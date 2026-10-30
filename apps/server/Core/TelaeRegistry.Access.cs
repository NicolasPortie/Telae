namespace Telae.Server.Core;

// Regra única de acesso a uma transmissão. Entrar, reconectar, receber a prévia e ver o "ao vivo" na presença
// passam todos por CanWatchLocked: nenhum outro ponto decide acesso.
public sealed partial class TelaeRegistry
{
    public const int MaxSelectedViewers = 200;

    /// <summary>
    /// <paramref name="viewerId"/> pode assistir à transmissão? A primeira regra que se aplica decide: quem
    /// transmite, oculto, removido, não amigo e fora do público escolhido não veem; os demais veem.
    /// </summary>
    private bool CanWatchLocked(string viewerId, ShareSessionRecord session)
    {
        if (viewerId == session.SharerDeviceId) return false;
        if (IsHiddenLocked(session.SharerDeviceId, viewerId)) return false;
        if (session.BlockedViewerDeviceIds.Contains(viewerId)) return false;
        // Só amigos mútuos assistem: deixar de ser amigo encerra o acesso.
        if (!AreMutualFriendsLocked(viewerId, session.SharerDeviceId)) return false;
        return session.Audience.Mode == AudienceMode.Friends || session.Audience.SelectedIds.Contains(viewerId);
    }

    /// <summary>
    /// Erro para quem não pode entrar. Oculto, fora do público e "não está transmitindo" respondem igual:
    /// ninguém descobre que foi deixado de fora.
    /// </summary>
    private static TelaeDomainException ShareUnavailable() =>
        new TelaeDomainException("share_not_active", "Seu amigo não está transmitindo agora.");

    /// <summary>Reaplica a regra a quem assiste: quem perdeu o acesso sai da transmissão.</summary>
    private AccessChange ReevaluateLocked(ShareSessionRecord session)
    {
        var detached = new List<ViewerDetachment>();
        foreach (var viewerId in session.ViewerDeviceIds.ToArray())
        {
            if (CanWatchLocked(viewerId, session)) continue;
            session.ViewerDeviceIds.Remove(viewerId);
            detached.Add(new ViewerDetachment(session.SessionId, session.SharerDeviceId, viewerId));
        }
        return detached.Count == 0 ? AccessChange.None : new AccessChange(detached);
    }

    /// <summary>Reavalia as sessões em que o dispositivo transmite ou assiste.</summary>
    private AccessChange ReevaluateSessionsInvolvingLocked(string deviceId)
    {
        var change = AccessChange.None;
        foreach (var session in _sessionsBySharer.Values.ToArray())
        {
            if (session.SharerDeviceId == deviceId || session.ViewerDeviceIds.Contains(deviceId))
                change = change.Merge(ReevaluateLocked(session));
        }
        return change;
    }

