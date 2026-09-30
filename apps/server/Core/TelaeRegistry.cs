using System.Security.Cryptography;
using System.Text.Json;

namespace Telae.Server.Core;

public sealed class TelaeRegistry
{
    private readonly object _gate = new();
    private readonly string? _profilePath;
    private readonly Dictionary<string, ProfileRecord> _profiles = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _deviceByConnection = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _connectionByDevice = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> _disconnectGenerationByDevice = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ShareSessionRecord> _sessionsBySharer = new(StringComparer.Ordinal);
    private readonly Dictionary<string, InviteRecord> _invitesByCode = new(StringComparer.OrdinalIgnoreCase);

    public static readonly TimeSpan InviteLifetime = TimeSpan.FromHours(24);

    public TelaeRegistry(string? profilePath = null)
    {
        _profilePath = profilePath;
        LoadProfiles();
    }

    public DeviceSnapshot RegisterDevice(string deviceId, string displayName, string connectionId)
    {
        if (string.IsNullOrWhiteSpace(deviceId))
            throw new TelaeDomainException("device_id_required", "O dispositivo não possui um identificador válido.");

        displayName = NormalizeDisplayName(displayName);

        lock (_gate)
        {
            if (!_profiles.TryGetValue(deviceId, out var profile))
            {
                profile = new ProfileRecord(deviceId, displayName, GenerateUniqueFriendCode());
                _profiles.Add(deviceId, profile);
            }
            else
            {
                profile.DisplayName = displayName;
            }

            if (_connectionByDevice.TryGetValue(deviceId, out var previousConnection))
                _deviceByConnection.Remove(previousConnection);

            _disconnectGenerationByDevice[deviceId] = NextDisconnectGenerationLocked(deviceId);
            _connectionByDevice[deviceId] = connectionId;
            _deviceByConnection[connectionId] = deviceId;
            PersistProfiles();
            return ToDeviceSnapshot(profile);
        }
    }

    public DeviceSnapshot? GetDevice(string deviceId)
    {
        lock (_gate)
        {
            return _profiles.TryGetValue(deviceId, out var profile) ? ToDeviceSnapshot(profile) : null;
        }
    }

    public DeviceSnapshot? FindByFriendCode(string friendCode)
    {
        var normalized = NormalizeFriendCode(friendCode);
        lock (_gate)
        {
            var profile = _profiles.Values.FirstOrDefault(p => p.FriendCode == normalized);
            return profile is null ? null : ToDeviceSnapshot(profile);
        }
    }

