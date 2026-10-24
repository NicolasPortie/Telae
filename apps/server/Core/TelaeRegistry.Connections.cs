using System.Security.Cryptography;
using System.Text.Json;

namespace Telae.Server.Core;

// Conexões SignalR e janela de reconexão após queda.
public sealed partial class TelaeRegistry
{
    public string? FindConnectionId(string deviceId)
    {
        lock (_gate)
        {
            return _connectionByDevice.TryGetValue(deviceId, out var connectionId) ? connectionId : null;
        }
    }

    public bool IsRegisteredConnection(string connectionId)
    {
        lock (_gate) return _deviceByConnection.ContainsKey(connectionId);
    }

    public DisconnectResult RevokeDevice(string deviceId, string? expectedConnectionId = null)
    {
        lock (_gate)
        {
            if (expectedConnectionId is not null && _connectionByDevice.GetValueOrDefault(deviceId) != expectedConnectionId)
                return new DisconnectResult(null, null, null, null);
            if (_connectionByDevice.Remove(deviceId, out var connectionId)) _deviceByConnection.Remove(connectionId);
            var generation = NextDisconnectGenerationLocked();
            _disconnectGenerationByDevice[deviceId] = generation;
            return FinalizeDisconnect(deviceId, generation);
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

            var generation = NextDisconnectGenerationLocked();
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

    private long NextDisconnectGenerationLocked() => ++_disconnectGeneration;

    public string GetConnectionId(string deviceId)
    {
        lock (_gate)
        {
            if (!_connectionByDevice.TryGetValue(deviceId, out var connectionId))
                throw new TelaeDomainException("device_offline", "Essa pessoa está offline agora.");
            return connectionId;
        }
    }

    public string GetDeviceIdForConnection(string connectionId)
    {
        lock (_gate)
        {
            if (!_deviceByConnection.TryGetValue(connectionId, out var deviceId))
                throw new TelaeDomainException("device_not_registered", "Esse aparelho ainda não está conectado. Reinicia o app e tenta de novo.");
            return deviceId;
        }
    }
}
