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
}
