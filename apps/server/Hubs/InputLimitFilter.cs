using System.Collections.Concurrent;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Telae.Server.Accounts;
using Telae.Server.Core;

namespace Telae.Server.Hubs;

// O endereço já passou pela validação dos proxies confiáveis.
public sealed class InputLimitFilter : IHubFilter, IDisposable
{
    private readonly PartitionedRateLimiter<string> _registration = Create(30);
    private readonly PartitionedRateLimiter<string> _commands = Create(120);
    private readonly PartitionedRateLimiter<string> _signals = Create(1200);
    // Sessões conferidas no banco há pouco: evita uma consulta por candidato ICE. A revogação não espera
    // o cache vencer, porque PresenceSubscriptions guarda as revogações em memória.
    public static readonly TimeSpan SessionCheckInterval = TimeSpan.FromSeconds(30);
    private readonly ConcurrentDictionary<string, DateTimeOffset> _verifiedSessions = new(StringComparer.Ordinal);

    private static PartitionedRateLimiter<string> Create(int permits) =>
        PartitionedRateLimiter.Create<string, string>(key => RateLimitPartition.GetFixedWindowLimiter(key,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permits, Window = TimeSpan.FromMinutes(1), QueueLimit = 0,
                AutoReplenishment = true
            }));

    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext context,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        var registration = context.HubMethodName == "RegisterDevice";
        var limiter = registration ? _registration : context.HubMethodName == "SendSignal" ? _signals : _commands;
        var key = registration || context.Context.User?.Identity?.IsAuthenticated != true
            ? context.Context.GetHttpContext()?.Connection.RemoteIpAddress?.MapToIPv6().ToString() ?? context.Context.ConnectionId
            : context.Context.User.FindFirst(TokenService.AccountIdClaim)?.Value ?? context.Context.ConnectionId;
        using var lease = limiter.AttemptAcquire(key);
        if (!lease.IsAcquired)
            throw new TelaeDomainException("rate_limited", "Muitos pedidos em pouco tempo. Espera um minuto e tenta de novo.");
        if (context.Context.User?.Identity?.IsAuthenticated == true)
        {
            if (!await IsSessionActiveAsync(context))
            {
                var accountId = context.Context.User.FindFirst(TokenService.AccountIdClaim)?.Value;
                if (accountId is not null && context.ServiceProvider.GetService<PresenceSubscriptions>() is { } presence)
                    await presence.RevokeAccountAsync(accountId, context.Context.ConnectionId);
                context.Context.Abort();
                throw new TelaeDomainException("session_expired", "Sua sessão acabou. Entra de novo.");
            }
        }
        return await next(context);
    }

    private async Task<bool> IsSessionActiveAsync(HubInvocationContext context)
    {
        var user = context.Context.User!;
        var accountId = user.FindFirst(TokenService.AccountIdClaim)?.Value;
        var sessionId = user.FindFirst(TokenService.SessionIdClaim)?.Value;
        if (accountId is null || sessionId is null) return false;
        // iat tem resolução de segundos: o segundo seguinte evita barrar um token emitido logo após a revogação.
        var issuedAt = long.TryParse(user.FindFirst("iat")?.Value, out var iat) ? DateTimeOffset.FromUnixTimeSeconds(iat + 1) : DateTimeOffset.MaxValue;
        var presence = context.ServiceProvider.GetService<PresenceSubscriptions>();
        if (presence?.IsRevoked(accountId, sessionId, issuedAt) == true)
        {
            _verifiedSessions.TryRemove(sessionId, out _);
            return false;
        }
        var now = DateTimeOffset.UtcNow;
        if (_verifiedSessions.TryGetValue(sessionId, out var validUntil) && validUntil > now) return true;

        var accounts = context.ServiceProvider.GetService<AccountService>();
        if (accounts is null || !await accounts.IsSessionActiveAsync(user, context.Context.ConnectionAborted, requireUnexpiredToken: false))
        {
            _verifiedSessions.TryRemove(sessionId, out _);
            return false;
        }
        if (_verifiedSessions.Count >= 10_000)
            foreach (var stale in _verifiedSessions.Where(pair => pair.Value <= now).Select(pair => pair.Key).ToArray())
                _verifiedSessions.TryRemove(stale, out _);
        _verifiedSessions[sessionId] = now + SessionCheckInterval;
        return true;
    }

    public void Dispose()
    {
        _registration.Dispose();
        _commands.Dispose();
        _signals.Dispose();
    }
}