    /// <summary>
    /// Muda quem pode ver a transmissão em andamento e devolve quem saiu. Quem fica de fora sai; quem entra no
    /// público passa a ver o cartão e pode entrar, sem ser colocado na transmissão automaticamente.
    /// </summary>
    public AudienceChange UpdateShareAudience(string sharerDeviceId, ShareAudienceDto audience)
    {
        lock (_gate)
        {
            RequireOnlineDevice(sharerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Você não está transmitindo agora.");
            var normalized = NormalizeAudienceLocked(sharerDeviceId, audience);
            var before = WatchersAllowedLocked(session);
            session.Audience = normalized;
            var change = ReevaluateLocked(session);
            var lostAccess = before.Except(WatchersAllowedLocked(session)).Any();
            IReadOnlyList<string> previewRemoval = [];
            if (lostAccess)
            {
                // A próxima miniatura volta só para quem ainda pode ver.
                session.Preview = null;
                previewRemoval = before.Where(_connectionByDevice.ContainsKey).Select(id => _connectionByDevice[id]).ToArray();
            }
            return new AudienceChange(ToSessionSnapshot(session), ToAudienceDto(normalized), change, previewRemoval);
        }
    }

    public ShareAudienceDto? GetShareAudience(string sharerDeviceId)
    {
        lock (_gate)
            return _sessionsBySharer.TryGetValue(sharerDeviceId, out var session) ? ToAudienceDto(session.Audience) : null;
    }

    /// <summary>Carrega a lista uma vez: uma leitura antiga do banco não pode desfazer uma mudança já aplicada.</summary>
    public void InitializeHiddenViewers(string ownerDeviceId, IEnumerable<string> hiddenDeviceIds)
    {
        lock (_gate)
        {
            if (!_initializedHiddenOwners.Add(ownerDeviceId)) return;
            var set = hiddenDeviceIds.Where(id => id != ownerDeviceId).ToHashSet(StringComparer.Ordinal);
            if (set.Count == 0) _hiddenByOwner.Remove(ownerDeviceId);
            else _hiddenByOwner[ownerDeviceId] = set;
        }
    }

    /// <summary>Oculta (ou volta a mostrar) as transmissões do dono para uma pessoa e aplica na hora.</summary>
    public HideChange SetHidden(string ownerDeviceId, string viewerDeviceId, bool hidden)
    {
        lock (_gate)
        {
            if (ownerDeviceId == viewerDeviceId) return new HideChange(AccessChange.None, []);
            _initializedHiddenOwners.Add(ownerDeviceId);
            var couldSeePreview = _sessionsBySharer.TryGetValue(ownerDeviceId, out var active)
                && active.Preview is not null && CanWatchLocked(viewerDeviceId, active);
            if (hidden)
            {
                if (!_hiddenByOwner.TryGetValue(ownerDeviceId, out var set))
                    _hiddenByOwner[ownerDeviceId] = set = new HashSet<string>(StringComparer.Ordinal);
                set.Add(viewerDeviceId);
            }
            else if (_hiddenByOwner.TryGetValue(ownerDeviceId, out var set))
            {
                set.Remove(viewerDeviceId);
                if (set.Count == 0) _hiddenByOwner.Remove(ownerDeviceId);
            }

            if (!_sessionsBySharer.TryGetValue(ownerDeviceId, out var session)) return new HideChange(AccessChange.None, []);
            var change = ReevaluateLocked(session);
            IReadOnlyList<string> previewRemoval = hidden && couldSeePreview && _connectionByDevice.TryGetValue(viewerDeviceId, out var connection)
                ? [connection] : [];
            return new HideChange(change, previewRemoval);
        }
    }

    public bool IsHidden(string ownerDeviceId, string viewerDeviceId)
    {
        lock (_gate) return IsHiddenLocked(ownerDeviceId, viewerDeviceId);
    }

    private bool IsHiddenLocked(string ownerDeviceId, string viewerDeviceId) =>
        _hiddenByOwner.TryGetValue(ownerDeviceId, out var set) && set.Contains(viewerDeviceId);

    /// <summary>Amigos online que hoje podem ver a transmissão (presença "ao vivo" e prévia).</summary>
    private HashSet<string> WatchersAllowedLocked(ShareSessionRecord session) =>
        _connectionByDevice.Keys
            .Where(id => CanWatchLocked(id, session))
            .ToHashSet(StringComparer.Ordinal);

    private ShareAudience NormalizeAudienceLocked(string sharerDeviceId, ShareAudienceDto? audience)
    {
        if (audience is null) return ShareAudience.Default;
        var mode = audience.Mode?.Trim().ToLowerInvariant() switch
        {
            "friends" => AudienceMode.Friends,
            "selected" => AudienceMode.Selected,
            _ => throw new TelaeDomainException("invalid_audience", "Não deu pra entender quem pode ver. Escolhe de novo."),
        };
        var selected = new HashSet<string>(StringComparer.Ordinal);
        if (mode == AudienceMode.Selected)
        {
            var codes = audience.Selected ?? [];
            if (codes.Count > MaxSelectedViewers)
                throw new TelaeDomainException("invalid_audience", "Dá pra escolher até 200 amigos.");
            foreach (var code in codes)
            {
                string normalized;
                try { normalized = NormalizeFriendCode(code); }
                catch (TelaeDomainException) { continue; }
                var profile = _profiles.Values.FirstOrDefault(p => string.Equals(p.FriendCode, normalized, StringComparison.OrdinalIgnoreCase));
                // Só amigos mútuos entram na lista; o resto é ignorado sem revelar quem existe.
                if (profile is not null && AreMutualFriendsLocked(sharerDeviceId, profile.DeviceId)) selected.Add(profile.DeviceId);
            }
        }
        return new ShareAudience(mode, selected);
    }

    private ShareAudienceDto ToAudienceDto(ShareAudience audience) => new(
        audience.Mode == AudienceMode.Selected ? "selected" : "friends",
        audience.SelectedIds
            .Select(id => _profiles.TryGetValue(id, out var profile) ? profile.FriendCode : null)
            .OfType<string>()
            .Order(StringComparer.Ordinal)
            .ToArray());
}
