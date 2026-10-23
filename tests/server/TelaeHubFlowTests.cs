using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Telae.Server.Core;
using Telae.Server.Hubs;

namespace Telae.Server.Tests;

/// <summary>
/// E2E no nível da sinalização: dois clientes SignalR reais
/// contra o hub servido por Kestrel em porta efêmera — invite, offer/answer,
/// trickle ICE, leave e queda. Mídia WebRTC de ponta a ponta exige 2 Electrons
/// (ver docs/BENCHMARK.md).
/// </summary>
public sealed class TelaeHubFlowTests : IAsyncLifetime
{
    private WebApplication? _app;
    private string _baseUrl = "";
    private readonly List<HubConnection> _connections = [];

    public Task InitializeAsync() => StartServerAsync([]);

    private async Task StartServerAsync(string[] knownProxies)
    {
        var builder = WebApplication.CreateBuilder();
        var settings = new Dictionary<string, string?> { ["ClientAddress:HeaderName"] = "CF-Connecting-IP" };
        for (var index = 0; index < knownProxies.Length; index++)
            settings[$"ClientAddress:KnownProxies:{index}"] = knownProxies[index];
        builder.Configuration.AddInMemoryCollection(settings);
        builder.Services.AddTrustedClientAddress(builder.Configuration);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddSignalR(options =>
        {
            options.AddFilter(typeof(DomainErrorFilter));
            options.AddFilter<InputLimitFilter>();
            options.MaximumReceiveMessageSize = 128 * 1024;
        });
        builder.Services.AddSingleton<InputLimitFilter>();
        builder.Services.AddSingleton<PresenceSubscriptions>();
        builder.Services.AddSingleton(new TelaeRegistry());
        builder.Services.AddSingleton<DisconnectCoordinator>();
        builder.Services.Configure<ReconnectConfiguration>(options => options.GracePeriodMilliseconds = 300);
        builder.Services.Configure<IceConfiguration>(options =>
            options.Servers.Add(new IceServerDto(["stun:stun.l.google.com:19302"])));
        builder.Services.AddSingleton<Microsoft.Extensions.Options.IValidateOptions<TurnConfiguration>, TurnConfigurationValidator>();
        builder.Services.AddOptions<TurnConfiguration>().ValidateOnStart();

        _app = builder.Build();
        _app.UseForwardedHeaders();
        _app.MapHub<TelaeHub>("/hubs/telae");
        await _app.StartAsync();

        var addresses = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>();
        _baseUrl = addresses?.Addresses.First(a => a.StartsWith("http://", StringComparison.Ordinal))
            ?? throw new InvalidOperationException("Kestrel não expôs endereço HTTP.");
    }

