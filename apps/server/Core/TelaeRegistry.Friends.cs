using System.Security.Cryptography;
using System.Text.Json;

namespace Telae.Server.Core;

// Amizade mútua: lista declarada, pedidos e dispensas.
public sealed partial class TelaeRegistry
{
    public DeclareFriendsResult DeclareFriends(string deviceId, IEnumerable<string> friendCodes)
    {
        lock (_gate)
        {
            var newSet = friendCodes.Select(NormalizeFriendCode).ToHashSet(StringComparer.Ordinal);
            var oldSet = _declaredFriendsByDevice.GetValueOrDefault(deviceId)
                ?? new HashSet<string>(StringComparer.Ordinal);
            _declaredFriendsByDevice[deviceId] = newSet;

            // Dispensa caduca quando o pedido deixa de existir: removeu e readicionou = nova intenção.
            foreach (var removed in oldSet.Except(newSet))
            {
                var target = _profiles.Values.FirstOrDefault(p => p.FriendCode == removed);
                if (target is not null && _dismissedRequests.TryGetValue(target.DeviceId, out var set))
                    set.Remove(deviceId);
            }

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

            // Amizade mútua dispensa o pedido pendente (para os dois lados).
            foreach (var code in newSet)
            {
                var other = _profiles.Values.FirstOrDefault(p => p.FriendCode == code);
                if (other is null || !AreMutualFriendsLocked(deviceId, other.DeviceId)) continue;
                if (_dismissedRequests.TryGetValue(deviceId, out var mine)) mine.Remove(other.DeviceId);
                if (_dismissedRequests.TryGetValue(other.DeviceId, out var theirs)) theirs.Remove(deviceId);
            }

            // Pedidos novos: declarados agora, ainda não mútuos, não dispensados, nunca a si mesmo.
            // O hub avisa cada alvo com o snapshot de quem declarou.
            var requests = new List<string>();
            if (_profiles.ContainsKey(deviceId))
            {
                var dismissedMine = _dismissedRequests.GetValueOrDefault(deviceId);
                foreach (var code in newSet.Except(oldSet))
                {
                    var other = _profiles.Values.FirstOrDefault(p => p.FriendCode == code);
                    if (other is null || other.DeviceId == deviceId) continue;
                    if (AreMutualFriendsLocked(deviceId, other.DeviceId)) continue;
                    if (dismissedMine?.Contains(other.DeviceId) == true) continue;
                    requests.Add(other.DeviceId);
                }
            }
            return new DeclareFriendsResult(detached, requests);
        }
    }

    /// <summary>
    /// Quem declarou este dispositivo sem reciprocidade (e sem dispensa): os pedidos a aceitar.
    /// </summary>

    public IReadOnlyList<DeviceSnapshot> GetFriendRequests(string deviceId)
    {
        lock (_gate)
        {
            if (!_profiles.TryGetValue(deviceId, out var me)) return [];
            var dismissedMine = _dismissedRequests.GetValueOrDefault(deviceId);
            return _profiles.Values
                .Where(p => p.DeviceId != deviceId
                    && _declaredFriendsByDevice.TryGetValue(p.DeviceId, out var theirs) && theirs.Contains(me.FriendCode)
                    && !AreMutualFriendsLocked(deviceId, p.DeviceId)
                    && (dismissedMine is null || !dismissedMine.Contains(p.DeviceId)))
                .Select(ToDeviceSnapshot)
                .OrderBy(device => device.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                .ToArray();
        }
    }

    public void DismissFriendRequest(string deviceId, string friendCode)
    {
        var normalized = NormalizeFriendCode(friendCode);
        if (normalized.Length != 6)
            throw new TelaeDomainException("invalid_friend_code", "O código tem 6 letras ou números.");
        lock (_gate)
        {
            RequireOnlineDevice(deviceId);
            var target = _profiles.Values.FirstOrDefault(p => p.FriendCode == normalized)
                ?? throw new TelaeDomainException("friend_not_found", "Não achei ninguém com esse código. Confere e tenta de novo.");
            if (target.DeviceId == deviceId) return;
            if (!_dismissedRequests.TryGetValue(deviceId, out var set))
            {
                set = new HashSet<string>(StringComparer.Ordinal);
                _dismissedRequests[deviceId] = set;
            }
            set.Add(target.DeviceId);
        }
    }

    private bool AreMutualFriendsLocked(string deviceA, string deviceB)
    {
        if (!_profiles.TryGetValue(deviceA, out var a) || !_profiles.TryGetValue(deviceB, out var b)) return false;
        return _declaredFriendsByDevice.TryGetValue(deviceA, out var aFriends) && aFriends.Contains(b.FriendCode)
            && _declaredFriendsByDevice.TryGetValue(deviceB, out var bFriends) && bFriends.Contains(a.FriendCode);
    }
}
