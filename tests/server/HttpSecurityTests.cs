using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Telae.Server.Core;

namespace Telae.Server.Tests;

public sealed class HttpSecurityTests : IAsyncLifetime
{
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ClientAddress:KnownProxies:0"] = "127.0.0.1",
        });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddTrustedClientAddress(builder.Configuration);
        builder.Services.AddTelaeCors();
        builder.Services.AddHsts(options => options.MaxAge = TimeSpan.FromDays(180));
        _app = builder.Build();
        _app.UseForwardedHeaders();
        _app.UseHsts();
        _app.UseTelaeHttpSecurity();
        _app.UseCors();
        _app.MapPost("/auth/echo", (Payload body) => body);
        _app.MapGet("/health", () => new { status = "ok" });
        await _app.StartAsync();
        var address = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        _http = new HttpClient { BaseAddress = new Uri(address) };
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Oversized_auth_json_is_rejected_before_binding_with_or_without_a_length(bool chunked)
    {
        var json = "{\"value\":\"" + new string('x', (int)HttpSecurity.AuthBodyLimit) + "\"}";
        using HttpContent content = chunked ? new ChunkedJson(json) : new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await _http.PostAsync("/auth/echo", content);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Auth_responses_are_not_cached_and_have_security_headers()
    {
        using var response = await _http.PostAsJsonAsync("/auth/echo", new Payload("test"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
        Assert.Contains("frame-ancestors 'none'", response.Headers.GetValues("Content-Security-Policy").Single());
    }

    [Fact]
    public async Task Hsts_recognizes_https_reported_by_the_explicit_proxy()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Host = "telae.example.com";
        request.Headers.Add("CF-Connecting-IP", "198.51.100.10");
        request.Headers.Add("X-Forwarded-Proto", "https");
        using var response = await _http.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("max-age=15552000", response.Headers.GetValues("Strict-Transport-Security").Single());
    }


    [Theory]
    [InlineData("telae://app", true)]
    [InlineData("telae://other", false)]
    [InlineData("telae://app.evil.example", false)]
    public async Task Cors_accepts_only_the_packaged_desktop_origin(string origin, bool allowed)
    {
        using var request = new HttpRequestMessage(HttpMethod.Options, "/auth/echo");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");
        using var response = await _http.SendAsync(request);
        Assert.Equal(allowed, response.Headers.Contains("Access-Control-Allow-Origin"));
        if (allowed) Assert.Equal(origin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await _app.DisposeAsync();
    }

    public sealed record Payload(string Value);

    private sealed class ChunkedJson : HttpContent
    {
        private readonly string _json;

        public ChunkedJson(string json)
        {
            _json = json;
            Headers.ContentType = new("application/json");
        }

        protected override bool TryComputeLength(out long length) { length = 0; return false; }
        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            await stream.WriteAsync(Encoding.UTF8.GetBytes(_json));
    }
}
