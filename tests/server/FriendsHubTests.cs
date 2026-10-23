using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Telae.Server.Accounts;
using Telae.Server.Core;
using Telae.Server.Hubs;

namespace Telae.Server.Tests;

/// <summary>Amigos por @usuário no hub real: lista no banco, pedidos, amizade mútua e exclusão de conta.</summary>
public sealed class FriendsHubTests : IAsyncLifetime
{
    private const string Password = "uma-senha-bem-longa-42";
    private readonly string _root = Path.Combine(Path.GetTempPath(), "telae-friends-hub-" + Guid.NewGuid().ToString("N"));
    private readonly List<HubConnection> _connections = [];
    private WebApplication? _app;
    private string _baseUrl = "";

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_root);
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing", ContentRootPath = _root });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:JwtKey"] = new string('k', 48),
            ["Auth:RequireEmailVerification"] = "false",
            ["Auth:AllowLegacyDevices"] = "false",
        });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddTrustedClientAddress(builder.Configuration);
        builder.Services.AddTelaeAccounts(builder.Configuration, builder.Environment);
        builder.Services.AddSignalR(options => { options.EnableDetailedErrors = true; options.AddFilter(typeof(DomainErrorFilter)); });
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

    private async Task<HubConnection> ConnectAsync(AuthResult session)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl($"{_baseUrl}/hubs/telae", options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.AccessTokenProvider = () => Task.FromResult<string?>(session.AccessToken);
            })
            .Build();
        _connections.Add(connection);
        await connection.StartAsync();
        await connection.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("x", "x", ""));
        return connection;
    }

    private async Task<(HubConnection Connection, AuthResult Session)> SignedInAsync(string username)
    {
        var session = await NewAccountAsync(username);
        return (await ConnectAsync(session), session);
    }

    private static Task<IReadOnlyList<DeviceSnapshot>> FriendsOf(HubConnection connection) =>
        connection.InvokeAsync<IReadOnlyList<DeviceSnapshot>>("GetFriends", Array.Empty<string>());

    [Fact]
    public async Task Adding_by_username_ignores_case_and_the_at_sign_and_the_list_follows_the_account()
    {
        var (ana, anaSession) = await SignedInAsync("ana");
        await SignedInAsync("bia");

        var added = await ana.InvokeAsync<DeviceSnapshot>("AddFriend", " @BIA ");
        Assert.Equal("bia", added.FriendCode);
        Assert.Equal("online", added.Status);
        Assert.Equal(["bia"], (await FriendsOf(ana)).Select(friend => friend.FriendCode));

        // Outro aparelho da mesma conta vê a mesma lista: ela está no banco, não no computador.
        var another = await ConnectAsync(anaSession);
        Assert.Equal(["bia"], (await FriendsOf(another)).Select(friend => friend.FriendCode));
    }

    [Fact]
    public async Task A_friend_who_never_connected_still_shows_up_offline()
    {
        var (ana, _) = await SignedInAsync("ana");
        await NewAccountAsync("caio");
        Assert.Equal("offline", (await ana.InvokeAsync<DeviceSnapshot>("AddFriend", "caio")).Status);
        Assert.Equal("offline", (await FriendsOf(ana)).Single().Status);
    }

    [Fact]
    public async Task Invalid_unknown_self_and_duplicate_additions_are_refused_with_a_reason()
    {
        var (ana, _) = await SignedInAsync("ana");
        await NewAccountAsync("bia");
        await ana.InvokeAsync<DeviceSnapshot>("AddFriend", "bia");

        Assert.Contains("não parece certo", (await Assert.ThrowsAsync<HubException>(() => ana.InvokeAsync<DeviceSnapshot>("AddFriend", "a!"))).Message);
        Assert.Contains("Não achei ninguém", (await Assert.ThrowsAsync<HubException>(() => ana.InvokeAsync<DeviceSnapshot>("AddFriend", "ninguem"))).Message);
        Assert.Contains("se adicionar", (await Assert.ThrowsAsync<HubException>(() => ana.InvokeAsync<DeviceSnapshot>("AddFriend", "@ana"))).Message);
        Assert.Contains("já está na sua lista", (await Assert.ThrowsAsync<HubException>(() => ana.InvokeAsync<DeviceSnapshot>("AddFriend", "bia"))).Message);
    }

    [Fact]
    public async Task Adding_someone_notifies_them_live_and_they_accept_by_adding_back()
    {
        var (ana, _) = await SignedInAsync("ana");
        var (bia, _) = await SignedInAsync("bia");
        var received = new TaskCompletionSource<DeviceSnapshot>(TaskCreationOptions.RunContinuationsAsynchronously);
        bia.On<DeviceSnapshot>("FriendRequestReceived", device => received.TrySetResult(device));

        await ana.InvokeAsync<DeviceSnapshot>("AddFriend", "bia");
        Assert.Equal("ana", (await received.Task.WaitAsync(TimeSpan.FromSeconds(5))).FriendCode);

        Assert.Equal(["ana"], (await bia.InvokeAsync<IReadOnlyList<DeviceSnapshot>>("GetFriendRequests")).Select(request => request.FriendCode));
        await bia.InvokeAsync<DeviceSnapshot>("AddFriend", "ana");
        Assert.Empty(await bia.InvokeAsync<IReadOnlyList<DeviceSnapshot>>("GetFriendRequests"));
    }

    [Fact]
    public async Task A_request_made_while_the_other_person_is_offline_is_waiting_for_them()
    {
        var (ana, _) = await SignedInAsync("ana");
        var biaSession = await NewAccountAsync("bia");
        await ana.InvokeAsync<DeviceSnapshot>("AddFriend", "bia");

        var bia = await ConnectAsync(biaSession);
        Assert.Equal(["ana"], (await bia.InvokeAsync<IReadOnlyList<DeviceSnapshot>>("GetFriendRequests")).Select(request => request.FriendCode));
    }

    [Fact]
    public async Task Dismissed_requests_stay_dismissed()
    {
        var (ana, _) = await SignedInAsync("ana");
        var (bia, _) = await SignedInAsync("bia");
        await ana.InvokeAsync<DeviceSnapshot>("AddFriend", "bia");
        await bia.InvokeAsync("DismissFriendRequest", "ana");
        Assert.Empty(await bia.InvokeAsync<IReadOnlyList<DeviceSnapshot>>("GetFriendRequests"));
    }

    [Fact]
    public async Task Watching_needs_mutual_friendship_and_ends_when_either_side_removes_the_other()
    {
        var (ana, anaSession) = await SignedInAsync("ana");
        var (bia, _) = await SignedInAsync("bia");
        await ana.InvokeAsync<DeviceSnapshot>("AddFriend", "bia");
        await FriendsOf(bia);
        await ana.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest(anaSession.Account.Id.ToString(), "1080p30"));

        var refused = await Assert.ThrowsAsync<HubException>(() => bia.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ana"));
        Assert.Contains("precisam se adicionar", refused.Message);

        await bia.InvokeAsync<DeviceSnapshot>("AddFriend", "ana");
        var access = await bia.InvokeAsync<ShareAccessResult>("JoinFriendShare", "@Ana");
        Assert.Equal(anaSession.Account.Id.ToString(), access.Session.SharerDeviceId);

        var ended = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        bia.On<string>("SessionEnded", sessionId => ended.TrySetResult(sessionId));
        await ana.InvokeAsync("RemoveFriend", "bia");
        Assert.Equal(access.Session.SessionId, await ended.Task.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Empty(await FriendsOf(ana));
    }

    [Fact]
    public async Task Reconnecting_does_not_resend_friend_request_notifications()
    {
        var (ana, anaSession) = await SignedInAsync("ana");
        var (bia, _) = await SignedInAsync("bia");
        await ana.InvokeAsync<DeviceSnapshot>("AddFriend", "bia");

        var repeats = 0;
        bia.On<DeviceSnapshot>("FriendRequestReceived", _ => Interlocked.Increment(ref repeats));
        var again = await ConnectAsync(anaSession);
        await FriendsOf(again);
        await Task.Delay(300);
        Assert.Equal(0, repeats);
    }

    [Fact]
    public async Task Deleting_an_account_removes_it_from_other_lists_and_frees_its_username()
    {
        var (ana, _) = await SignedInAsync("ana");
        var biaSession = await NewAccountAsync("bia");
        await ana.InvokeAsync<DeviceSnapshot>("AddFriend", "bia");

        using (var scope = _app!.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<AccountService>().DeleteAsync(biaSession.Account.Id, Password, default);
            _app.Services.GetRequiredService<TelaeRegistry>().ForgetAccount(biaSession.Account.Id.ToString());
        }
        Assert.Empty(await FriendsOf(ana));

        var reborn = await NewAccountAsync("bia");
        var device = await (await ConnectAsync(reborn)).InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("x", "x", ""));
        Assert.Equal("bia", device.FriendCode);
    }

    [Fact]
    public async Task Presence_reaches_friends_by_username_group()
    {
        var (ana, _) = await SignedInAsync("ana");
        var (bia, biaSession) = await SignedInAsync("bia");
        await ana.InvokeAsync<DeviceSnapshot>("AddFriend", "bia");
        await bia.InvokeAsync<DeviceSnapshot>("AddFriend", "ana");
        await FriendsOf(ana);

        var presence = new TaskCompletionSource<DeviceSnapshot>(TaskCreationOptions.RunContinuationsAsynchronously);
        ana.On<DeviceSnapshot>("PresenceChanged", device => { if (device.IsSharing) presence.TrySetResult(device); });
        await bia.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest(biaSession.Account.Id.ToString(), "720p60"));
        var seen = await presence.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal("bia", seen.FriendCode);
        Assert.True(seen.IsSharing);
    }
}
