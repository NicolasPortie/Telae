using System.Threading.Channels;
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

/// <summary>Controle de quem assiste no hub real: presença por pessoa, público e ocultos no banco.</summary>
public sealed class PrivacyHubTests : IAsyncLifetime
{
    private const string Password = "uma-senha-bem-longa-42";
    private readonly string _root = Path.Combine(Path.GetTempPath(), "telae-privacy-hub-" + Guid.NewGuid().ToString("N"));
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
        builder.Services.AddSignalR(options => { options.AddFilter(typeof(DomainErrorFilter)); options.AddFilter<InputLimitFilter>(); });
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

    private sealed record Person(HubConnection Connection, AuthResult Session, Channel<(string Method, object? Payload)> Events)
    {
        public string Id => Session.Account.Id.ToString();

        public async Task<T> Next<T>(string method)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            while (true)
            {
                var (name, payload) = await Events.Reader.ReadAsync(timeout.Token);
                if (name == method) return (T)payload!;
            }
        }

        public async Task Quiet(string method)
        {
            await Task.Delay(400);
            while (Events.Reader.TryRead(out var item)) Assert.NotEqual(method, item.Method);
        }

        public void Drain() { while (Events.Reader.TryRead(out _)) { } }
    }

    private async Task<Person> SignedInAsync(string username)
    {
        using var scope = _app!.Services.CreateScope();
        var session = (await scope.ServiceProvider.GetRequiredService<AccountService>()
            .RegisterAsync($"{username}@example.com", username, Password, null, null, default)).Session!;
        return await ConnectAsync(session);
    }

    private async Task<Person> ConnectAsync(AuthResult session)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl($"{_baseUrl}/hubs/telae", options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.AccessTokenProvider = () => Task.FromResult<string?>(session.AccessToken);
            })
            .Build();
        _connections.Add(connection);
        var events = Channel.CreateUnbounded<(string, object?)>();
        connection.On<DeviceSnapshot>("PresenceChanged", value => events.Writer.TryWrite(("PresenceChanged", value)));
        connection.On<string>("SharePreviewRemoved", value => events.Writer.TryWrite(("SharePreviewRemoved", value)));
        connection.On<string>("SessionEnded", value => events.Writer.TryWrite(("SessionEnded", value)));
        connection.On<ViewerLeftEvent>("ViewerLeft", value => events.Writer.TryWrite(("ViewerLeft", value)));
        await connection.StartAsync();
        await connection.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("x", "x", ""));
        return new Person(connection, session, events);
    }

    private static async Task BefriendAsync(params Person[] people)
    {
        foreach (var person in people)
            foreach (var other in people.Where(other => other != person))
                await person.Connection.InvokeAsync<DeviceSnapshot>("AddFriend", other.Session.Account.Username);
        foreach (var person in people) await person.Connection.InvokeAsync<IReadOnlyList<DeviceSnapshot>>("GetFriends", Array.Empty<string>());
        foreach (var person in people) person.Drain();
    }

    private static Task<ShareAccessResult> StartAsync(Person sharer, ShareAudienceDto? audience = null) =>
        sharer.Connection.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest(sharer.Id, "auto", audience));

    [Fact]
    public async Task Each_friend_gets_presence_as_they_are_allowed_to_see_it()
    {
        var ana = await SignedInAsync("ana");
        var bia = await SignedInAsync("bia");
        var caio = await SignedInAsync("caio");
        await BefriendAsync(ana, bia, caio);

        var started = await StartAsync(ana, new ShareAudienceDto("selected", ["bia"]));

        Assert.Equal(["bia"], started.Audience!.Selected);
        var forBia = await bia.Next<DeviceSnapshot>("PresenceChanged");
        Assert.True(forBia.IsSharing);
        var forCaio = await caio.Next<DeviceSnapshot>("PresenceChanged");
        Assert.False(forCaio.IsSharing);
        Assert.Equal("online", forCaio.Status);
        Assert.Null(forCaio.ActiveQualityProfile);

        // Abrir o público avisa caio; a escolha nunca chega aos espectadores pelo snapshot da sessão.
        var widened = await ana.Connection.InvokeAsync<AudienceUpdateResult>("UpdateShareAudience", new ShareAudienceDto("friends"));
        Assert.Equal("friends", widened.Audience.Mode);
        Assert.True((await caio.Next<DeviceSnapshot>("PresenceChanged")).IsSharing);
        var joined = await caio.Connection.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ana");
        Assert.Null(joined.Audience);
    }

    [Fact]
    public async Task Narrowing_the_audience_ends_the_watch_and_drops_cached_previews()
    {
        var ana = await SignedInAsync("ana");
        var bia = await SignedInAsync("bia");
        await BefriendAsync(ana, bia);
        await StartAsync(ana);
        await bia.Connection.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ana");
        await ana.Connection.InvokeAsync("PublishSharePreview", SharePreviewTests.Jpeg);
        bia.Drain();

        await ana.Connection.InvokeAsync<AudienceUpdateResult>("UpdateShareAudience", new ShareAudienceDto("selected", []));

        Assert.NotEmpty(await bia.Next<string>("SessionEnded"));
        Assert.Equal(ana.Id, await bia.Next<string>("SharePreviewRemoved"));
        Assert.False((await bia.Next<DeviceSnapshot>("PresenceChanged")).IsSharing);
        Assert.Equal(bia.Id, (await ana.Next<ViewerLeftEvent>("ViewerLeft")).ViewerDeviceId);
        Assert.Empty(await bia.Connection.InvokeAsync<IReadOnlyList<SharePreviewEvent>>("GetFriendPreviews"));
    }

    [Fact]
    public async Task Hiding_is_stored_with_the_account_and_applies_on_the_spot()
    {
        var ana = await SignedInAsync("ana");
        var bia = await SignedInAsync("bia");
        await BefriendAsync(ana, bia);
        await StartAsync(ana);
        await bia.Connection.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ana");
        bia.Drain();

        var hidden = await ana.Connection.InvokeAsync<DeviceSnapshot>("HideShares", "@bia");

        Assert.Equal("bia", hidden.FriendCode);
        Assert.NotEmpty(await bia.Next<string>("SessionEnded"));
        Assert.False((await bia.Next<DeviceSnapshot>("PresenceChanged")).IsSharing);
        var error = await Assert.ThrowsAsync<HubException>(() => bia.Connection.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ana"));
        Assert.Contains("não está transmitindo", error.Message);

        // Outro aparelho da mesma conta já conhece a lista: ela está no banco.
        await ana.Connection.InvokeAsync("StopShare");
        await ana.Connection.StopAsync();
        var again = await ConnectAsync(ana.Session);
        Assert.Equal(["bia"], (await again.Connection.InvokeAsync<IReadOnlyList<DeviceSnapshot>>("GetHiddenViewers")).Select(p => p.FriendCode));
        await StartAsync(again);
        Assert.False((await bia.Connection.InvokeAsync<IReadOnlyList<DeviceSnapshot>>("GetFriends", Array.Empty<string>())).Single().IsSharing);

        await again.Connection.InvokeAsync("UnhideShares", "bia");
        Assert.Empty(await again.Connection.InvokeAsync<IReadOnlyList<DeviceSnapshot>>("GetHiddenViewers"));
        await bia.Connection.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ana");

        var self = await Assert.ThrowsAsync<HubException>(() => again.Connection.InvokeAsync<DeviceSnapshot>("HideShares", "ana"));
        Assert.Contains("ocultar", self.Message);
    }

    [Fact]
    public async Task Removing_a_viewer_immediately_clears_their_preview_and_live_presence()
    {
        var ana = await SignedInAsync("ana");
        var bia = await SignedInAsync("bia");
        await BefriendAsync(ana, bia);
        await StartAsync(ana);
        await bia.Connection.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ana");
        await ana.Connection.InvokeAsync("PublishSharePreview", SharePreviewTests.Jpeg);
        bia.Drain();

        await ana.Connection.InvokeAsync<ShareSessionSnapshot>("RemoveViewer", bia.Id);

        Assert.NotEmpty(await bia.Next<string>("SessionEnded"));
        Assert.Equal(ana.Id, await bia.Next<string>("SharePreviewRemoved"));
        Assert.False((await bia.Next<DeviceSnapshot>("PresenceChanged")).IsSharing);
        Assert.Empty(await bia.Connection.InvokeAsync<IReadOnlyList<SharePreviewEvent>>("GetFriendPreviews"));
        Assert.Equal(bia.Id, (await ana.Next<ViewerLeftEvent>("ViewerLeft")).ViewerDeviceId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Removing_a_friend_clears_their_preview_and_presence_even_if_they_are_not_watching(bool watching)
    {
        var ana = await SignedInAsync("ana");
        var bia = await SignedInAsync("bia");
        await BefriendAsync(ana, bia);
        await StartAsync(ana);
        if (watching) await bia.Connection.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ana");
        await ana.Connection.InvokeAsync("PublishSharePreview", SharePreviewTests.Jpeg);
        bia.Drain();

        await ana.Connection.InvokeAsync("RemoveFriend", "bia");

        if (watching) Assert.NotEmpty(await bia.Next<string>("SessionEnded"));
        Assert.Equal(ana.Id, await bia.Next<string>("SharePreviewRemoved"));
        var presence = await bia.Next<DeviceSnapshot>("PresenceChanged");
        Assert.False(presence.IsSharing);
        Assert.Equal("offline", presence.Status);
        Assert.Empty(await bia.Connection.InvokeAsync<IReadOnlyList<SharePreviewEvent>>("GetFriendPreviews"));
    }

    [Fact]
    public async Task Adding_a_friend_during_the_stream_shows_the_stream_to_them_and_the_rest_stay_unaware()
    {
        var ana = await SignedInAsync("ana");
        var bia = await SignedInAsync("bia");
        var caio = await SignedInAsync("caio");
        await BefriendAsync(ana, bia, caio);
        await StartAsync(ana, new ShareAudienceDto("selected", ["bia"]));
        Assert.False((await caio.Next<DeviceSnapshot>("PresenceChanged")).IsSharing);

        var updated = await ana.Connection.InvokeAsync<AudienceUpdateResult>("UpdateShareAudience", new ShareAudienceDto("selected", ["bia", "caio"]));

        Assert.Equal(["bia", "caio"], updated.Audience.Selected);
        Assert.True((await caio.Next<DeviceSnapshot>("PresenceChanged")).IsSharing);
        var joined = await caio.Connection.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ana");
        Assert.Contains(caio.Id, joined.Session.ViewerDeviceIds);
    }
}
