using Microsoft.AspNetCore.SignalR;
using Telae.Server.Hubs;

namespace Telae.Server.Core;

// Serialize membership changes and publications so replaced/revoked connections
// cannot keep receiving presence through old SignalR groups.
public sealed class PresenceSubscriptions(TelaeRegistry registry, IHubContext<TelaeHub> hub)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, HashSet<string>> _groups = new(StringComparer.Ordinal);
    private static string Group(string code) => $"presence:{code.ToLowerInvariant()}";

    public async Task<DeviceSnapshot> RegisterAsync(RegisterDeviceRequest request, string connectionId, bool authenticatedAccount = false)
    {
        await _gate.WaitAsync();
        try
        {
            var device = authenticatedAccount
                ? registry.RegisterAccountDevice(request.DeviceId, request.Username ?? "", request.DisplayName, connectionId)
                : registry.RegisterDevice(request.DeviceId, request.DisplayName, connectionId, request.DeviceSecret);
            await PublishLockedAsync(device);
            return device;
        }
        finally { _gate.Release(); }
    }

    public async Task ReplaceAsync(string connectionId, IReadOnlyList<DeviceSnapshot> friends)
    {
        await _gate.WaitAsync();
        try
        {
            registry.GetDeviceIdForConnection(connectionId);
            var desired = friends.Select(friend => Group(friend.FriendCode)).ToHashSet(StringComparer.Ordinal);
            var previous = _groups.GetValueOrDefault(connectionId) ?? [];
            foreach (var group in previous.Except(desired))
                await hub.Groups.RemoveFromGroupAsync(connectionId, group);
            foreach (var group in desired.Except(previous))
                await hub.Groups.AddToGroupAsync(connectionId, group);
            _groups[connectionId] = desired;
        }
        finally { _gate.Release(); }
    }

    public async Task RemoveAsync(string connectionId)
    {
        await _gate.WaitAsync();
        try { await RemoveLockedAsync(connectionId); }
        finally { _gate.Release(); }
    }

    private async Task RemoveLockedAsync(string connectionId)
    {
        if (!_groups.Remove(connectionId, out var groups)) return;
        foreach (var group in groups)
            await hub.Groups.RemoveFromGroupAsync(connectionId, group);
    }

    public async Task PublishAsync(DeviceSnapshot device)
    {
        await _gate.WaitAsync();
        try
        {
            await PublishLockedAsync(device);
        }
        finally { _gate.Release(); }
    }

    private async Task PublishLockedAsync(DeviceSnapshot device)
    {
        foreach (var connection in _groups.Keys.Where(id => !registry.IsRegisteredConnection(id)).ToArray())
            await RemoveLockedAsync(connection);
        await hub.Clients.Group(Group(device.FriendCode)).SendAsync("PresenceChanged", device);
    }
}
