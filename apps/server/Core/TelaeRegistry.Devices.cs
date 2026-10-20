using System.Security.Cryptography;
using System.Text.Json;

namespace Telae.Server.Core;

// Dispositivos: registro, credencial e consulta por código de amigo.
public sealed partial class TelaeRegistry
{
    /// <summary>Registro legado: o dispositivo se identifica por uma credencial própria (clientes anteriores às contas).</summary>
    public DeviceSnapshot RegisterDevice(string deviceId, string displayName, string connectionId, string deviceSecret)
    {
        if (string.IsNullOrWhiteSpace(deviceId) || deviceId.Length > 128)
            throw new TelaeDomainException("device_id_required", "O dispositivo não possui um identificador válido.");

        if (deviceSecret is null || deviceSecret.Length != 64 || !deviceSecret.All(Uri.IsHexDigit))
            throw new TelaeDomainException("device_unauthorized", "Atualize o aplicativo para registrar este dispositivo com segurança.");
        return RegisterCore(deviceId, displayName, connectionId, SHA256.HashData(Convert.FromHexString(deviceSecret)));
    }

    /// <summary>Registro de uma conta já autenticada pelo token de acesso: o identificador é o da conta e não há credencial de dispositivo.</summary>
    public DeviceSnapshot RegisterAccountDevice(string accountId, string displayName, string connectionId)
    {
        if (string.IsNullOrWhiteSpace(accountId) || accountId.Length > 128)
            throw new TelaeDomainException("device_id_required", "O dispositivo não possui um identificador válido.");
        return RegisterCore(accountId, displayName, connectionId, secretHash: null);
    }

    private DeviceSnapshot RegisterCore(string deviceId, string displayName, string connectionId, byte[]? secretHash)
    {
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
                    DeviceSecretHash = secretHash is null ? null : Convert.ToHexString(secretHash)
                };
                _profiles.Add(deviceId, profile);
                profileChanged = true;
            }
            else
            {
                // Perfis de conta (sem credencial de dispositivo) não aceitam o caminho legado, e vice-versa.
                var credentialMatches = secretHash is null
                    ? profile.DeviceSecretHash is null
                    : profile.DeviceSecretHash is not null &&
                      CryptographicOperations.FixedTimeEquals(secretHash, Convert.FromHexString(profile.DeviceSecretHash));
                if (!credentialMatches)
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
}
