using System.Security.Cryptography;
using System.Text;
using Telae.Server.Core;

namespace Telae.Server.Tests;

public sealed class TurnCredentialTests
{
    [Fact]
    public void Issued_credentials_verify_against_the_shared_secret()
    {
        const string secret = "test-shared-secret";
        var now = DateTimeOffset.UtcNow;

        var (username, password) = TurnCredentialIssuer.Issue(secret, "device-nicolas", now, 3600);

        var parts = username.Split(':');
        Assert.Equal(2, parts.Length);
        Assert.Equal("device-nicolas", parts[1]);
        var expiry = long.Parse(parts[0]);
        Assert.True(expiry > now.ToUnixTimeSeconds());

        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        var expected = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(username)));
        Assert.Equal(expected, password);
    }

    [Fact]
    public void Missing_secret_fails_with_turn_not_configured()
    {
        var error = Assert.Throws<TelaeDomainException>(() =>
            TurnCredentialIssuer.Issue("", "device-nicolas", DateTimeOffset.UtcNow, 3600));
        Assert.Equal("turn_not_configured", error.Code);
    }
}
