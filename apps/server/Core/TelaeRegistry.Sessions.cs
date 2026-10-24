using System.Security.Cryptography;
using System.Text.Json;

namespace Telae.Server.Core;

// Sessões de transmissão: iniciar, entrar, sair, remover espectador e qualidade.
public sealed partial class TelaeRegistry
{
    public ShareSessionSnapshot StartShare(string deviceId, string qualityProfile)
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
            throw new TelaeDomainException("invalid_sharer", "Não deu pra entrar na transmissão. Tenta de novo.");
        lock (_gate)
        {
            RequireOnlineDevice(viewerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Essa pessoa não está transmitindo agora.");
            if (session.BlockedViewerDeviceIds.Contains(viewerDeviceId))
                throw new TelaeDomainException("viewer_removed", "Você foi removido dessa transmissão.");
            if (!session.ViewerDeviceIds.Contains(viewerDeviceId))
                throw new TelaeDomainException("invite_required", "Usa um código de convite pra entrar nessa transmissão.");
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
                throw new TelaeDomainException("share_not_active", "Seu amigo não está transmitindo agora.");
            RequireOnlineDevice(sharerDeviceId);
            if (target.BlockedViewerDeviceIds.Contains(viewerDeviceId))
                throw new TelaeDomainException("viewer_removed", "Você foi removido dessa transmissão.");
            if (_sessionsBySharer.ContainsKey(viewerDeviceId))
                throw new TelaeDomainException("share_already_active", "Para de transmitir antes de assistir a uma transmissão.");

            var current = _sessionsBySharer.Values.FirstOrDefault(s => s.ViewerDeviceIds.Contains(viewerDeviceId));
            if (ReferenceEquals(current, target))
                throw new TelaeDomainException("already_watching", "Você já está assistindo essa transmissão.");
            if (target.ViewerDeviceIds.Count >= MaxViewersPerSession)
                throw new TelaeDomainException("share_full", $"Essa transmissão já chegou ao limite de {MaxViewersPerSession} pessoas.");

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

    private ShareSessionSnapshot AttachViewerLocked(string viewerDeviceId, ShareSessionRecord session)
    {
        if (session.BlockedViewerDeviceIds.Contains(viewerDeviceId))
            throw new TelaeDomainException("viewer_removed", "Você foi removido dessa transmissão.");
        RequireOnlineDevice(session.SharerDeviceId);
        if (viewerDeviceId == session.SharerDeviceId)
            throw new TelaeDomainException("cannot_view_own_share", "Você não pode assistir à sua própria transmissão.");
        if (_profiles[session.SharerDeviceId].DeviceSecretHash is null && !AreMutualFriendsLocked(viewerDeviceId, session.SharerDeviceId))
            throw new TelaeDomainException("not_friends", "Vocês precisam se adicionar como amigos pra assistir.");
        if (_sessionsBySharer.ContainsKey(viewerDeviceId))
            throw new TelaeDomainException("share_already_active", "Para de transmitir antes de assistir a uma transmissão.");
        if (_sessionsBySharer.Values.Any(s => s != session && s.ViewerDeviceIds.Contains(viewerDeviceId)))
            throw new TelaeDomainException("viewer_already_joined", "Sai da transmissão atual antes de entrar em outra.");
        if (session.ViewerDeviceIds.Count >= MaxViewersPerSession && !session.ViewerDeviceIds.Contains(viewerDeviceId))
            throw new TelaeDomainException("share_full", "Essa transmissão já chegou ao limite de 12 pessoas.");
        session.ViewerDeviceIds.Add(viewerDeviceId);
        return ToSessionSnapshot(session);
    }

    public ShareSessionSnapshot StopShare(string sharerDeviceId)
    {
        lock (_gate)
        {
            if (!_sessionsBySharer.Remove(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Você não está transmitindo agora.");
            // Os convites da sessão terminada são mantidos de propósito: entrar com
            // eles deve responder share_not_active ("transmissão já terminou") em vez
            // de invite_invalid. Eles saem por expiração no próximo CreateInvite.
            return ToSessionSnapshot(session);
        }
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
