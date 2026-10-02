using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Telae.Server.Core;

namespace Telae.Server.Hubs;

public sealed class TelaeHub(
    TelaeRegistry registry,
    DisconnectCoordinator disconnectCoordinator,
    PresenceSubscriptions presence,
    IOptions<IceConfiguration> iceConfiguration,
    IOptions<TurnConfiguration> turnConfiguration) : Hub
{
    public async Task<DeviceSnapshot> RegisterDevice(RegisterDeviceRequest request)
    {
        if (request is null) throw new TelaeDomainException("invalid_request", "Informe os dados do dispositivo.");
        return await presence.RegisterAsync(request, Context.ConnectionId);
    }

    public Task<DeviceSnapshot?> LookupFriend(string friendCode)
    {
        registry.GetDeviceIdForConnection(Context.ConnectionId);
        return Task.FromResult(registry.FindByFriendCode(friendCode));
    }

    public async Task<IReadOnlyList<DeviceSnapshot>> GetFriends(string[] friendCodes)
    {
        registry.GetDeviceIdForConnection(Context.ConnectionId);
        if (friendCodes is null || friendCodes.Length > 200)
            throw new TelaeDomainException("invalid_friend_list", "Informe no máximo 200 códigos de amigos.");
        var friends = registry.GetDevicesByFriendCodes(friendCodes);
        await presence.ReplaceAsync(Context.ConnectionId, friends);
        // Read again after subscribing so changes during group setup are reflected.
        return registry.GetDevicesByFriendCodes(friendCodes);
    }

    public async Task<ShareAccessResult> StartShare(StartShareRequest request)
    {
        if (request is null) throw new TelaeDomainException("invalid_request", "Informe os dados da transmissão.");
        EnsureCallerMatches(request.DeviceId);
        var session = registry.StartShare(request.DeviceId, request.QualityProfile);
        await presence.PublishAsync(registry.GetDevice(request.DeviceId)!);
        return new ShareAccessResult(session, GetIceServers(request.DeviceId));
    }

    public Task<ShareSessionSnapshot?> GetActiveShare()
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        return Task.FromResult(registry.GetActiveSessionForSharer(deviceId));
    }

    public async Task StopShare()
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var session = registry.StopShare(deviceId);

        foreach (var viewerDeviceId in session.ViewerDeviceIds)
        {
            try
            {
                await Clients.Client(registry.GetConnectionId(viewerDeviceId))
                    .SendAsync("SessionEnded", session.SessionId);
            }
            catch (TelaeDomainException) { }
        }

        await presence.PublishAsync(registry.GetDevice(deviceId)!);
    }

    public async Task<ShareSessionSnapshot> RemoveViewer(string viewerDeviceId)
    {
        var sharerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var session = registry.RemoveViewer(sharerDeviceId, viewerDeviceId);
        try
        {
            await Clients.Client(registry.GetConnectionId(viewerDeviceId)).SendAsync("SessionEnded", session.SessionId);
        }
        catch (TelaeDomainException) { }
        await Clients.Caller.SendAsync("ViewerLeft", new ViewerLeftEvent(session.SessionId, viewerDeviceId));
        return session;
    }

    public async Task<ShareSessionSnapshot> UpdateShareQuality(string qualityProfile)
    {
        var sharerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var session = registry.UpdateShareQuality(sharerDeviceId, qualityProfile);
        await presence.PublishAsync(registry.GetDevice(sharerDeviceId)!);
        foreach (var viewer in session.ViewerDeviceIds)
        {
            try
            {
                await Clients.Client(registry.GetConnectionId(viewer)).SendAsync("ShareQualityChanged", session);
            }
            catch (TelaeDomainException) { }
        }
        return session;
    }

    public Task<InviteSnapshot> CreateInvite()
    {
        var sharerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        return Task.FromResult(registry.CreateInvite(sharerDeviceId));
    }

    public async Task<ShareAccessResult> JoinWithInvite(string inviteCode)
    {
        var viewerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var session = registry.JoinWithInvite(viewerDeviceId, inviteCode);
        await Clients.Client(registry.GetConnectionId(session.SharerDeviceId)).SendAsync(
            "ViewerJoined",
            new ViewerJoinedEvent(session.SessionId, registry.GetDevice(viewerDeviceId)!));
        return new ShareAccessResult(session, GetIceServers(viewerDeviceId));
    }

    public Task<IReadOnlyList<IceServerDto>> GetTurnCredentials()
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        return Task.FromResult(GetIceServers(deviceId));
    }

    public async Task<ShareAccessResult> JoinShare(string sharerDeviceId)
    {
        var viewerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var session = registry.JoinShare(viewerDeviceId, sharerDeviceId);
        await Clients.Client(registry.GetConnectionId(sharerDeviceId)).SendAsync(
            "ViewerJoined",
            new ViewerJoinedEvent(session.SessionId, registry.GetDevice(viewerDeviceId)!));
        return new ShareAccessResult(session, GetIceServers(viewerDeviceId));
    }

    public async Task LeaveShare()
    {
        var viewerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var result = registry.LeaveShare(viewerDeviceId);
        if (result.Session is not null && result.SharerConnectionId is not null && result.ViewerDeviceId is not null)
            await Clients.Client(result.SharerConnectionId).SendAsync("ViewerLeft", new ViewerLeftEvent(result.Session.SessionId, result.ViewerDeviceId));
    }

    public async Task SendSignal(string targetDeviceId, SignalingEnvelope envelope)
    {
        var fromDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        if (string.IsNullOrWhiteSpace(targetDeviceId) || targetDeviceId.Length > 128 ||
            envelope?.Payload is null || string.IsNullOrWhiteSpace(envelope.SessionId) || envelope.SessionId.Length > 128 ||
            string.IsNullOrWhiteSpace(envelope.FromDeviceId) || envelope.FromDeviceId.Length > 128 ||
            envelope.Payload.Kind is not ("offer" or "answer" or "candidate") ||
            (envelope.Payload.Kind is "offer" or "answer" && string.IsNullOrWhiteSpace(envelope.Payload.Sdp)) ||
            envelope.Payload.Sdp?.Length > 65_536 || envelope.Payload.Candidate?.Candidate?.Length > 4096 ||
            envelope.Payload.Candidate?.SdpMid?.Length > 256 || envelope.Payload.Candidate?.UsernameFragment?.Length > 256)
            throw new TelaeDomainException("invalid_signal", "Sinalização inválida.");
        if (!string.Equals(fromDeviceId, envelope.FromDeviceId, StringComparison.Ordinal))
            throw new TelaeDomainException("invalid_signal_sender", "O remetente não corresponde ao dispositivo conectado.");

        registry.ValidateSessionParticipant(envelope.SessionId, fromDeviceId, targetDeviceId);
        await Clients.Client(registry.GetConnectionId(targetDeviceId)).SendAsync("SignalReceived", envelope);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await presence.RemoveAsync(Context.ConnectionId);
        disconnectCoordinator.Schedule(registry.BeginDisconnect(Context.ConnectionId));
        await base.OnDisconnectedAsync(exception);
    }

    private IReadOnlyList<IceServerDto> GetIceServers(string deviceId)
    {
        var servers = iceConfiguration.Value.Servers.Count > 0
            ? iceConfiguration.Value.Servers
            : new List<IceServerDto> { new(["stun:stun.l.google.com:19302"]) };

        var turn = turnConfiguration.Value;
        if (string.IsNullOrWhiteSpace(turn.Secret) || turn.Urls.Length == 0)
            return servers;

        var (username, password) = TurnCredentialIssuer.Issue(
            turn.Secret, deviceId, DateTimeOffset.UtcNow, turn.TtlSeconds);
        return [.. servers, new IceServerDto(turn.Urls, username, password)];
    }

    private void EnsureCallerMatches(string deviceId)
    {
        if (registry.GetDeviceIdForConnection(Context.ConnectionId) != deviceId)
            throw new TelaeDomainException("device_mismatch", "O dispositivo informado não corresponde à conexão atual.");
    }
}
