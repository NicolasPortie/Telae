using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Telae.Server.Core;

namespace Telae.Server.Tests;

public sealed class TurnCredentialTests
{
    [Fact]
    public async Task Invalid_turn_configuration_prevents_host_startup()
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddSingleton<IValidateOptions<TurnConfiguration>, TurnConfigurationValidator>();
        builder.Services.AddOptions<TurnConfiguration>().Configure(options => options.Secret = "private-secret").ValidateOnStart();
        using var host = builder.Build();
        var error = await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
        Assert.DoesNotContain("private-secret", error.Message);
    }
    [Theory]
    [InlineData("turn:relay.example.com:3478?transport=udp")]
    [InlineData("turns:relay.example.com:5349?transport=tcp")]
    [InlineData("turn:[::1]:3478")]
    public void Valid_turn_configuration_is_accepted(string url)
    {
        Assert.True(new TurnConfigurationValidator().Validate(null,
            new TurnConfiguration { Secret = "private-secret", Urls = [url] }).Succeeded);
    }

    [Theory]
    [InlineData("stun:relay.example.com")]
    [InlineData("turn:user:password@relay.example.com")]
    [InlineData("turn:relay.example.com/path")]
    [InlineData("turn:relay.example.com:99999")]
    [InlineData("turn:relay.example.com?transport=invalid")]
    [InlineData("turn:")]
    [InlineData("turn:relay.example.com#fragment")]
    public void Invalid_turn_urls_fail_without_echoing_configuration(string url)
    {
        var result = new TurnConfigurationValidator().Validate(null,
            new TurnConfiguration { Secret = "private-secret", Urls = [url] });
        Assert.True(result.Failed);
        Assert.DoesNotContain(url, result.FailureMessage);
        Assert.DoesNotContain("private-secret", result.FailureMessage);
    }

    [Fact]
    public void Disabled_turn_is_valid_but_partial_configuration_and_bad_ttl_fail()
    {
        var validator = new TurnConfigurationValidator();
        Assert.True(validator.Validate(null, new TurnConfiguration()).Succeeded);
        Assert.True(validator.Validate(null, new TurnConfiguration { Secret = "secret" }).Failed);
        Assert.True(validator.Validate(null, new TurnConfiguration { Urls = ["turn:relay.example.com"] }).Failed);
        Assert.True(validator.Validate(null, new TurnConfiguration { TtlSeconds = 0 }).Failed);
        Assert.True(validator.Validate(null, new TurnConfiguration { TtlSeconds = 86_401 }).Failed);
    }

    [Fact]
    public void Connectivity_health_reports_configuration_without_claiming_reachability_or_exposing_credentials()
    {
        var turn = new TurnConfiguration { Secret = "private-secret", Urls = ["turn:private-host.example.com"] };
        var health = ConnectivityHealth.From(new IceConfiguration(), turn);
        Assert.True(health.StunConfigured);
        Assert.True(health.TurnConfigured);
        Assert.Equal("unverified", health.RelayReachability);
        var json = System.Text.Json.JsonSerializer.Serialize(health);
        Assert.DoesNotContain(turn.Secret, json);
        Assert.DoesNotContain(turn.Urls[0], json);
        Assert.False(ConnectivityHealth.From(new IceConfiguration(), new TurnConfiguration()).TurnConfigured);
    }

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
