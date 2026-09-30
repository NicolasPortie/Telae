namespace Telae.Server.Core;

public sealed record RegisterDeviceRequest(string DeviceId, string DisplayName, string DeviceSecret);
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
    IReadOnlyList<string> ViewerDeviceIds,
    DateTimeOffset StartedAt)
{
    public string? ViewerDeviceId => ViewerDeviceIds.FirstOrDefault();
}

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
public sealed record ViewerLeftEvent(string SessionId, string ViewerDeviceId);
public sealed record InviteSnapshot(string Code, string SessionId, DateTimeOffset ExpiresAt);
public sealed record InviteResult(InviteSnapshot Invite, ShareSessionSnapshot Session);
public sealed record PendingDisconnect(string? DeviceId, long Generation);
public sealed record DisconnectResult(
    DeviceSnapshot? ChangedDevice,
    ShareSessionSnapshot? EndedSession,
    ShareSessionSnapshot? ViewerLeftSession,
    string? ViewerLeftDeviceId);
public sealed record LeaveViewerResult(ShareSessionSnapshot? Session, string? SharerConnectionId, string? ViewerDeviceId);

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
