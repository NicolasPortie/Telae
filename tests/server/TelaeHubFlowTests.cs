using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Telae.Server.Core;
using Telae.Server.Hubs;

namespace Telae.Server.Tests;

/// <summary>
/// E2E no nível da sinalização (Tickets 02/03/07): dois clientes SignalR reais
/// contra o hub servido por Kestrel em porta efêmera — invite, offer/answer,
/// trickle ICE, leave e queda. Mídia WebRTC de ponta a ponta exige 2 Electrons
/// (ver docs/BENCHMARK.md).
/// </summary>
public sealed class TelaeHubFlowTests : IAsyncLifetime
{
    private WebApplication? _app;
    private string _baseUrl = "";
    private readonly List<HubConnection> _connections = [];

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddSignalR(options => options.AddFilter(typeof(DomainErrorFilter)));
        builder.Services.AddSingleton(new TelaeRegistry());
        builder.Services.AddSingleton<DisconnectCoordinator>();
        builder.Services.Configure<ReconnectConfiguration>(options => options.GracePeriodMilliseconds = 300);
        builder.Services.Configure<IceConfiguration>(options =>
            options.Servers.Add(new IceServerDto(["stun:stun.l.google.com:19302"])));
        builder.Services.Configure<TurnConfiguration>(options => options.Secret = "e2e-test-secret");

        _app = builder.Build();
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
}
