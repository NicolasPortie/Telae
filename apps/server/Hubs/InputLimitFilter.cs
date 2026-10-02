using System.Threading.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Telae.Server.Core;

namespace Telae.Server.Hubs;

// RemoteIpAddress is rewritten only by configured trusted-proxy middleware.
// Never read forwarded headers here. Other operations are per connection.
public sealed class InputLimitFilter : IHubFilter, IDisposable
{
    private readonly PartitionedRateLimiter<string> _registration = Create(30);
    private readonly PartitionedRateLimiter<string> _commands = Create(120);
    private readonly PartitionedRateLimiter<string> _signals = Create(1200);

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
        var key = registration
            ? context.Context.GetHttpContext()?.Connection.RemoteIpAddress?.MapToIPv6().ToString() ?? context.Context.ConnectionId
            : context.Context.ConnectionId;
        using var lease = limiter.AttemptAcquire(key);
        if (!lease.IsAcquired)
            throw new TelaeDomainException("rate_limited", "Muitas solicitações. Aguarde um minuto e tente novamente.");
        return await next(context);
    }

    public void Dispose()
    {
        _registration.Dispose();
        _commands.Dispose();
        _signals.Dispose();
    }
}
