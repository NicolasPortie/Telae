namespace Telae.Server.Core;

public sealed record RegisterDeviceRequest(string DeviceId, string DisplayName);
public sealed record StartShareRequest(string DeviceId, string QualityProfile);

public sealed record DeviceSnapshot(
    string DeviceId,
    string DisplayName,
    string FriendCode,
    string Status,
    bool IsSharing,
    string? ActiveQualityProfile);

public sealed record ShareSessionSnapshot(
    string SessionId,
    string SharerDeviceId,
    string SharerDisplayName,
    string QualityProfile,
    string? ViewerDeviceId,
    DateTimeOffset StartedAt);

public sealed record IceServerDto(string[] Urls, string? Username = null, string? Credential = null);
public sealed record ShareAccessResult(ShareSessionSnapshot Session, IReadOnlyList<IceServerDto> IceServers);

public sealed record IceCandidatePayload(
    string Candidate,
    string? SdpMid,
    int? SdpMLineIndex,
    string? UsernameFragment);

public sealed record SignalingPayload(string Kind, string? Sdp = null, IceCandidatePayload? Candidate = null);
public sealed record SignalingEnvelope(string SessionId, string FromDeviceId, SignalingPayload Payload);
public sealed record ViewerJoinedEvent(string SessionId, DeviceSnapshot Viewer);
public sealed record InviteSnapshot(string Code, string SessionId, DateTimeOffset ExpiresAt);
public sealed record InviteResult(InviteSnapshot Invite, ShareSessionSnapshot Session);
public sealed record PendingDisconnect(string? DeviceId, long Generation);
public sealed record DisconnectResult(
    DeviceSnapshot? ChangedDevice,
    ShareSessionSnapshot? EndedSession,
    ShareSessionSnapshot? ViewerLeftSession);
public sealed record LeaveViewerResult(ShareSessionSnapshot? Session, string? SharerConnectionId);

public sealed class TelaeDomainException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public sealed class IceConfiguration
{
    public List<IceServerDto> Servers { get; init; } = [];
}

public sealed class ReconnectConfiguration
{
    public int GracePeriodMilliseconds { get; set; } = 20_000;
}
