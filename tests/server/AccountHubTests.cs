using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Telae.Server.Accounts;
using Telae.Server.Core;
using Telae.Server.Hubs;

namespace Telae.Server.Tests;

/// <summary>Hub real com autenticação por token de conta e a trava do caminho legado.</summary>
public sealed class AccountHubTests : IAsyncLifetime
{
    private const string Password = "uma-senha-bem-longa-42";
    private readonly string _root = Path.Combine(Path.GetTempPath(), "telae-account-hub-" + Guid.NewGuid().ToString("N"));
    private readonly List<HubConnection> _connections = [];
    private WebApplication? _app;
    private string _baseUrl = "";

    public Task InitializeAsync() => StartAsync(allowLegacy: false);

    private async Task StartAsync(bool allowLegacy)
    {
        Directory.CreateDirectory(_root);
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing", ContentRootPath = _root });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:JwtKey"] = new string('k', 48),
            ["Auth:RequireEmailVerification"] = "false",
            ["Auth:AllowLegacyDevices"] = allowLegacy ? "true" : "false",
        });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddTrustedClientAddress(builder.Configuration);
        builder.Services.AddTelaeAccounts(builder.Configuration, builder.Environment);
        builder.Services.AddSignalR(options => options.AddFilter(typeof(DomainErrorFilter)));
        builder.Services.AddSingleton(new TelaeRegistry());
        builder.Services.AddSingleton<PresenceSubscriptions>();
        builder.Services.AddSingleton<DisconnectCoordinator>();
        builder.Services.AddSingleton<InputLimitFilter>();
        builder.Services.AddSingleton<IValidateOptions<TurnConfiguration>, TurnConfigurationValidator>();
        builder.Services.AddOptions<TurnConfiguration>();
        builder.Services.Configure<IceConfiguration>(options => options.Servers.Add(new IceServerDto(["stun:stun.example.com"])));

        _app = builder.Build();
        _app.UseAuthentication();
        _app.UseAuthorization();
        _app.MapHub<TelaeHub>("/hubs/telae");
        await _app.Services.InitializeAccountsDatabaseAsync();
        await _app.StartAsync();
        _baseUrl = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!
            .Addresses.First(a => a.StartsWith("http://", StringComparison.Ordinal));
    }

    public async Task DisposeAsync()
    {
        foreach (var connection in _connections) await connection.DisposeAsync();
        if (_app is not null) await _app.DisposeAsync();
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    private async Task<AuthResult> NewAccountAsync(string username)
    {
        using var scope = _app!.Services.CreateScope();
        var result = await scope.ServiceProvider.GetRequiredService<AccountService>()
            .RegisterAsync($"{username}@example.com", username, Password, null, null, default);
        return result.Session!;
    }

    private HubConnection Connect(string? accessToken)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl($"{_baseUrl}/hubs/telae", options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                if (accessToken is not null) options.AccessTokenProvider = () => Task.FromResult<string?>(accessToken);
            })
            .Build();
        _connections.Add(connection);
        return connection;
    }

    [Fact]
    public async Task A_valid_token_registers_the_account_as_the_device_and_ignores_what_the_client_sends()
    {
        var session = await NewAccountAsync("ana");
        var connection = Connect(session.AccessToken);
        await connection.StartAsync();

        var device = await connection.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest("id-forjado", "Nome Forjado", ""));

        Assert.Equal(session.Account.Id.ToString(), device.DeviceId);
        Assert.Equal("ana", device.DisplayName);
        Assert.Matches("^[A-Z2-9]{6}$", device.FriendCode);
    }

    [Fact]
    public async Task Reconnecting_with_the_same_account_keeps_the_friend_code()
    {
        var session = await NewAccountAsync("ana");
        var first = Connect(session.AccessToken);
        await first.StartAsync();
        var one = await first.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("x", "x", ""));
        await first.StopAsync();

        var second = Connect(session.AccessToken);
        await second.StartAsync();
        var two = await second.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("x", "x", ""));
        Assert.Equal(one.FriendCode, two.FriendCode);
    }

    [Fact]
    public async Task Without_a_token_the_legacy_device_path_is_refused_when_disabled()
    {
        var connection = Connect(null);
        await connection.StartAsync();
        var error = await Assert.ThrowsAsync<HubException>(() => connection.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest("legacy-device", "Legado", new string('a', 64))));
        Assert.Contains("Entre na sua conta", error.Message);
    }

    [Fact]
    public async Task A_tampered_or_expired_token_is_treated_as_anonymous()
    {
        var session = await NewAccountAsync("ana");
        var connection = Connect(session.AccessToken[..^3] + "abc");
        await connection.StartAsync();
        var error = await Assert.ThrowsAsync<HubException>(() => connection.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest(session.Account.Id.ToString(), "ana", new string('a', 64))));
        Assert.Contains("Entre na sua conta", error.Message);
    }

    [Fact]
    public async Task A_deleted_account_cannot_register_with_a_token_that_is_still_valid()
    {
        var session = await NewAccountAsync("ana");
        using (var scope = _app!.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<AccountService>().DeleteAsync(session.Account.Id, Password, default);

        var connection = Connect(session.AccessToken);
        await connection.StartAsync();
        var error = await Assert.ThrowsAsync<HubException>(() => connection.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest("x", "x", "")));
        Assert.Contains("sessão expirou", error.Message);
    }

    [Fact]
    public async Task Two_accounts_get_distinct_identities_and_cannot_take_over_each_other()
    {
        var ana = await NewAccountAsync("ana");
        var bia = await NewAccountAsync("bia");
        var one = Connect(ana.AccessToken);
        var two = Connect(bia.AccessToken);
        await one.StartAsync();
        await two.StartAsync();

        var deviceAna = await one.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest(bia.Account.Id.ToString(), "bia", ""));
        var deviceBia = await two.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest(ana.Account.Id.ToString(), "ana", ""));

        Assert.Equal(ana.Account.Id.ToString(), deviceAna.DeviceId);
        Assert.Equal(bia.Account.Id.ToString(), deviceBia.DeviceId);
        Assert.NotEqual(deviceAna.FriendCode, deviceBia.FriendCode);
    }
}
