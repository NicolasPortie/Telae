using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Telae.Server.Accounts;

namespace Telae.Server.Tests;

public sealed class TokenKeySeparationTests
{
    [Fact]
    public async Task Jwt_and_codes_use_independent_versioned_hkdf_keys_and_reject_the_old_root_key()
    {
        var options = new AuthOptions { JwtKey = new string('k', 48) };
        var service = new TokenService(Options.Create(options), TimeProvider.System);
        var account = new Account { Username = "ana" };
        var (token, _) = service.CreateAccessToken(account, Guid.NewGuid());
        var root = Encoding.UTF8.GetBytes(options.JwtKey);
        var signing = HKDF.DeriveKey(HashAlgorithmName.SHA256, root, 32, info: "telae/jwt-signing/v1"u8.ToArray());
        var codes = HKDF.DeriveKey(HashAlgorithmName.SHA256, root, 32, info: "telae/one-time-codes/v1"u8.ToArray());
        Assert.NotEqual(signing, codes);
        Assert.Equal(signing, TokenService.SigningKey(options.JwtKey).Key);
        TokenValidationParameters Validation(byte[] key) => new()
        {
            ValidIssuer = options.Issuer, ValidAudience = options.Audience, IssuerSigningKey = new SymmetricSecurityKey(key),
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256], ClockSkew = TimeSpan.Zero,
        };
        var handler = new JsonWebTokenHandler();
        Assert.True((await handler.ValidateTokenAsync(token, Validation(signing))).IsValid);
        Assert.False((await handler.ValidateTokenAsync(token, Validation(codes))).IsValid);
        Assert.False((await handler.ValidateTokenAsync(token, Validation(root))).IsValid);
        var legacy = handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = options.Issuer, Audience = options.Audience, Expires = DateTime.UtcNow.AddMinutes(5),
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(root), SecurityAlgorithms.HmacSha256),
        });
        Assert.False((await handler.ValidateTokenAsync(legacy, Validation(signing))).IsValid);

        var message = Encoding.UTF8.GetBytes($"{account.Id}:{(int)OneTimeCodePurpose.ResetPassword}:123456");
        var actual = service.HashCode(account.Id, OneTimeCodePurpose.ResetPassword, "123456");
        Assert.Equal(Convert.ToHexStringLower(HMACSHA256.HashData(codes, message)), actual);
        Assert.NotEqual(Convert.ToHexStringLower(HMACSHA256.HashData(root, message)), actual);
        Assert.NotEqual(Convert.ToHexStringLower(HMACSHA256.HashData(signing, message)), actual);
        Assert.NotEqual(actual, service.HashCode(account.Id, OneTimeCodePurpose.VerifyEmail, "123456"));
    }
}
