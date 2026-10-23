using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Telae.Server.Accounts;

namespace Telae.Server.Tests;

/// <summary>Endpoints REST de conta rodando de verdade (Kestrel + SQLite), incluindo os limites por IP.</summary>
public sealed class AuthEndpointsTests : IAsyncLifetime
{
    private const string Password = "uma-senha-bem-longa-42";
    private readonly string _root = Path.Combine(Path.GetTempPath(), "telae-auth-http-" + Guid.NewGuid().ToString("N"));
    private WebApplication? _app;
    private HttpClient _http = new();
    private readonly CapturingEmail _email = new();

    public Task InitializeAsync() => StartAsync(strict: 3);

    private async Task StartAsync(int strict)
    {
        Directory.CreateDirectory(_root);
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing", ContentRootPath = _root });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:JwtKey"] = new string('k', 48),
            ["Auth:StrictRequestsPerMinute"] = strict.ToString(),
            ["Auth:RequestsPerMinute"] = "1000",
        });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddTelaeAccounts(builder.Configuration, builder.Environment);
        builder.Services.AddAuthRateLimits();
        builder.Services.AddSingleton<IEmailSender>(_email);

        _app = builder.Build();
        _app.UseAuthentication();
        _app.UseAuthorization();
        _app.UseRateLimiter();
        _app.MapAuth();
        await _app.Services.InitializeAccountsDatabaseAsync();
        await _app.StartAsync();
        var address = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!
            .Addresses.First(a => a.StartsWith("http://", StringComparison.Ordinal));
        _http = new HttpClient { BaseAddress = new Uri(address) };
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        if (_app is not null) await _app.DisposeAsync();
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    private Task<HttpResponseMessage> RegisterAsync(int index) =>
        _http.PostAsJsonAsync("/auth/register", new RegisterRequest($"user{index}@example.com", $"user_{index}", Password, "pt-BR"));

    [Fact]
    public async Task Registration_is_limited_per_address_with_a_stable_error_code()
    {
        for (var index = 0; index < 3; index++)
            Assert.Equal(HttpStatusCode.OK, (await RegisterAsync(index)).StatusCode);

        var blocked = await RegisterAsync(99);
        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
        Assert.Contains("rate_limited", await blocked.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_full_flow_works_over_http_and_protected_routes_need_a_token()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _http.GetAsync("/auth/me")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await _http.PostAsJsonAsync("/auth/register", new RegisterRequest("ana@example.com", "ana", Password, "en"))).StatusCode);
        var session = await (await _http.PostAsJsonAsync("/auth/verify-email", new VerifyRequest("ana", _email.LastCode("ana@example.com")))).Content.ReadFromJsonAsync<AuthResult>();
        Assert.NotNull(session);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/auth/me");
        request.Headers.Authorization = new("Bearer", session.AccessToken);
        var me = await (await _http.SendAsync(request)).Content.ReadFromJsonAsync<AccountDto>();
        Assert.Equal("ana", me!.Username);

        var wrong = await _http.PostAsJsonAsync("/auth/login", new LoginRequest("ana", "errada-errada-1"));
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Contains("invalid_credentials", await wrong.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_tampered_access_token_is_rejected()
    {
        await _http.PostAsJsonAsync("/auth/register", new RegisterRequest("ana@example.com", "ana", Password, null));
        var session = await (await _http.PostAsJsonAsync("/auth/verify-email", new VerifyRequest("ana", _email.LastCode("ana@example.com")))).Content.ReadFromJsonAsync<AuthResult>();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/auth/me");
        request.Headers.Authorization = new("Bearer", session!.AccessToken[..^4] + "AAAA");
        Assert.Equal(HttpStatusCode.Unauthorized, (await _http.SendAsync(request)).StatusCode);
    }
}
