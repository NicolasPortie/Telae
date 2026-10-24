using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Telae.Server.Accounts;
using Telae.Server.Core;

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
            ["Auth:LoginBackoffSeconds"] = "60",
            ["ClientAddress:KnownProxies:0"] = "127.0.0.1",
        });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddTelaeAccounts(builder.Configuration, builder.Environment);
        builder.Services.AddTrustedClientAddress(builder.Configuration);
        builder.Services.AddAuthRateLimits();
        builder.Services.AddSingleton<IEmailSender>(_email);

        _app = builder.Build();
        _app.UseForwardedHeaders();
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
        var session = await (await _http.PostAsJsonAsync("/auth/verify-email", new VerifyRequest("ana", _email.LastCode("ana@example.com"), Password))).Content.ReadFromJsonAsync<AuthResult>();
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
        var session = await (await _http.PostAsJsonAsync("/auth/verify-email", new VerifyRequest("ana", _email.LastCode("ana@example.com"), Password))).Content.ReadFromJsonAsync<AuthResult>();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/auth/me");
        request.Headers.Authorization = new("Bearer", session!.AccessToken[..^4] + "AAAA");
        Assert.Equal(HttpStatusCode.Unauthorized, (await _http.SendAsync(request)).StatusCode);
    }

    private async Task<AuthResult> SignInAsync()
    {
        await _http.PostAsJsonAsync("/auth/register", new RegisterRequest("ana@example.com", "ana", Password, null));
        return (await (await _http.PostAsJsonAsync("/auth/verify-email",
            new VerifyRequest("ana", _email.LastCode("ana@example.com"), Password))).Content.ReadFromJsonAsync<AuthResult>())!;
    }

    [Fact]
    public async Task Password_routes_use_the_client_address_resolved_by_the_trusted_proxy()
    {
        var session = await SignInAsync();
        async Task<HttpResponseMessage> SendAsync(string path, object body, string address, bool signedIn = false)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
            request.Headers.Add("CF-Connecting-IP", address);
            if (signedIn) request.Headers.Authorization = new("Bearer", session.AccessToken);
            return await _http.SendAsync(request);
        }
        for (var index = 0; index < 5; index++)
        {
            using var failed = await SendAsync("/auth/login", new LoginRequest("ana", "wrong"), "198.51.100.1");
            Assert.Equal(HttpStatusCode.Unauthorized, failed.StatusCode);
        }
        using var blocked = await SendAsync("/auth/login", new LoginRequest("ana", Password), "198.51.100.1");
        using var owner = await SendAsync("/auth/login", new LoginRequest("ana", Password), "198.51.100.2");
        Assert.Equal(HttpStatusCode.Unauthorized, blocked.StatusCode);
        Assert.Equal(HttpStatusCode.OK, owner.StatusCode);
        using var change = await SendAsync("/auth/change-password", new ChangePasswordRequest(Password, "outra-senha-segura-27"), "198.51.100.1", signedIn: true);
        using var delete = await SendAsync("/auth/delete-account", new PasswordConfirmRequest(Password), "198.51.100.1", signedIn: true);
        Assert.Equal(HttpStatusCode.Unauthorized, change.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, delete.StatusCode);
    }

    private async Task<HttpStatusCode> ProfileStatusAsync(string accessToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/auth/me");
        request.Headers.Authorization = new("Bearer", accessToken);
        return (await _http.SendAsync(request)).StatusCode;
    }

    [Fact]
    public async Task Logout_immediately_rejects_the_previously_valid_access_token()
    {
        var session = await SignInAsync();
        Assert.Equal(HttpStatusCode.OK, await ProfileStatusAsync(session.AccessToken));
        Assert.Equal(HttpStatusCode.NoContent, (await _http.PostAsJsonAsync("/auth/logout", new RefreshRequest(session.RefreshToken))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await ProfileStatusAsync(session.AccessToken));
    }

    [Fact]
    public async Task Password_change_immediately_rejects_old_access_and_keeps_the_new_session()
    {
        var session = await SignInAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/auth/change-password");
        request.Headers.Authorization = new("Bearer", session.AccessToken);
        request.Content = JsonContent.Create(new ChangePasswordRequest(Password, "outra-senha-segura-27"));
        var response = await _http.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var fresh = (await response.Content.ReadFromJsonAsync<AuthResult>())!;
        Assert.Equal(HttpStatusCode.Unauthorized, await ProfileStatusAsync(session.AccessToken));
        Assert.Equal(HttpStatusCode.OK, await ProfileStatusAsync(fresh.AccessToken));
        Assert.Equal(HttpStatusCode.Unauthorized, (await _http.PostAsJsonAsync("/auth/refresh", new RefreshRequest(session.RefreshToken))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await ProfileStatusAsync(fresh.AccessToken));
    }
}
