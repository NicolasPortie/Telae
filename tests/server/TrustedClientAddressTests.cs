using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Http;
using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging.Abstractions;
using Telae.Server.Core;

namespace Telae.Server.Tests;

public sealed class TrustedClientAddressTests
{
    [Fact]
    public async Task Untrusted_peer_cannot_spoof_address_or_https()
    {
        var services = new ServiceCollection();
        services.AddTrustedClientAddress(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ClientAddress:KnownProxies:0"] = "127.0.0.1",
        }).Build());
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<ForwardedHeadersOptions>>();
        var middleware = new ForwardedHeadersMiddleware(_ => Task.CompletedTask, NullLoggerFactory.Instance, options);
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse("203.0.113.10");
        context.Request.Scheme = "http";
        context.Request.Headers["CF-Connecting-IP"] = "198.51.100.20";
        context.Request.Headers["X-Forwarded-Proto"] = "https";

        await middleware.Invoke(context);

        Assert.Equal("http", context.Request.Scheme);
        Assert.Equal(IPAddress.Parse("203.0.113.10"), context.Connection.RemoteIpAddress);
    }

    [Fact]
    public void Forwarding_is_disabled_by_default_with_no_implicit_loopback_or_network_trust()
    {
        var services = new ServiceCollection();
        services.AddTrustedClientAddress(new ConfigurationBuilder().Build());
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value;
        Assert.Equal(ForwardedHeaders.None, options.ForwardedHeaders);
        Assert.Empty(options.KnownProxies);
        Assert.Empty(options.KnownIPNetworks);
        Assert.Equal(1, options.ForwardLimit);
    }

    [Fact]
    public void Only_explicit_proxies_and_the_selected_client_header_are_enabled()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ClientAddress:KnownProxies:0"] = "127.0.0.1",
            ["ClientAddress:KnownProxies:1"] = "::1",
            ["ClientAddress:HeaderName"] = "CF-Connecting-IP"
        }).Build();
        var services = new ServiceCollection();
        services.AddTrustedClientAddress(configuration);
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value;
        Assert.Equal(ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto, options.ForwardedHeaders);
        Assert.Equal("CF-Connecting-IP", options.ForwardedForHeaderName);
        Assert.Equal(2, options.KnownProxies.Count);
        Assert.Empty(options.KnownIPNetworks);
        Assert.Equal(1, options.ForwardLimit);
    }

    [Theory]
    [InlineData("0.0.0.0")]
    [InlineData("::")]
    [InlineData("::ffff:0.0.0.0")]
    [InlineData("127.0.0.0/8")]
    [InlineData("*")]
    [InlineData("localhost")]
    public void Broad_or_invalid_proxy_configuration_is_rejected(string proxy)
    {
        Assert.True(new ClientAddressValidator().Validate(null,
            new ClientAddressConfiguration { KnownProxies = [proxy] }).Failed);
    }

    [Fact]
    public void Unsupported_header_fails_configuration_instead_of_silently_trusting_it()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ClientAddress:KnownProxies:0"] = "127.0.0.1",
            ["ClientAddress:HeaderName"] = "X-User-Controlled-IP"
        }).Build();
        var services = new ServiceCollection();
        services.AddTrustedClientAddress(configuration);
        using var provider = services.BuildServiceProvider();
        Assert.Throws<OptionsValidationException>(() =>
            provider.GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value);
    }
}
