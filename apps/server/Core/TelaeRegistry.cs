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
    // Lista de amigos declarada por cada dispositivo (GetFriends). Persiste entre reconexões:
    // só muda quando o próprio dispositivo envia uma nova lista.
    private readonly Dictionary<string, HashSet<string>> _declaredFriendsByDevice = new(StringComparer.Ordinal);

    public const int MaxViewersPerSession = 12;
    public static readonly TimeSpan InviteLifetime = TimeSpan.FromHours(24);

    public TelaeRegistry(string? profilePath = null)
    {
        _profilePath = profilePath;
        LoadProfiles();
    }

    public DeviceSnapshot RegisterDevice(string deviceId, string displayName, string connectionId, string deviceSecret)
    {
        if (string.IsNullOrWhiteSpace(deviceId) || deviceId.Length > 128)
            throw new TelaeDomainException("device_id_required", "O dispositivo não possui um identificador válido.");

        if (deviceSecret is null || deviceSecret.Length != 64 || !deviceSecret.All(Uri.IsHexDigit))
            throw new TelaeDomainException("device_unauthorized", "Atualize o aplicativo para registrar este dispositivo com segurança.");
        var secretHash = SHA256.HashData(Convert.FromHexString(deviceSecret));

        displayName = NormalizeDisplayName(displayName);

        lock (_gate)
        {
            var profileChanged = false;
            string? previousName = null;
            if (_deviceByConnection.TryGetValue(connectionId, out var registeredDevice) && registeredDevice != deviceId)
                throw new TelaeDomainException("device_mismatch", "Esta conexão já pertence a outro dispositivo.");
            if (!_profiles.TryGetValue(deviceId, out var profile))
            {
                profile = new ProfileRecord(deviceId, displayName, GenerateUniqueFriendCode())
                {
                    DeviceSecretHash = Convert.ToHexString(secretHash)
                };
                _profiles.Add(deviceId, profile);
                profileChanged = true;
            }
            else
            {
                if (profile.DeviceSecretHash is null ||
                    !CryptographicOperations.FixedTimeEquals(secretHash, Convert.FromHexString(profile.DeviceSecretHash)))
                    throw new TelaeDomainException("device_unauthorized", "A credencial deste dispositivo é inválida. Atualize o aplicativo e tente novamente.");
                profileChanged = profile.DisplayName != displayName;
                previousName = profile.DisplayName;
                profile.DisplayName = displayName;
            }

            if (profileChanged)
            {
                try { PersistProfiles(); }
                catch
                {
                    if (previousName is null) _profiles.Remove(deviceId);
                    else profile.DisplayName = previousName;
                    throw;
                }
            }

            if (_connectionByDevice.TryGetValue(deviceId, out var previousConnection))
                _deviceByConnection.Remove(previousConnection);

            _disconnectGenerationByDevice[deviceId] = NextDisconnectGenerationLocked(deviceId);
            _connectionByDevice[deviceId] = connectionId;
            _deviceByConnection[connectionId] = deviceId;
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
            if (_sessionsBySharer.Values.Any(session => session.ViewerDeviceIds.Contains(deviceId)))
                throw new TelaeDomainException("viewer_already_joined", "Saia da transmissão atual antes de compartilhar sua tela.");

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
        if (string.IsNullOrWhiteSpace(sharerDeviceId) || sharerDeviceId.Length > 128)
            throw new TelaeDomainException("invalid_sharer", "Informe um dispositivo válido.");
        lock (_gate)
        {
            RequireOnlineDevice(viewerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Esta pessoa não está compartilhando a tela agora.");
            if (session.BlockedViewerDeviceIds.Contains(viewerDeviceId))
                throw new TelaeDomainException("viewer_removed", "Você foi removido desta transmissão.");
            if (!session.ViewerDeviceIds.Contains(viewerDeviceId))
                throw new TelaeDomainException("invite_required", "Use um código de convite para entrar nesta transmissão.");
            return AttachViewerLocked(viewerDeviceId, session);
        }
    }

    /// <summary>
    /// Entrada por amizade. Exige amizade mútua (ambos declararam o outro em GetFriends).
    /// Se o espectador já assiste outro amigo, a troca é feita aqui, atomicamente: nenhuma
    /// mudança acontece se qualquer validação falhar.
    /// </summary>
    public FriendJoinResult JoinFriendShare(string viewerDeviceId, string friendCode)
    {
        var normalized = NormalizeFriendCode(friendCode);
        if (normalized.Length != 6)
            throw new TelaeDomainException("invalid_friend_code", "Código de amigo deve ter 6 caracteres.");
        lock (_gate)
        {
            RequireOnlineDevice(viewerDeviceId);
            var sharerProfile = _profiles.Values.FirstOrDefault(p => p.FriendCode == normalized)
                ?? throw new TelaeDomainException("friend_not_found", "Amigo não encontrado. Confira o código e tente novamente.");
            var sharerDeviceId = sharerProfile.DeviceId;
            if (sharerDeviceId == viewerDeviceId)
                throw new TelaeDomainException("cannot_view_own_share", "Você não pode assistir à sua própria transmissão.");
            if (!AreMutualFriendsLocked(viewerDeviceId, sharerDeviceId))
                throw new TelaeDomainException("not_friends", "Vocês precisam se adicionar como amigos para assistir.");
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var target))
                throw new TelaeDomainException("share_not_active", "Seu amigo não está transmitindo agora.");
            RequireOnlineDevice(sharerDeviceId);
            if (target.BlockedViewerDeviceIds.Contains(viewerDeviceId))
                throw new TelaeDomainException("viewer_removed", "Você foi removido desta transmissão.");
            if (_sessionsBySharer.ContainsKey(viewerDeviceId))
                throw new TelaeDomainException("share_already_active", "Encerre sua transmissão antes de assistir a outra.");

            var current = _sessionsBySharer.Values.FirstOrDefault(s => s.ViewerDeviceIds.Contains(viewerDeviceId));
            if (ReferenceEquals(current, target))
                throw new TelaeDomainException("already_watching", "Você já está assistindo esta transmissão.");
            if (target.ViewerDeviceIds.Count >= MaxViewersPerSession)
                throw new TelaeDomainException("share_full", $"Esta transmissão atingiu o limite de {MaxViewersPerSession} espectadores.");

            ViewerDetachment? detached = null;
            if (current is not null)
            {
                current.ViewerDeviceIds.Remove(viewerDeviceId);
                detached = new ViewerDetachment(current.SessionId, current.SharerDeviceId, viewerDeviceId);
            }
            target.ViewerDeviceIds.Add(viewerDeviceId);
            return new FriendJoinResult(ToSessionSnapshot(target), detached);
        }
    }

    /// <summary>
    /// Registra a lista de amigos declarada pelo dispositivo. Quando a amizade mútua deixa de
    /// valer para uma transmissão em andamento, o espectador é removido e a lista de saídas é
    /// devolvida para o hub notificar as duas partes.
    /// </summary>
    public IReadOnlyList<ViewerDetachment> DeclareFriends(string deviceId, IEnumerable<string> friendCodes)
    {
        lock (_gate)
        {
            _declaredFriendsByDevice[deviceId] = friendCodes.Select(NormalizeFriendCode).ToHashSet(StringComparer.Ordinal);

            var detached = new List<ViewerDetachment>();
            if (_sessionsBySharer.TryGetValue(deviceId, out var own))
            {
                foreach (var viewerId in own.ViewerDeviceIds.ToArray())
                {
                    if (AreMutualFriendsLocked(deviceId, viewerId)) continue;
                    own.ViewerDeviceIds.Remove(viewerId);
                    detached.Add(new ViewerDetachment(own.SessionId, own.SharerDeviceId, viewerId));
                }
            }

            var watching = _sessionsBySharer.Values.FirstOrDefault(s => s.ViewerDeviceIds.Contains(deviceId));
            if (watching is not null && !AreMutualFriendsLocked(deviceId, watching.SharerDeviceId))
            {
                watching.ViewerDeviceIds.Remove(deviceId);
                detached.Add(new ViewerDetachment(watching.SessionId, watching.SharerDeviceId, deviceId));
            }
            return detached;
        }
    }

    private bool AreMutualFriendsLocked(string deviceA, string deviceB)
    {
        if (!_profiles.TryGetValue(deviceA, out var a) || !_profiles.TryGetValue(deviceB, out var b)) return false;
        return _declaredFriendsByDevice.TryGetValue(deviceA, out var aFriends) && aFriends.Contains(b.FriendCode)
            && _declaredFriendsByDevice.TryGetValue(deviceB, out var bFriends) && bFriends.Contains(a.FriendCode);
    }

    public string? FindConnectionId(string deviceId)
    {
        lock (_gate)
        {
            return _connectionByDevice.TryGetValue(deviceId, out var connectionId) ? connectionId : null;
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
        if (session.BlockedViewerDeviceIds.Contains(viewerDeviceId))
            throw new TelaeDomainException("viewer_removed", "Você foi removido desta transmissão.");
        RequireOnlineDevice(session.SharerDeviceId);
        if (viewerDeviceId == session.SharerDeviceId)
            throw new TelaeDomainException("cannot_view_own_share", "O dispositivo não pode assistir à própria transmissão.");
        if (_sessionsBySharer.ContainsKey(viewerDeviceId))
            throw new TelaeDomainException("share_already_active", "Encerre sua transmissão antes de assistir a outra.");
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

    public ShareSessionSnapshot RemoveViewer(string sharerDeviceId, string viewerDeviceId)
    {
        if (string.IsNullOrWhiteSpace(viewerDeviceId) || viewerDeviceId.Length > 128)
            throw new TelaeDomainException("invalid_viewer", "Informe um espectador válido.");
        lock (_gate)
        {
            RequireOnlineDevice(sharerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Este dispositivo não possui uma transmissão ativa.");
            if (!session.ViewerDeviceIds.Remove(viewerDeviceId))
                throw new TelaeDomainException("viewer_not_joined", "O espectador não participa desta transmissão.");
            session.BlockedViewerDeviceIds.Add(viewerDeviceId);
            return ToSessionSnapshot(session);
        }
    }

    public ShareSessionSnapshot UpdateShareQuality(string sharerDeviceId, string qualityProfile)
    {
        var normalized = NormalizeQualityProfile(qualityProfile);
        lock (_gate)
        {
            RequireOnlineDevice(sharerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Este dispositivo não possui uma transmissão ativa.");
            session.QualityProfile = normalized;
            return ToSessionSnapshot(session);
        }
    }

    public bool IsRegisteredConnection(string connectionId)
    {
        lock (_gate) return _deviceByConnection.ContainsKey(connectionId);
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
        var temporaryPath = $"{_profilePath}.{Guid.NewGuid():N}.tmp";
        try
        {
            using (var file = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                4096, FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(file, _profiles.Values.OrderBy(profile => profile.DeviceId),
                    new JsonSerializerOptions { WriteIndented = true });
                file.Flush(flushToDisk: true);
            }
            File.Move(temporaryPath, _profilePath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static string NormalizeDisplayName(string value)
    {
        var normalized = value?.Trim() ?? "";
        if (normalized.Length is < 1 or > 32)
            throw new TelaeDomainException("invalid_display_name", "O nome deve ter entre 1 e 32 caracteres.");
        return normalized;
    }

    private static string NormalizeFriendCode(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 32)
            throw new TelaeDomainException("invalid_friend_code", "Código inválido.");
        var normalized = value.Trim().Replace("-", "").ToUpperInvariant();
        if (normalized.Length is not (6 or 8) || !normalized.All(char.IsAsciiLetterOrDigit))
            throw new TelaeDomainException("invalid_friend_code", "Código inválido.");
        return normalized;
    }

    private static string NormalizeQualityProfile(string value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return normalized switch
        {
            "auto" or "720p60" or "1080p30" or "1080p60" or "1440p30" or "1440p60" => normalized,
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
        public string? DeviceSecretHash { get; init; }
    }

    private sealed class ShareSessionRecord(
        string sessionId,
        string sharerDeviceId,
        string qualityProfile,
        DateTimeOffset startedAt)
    {
        public string SessionId { get; } = sessionId;
        public string SharerDeviceId { get; } = sharerDeviceId;
        public string QualityProfile { get; set; } = qualityProfile;
        public HashSet<string> ViewerDeviceIds { get; } = new(StringComparer.Ordinal);
        public HashSet<string> BlockedViewerDeviceIds { get; } = new(StringComparer.Ordinal);
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
