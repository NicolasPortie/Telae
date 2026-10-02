using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace Telae.Server.Core;

/// <summary>
/// Emite credenciais TURN efêmeras no formato REST da coturn:
/// username = "expiryUnix:deviceId", password = base64(HMAC-SHA1(secret, username)).
/// </summary>
public sealed class TurnConfiguration
{
    public string? Secret { get; set; }
    public string[] Urls { get; set; } = [];
    public int TtlSeconds { get; set; } = 3600;
}

public sealed class TurnConfigurationValidator : IValidateOptions<TurnConfiguration>
{
    public ValidateOptionsResult Validate(string? name, TurnConfiguration options)
    {
        var hasSecret = !string.IsNullOrWhiteSpace(options.Secret);
        var hasUrls = options.Urls is { Length: > 0 };
        if (hasSecret != hasUrls)
            return ValidateOptionsResult.Fail("TURN requires both a secret and URLs.");
        if (options.TtlSeconds is < 60 or > 86_400)
            return ValidateOptionsResult.Fail("TURN TTL must be between 60 and 86400 seconds.");
        if (options.Urls is null || options.Urls.Length > 16 || options.Urls.Any(url => !IsValidUrl(url)))
            return ValidateOptionsResult.Fail("TURN URLs must contain a valid turn/turns host, optional port and UDP/TCP transport; embedded credentials are forbidden.");
        return ValidateOptionsResult.Success;
    }

    private static bool IsValidUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url) || url.Length > 2048) return false;
        var schemeEnd = url.IndexOf(':');
        if (schemeEnd < 0 || url[..schemeEnd] is not ("turn" or "turns")) return false;
        var parts = url[(schemeEnd + 1)..].Split('?');
        if (parts.Length > 2 || (parts.Length == 2 && parts[1] is not ("transport=udp" or "transport=tcp"))) return false;
        var host = parts[0];
        if (host.Any(c => char.IsWhiteSpace(c) || c is '/' or '@' or '#' or '\\')) return false;
        return Uri.TryCreate("http://" + host, UriKind.Absolute, out var parsed) &&
            parsed.Host.Length > 0 && parsed.HostNameType is not UriHostNameType.Unknown && parsed.Port is > 0 and <= 65535;
    }
}

public sealed record ConnectivityHealth(bool StunConfigured, bool TurnConfigured, string RelayReachability)
{
    public static ConnectivityHealth From(IceConfiguration ice, TurnConfiguration turn) => new(
        ice.Servers.Count == 0 || ice.Servers.Any(server => server.Urls.Any(url => url.StartsWith("stun:", StringComparison.Ordinal))),
        !string.IsNullOrWhiteSpace(turn.Secret) && turn.Urls.Length > 0,
        "unverified");
}

public static class TurnCredentialIssuer
{
    public static (string Username, string Password) Issue(
        string secret,
        string deviceId,
        DateTimeOffset now,
        int ttlSeconds)
    {
        if (string.IsNullOrWhiteSpace(secret))
            throw new TelaeDomainException("turn_not_configured", "O serviço TURN não está configurado.");
        if (ttlSeconds <= 0)
            throw new TelaeDomainException("invalid_turn_ttl", "A duração da credencial TURN é inválida.");

        var username = $"{now.ToUnixTimeSeconds() + ttlSeconds}:{deviceId.Trim()}";
        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        var password = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(username)));
        return (username, password);
    }
}