    public IReadOnlyList<DeviceSnapshot> GetDevicesByFriendCodes(IEnumerable<string> friendCodes)
    {
        var codes = friendCodes.Select(NormalizeFriendCode).ToHashSet(StringComparer.OrdinalIgnoreCase);
        lock (_gate)
        {
            return _profiles.Values
                .Where(profile => codes.Contains(profile.FriendCode))
                .Select(ToDeviceSnapshot)
                .OrderByDescending(device => device.Status == "transmitting")
                .ThenByDescending(device => device.Status == "online")
                .ThenBy(device => device.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                .ToArray();
        }
    }

    public ShareSessionSnapshot StartShare(string deviceId, string qualityProfile)
    {
        lock (_gate)
        {
            RequireOnlineDevice(deviceId);
            if (_sessionsBySharer.ContainsKey(deviceId))
                throw new TelaeDomainException("share_already_active", "Este dispositivo já está compartilhando a tela.");

            var session = new ShareSessionRecord(
                Guid.NewGuid().ToString("N"),
                deviceId,
                NormalizeQualityProfile(qualityProfile),
                DateTimeOffset.UtcNow);

            _sessionsBySharer.Add(deviceId, session);
            return ToSessionSnapshot(session);
        }
    }

    public ShareSessionSnapshot? GetActiveSessionForSharer(string sharerDeviceId)
    {
        lock (_gate)
        {
            return _sessionsBySharer.TryGetValue(sharerDeviceId, out var session)
                ? ToSessionSnapshot(session)
                : null;
        }
    }

    public ShareSessionSnapshot JoinShare(string viewerDeviceId, string sharerDeviceId)
    {
        lock (_gate)
        {
            RequireOnlineDevice(viewerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Esta pessoa não está compartilhando a tela agora.");
            return AttachViewerLocked(viewerDeviceId, session);
        }
    }

    public InviteSnapshot CreateInvite(string sharerDeviceId, TimeSpan? timeToLive = null)
    {
        lock (_gate)
        {
            RequireOnlineDevice(sharerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Inicie a transmissão antes de gerar um convite.");

            PurgeExpiredInvitesLocked();
            var code = GenerateUniqueInviteCode();
            var invite = new InviteRecord(code, session.SessionId, sharerDeviceId, DateTimeOffset.UtcNow + (timeToLive ?? InviteLifetime));
            _invitesByCode.Add(code, invite);
            return new InviteSnapshot(invite.Code, invite.SessionId, invite.ExpiresAt);
        }
    }

    public ShareSessionSnapshot JoinWithInvite(string viewerDeviceId, string inviteCode)
    {
        lock (_gate)
        {
            RequireOnlineDevice(viewerDeviceId);
            var normalized = NormalizeFriendCode(inviteCode);
            if (!_invitesByCode.TryGetValue(normalized, out var invite))
                throw new TelaeDomainException("invite_invalid", "Este convite não existe. Confira o código e tente de novo.");
            if (invite.ExpiresAt <= DateTimeOffset.UtcNow)
                throw new TelaeDomainException("invite_expired", "Este convite expirou. Peça um novo convite ao Sharer.");
            if (!_sessionsBySharer.TryGetValue(invite.SharerDeviceId, out var session) || session.SessionId != invite.SessionId)
                throw new TelaeDomainException("share_not_active", "Esta transmissão já terminou.");

            return AttachViewerLocked(viewerDeviceId, session);
        }
    }

    private ShareSessionSnapshot AttachViewerLocked(string viewerDeviceId, ShareSessionRecord session)
    {
        if (viewerDeviceId == session.SharerDeviceId)
            throw new TelaeDomainException("cannot_view_own_share", "O dispositivo não pode assistir à própria transmissão.");
        if (_sessionsBySharer.Values.Any(s => s != session && s.ViewerDeviceIds.Contains(viewerDeviceId)))
            throw new TelaeDomainException("viewer_already_joined", "Saia da transmissão atual antes de entrar em outra.");
        if (session.ViewerDeviceIds.Count >= 12 && !session.ViewerDeviceIds.Contains(viewerDeviceId))
            throw new TelaeDomainException("share_full", "Esta transmissão atingiu o limite de 12 espectadores.");
        session.ViewerDeviceIds.Add(viewerDeviceId);
        return ToSessionSnapshot(session);
    }

    public ShareSessionSnapshot StopShare(string sharerDeviceId)
    {
        lock (_gate)
        {
            if (!_sessionsBySharer.Remove(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Este dispositivo não possui uma transmissão ativa.");
            // Os convites da sessão terminada são mantidos de propósito: entrar com
            // eles deve responder share_not_active ("transmissão já terminou") em vez
            // de invite_invalid. Eles saem por expiração no próximo CreateInvite.
            return ToSessionSnapshot(session);
        }
    }

    public LeaveViewerResult LeaveShare(string viewerDeviceId)
    {
        lock (_gate)
        {
            var session = _sessionsBySharer.Values.FirstOrDefault(s => s.ViewerDeviceIds.Contains(viewerDeviceId));
            if (session is null) return new LeaveViewerResult(null, null, null);

            session.ViewerDeviceIds.Remove(viewerDeviceId);
            _connectionByDevice.TryGetValue(session.SharerDeviceId, out var connectionId);
            return new LeaveViewerResult(ToSessionSnapshot(session), connectionId, viewerDeviceId);
        }
    }

    public PendingDisconnect BeginDisconnect(string connectionId)
    {
        lock (_gate)
        {
            if (!_deviceByConnection.Remove(connectionId, out var deviceId))
                return new PendingDisconnect(null, 0);

            if (_connectionByDevice.TryGetValue(deviceId, out var mapped) && mapped == connectionId)
                _connectionByDevice.Remove(deviceId);

            var generation = NextDisconnectGenerationLocked(deviceId);
            _disconnectGenerationByDevice[deviceId] = generation;
            return new PendingDisconnect(deviceId, generation);
        }
    }

    public DisconnectResult FinalizeDisconnect(string deviceId, long generation)
    {
        lock (_gate)
        {
            if (!_disconnectGenerationByDevice.TryGetValue(deviceId, out var currentGeneration) ||
                currentGeneration != generation ||
                _connectionByDevice.ContainsKey(deviceId))
            {
                return new DisconnectResult(null, null, null, null);
            }

            _disconnectGenerationByDevice.Remove(deviceId);
            ShareSessionSnapshot? ended = null;
            ShareSessionSnapshot? viewerLeft = null;
            string? viewerLeftDeviceId = null;
            if (_sessionsBySharer.Remove(deviceId, out var sharerSession))
            {
                ended = ToSessionSnapshot(sharerSession);
            }
            else
            {
                var viewerSession = _sessionsBySharer.Values.FirstOrDefault(s => s.ViewerDeviceIds.Contains(deviceId));
                if (viewerSession is not null)
                {
                    viewerSession.ViewerDeviceIds.Remove(deviceId);
                    viewerLeft = ToSessionSnapshot(viewerSession);
                    viewerLeftDeviceId = deviceId;
                }
            }

            return new DisconnectResult(
                _profiles.TryGetValue(deviceId, out var profile) ? ToDeviceSnapshot(profile) : null,
                ended,
                viewerLeft,
                viewerLeftDeviceId);
        }
    }

    private long NextDisconnectGenerationLocked(string deviceId) =>
        _disconnectGenerationByDevice.TryGetValue(deviceId, out var current) ? current + 1 : 1;

    public string GetConnectionId(string deviceId)
    {
        lock (_gate)
        {
            if (!_connectionByDevice.TryGetValue(deviceId, out var connectionId))
                throw new TelaeDomainException("device_offline", "O dispositivo não está online.");
            return connectionId;
        }
    }

    public string GetDeviceIdForConnection(string connectionId)
    {
        lock (_gate)
        {
            if (!_deviceByConnection.TryGetValue(connectionId, out var deviceId))
                throw new TelaeDomainException("device_not_registered", "Registre o dispositivo antes de usar esta operação.");
            return deviceId;
        }
    }

    public void ValidateSessionParticipant(string sessionId, string deviceId, string targetDeviceId)
    {
        lock (_gate)
        {
            var session = _sessionsBySharer.Values.FirstOrDefault(s => s.SessionId == sessionId)
                ?? throw new TelaeDomainException("share_not_active", "A transmissão não está mais ativa.");

            var validPair = (session.SharerDeviceId == deviceId && session.ViewerDeviceIds.Contains(targetDeviceId)) ||
                (session.SharerDeviceId == targetDeviceId && session.ViewerDeviceIds.Contains(deviceId));
            if (!validPair)
                throw new TelaeDomainException("not_session_participant", "Somente participantes da transmissão podem trocar sinalização.");
        }
    }

    private DeviceSnapshot ToDeviceSnapshot(ProfileRecord profile)
    {
        var online = _connectionByDevice.ContainsKey(profile.DeviceId);
        _sessionsBySharer.TryGetValue(profile.DeviceId, out var activeSession);
        var status = activeSession is not null ? "transmitting" : online ? "online" : "offline";
        return new DeviceSnapshot(
            profile.DeviceId,
            profile.DisplayName,
            profile.FriendCode,
            status,
            activeSession is not null,
            activeSession?.QualityProfile);
    }

    private ShareSessionSnapshot ToSessionSnapshot(ShareSessionRecord session)
    {
        var name = _profiles.TryGetValue(session.SharerDeviceId, out var profile) ? profile.DisplayName : "Amigo";
        return new ShareSessionSnapshot(
            session.SessionId,
            session.SharerDeviceId,
            name,
            session.QualityProfile,
            session.ViewerDeviceIds.Order(StringComparer.Ordinal).ToArray(),
            session.StartedAt);
    }

    private void RequireOnlineDevice(string deviceId)
    {
        if (!_profiles.ContainsKey(deviceId))
            throw new TelaeDomainException("device_not_registered", "O dispositivo ainda não foi registrado.");
        if (!_connectionByDevice.ContainsKey(deviceId))
            throw new TelaeDomainException("device_offline", "O dispositivo não está online.");
    }

    private string GenerateUniqueFriendCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        Span<byte> bytes = stackalloc byte[6];

        for (var attempt = 0; attempt < 100; attempt++)
        {
            RandomNumberGenerator.Fill(bytes);
            var chars = new char[6];
            for (var i = 0; i < chars.Length; i++) chars[i] = alphabet[bytes[i] % alphabet.Length];
            var code = new string(chars);
            if (_profiles.Values.All(profile => profile.FriendCode != code)) return code;
        }

        throw new InvalidOperationException("Não foi possível gerar um código de amigo único.");
    }

    private string GenerateUniqueInviteCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        Span<byte> bytes = stackalloc byte[8];

        for (var attempt = 0; attempt < 100; attempt++)
        {
            RandomNumberGenerator.Fill(bytes);
            var chars = new char[8];
            for (var i = 0; i < chars.Length; i++) chars[i] = alphabet[bytes[i] % alphabet.Length];
            var code = new string(chars);
            if (!_invitesByCode.ContainsKey(code)) return code;
        }

        throw new InvalidOperationException("Não foi possível gerar um código de convite único.");
    }

    private void PurgeExpiredInvitesLocked()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var code in _invitesByCode.Values.Where(i => i.ExpiresAt <= now).Select(i => i.Code).ToArray())
            _invitesByCode.Remove(code);
    }

    private void LoadProfiles()
    {
        if (string.IsNullOrWhiteSpace(_profilePath) || !File.Exists(_profilePath)) return;
        try
        {
            var profiles = JsonSerializer.Deserialize<List<ProfileRecord>>(File.ReadAllText(_profilePath)) ?? [];
            foreach (var profile in profiles) _profiles[profile.DeviceId] = profile;
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException($"O arquivo de perfis '{_profilePath}' está inválido.", exception);
        }
    }

    private void PersistProfiles()
    {
        if (string.IsNullOrWhiteSpace(_profilePath)) return;
        var folder = Path.GetDirectoryName(_profilePath);
        if (!string.IsNullOrWhiteSpace(folder)) Directory.CreateDirectory(folder);
        File.WriteAllText(_profilePath, JsonSerializer.Serialize(
            _profiles.Values.OrderBy(profile => profile.DeviceId),
            new JsonSerializerOptions { WriteIndented = true }));
    }

    private static string NormalizeDisplayName(string value)
    {
        var normalized = value.Trim();
        if (normalized.Length is < 1 or > 32)
            throw new TelaeDomainException("invalid_display_name", "O nome deve ter entre 1 e 32 caracteres.");
        return normalized;
    }

    private static string NormalizeFriendCode(string value) => value.Trim().Replace("-", "").ToUpperInvariant();

    private static string NormalizeQualityProfile(string value)
    {
        var normalized = value.Trim().ToLowerInvariant();
        return normalized switch
        {
            "auto" or "720p60" or "1080p30" or "1080p60" => normalized,
            _ => throw new TelaeDomainException("invalid_quality_profile", "Perfil de qualidade inválido.")
        };
    }

    private sealed class ProfileRecord
    {
        public ProfileRecord(string deviceId, string displayName, string friendCode)
        {
            DeviceId = deviceId;
            DisplayName = displayName;
            FriendCode = friendCode;
        }

        public string DeviceId { get; init; }
        public string DisplayName { get; set; }
        public string FriendCode { get; init; }
    }

    private sealed class ShareSessionRecord(
        string sessionId,
        string sharerDeviceId,
        string qualityProfile,
        DateTimeOffset startedAt)
    {
        public string SessionId { get; } = sessionId;
        public string SharerDeviceId { get; } = sharerDeviceId;
        public string QualityProfile { get; } = qualityProfile;
        public HashSet<string> ViewerDeviceIds { get; } = new(StringComparer.Ordinal);
        public DateTimeOffset StartedAt { get; } = startedAt;
    }

    private sealed class InviteRecord(string code, string sessionId, string sharerDeviceId, DateTimeOffset expiresAt)
    {
        public string Code { get; } = code;
        public string SessionId { get; } = sessionId;
        public string SharerDeviceId { get; } = sharerDeviceId;
        public DateTimeOffset ExpiresAt { get; } = expiresAt;
    }
}
