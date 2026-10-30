using System.Security.Cryptography;
using System.Text.Json;

namespace Telae.Server.Core;

// Sessões de transmissão: iniciar, entrar, sair, remover espectador e qualidade.
public sealed partial class TelaeRegistry
{
    public ShareSessionSnapshot StartShare(string deviceId, string qualityProfile, ShareAudienceDto? audience = null)
    {
        lock (_gate)
        {
            RequireOnlineDevice(deviceId);
            if (_sessionsBySharer.ContainsKey(deviceId))
                throw new TelaeDomainException("share_already_active", "Você já está transmitindo.");
            if (_sessionsBySharer.Values.Any(session => session.ViewerDeviceIds.Contains(deviceId)))
                throw new TelaeDomainException("viewer_already_joined", "Sai da transmissão atual antes de transmitir a sua.");

            var session = new ShareSessionRecord(
                Guid.NewGuid().ToString("N"),
                deviceId,
                NormalizeQualityProfile(qualityProfile),
                DateTimeOffset.UtcNow)
            {
                // Sem escolha (clientes antigos), vale o padrão de sempre: todos os amigos, com prévia.
                Audience = NormalizeAudienceLocked(deviceId, audience),
            };

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

    /// <summary>Volta para uma sessão em que o espectador já estava (reconexão).</summary>
    public ShareSessionSnapshot JoinShare(string viewerDeviceId, string sharerDeviceId)
    {
        if (string.IsNullOrWhiteSpace(sharerDeviceId) || sharerDeviceId.Length > 128)
            throw new TelaeDomainException("invalid_sharer", "Não deu pra entrar na transmissão. Tenta de novo.");
        lock (_gate)
        {
            RequireOnlineDevice(viewerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw ShareUnavailable();
            if (!CanWatchLocked(viewerDeviceId, session))
                throw ShareUnavailable();
            if (!session.ViewerDeviceIds.Contains(viewerDeviceId))
                throw new TelaeDomainException("invite_required", "Entra pela lista de amigos pra assistir essa transmissão.");
            return AttachViewerLocked(viewerDeviceId, session);
        }
    }

    /// <summary>
    /// Entrada por amizade. Exige amizade mútua e permissão para ver a transmissão. Se o espectador já
    /// assiste outro amigo, a troca é feita aqui, atomicamente:
    /// nenhuma mudança acontece se qualquer validação falhar.
    /// </summary>
    public FriendJoinResult JoinFriendShare(string viewerDeviceId, string friendCode)
    {
        var normalized = NormalizeFriendCode(friendCode);
        lock (_gate)
        {
            RequireOnlineDevice(viewerDeviceId);
            var sharerProfile = _profiles.Values.FirstOrDefault(p => string.Equals(p.FriendCode, normalized, StringComparison.OrdinalIgnoreCase))
                ?? throw new TelaeDomainException("friend_not_found", "Não deu pra achar ninguém com esse @. Confere e tenta de novo.");
            var sharerDeviceId = sharerProfile.DeviceId;
            if (sharerDeviceId == viewerDeviceId)
                throw new TelaeDomainException("cannot_view_own_share", "Você não pode assistir à sua própria transmissão.");
            if (!AreMutualFriendsLocked(viewerDeviceId, sharerDeviceId))
                throw new TelaeDomainException("not_friends", "Vocês precisam se adicionar como amigos pra assistir.");
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var target))
                throw ShareUnavailable();
            if (!CanWatchLocked(viewerDeviceId, target))
                throw ShareUnavailable();
            RequireOnlineDevice(sharerDeviceId);
            return AttachWithSwitchLocked(viewerDeviceId, target);
        }
    }

    /// <summary>Coloca o espectador na sessão, saindo da que ele assiste agora (se houver).</summary>
    private FriendJoinResult AttachWithSwitchLocked(string viewerDeviceId, ShareSessionRecord target)
    {
        if (_sessionsBySharer.ContainsKey(viewerDeviceId))
            throw new TelaeDomainException("share_already_active", "Para de transmitir antes de assistir a uma transmissão.");

        var current = _sessionsBySharer.Values.FirstOrDefault(s => s.ViewerDeviceIds.Contains(viewerDeviceId));
        if (ReferenceEquals(current, target))
            throw new TelaeDomainException("already_watching", "Você já está assistindo essa transmissão.");

        ViewerDetachment? detached = null;
        if (current is not null)
        {
            current.ViewerDeviceIds.Remove(viewerDeviceId);
            detached = new ViewerDetachment(current.SessionId, current.SharerDeviceId, viewerDeviceId);
        }
        target.ViewerDeviceIds.Add(viewerDeviceId);
        return new FriendJoinResult(ToSessionSnapshot(target), detached);
    }

    private ShareSessionSnapshot AttachViewerLocked(string viewerDeviceId, ShareSessionRecord session)
    {
        RequireOnlineDevice(session.SharerDeviceId);
        if (viewerDeviceId == session.SharerDeviceId)
            throw new TelaeDomainException("cannot_view_own_share", "Você não pode assistir à sua própria transmissão.");
        if (!CanWatchLocked(viewerDeviceId, session))
            throw ShareUnavailable();
        if (_sessionsBySharer.ContainsKey(viewerDeviceId))
            throw new TelaeDomainException("share_already_active", "Para de transmitir antes de assistir a uma transmissão.");
        if (_sessionsBySharer.Values.Any(s => s != session && s.ViewerDeviceIds.Contains(viewerDeviceId)))
            throw new TelaeDomainException("viewer_already_joined", "Sai da transmissão atual antes de entrar em outra.");
        session.ViewerDeviceIds.Add(viewerDeviceId);
        return ToSessionSnapshot(session);
    }

    public ShareSessionSnapshot StopShare(string sharerDeviceId)
    {
        lock (_gate)
        {
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Você não está transmitindo agora.");
            EndSessionLocked(session);
            return ToSessionSnapshot(session);
        }
    }

    /// <summary>Tira a sessão do ar e apaga a última miniatura.</summary>
    private void EndSessionLocked(ShareSessionRecord session)
    {
        _sessionsBySharer.Remove(session.SharerDeviceId);
        session.Preview = null;
    }

    public ShareSessionSnapshot RemoveViewer(string sharerDeviceId, string viewerDeviceId)
    {
        if (string.IsNullOrWhiteSpace(viewerDeviceId) || viewerDeviceId.Length > 128)
            throw new TelaeDomainException("invalid_viewer", "Essa pessoa não está nessa transmissão.");
        lock (_gate)
        {
            RequireOnlineDevice(sharerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Você não está transmitindo agora.");
            if (!session.ViewerDeviceIds.Remove(viewerDeviceId))
                throw new TelaeDomainException("viewer_not_joined", "Essa pessoa não está nessa transmissão.");
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
                throw new TelaeDomainException("share_not_active", "Você não está transmitindo agora.");
            session.QualityProfile = normalized;
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

    public void ValidateSessionParticipant(string sessionId, string deviceId, string targetDeviceId)
    {
        lock (_gate)
        {
            RequireOnlineDevice(deviceId);
            RequireOnlineDevice(targetDeviceId);
            var session = _sessionsBySharer.Values.FirstOrDefault(s => s.SessionId == sessionId)
                ?? throw new TelaeDomainException("share_not_active", "Essa transmissão não está mais no ar.");

            var validPair = (session.SharerDeviceId == deviceId && session.ViewerDeviceIds.Contains(targetDeviceId)) ||
                (session.SharerDeviceId == targetDeviceId && session.ViewerDeviceIds.Contains(deviceId));
            if (!validPair)
                throw new TelaeDomainException("not_session_participant", "Só quem está na transmissão pode fazer isso.");
        }
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

    private static string NormalizeQualityProfile(string value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return normalized switch
        {
            "auto" or "720p60" or "1080p30" or "1080p60" or "1440p30" or "1440p60" => normalized,
            _ => throw new TelaeDomainException("invalid_quality_profile", "Não deu pra usar esse perfil de qualidade. Escolhe outro.")
        };
    }
}
