using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Telae.Server.Hubs;

namespace Telae.Server.Core;

// Serializa assinaturas e envios para respeitar remoções e conexões substituídas.
public sealed class PresenceSubscriptions(TelaeRegistry registry, IHubContext<TelaeHub> hub)
{
    public static readonly TimeSpan PublicationTimeout = TimeSpan.FromSeconds(2);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, HashSet<string>> _subscriptions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _sessionsByDevice = new(StringComparer.Ordinal);
    // Revogações recentes em memória: o hub barra a sessão na hora sem consultar o banco a cada chamada.
    private readonly ConcurrentDictionary<string, DateTimeOffset> _revokedSessions = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, DateTimeOffset> _revokedAccounts = new(StringComparer.Ordinal);
    private const int MaxRememberedRevocations = 10_000;

    /// <summary>A sessão foi revogada, ou a conta inteira foi revogada depois de <paramref name="since"/>.</summary>
    public bool IsRevoked(string accountId, string? sessionId, DateTimeOffset since) =>
        (sessionId is not null && _revokedSessions.ContainsKey(sessionId))
        || (_revokedAccounts.TryGetValue(accountId, out var revokedAt) && revokedAt >= since);

    private static void Remember(ConcurrentDictionary<string, DateTimeOffset> revocations, string key)
    {
        var now = DateTimeOffset.UtcNow;
        if (revocations.Count >= MaxRememberedRevocations)
            foreach (var old in revocations.Where(pair => pair.Value < now.AddDays(-1)).Select(pair => pair.Key).ToArray())
                revocations.TryRemove(old, out _);
        revocations[key] = now;
    }

    public async Task<DeviceSnapshot> RegisterAsync(RegisterDeviceRequest request, string connectionId, bool authenticatedAccount = false,
        string? sessionId = null, Func<Task<bool>>? authorize = null)
    {
        DeviceSnapshot device;
        Task publication;
        // A consulta ao banco fica fora da fila; dentro dela, só a checagem em memória de quem foi revogado nesse meio-tempo.
        var checkedAt = DateTimeOffset.UtcNow;
        if (authorize is not null && !await authorize())
            throw new TelaeDomainException("session_expired", "Sua sessão acabou. Entra de novo.");
        await _gate.WaitAsync();
        try
        {
            if (authorize is not null && IsRevoked(request.DeviceId, sessionId, checkedAt))
                throw new TelaeDomainException("session_expired", "Sua sessão acabou. Entra de novo.");
            device = authenticatedAccount
                ? registry.RegisterAccountDevice(request.DeviceId, request.Username ?? "", request.DisplayName, connectionId)
                : registry.RegisterDevice(request.DeviceId, request.DisplayName, connectionId, request.DeviceSecret);
            if (sessionId is not null) _sessionsByDevice[device.DeviceId] = sessionId;
            publication = PublishLockedAsync(device);
        }
        finally { _gate.Release(); }
        await publication;
        return device;
    }

    public async Task<DeclareFriendsResult> DeclareFriendsAsync(string connectionId, string[] friendCodes)
    {
        await _gate.WaitAsync();
        try
        {
            var deviceId = registry.GetDeviceIdForConnection(connectionId);
            var declared = registry.DeclareFriends(deviceId, friendCodes);
            _subscriptions[connectionId] = registry.GetDevicesByFriendCodes(friendCodes)
                .Select(friend => friend.DeviceId).ToHashSet(StringComparer.Ordinal);
            return declared;
        }
        finally { _gate.Release(); }
    }

    public async Task RemoveAsync(string connectionId)
    {
        await _gate.WaitAsync();
        try { _subscriptions.Remove(connectionId); }
        finally { _gate.Release(); }
    }

    public async Task PublishPreviewAsync(string connectionId, string image)
    {
        Task publication = Task.CompletedTask;
        await _gate.WaitAsync();
        try
        {
            var deviceId = registry.GetDeviceIdForConnection(connectionId);
            var (preview, connections) = registry.SetSharePreview(deviceId, image);
            if (connections.Count > 0)
                publication = SendBoundedAsync(hub.Clients.Clients(connections), "SharePreview", preview);
        }
        finally { _gate.Release(); }
        await publication;
    }

    public async Task<ShareSessionSnapshot> RemoveViewerAsync(string connectionId, string viewerDeviceId)
    {
        await _gate.WaitAsync();
        try { return registry.RemoveViewer(registry.GetDeviceIdForConnection(connectionId), viewerDeviceId); }
        finally { _gate.Release(); }
    }