    public async Task DisposeAsync()
    {
        foreach (var connection in _connections)
            await connection.DisposeAsync();
        if (_app is not null)
        {
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }

    private async Task<HubConnection> ConnectAsync(string deviceId, string displayName)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl($"{_baseUrl}/hubs/telae")
            .Build();
        _connections.Add(connection);
        await connection.StartAsync();
        await connection.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest(deviceId, displayName, new string('a', 64)));
        return connection;
    }

    private static Task<T> WaitForAsync<T>(TaskCompletionSource<T> source, string what, int timeoutMs = 10000)
    {
        return source.Task.WaitAsync(TimeSpan.FromMilliseconds(timeoutMs));
    }

    private async Task<HubConnection> ConnectUnregisteredAsync(string? forwardedClient = null, string? spoofedForwardedFor = null)
    {
        var connection = new HubConnectionBuilder().WithUrl($"{_baseUrl}/hubs/telae", options =>
        {
            if (forwardedClient is not null) options.Headers["CF-Connecting-IP"] = forwardedClient;
            if (spoofedForwardedFor is not null) options.Headers["X-Forwarded-For"] = spoofedForwardedFor;
        }).Build();
        _connections.Add(connection);
        await connection.StartAsync();
        return connection;
    }

    private static System.Threading.Channels.Channel<DeviceSnapshot> ObservePresence(HubConnection connection)
    {
        var channel = System.Threading.Channels.Channel.CreateUnbounded<DeviceSnapshot>();
        connection.On<DeviceSnapshot>("PresenceChanged", device => channel.Writer.TryWrite(device));
        return channel;
    }

    private static async Task<DeviceSnapshot> NextPresence(System.Threading.Channels.Channel<DeviceSnapshot> channel) =>
        await channel.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));

    private static async Task AssertNoPresence(System.Threading.Channels.Channel<DeviceSnapshot> channel)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => channel.Reader.ReadAsync(timeout.Token).AsTask());
    }

    [Fact]
    public async Task Presence_is_private_for_registration_sharing_quality_stop_and_disconnect()
    {
        var sharer = await ConnectAsync("sharer", "Sharer");
        var friend = await ConnectAsync("friend", "Friend");
        var stranger = await ConnectAsync("stranger", "Stranger");
        var anonymous = await ConnectUnregisteredAsync();
        var subscribedEvents = ObservePresence(friend);
        var strangerEvents = ObservePresence(stranger);
        var anonymousEvents = ObservePresence(anonymous);
        var device = await sharer.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("sharer", "Sharer", new string('a', 64)));
        await friend.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { device.FriendCode });
        // Lookup alone does not subscribe.
        await stranger.InvokeAsync<DeviceSnapshot>("LookupFriend", device.FriendCode);
        await sharer.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("sharer", "Renamed", new string('a', 64)));
        Assert.Equal("Renamed", (await NextPresence(subscribedEvents)).DisplayName);
        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("sharer", "auto"));
        Assert.Equal("transmitting", (await NextPresence(subscribedEvents)).Status);
        await sharer.InvokeAsync<ShareSessionSnapshot>("UpdateShareQuality", "720p60");
        Assert.Equal("720p60", (await NextPresence(subscribedEvents)).ActiveQualityProfile);
        await sharer.InvokeAsync("StopShare");
        Assert.Equal("online", (await NextPresence(subscribedEvents)).Status);
        await sharer.StopAsync();
        Assert.Equal("offline", (await NextPresence(subscribedEvents)).Status);
        await Task.WhenAll(AssertNoPresence(strangerEvents), AssertNoPresence(anonymousEvents));
    }

    [Fact]
    public async Task Friend_subscriptions_are_replaced_and_must_be_restored_after_reconnect()
    {
        var source = await ConnectAsync("source", "Source");
        var subscriber = await ConnectAsync("subscriber", "Subscriber");
        var device = await source.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("source", "Source", new string('a', 64)));
        var events = ObservePresence(subscriber);
        await subscriber.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { device.FriendCode });
        await subscriber.InvokeAsync<DeviceSnapshot[]>("GetFriends", Array.Empty<string>());
        await source.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("source", "auto"));
        await AssertNoPresence(events);
        await subscriber.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { device.FriendCode });
        await subscriber.StopAsync();
        await subscriber.StartAsync();
        events = ObservePresence(subscriber);
        await subscriber.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("subscriber", "Subscriber", new string('a', 64)));
        await source.InvokeAsync<ShareSessionSnapshot>("UpdateShareQuality", "720p60");
        await AssertNoPresence(events);
        var friends = await subscriber.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { device.FriendCode, device.FriendCode });
        Assert.Single(friends);
        Assert.Equal("720p60", friends[0].ActiveQualityProfile);
        await source.InvokeAsync<ShareSessionSnapshot>("UpdateShareQuality", "1080p30");
        Assert.Equal("1080p30", (await NextPresence(events)).ActiveQualityProfile);
    }

    [Fact]
    public async Task Superseded_connection_loses_presence_and_command_access()
    {
        var source = await ConnectAsync("source", "Source");
        var old = await ConnectAsync("subscriber", "Subscriber");
        var device = await source.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("source", "Source", new string('a', 64)));
        await old.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { device.FriendCode });
        var events = ObservePresence(old);
        await ConnectAsync("subscriber", "Subscriber");
        await source.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("source", "auto"));
        await AssertNoPresence(events);
        await Assert.ThrowsAsync<HubException>(() => old.InvokeAsync<DeviceSnapshot>("LookupFriend", device.FriendCode));
    }

    [Fact]
    public async Task Removal_revokes_invites_signaling_and_reconnection_until_a_new_session()
    {
        var sharer = await ConnectAsync("sharer", "Sharer");
        var viewer = await ConnectAsync("viewer", "Viewer");
        var access = await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("sharer", "auto"));
        var invite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        await viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code);
        var ended = new TaskCompletionSource<string>();
        var left = new TaskCompletionSource<ViewerLeftEvent>();
        viewer.On<string>("SessionEnded", id => ended.TrySetResult(id));
        sharer.On<ViewerLeftEvent>("ViewerLeft", data => left.TrySetResult(data));
        var removed = await sharer.InvokeAsync<ShareSessionSnapshot>("RemoveViewer", "viewer");
        Assert.Empty(removed.ViewerDeviceIds);
        Assert.Equal(access.Session.SessionId, await WaitForAsync(ended, "removed"));
        Assert.Equal("viewer", (await WaitForAsync(left, "left")).ViewerDeviceId);
        var newInvite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        foreach (var code in new[] { invite.Code, newInvite.Code })
        {
            var error = await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", code));
            Assert.Contains("removido", error.Message);
        }
        await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinShare", "sharer"));
        await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync("SendSignal", "sharer",
            new SignalingEnvelope(access.Session.SessionId, "viewer", new SignalingPayload("offer", "x"))));
        await viewer.StopAsync();
        viewer = await ConnectAsync("viewer", "Viewer");
        await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code));
        await sharer.InvokeAsync("StopShare");
        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("sharer", "auto"));
        var nextInvite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        Assert.Contains("viewer", (await viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", nextInvite.Code)).Session.ViewerDeviceIds);
    }

    [Fact]
    public async Task Only_sharer_can_remove_viewers_or_change_validated_live_quality()
    {
        var sharer = await ConnectAsync("sharer", "Sharer");
        var viewer = await ConnectAsync("viewer", "Viewer");
        var stranger = await ConnectAsync("stranger", "Stranger");
        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("sharer", "auto"));
        var invite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        await viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code);
        foreach (var caller in new[] { viewer, stranger })
        {
            await Assert.ThrowsAsync<HubException>(() => caller.InvokeAsync<ShareSessionSnapshot>("RemoveViewer", "viewer"));
            await Assert.ThrowsAsync<HubException>(() => caller.InvokeAsync<ShareSessionSnapshot>("UpdateShareQuality", "720p60"));
        }
        await stranger.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("stranger", "auto"));
        await Assert.ThrowsAsync<HubException>(() => stranger.InvokeAsync<ShareSessionSnapshot>("RemoveViewer", "viewer"));
        Assert.Contains("viewer", (await sharer.InvokeAsync<ShareSessionSnapshot>("GetActiveShare")).ViewerDeviceIds);
        await Assert.ThrowsAsync<HubException>(() => sharer.InvokeAsync<ShareSessionSnapshot>("UpdateShareQuality", "4k"));
        Assert.Equal("auto", (await sharer.InvokeAsync<ShareSessionSnapshot>("GetActiveShare")).QualityProfile);
        var changed = new TaskCompletionSource<ShareSessionSnapshot>();
        viewer.On<ShareSessionSnapshot>("ShareQualityChanged", data => changed.TrySetResult(data));
        var result = await sharer.InvokeAsync<ShareSessionSnapshot>("UpdateShareQuality", " 1080P30 ");
        Assert.Equal("1080p30", result.QualityProfile);
        var notification = await WaitForAsync(changed, "quality");
        Assert.Equal(result.SessionId, notification.SessionId);
        Assert.Equal(result.QualityProfile, notification.QualityProfile);
        Assert.Equal(result.ViewerDeviceIds, notification.ViewerDeviceIds);
    }

    [Fact]
    public async Task Unregistered_lookup_subscriptions_and_session_commands_are_denied()
    {
        var anonymous = await ConnectUnregisteredAsync();
        await Assert.ThrowsAsync<HubException>(() => anonymous.InvokeAsync<DeviceSnapshot>("LookupFriend", "ABC234"));
        await Assert.ThrowsAsync<HubException>(() => anonymous.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { "ABC234" }));
        await Assert.ThrowsAsync<HubException>(() => anonymous.InvokeAsync<ShareSessionSnapshot>("RemoveViewer", "viewer"));
        await Assert.ThrowsAsync<HubException>(() => anonymous.InvokeAsync<ShareSessionSnapshot>("UpdateShareQuality", "auto"));
        await Assert.ThrowsAsync<HubException>(() => anonymous.InvokeAsync<IceServerDto[]>("GetTurnCredentials"));
    }

    [Fact]
    public async Task Registration_is_limited_across_connections_from_the_same_peer()
    {
        var first = await ConnectAsync("device", "Device");
        for (var index = 1; index < 30; index++)
            await first.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest("device", "Device", new string('a', 64)));
        var second = await ConnectUnregisteredAsync();
        var error = await Assert.ThrowsAsync<HubException>(() => second.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest("new-device", "New", new string('a', 64))));
        Assert.Contains("Muitas solicitações", error.Message);
        Assert.Null(_app!.Services.GetRequiredService<TelaeRegistry>().GetDevice("new-device"));
    }

    [Fact]
    public async Task Trusted_tunnel_preserves_independent_registration_limits_for_forwarded_clients()
    {
        await _app!.StopAsync();
        await _app.DisposeAsync();
        await StartServerAsync(["127.0.0.1"]);

        var firstClient = await ConnectUnregisteredAsync("198.51.100.10");
        for (var index = 0; index < 30; index++)
            await firstClient.InvokeAsync<DeviceSnapshot>("RegisterDevice",
                new RegisterDeviceRequest("first-client", "First", new string('a', 64)));

        // New transport connection and forged XFF cannot bypass the exhausted CF address.
        var sameClient = await ConnectUnregisteredAsync("198.51.100.10", "198.51.100.99");
        var error = await Assert.ThrowsAsync<HubException>(() => sameClient.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest("first-client", "First", new string('a', 64))));
        Assert.Contains("Muitas solicitações", error.Message);

        // This registration used to fail because both peers appeared as 127.0.0.1.
        var secondClient = await ConnectUnregisteredAsync("198.51.100.11");
        var second = await secondClient.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest("second-client", "Second", new string('b', 64)));
        Assert.Equal("second-client", second.DeviceId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Untrusted_peer_cannot_escape_registration_limits_by_forging_forwarded_headers(bool configureOtherProxy)
    {
        if (configureOtherProxy)
        {
            await _app!.StopAsync();
            await _app.DisposeAsync();
            // The actual TCP peer is loopback, which is deliberately not trusted here.
            await StartServerAsync(["192.0.2.20"]);
        }
        var first = await ConnectUnregisteredAsync("198.51.100.10", "198.51.100.10");
        for (var index = 0; index < 30; index++)
            await first.InvokeAsync<DeviceSnapshot>("RegisterDevice",
                new RegisterDeviceRequest("first", "First", new string('a', 64)));
        var forged = await ConnectUnregisteredAsync("198.51.100.11", "198.51.100.11");
        var error = await Assert.ThrowsAsync<HubException>(() => forged.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest("forged", "Forged", new string('b', 64))));
        Assert.Contains("Muitas solicitações", error.Message);
        Assert.Null(_app!.Services.GetRequiredService<TelaeRegistry>().GetDevice("forged"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-an-ip")]
    public async Task Missing_or_invalid_tunnel_header_falls_back_to_actual_peer_limit(string? header)
    {
        await _app!.StopAsync();
        await _app.DisposeAsync();
        await StartServerAsync(["127.0.0.1"]);
        var first = await ConnectUnregisteredAsync(header);
        for (var index = 0; index < 30; index++)
            await first.InvokeAsync<DeviceSnapshot>("RegisterDevice",
                new RegisterDeviceRequest("first", "First", new string('a', 64)));
        var second = await ConnectUnregisteredAsync(header);
        var error = await Assert.ThrowsAsync<HubException>(() => second.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest("second", "Second", new string('b', 64))));
        Assert.Contains("Muitas solicitações", error.Message);
    }

    [Fact]
    public async Task Input_limits_reject_oversized_friend_lists_and_command_floods()
    {
        var caller = await ConnectAsync("device", "Device");
        await Assert.ThrowsAsync<HubException>(() => caller.InvokeAsync<DeviceSnapshot[]>("GetFriends", Enumerable.Repeat("ABC234", 201).ToArray()));
        await Assert.ThrowsAsync<HubException>(() => caller.InvokeAsync<DeviceSnapshot[]>("GetFriends", new string[] { null! }));
        for (var index = 2; index < 120; index++)
            await caller.InvokeAsync<ShareSessionSnapshot?>("GetActiveShare");
        var error = await Assert.ThrowsAsync<HubException>(() => caller.InvokeAsync<ShareSessionSnapshot?>("GetActiveShare"));
        Assert.Contains("Muitas solicitações", error.Message);
    }

    [Fact]
    public async Task Direct_join_and_device_impersonation_are_rejected_by_the_real_hub()
    {
        var sharer = await ConnectAsync("device-sharer", "Sharer");
        var attacker = await ConnectAsync("device-attacker", "Attacker");
        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "auto"));
        var joinError = await Assert.ThrowsAsync<HubException>(() => attacker.InvokeAsync<ShareAccessResult>("JoinShare", "device-sharer"));
        Assert.Contains("convite", joinError.Message);
        var unregistered = new HubConnectionBuilder().WithUrl($"{_baseUrl}/hubs/telae").Build();
        _connections.Add(unregistered);
        await unregistered.StartAsync();
        var takeoverError = await Assert.ThrowsAsync<HubException>(() => unregistered.InvokeAsync<DeviceSnapshot>("RegisterDevice",
            new RegisterDeviceRequest("device-sharer", "Attacker", new string('b', 64))));
        Assert.Contains("credencial", takeoverError.Message);
        Assert.NotNull(await sharer.InvokeAsync<ShareSessionSnapshot?>("GetActiveShare"));
    }

    [Fact]
    public async Task Two_clients_complete_invite_offer_answer_and_trickle_ice()
    {
        var sharer = await ConnectAsync("device-sharer", "Sharer");
        var viewer = await ConnectAsync("device-viewer", "Viewer");

        var viewerJoined = new TaskCompletionSource<ViewerJoinedEvent>();
        sharer.On<ViewerJoinedEvent>("ViewerJoined", e => viewerJoined.TrySetResult(e));

        var offerAtSharer = new TaskCompletionSource<SignalingEnvelope>();
        sharer.On<SignalingEnvelope>("SignalReceived", e => offerAtSharer.TrySetResult(e));

        var answerAtViewer = new TaskCompletionSource<SignalingEnvelope>();
        var candidateAtViewer = new TaskCompletionSource<SignalingEnvelope>();
        viewer.On<SignalingEnvelope>("SignalReceived", e =>
        {
            if (e.Payload.Kind == "answer") answerAtViewer.TrySetResult(e);
            else candidateAtViewer.TrySetResult(e);
        });

        var access = await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "1080p60"));
        Assert.NotEmpty(access.IceServers);

        var invite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        Assert.Equal(8, invite.Code.Length);

        var join = await viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code);
        Assert.Equal(access.Session.SessionId, join.Session.SessionId);

        var joined = await WaitForAsync(viewerJoined, "ViewerJoined");
        Assert.Equal("device-viewer", joined.Viewer.DeviceId);

        await viewer.InvokeAsync("SendSignal", "device-sharer",
            new SignalingEnvelope(join.Session.SessionId, "device-viewer", new SignalingPayload("offer", "fake-offer-sdp")));
        var offer = await WaitForAsync(offerAtSharer, "offer");
        Assert.Equal("offer", offer.Payload.Kind);
        Assert.Equal("fake-offer-sdp", offer.Payload.Sdp);

        await sharer.InvokeAsync("SendSignal", "device-viewer",
            new SignalingEnvelope(join.Session.SessionId, "device-sharer", new SignalingPayload("answer", "fake-answer-sdp")));
        var answer = await WaitForAsync(answerAtViewer, "answer");
        Assert.Equal("fake-answer-sdp", answer.Payload.Sdp);

        await sharer.InvokeAsync("SendSignal", "device-viewer",
            new SignalingEnvelope(join.Session.SessionId, "device-sharer",
                new SignalingPayload("candidate", Candidate: new IceCandidatePayload("candidate:1", "0", 0, null))));
        var candidate = await WaitForAsync(candidateAtViewer, "candidate");
        Assert.Equal("candidate:1", candidate.Payload.Candidate?.Candidate);
    }

    [Fact]
    public async Task Sharer_can_query_its_own_active_share()
    {
        var sharer = await ConnectAsync("device-sharer", "Sharer");

        Assert.Null(await sharer.InvokeAsync<ShareSessionSnapshot?>("GetActiveShare"));

        var started = await sharer.InvokeAsync<ShareAccessResult>(
            "StartShare",
            new StartShareRequest("device-sharer", "auto"));

        var active = await sharer.InvokeAsync<ShareSessionSnapshot?>("GetActiveShare");
        Assert.NotNull(active);
        Assert.Equal(started.Session.SessionId, active.SessionId);

        await sharer.InvokeAsync("StopShare");
        Assert.Null(await sharer.InvokeAsync<ShareSessionSnapshot?>("GetActiveShare"));
    }

    [Fact]
    public async Task Viewer_leave_notifies_sharer_and_invite_remains_reusable()
    {
        var sharer = await ConnectAsync("device-sharer", "Sharer");
        var viewer = await ConnectAsync("device-viewer", "Viewer");
        var intruder = await ConnectAsync("device-intruder", "Intruder");

        var viewerLeft = new TaskCompletionSource<ViewerLeftEvent>();
        sharer.On<ViewerLeftEvent>("ViewerLeft", eventData => viewerLeft.TrySetResult(eventData));

        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "auto"));
        var invite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        var join = await viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code);

        await viewer.InvokeAsync("LeaveShare");
        var left = await WaitForAsync(viewerLeft, "ViewerLeft");
        Assert.Equal(join.Session.SessionId, left.SessionId);
        Assert.Equal("device-viewer", left.ViewerDeviceId);
        var secondJoin = await intruder.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code);
        Assert.Contains("device-intruder", secondJoin.Session.ViewerDeviceIds);
    }

    [Fact]
    public async Task Sharer_disconnect_ends_session_and_viewer_is_notified()
    {
        var sharer = await ConnectAsync("device-sharer", "Sharer");
        var viewer = await ConnectAsync("device-viewer", "Viewer");

        var sessionEnded = new TaskCompletionSource<string>();
        viewer.On<string>("SessionEnded", sessionId => sessionEnded.TrySetResult(sessionId));

        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "720p60"));
        var invite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        var join = await viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code);

        await sharer.StopAsync();
        Assert.Equal(join.Session.SessionId, await WaitForAsync(sessionEnded, "SessionEnded"));
    }

    [Fact]
    public async Task Sharer_reconnect_within_grace_window_preserves_session()
    {
        var sharer = await ConnectAsync("device-sharer", "Sharer");
        var viewer = await ConnectAsync("device-viewer", "Viewer");

        var access = await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "auto"));
        var invite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        await viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code);

        await sharer.StopAsync();
        var reconnectedSharer = await ConnectAsync("device-sharer", "Sharer");
        await Task.Delay(500);

        var signalAtViewer = new TaskCompletionSource<SignalingEnvelope>();
        viewer.On<SignalingEnvelope>("SignalReceived", envelope => signalAtViewer.TrySetResult(envelope));
        await reconnectedSharer.InvokeAsync(
            "SendSignal",
            "device-viewer",
            new SignalingEnvelope(access.Session.SessionId, "device-sharer", new SignalingPayload("answer", "reconnected-answer")));

        var signal = await WaitForAsync(signalAtViewer, "signal after reconnect");
        Assert.Equal("reconnected-answer", signal.Payload.Sdp);
    }

    [Fact]
    public async Task Unknown_invite_is_rejected_with_specific_message()
    {
        var viewer = await ConnectAsync("device-viewer", "Viewer");

        var error = await Assert.ThrowsAsync<HubException>(() =>
            viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", "XXXXXXXX"));
        Assert.Contains("não existe", error.Message);
    }

    [Fact]
    public async Task Stranger_cannot_inject_signals_into_a_session()
    {
        var sharer = await ConnectAsync("device-sharer", "Sharer");
        var viewer = await ConnectAsync("device-viewer", "Viewer");
        var stranger = await ConnectAsync("device-stranger", "Stranger");

        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "auto"));
        var invite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        var join = await viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code);

        var error = await Assert.ThrowsAsync<HubException>(() =>
            stranger.InvokeAsync("SendSignal", "device-viewer",
                new SignalingEnvelope(join.Session.SessionId, "device-stranger", new SignalingPayload("offer", "x"))));
        Assert.Contains("participantes", error.Message);
    }

    private async Task<DeviceSnapshot> RegisterAsync(HubConnection connection, string deviceId, string displayName) =>
        await connection.InvokeAsync<DeviceSnapshot>("RegisterDevice", new RegisterDeviceRequest(deviceId, displayName, new string('a', 64)));

    // Amizade mútua: cada lado declara o outro através de GetFriends.
    private async Task<(DeviceSnapshot First, DeviceSnapshot Second)> MakeMutualFriendsAsync(
        HubConnection first, string firstId, HubConnection second, string secondId)
    {
        var firstSnapshot = await RegisterAsync(first, firstId, firstId);
        var secondSnapshot = await RegisterAsync(second, secondId, secondId);
        await first.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { secondSnapshot.FriendCode });
        await second.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { firstSnapshot.FriendCode });
        return (firstSnapshot, secondSnapshot);
    }

    [Fact]
    public async Task Friend_join_directly_by_friend_code_without_invite()
    {
        var sharer = await ConnectUnregisteredAsync();
        var viewer = await ConnectUnregisteredAsync();
        var (sharerSnapshot, _) = await MakeMutualFriendsAsync(sharer, "device-sharer", viewer, "device-viewer");

        var joinedEvent = new TaskCompletionSource<ViewerJoinedEvent>();
        sharer.On<ViewerJoinedEvent>("ViewerJoined", e => joinedEvent.TrySetResult(e));

        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "1080p30"));

        // Amigo mútuo entra direto pelo friendCode de 6 chars, sem convite.
        var access = await viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode);
        Assert.Equal("device-sharer", access.Session.SharerDeviceId);
        Assert.Contains("device-viewer", access.Session.ViewerDeviceIds);

        var notified = await WaitForAsync(joinedEvent, "ViewerJoined via friend code");
        Assert.Equal("device-viewer", notified.Viewer.DeviceId);
        Assert.Equal(access.Session.SessionId, notified.SessionId);
    }

    [Fact]
    public async Task Friend_join_validations_cover_offline_blocked_and_limits()
    {
        var sharer = await ConnectUnregisteredAsync();
        var viewer = await ConnectUnregisteredAsync();
        var outsider = await ConnectUnregisteredAsync();
        var (sharerSnapshot, _) = await MakeMutualFriendsAsync(sharer, "sharer", viewer, "viewer");
        await RegisterAsync(outsider, "outsider", "Outsider");

        // Sem transmissão ativa: share_not_active
        var noShareError = await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode));
        Assert.Contains("transmitindo", noShareError.Message);

        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("sharer", "auto"));

        // Código inexistente: friend_not_found
        var notFound = await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ZZZZZZ"));
        Assert.Contains("Não achei ninguém", notFound.Message);

        // Identificador fora do formato do @usuário: invalid_friend_code
        var invite = await sharer.InvokeAsync<InviteSnapshot>("CreateInvite");
        var badFormat = await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", "no"));
        Assert.Contains("não parece certo", badFormat.Message);

        // Própria transmissão: cannot_view_own_share
        var selfError = await Assert.ThrowsAsync<HubException>(() => sharer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode));
        Assert.Contains("própria", selfError.Message);

        // Quem não é amigo mútuo não entra, mesmo com o código: not_friends
        var notFriend = await Assert.ThrowsAsync<HubException>(() => outsider.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode));
        Assert.Contains("amigos", notFriend.Message);

        // Acesso normal por amigo funciona
        await viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode);

        // Entrar de novo na mesma transmissão não duplica o espectador
        var already = await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode));
        Assert.Contains("já está assistindo", already.Message);

        // Após remoção pelo dono, o amigo fica bloqueado nesta transmissão
        await sharer.InvokeAsync<ShareSessionSnapshot>("RemoveViewer", "viewer");
        var blocked = await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode));
        Assert.Contains("removido", blocked.Message);
        var blockedInvite = await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinWithInvite", invite.Code));
        Assert.Contains("removido", blockedInvite.Message);
    }

    [Fact]
    public async Task Friend_join_requires_friendship_declared_by_both_sides()
    {
        var sharer = await ConnectUnregisteredAsync();
        var viewer = await ConnectUnregisteredAsync();
        var sharerSnapshot = await RegisterAsync(sharer, "device-sharer", "Sharer");
        var viewerSnapshot = await RegisterAsync(viewer, "device-viewer", "Viewer");
        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "auto"));

        // Código conhecido, nenhuma amizade declarada: negado.
        var stranger = await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode));
        Assert.Contains("amigos", stranger.Message);

        // Só o espectador declarou o dono: o dono ainda não o adicionou.
        await viewer.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { sharerSnapshot.FriendCode });
        await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode));

        // Amizade mútua: entra sem convite.
        await sharer.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { viewerSnapshot.FriendCode });
        var access = await viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode);
        Assert.Contains("device-viewer", access.Session.ViewerDeviceIds);
    }

    [Fact]
    public async Task Friend_switch_moves_viewer_atomically_and_keeps_current_on_failure()
    {
        var first = await ConnectUnregisteredAsync();
        var second = await ConnectUnregisteredAsync();
        var viewer = await ConnectUnregisteredAsync();
        var firstSnapshot = await RegisterAsync(first, "device-first", "First");
        var secondSnapshot = await RegisterAsync(second, "device-second", "Second");
        var viewerSnapshot = await RegisterAsync(viewer, "device-viewer", "Viewer");
        await viewer.InvokeAsync("GetFriends", new[] { firstSnapshot.FriendCode, secondSnapshot.FriendCode });
        await first.InvokeAsync("GetFriends", new[] { viewerSnapshot.FriendCode });
        await second.InvokeAsync("GetFriends", new[] { viewerSnapshot.FriendCode });
        await first.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-first", "auto"));
        await second.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-second", "auto"));

        var leftFirst = new TaskCompletionSource<ViewerLeftEvent>();
        first.On<ViewerLeftEvent>("ViewerLeft", e => leftFirst.TrySetResult(e));

        await viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", firstSnapshot.FriendCode);

        // Falha na troca (o segundo amigo parou de transmitir): o espectador continua no primeiro.
        await second.InvokeAsync("StopShare");
        await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", secondSnapshot.FriendCode));
        var stillFirst = await first.InvokeAsync<ShareSessionSnapshot?>("GetActiveShare");
        Assert.Contains("device-viewer", stillFirst!.ViewerDeviceIds);

        // Troca válida: sai do primeiro e entra no segundo no mesmo passo.
        await second.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-second", "auto"));
        var switched = await viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", secondSnapshot.FriendCode);
        Assert.Contains("device-viewer", switched.Session.ViewerDeviceIds);
        var left = await WaitForAsync(leftFirst, "ViewerLeft after switch");
        Assert.Equal("device-viewer", left.ViewerDeviceId);
        var afterSwitch = await first.InvokeAsync<ShareSessionSnapshot?>("GetActiveShare");
        Assert.DoesNotContain("device-viewer", afterSwitch!.ViewerDeviceIds);
    }

    [Fact]
    public async Task Removing_a_friend_ends_their_active_watch_on_both_sides()
    {
        var sharer = await ConnectUnregisteredAsync();
        var viewer = await ConnectUnregisteredAsync();
        var (sharerSnapshot, _) = await MakeMutualFriendsAsync(sharer, "device-sharer", viewer, "device-viewer");
        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "auto"));
        var access = await viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode);

        var ended = new TaskCompletionSource<string>();
        var left = new TaskCompletionSource<ViewerLeftEvent>();
        viewer.On<string>("SessionEnded", id => ended.TrySetResult(id));
        sharer.On<ViewerLeftEvent>("ViewerLeft", e => left.TrySetResult(e));

        // O dono remove o espectador da lista de amigos: ele deixa de assistir.
        await sharer.InvokeAsync<DeviceSnapshot[]>("GetFriends", Array.Empty<string>());
        Assert.Equal(access.Session.SessionId, await WaitForAsync(ended, "SessionEnded"));
        Assert.Equal("device-viewer", (await WaitForAsync(left, "ViewerLeft")).ViewerDeviceId);
        var reentry = await Assert.ThrowsAsync<HubException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode));
        Assert.Contains("amigos", reentry.Message);
    }

    [Fact]
    public async Task Viewer_removing_the_sharer_ends_their_own_watch()
    {
        var sharer = await ConnectUnregisteredAsync();
        var viewer = await ConnectUnregisteredAsync();
        var (sharerSnapshot, _) = await MakeMutualFriendsAsync(sharer, "device-sharer", viewer, "device-viewer");
        await sharer.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "auto"));
        await viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode);

        var ended = new TaskCompletionSource<string>();
        viewer.On<string>("SessionEnded", id => ended.TrySetResult(id));

        await viewer.InvokeAsync<DeviceSnapshot[]>("GetFriends", Array.Empty<string>());
        await WaitForAsync(ended, "SessionEnded after unfriending");
        var active = await sharer.InvokeAsync<ShareSessionSnapshot?>("GetActiveShare");
        Assert.Empty(active!.ViewerDeviceIds);
    }

    [Fact]
    public async Task Declared_friendship_survives_reconnect_without_a_new_declaration()
    {
        var sharer = await ConnectUnregisteredAsync();
        var viewer = await ConnectUnregisteredAsync();
        var (sharerSnapshot, _) = await MakeMutualFriendsAsync(sharer, "device-sharer", viewer, "device-viewer");

        // O dono reconecta (nova conexão, sem reenviar a lista): a amizade continua valendo.
        await sharer.StopAsync();
        var reconnected = await ConnectUnregisteredAsync();
        await RegisterAsync(reconnected, "device-sharer", "Sharer");
        await reconnected.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("device-sharer", "auto"));

        var access = await viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", sharerSnapshot.FriendCode);
        Assert.Contains("device-viewer", access.Session.ViewerDeviceIds);
    }

    [Fact]
    public async Task Friend_join_rejected_when_not_online_or_not_registered()
    {
        // Não registrado não passa pelo IsRegisteredConnection
        var anonymous = await ConnectUnregisteredAsync();
        await Assert.ThrowsAsync<HubException>(() => anonymous.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ABCDEF"));

        var viewer = await ConnectAsync("viewer", "Viewer");
        await viewer.StopAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => viewer.InvokeAsync<ShareAccessResult>("JoinFriendShare", "ABCDEF"));
    }

    [Fact]
    public async Task Friend_request_appears_for_target_and_accepting_makes_it_mutual()
    {
        var requester = await ConnectUnregisteredAsync();
        var target = await ConnectUnregisteredAsync();
        var requesterSnapshot = await RegisterAsync(requester, "requester", "Requester");
        var targetSnapshot = await RegisterAsync(target, "target", "Target");
        await target.InvokeAsync<ShareAccessResult>("StartShare", new StartShareRequest("target", "auto"));

        Assert.Empty(await target.InvokeAsync<DeviceSnapshot[]>("GetFriendRequests"));

        await requester.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { targetSnapshot.FriendCode });
        var pending = Assert.Single(await target.InvokeAsync<DeviceSnapshot[]>("GetFriendRequests"));
        Assert.Equal("requester", pending.DeviceId);
        Assert.Equal(requesterSnapshot.FriendCode, pending.FriendCode);

        // Sem reciprocidade, a entrada continua negada mesmo com o pedido visível.
        var denied = await Assert.ThrowsAsync<HubException>(() => requester.InvokeAsync<ShareAccessResult>("JoinFriendShare", targetSnapshot.FriendCode));
        Assert.Contains("amigos", denied.Message);

        // Aceitar = declarar de volta: some da pendência e libera a entrada.
        await target.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { requesterSnapshot.FriendCode });
        Assert.Empty(await target.InvokeAsync<DeviceSnapshot[]>("GetFriendRequests"));
        Assert.Empty(await requester.InvokeAsync<DeviceSnapshot[]>("GetFriendRequests"));
        var access = await requester.InvokeAsync<ShareAccessResult>("JoinFriendShare", targetSnapshot.FriendCode);
        Assert.Contains("requester", access.Session.ViewerDeviceIds);
    }

    [Fact]
    public async Task Friend_request_push_arrives_once_while_target_online()
    {
        var requester = await ConnectUnregisteredAsync();
        var target = await ConnectUnregisteredAsync();
        var requesterSnapshot = await RegisterAsync(requester, "requester", "Requester");
        var targetSnapshot = await RegisterAsync(target, "target", "Target");
        var channel = System.Threading.Channels.Channel.CreateUnbounded<DeviceSnapshot>();
        target.On<DeviceSnapshot>("FriendRequestReceived", device => channel.Writer.TryWrite(device));

        await requester.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { targetSnapshot.FriendCode });
        var first = await channel.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal("requester", first.DeviceId);
        Assert.Equal(requesterSnapshot.FriendCode, first.FriendCode);

        // Re-declarar a mesma lista (poll periódico) não re-notifica.
        await requester.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { targetSnapshot.FriendCode });
        using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => channel.Reader.ReadAsync(timeout.Token).AsTask());
    }

    [Fact]
    public async Task Dismissed_request_stays_hidden_until_redeclared()
    {
        var requester = await ConnectUnregisteredAsync();
        var target = await ConnectUnregisteredAsync();
        var requesterSnapshot = await RegisterAsync(requester, "requester", "Requester");
        var targetSnapshot = await RegisterAsync(target, "target", "Target");

        await requester.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { targetSnapshot.FriendCode });
        Assert.Single(await target.InvokeAsync<DeviceSnapshot[]>("GetFriendRequests"));

        var unknown = await Assert.ThrowsAsync<HubException>(() => target.InvokeAsync("DismissFriendRequest", "ZZZZZZ"));
        Assert.Contains("Não achei ninguém", unknown.Message);

        await target.InvokeAsync("DismissFriendRequest", requesterSnapshot.FriendCode);
        Assert.Empty(await target.InvokeAsync<DeviceSnapshot[]>("GetFriendRequests"));
        // Refresh dos dois lados não ressuscita o pedido dispensado.
        await target.InvokeAsync<DeviceSnapshot[]>("GetFriends", Array.Empty<string>());
        await requester.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { targetSnapshot.FriendCode });
        Assert.Empty(await target.InvokeAsync<DeviceSnapshot[]>("GetFriendRequests"));

        // Removeu e readicionou = nova intenção: aparece de novo.
        await requester.InvokeAsync<DeviceSnapshot[]>("GetFriends", Array.Empty<string>());
        await requester.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { targetSnapshot.FriendCode });
        Assert.Single(await target.InvokeAsync<DeviceSnapshot[]>("GetFriendRequests"));
    }

    [Fact]
    public async Task Self_declaration_creates_no_request()
    {
        var device = await ConnectUnregisteredAsync();
        var snapshot = await RegisterAsync(device, "device", "Device");
        await device.InvokeAsync<DeviceSnapshot[]>("GetFriends", new[] { snapshot.FriendCode });
        Assert.Empty(await device.InvokeAsync<DeviceSnapshot[]>("GetFriendRequests"));
    }
}
