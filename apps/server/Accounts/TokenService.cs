using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Telae.Server.Accounts;

public sealed class TokenService(IOptions<AuthOptions> options, TimeProvider clock)
{
    public const string AccountIdClaim = JwtRegisteredClaimNames.Sub;
    public const string UsernameClaim = "username";

    public static SymmetricSecurityKey SigningKey(string jwtKey) => new(Encoding.UTF8.GetBytes(jwtKey));

    public (string Token, DateTimeOffset ExpiresAt) CreateAccessToken(Account account)
    {
        var auth = options.Value;
        var now = clock.GetUtcNow();
        var expires = now.AddMinutes(auth.AccessTokenMinutes);
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = auth.Issuer,
            Audience = auth.Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = expires.UtcDateTime,
            Subject = new ClaimsIdentity([
                new Claim(AccountIdClaim, account.Id.ToString()),
                new Claim(UsernameClaim, account.Username),
            ]),
            SigningCredentials = new SigningCredentials(SigningKey(auth.JwtKey), SecurityAlgorithms.HmacSha256),
        };
        return (new JsonWebTokenHandler().CreateToken(descriptor), expires);
    }

    public static string NewRefreshToken() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    /// <summary>
    /// Código de 6 dígitos. O hash usa HMAC com a chave do servidor: um vazamento do banco
    /// não permite testar os 1.000.000 de códigos offline.
    /// </summary>
    public string HashCode(Guid accountId, OneTimeCodePurpose purpose, string code)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(options.Value.JwtKey));
        return Convert.ToHexStringLower(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{accountId}:{(int)purpose}:{code}")));
    }

    public static string NewCode() =>
        RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