    public async Task<ShareSessionSnapshot> StopShareAsync(string connectionId)
    {
        await _gate.WaitAsync();
        try { return registry.StopShare(registry.GetDeviceIdForConnection(connectionId)); }
        finally { _gate.Release(); }
    }

    // Sinais (SDP/ICE) não passam pela fila global: o registro já tem a própria trava e uma conexão
    // revogada deixa de existir nele, então não há o que serializar aqui.
    public async Task SendSignalAsync(string connectionId, string targetDeviceId, SignalingEnvelope envelope)
    {
        var deviceId = registry.GetDeviceIdForConnection(connectionId);
        if (deviceId != envelope.FromDeviceId)
            throw new TelaeDomainException("invalid_signal_sender", "Não deu pra completar a conexão. Tenta entrar de novo.");
        registry.ValidateSessionParticipant(envelope.SessionId, deviceId, targetDeviceId);
        var publication = SendBoundedAsync(hub.Clients.Client(registry.GetConnectionId(targetDeviceId)), "SignalReceived", envelope);
        if (!await publication)
            throw new TelaeDomainException("device_offline", "Essa pessoa está offline agora.");
    }

    public async Task RevokeSessionAsync(string accountId, string sessionId)
    {
        Remember(_revokedSessions, sessionId);
        Task notification = Task.CompletedTask;
        await _gate.WaitAsync();
        try
        {
            var connectionId = registry.FindConnectionId(accountId);
            if (_sessionsByDevice.GetValueOrDefault(accountId) == sessionId)
                notification = RevokeLockedAsync(accountId, connectionId);
        }
        finally { _gate.Release(); }
        await notification;
    }

    public async Task RevokeAccountAsync(string accountId, string? expectedConnectionId = null)
    {
        // Só a conta inteira (senha trocada, conta excluída) invalida as outras sessões; a limpeza de uma conexão específica não.
        if (expectedConnectionId is null) Remember(_revokedAccounts, accountId);
        Task notification;
        await _gate.WaitAsync();
        try
        {
            var connectionId = registry.FindConnectionId(accountId);
            if (expectedConnectionId is not null && connectionId != expectedConnectionId) return;
            notification = RevokeLockedAsync(accountId, connectionId);
        }
        finally { _gate.Release(); }
        await notification;
    }

    private Task RevokeLockedAsync(string accountId, string? connectionId)
    {
        if (connectionId is not null) _subscriptions.Remove(connectionId);
        _sessionsByDevice.Remove(accountId);
        var result = registry.RevokeDevice(accountId, connectionId);
        var notifications = new List<Task>();
        if (result.EndedSession is { } ended)
        {
            var connections = ended.ViewerDeviceIds.Select(registry.FindConnectionId).OfType<string>().ToArray();
            if (connections.Length > 0) notifications.Add(SendBoundedAsync(hub.Clients.Clients(connections), "SessionEnded", ended.SessionId));
        }
        if (result.ViewerLeftSession is { } watching)
            notifications.Add(NotifyLockedAsync(watching.SharerDeviceId, "ViewerLeft", new ViewerLeftEvent(watching.SessionId, accountId)));
        if (result.ChangedDevice is not null) notifications.Add(PublishLockedAsync(result.ChangedDevice));
        return Task.WhenAll(notifications);
    }

    private async Task NotifyLockedAsync(string deviceId, string method, object payload)
    {
        if (registry.FindConnectionId(deviceId) is { } connectionId)
            await SendBoundedAsync(hub.Clients.Client(connectionId), method, payload);
    }

    public async Task PublishAsync(DeviceSnapshot device)
    {
        Task publication;
        await _gate.WaitAsync();
        try
        {
            publication = PublishLockedAsync(device);
        }
        finally { _gate.Release(); }
        await publication;
    }

    private async Task PublishLockedAsync(DeviceSnapshot device)
    {
        device = registry.GetDevice(device.DeviceId) ?? device;
        foreach (var connection in _subscriptions.Keys.Where(id => !registry.IsRegisteredConnection(id)).ToArray())
            _subscriptions.Remove(connection);
        var connections = _subscriptions.Where(pair => pair.Value.Contains(device.DeviceId)
                && registry.AreMutualFriends(registry.GetDeviceIdForConnection(pair.Key), device.DeviceId))
            .Select(pair => pair.Key).ToArray();
        if (connections.Length > 0) await SendBoundedAsync(hub.Clients.Clients(connections), "PresenceChanged", device);
    }

    private static async Task<bool> SendBoundedAsync(IClientProxy client, string method, object payload)
    {
        using var timeout = new CancellationTokenSource(PublicationTimeout);
        try
        {
            await client.SendCoreAsync(method, [payload], timeout.Token);
            return true;
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested) { return false; }
    }
}
