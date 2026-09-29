using System.Security.Cryptography;
using System.Text;

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
