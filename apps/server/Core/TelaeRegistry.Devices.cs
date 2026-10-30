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
            throw new TelaeDomainException("device_id_required", "Não deu pra identificar este aparelho. Reinicia o app e tenta de novo.");

        if (deviceSecret is null || deviceSecret.Length != 64 || !deviceSecret.All(Uri.IsHexDigit))
            throw new TelaeDomainException("device_unauthorized", "Atualiza o app pra registrar este aparelho com segurança.");
        return RegisterCore(deviceId, displayName, connectionId, SHA256.HashData(Convert.FromHexString(deviceSecret)));
    }

    /// <summary>Registro de uma conta já autenticada pelo token de acesso: o identificador é o da conta e não há credencial de dispositivo.</summary>
    public DeviceSnapshot RegisterAccountDevice(string accountId, string username, string displayName, string connectionId)
    {
        if (string.IsNullOrWhiteSpace(accountId) || accountId.Length > 128)
            throw new TelaeDomainException("device_id_required", "Não deu pra identificar este aparelho. Reinicia o app e tenta de novo.");
        return RegisterCore(accountId, displayName, connectionId, secretHash: null, friendCode: NormalizeFriendCode(username));
    }

    /// <summary>
    /// Garante o perfil de uma conta que ainda não se conectou, para poder aparecer (offline) na lista de quem a adicionou.
    /// </summary>
    public DeviceSnapshot EnsureAccountProfile(string accountId, string username, string displayName)
    {
        var friendCode = NormalizeFriendCode(username);
        displayName = NormalizeDisplayName(displayName);
        lock (_gate)
        {
            if (!_profiles.TryGetValue(accountId, out var profile))
            {
                EnsureFriendCodeFreeLocked(accountId, friendCode);
                profile = new ProfileRecord(accountId, displayName, friendCode);
                _profiles.Add(accountId, profile);
                PersistProfiles();
            }
            return ToDeviceSnapshot(profile);
        }
    }

    /// <summary>Esquece o perfil de uma conta excluída, liberando o @usuário.</summary>
    public void ForgetAccount(string accountId)
    {
        lock (_gate)
        {
            if (!_profiles.Remove(accountId, out var profile)) return;
            _declaredFriendsByDevice.Remove(accountId);
            foreach (var friends in _declaredFriendsByDevice.Values) friends.Remove(profile.FriendCode);
            _dismissedRequests.Remove(accountId);
            _lastPreviewByDevice.Remove(accountId);
            if (_connectionByDevice.Remove(accountId, out var connectionId))
                _deviceByConnection.Remove(connectionId);
            _disconnectGenerationByDevice.Remove(accountId);
            if (_sessionsBySharer.TryGetValue(accountId, out var own)) EndSessionLocked(own);
            foreach (var session in _sessionsBySharer.Values)
            {
                session.ViewerDeviceIds.Remove(accountId);
                session.BlockedViewerDeviceIds.Remove(accountId);
            }
            foreach (var dismissed in _dismissedRequests.Values) dismissed.Remove(accountId);
            _hiddenByOwner.Remove(accountId);
            _initializedHiddenOwners.Remove(accountId);
            foreach (var hidden in _hiddenByOwner.Values) hidden.Remove(accountId);
            PersistProfiles();
        }
    }

    private void EnsureFriendCodeFreeLocked(string deviceId, string friendCode)
    {
        if (_profiles.Values.Any(p => p.DeviceId != deviceId && string.Equals(p.FriendCode, friendCode, StringComparison.OrdinalIgnoreCase)))
            throw new TelaeDomainException("friend_code_conflict", "Esse @ já tem dono. Tenta outro.");
    }

    private DeviceSnapshot RegisterCore(string deviceId, string displayName, string connectionId, byte[]? secretHash, string? friendCode = null)
    {
        displayName = NormalizeDisplayName(displayName);

        lock (_gate)
        {
            var profileChanged = false;
            string? previousName = null;
            if (_deviceByConnection.TryGetValue(connectionId, out var registeredDevice) && registeredDevice != deviceId)
                throw new TelaeDomainException("device_mismatch", "Esse aparelho já está sendo usado em outra conexão.");
            if (!_profiles.TryGetValue(deviceId, out var profile))
            {
                if (secretHash is not null) RequireLegacyCapacityLocked();
                if (friendCode is not null) EnsureFriendCodeFreeLocked(deviceId, friendCode);
                profile = new ProfileRecord(deviceId, displayName, friendCode ?? GenerateUniqueFriendCode())
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
                    throw new TelaeDomainException("device_unauthorized", "Não deu pra confirmar este aparelho. Atualiza o app e tenta de novo.");
                profileChanged = profile.DisplayName != displayName;
                previousName = profile.DisplayName;
                profile.DisplayName = displayName;
                // Perfis de conta que ainda tinham um código aleatório passam a usar o @usuário.
                if (friendCode is not null && !string.Equals(profile.FriendCode, friendCode, StringComparison.Ordinal))
                {
                    EnsureFriendCodeFreeLocked(deviceId, friendCode);
                    profile.FriendCode = friendCode;
                    profileChanged = true;
                }
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

            _disconnectGenerationByDevice[deviceId] = NextDisconnectGenerationLocked();
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
            var profile = _profiles.Values.FirstOrDefault(p => string.Equals(p.FriendCode, normalized, StringComparison.OrdinalIgnoreCase));
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

    /// <summary>
    /// O snapshot como <paramref name="observerDeviceId"/> pode vê-lo. Quem não é amigo mútuo vê "offline";
    /// quem não pode assistir à transmissão vê só "online".
    /// </summary>
    public DeviceSnapshot ForObserver(string observerDeviceId, DeviceSnapshot device)
    {
        lock (_gate) return ForObserverLocked(observerDeviceId, device);
    }

    /// <summary>A lista de amigos como o observador pode vê-la, com quem está ao vivo (para ele) primeiro.</summary>
    public IReadOnlyList<DeviceSnapshot> GetFriendsForObserver(string observerDeviceId, IEnumerable<string> friendCodes)
    {
        var codes = friendCodes.Select(NormalizeFriendCode).ToHashSet(StringComparer.OrdinalIgnoreCase);
        lock (_gate)
        {
            return _profiles.Values
                .Where(profile => codes.Contains(profile.FriendCode))
                .Select(profile => ForObserverLocked(observerDeviceId, ToDeviceSnapshot(profile)))
                .OrderByDescending(device => device.Status == "transmitting")
                .ThenByDescending(device => device.Status == "online")
                .ThenBy(device => device.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                .ToArray();
        }
    }

    private DeviceSnapshot ForObserverLocked(string observerDeviceId, DeviceSnapshot device)
    {
        if (observerDeviceId == device.DeviceId) return device;
        if (!AreMutualFriendsLocked(observerDeviceId, device.DeviceId))
            return device with { Status = "offline", IsSharing = false, ActiveQualityProfile = null };
        if (!device.IsSharing || !_sessionsBySharer.TryGetValue(device.DeviceId, out var session)) return device;
        return CanWatchLocked(observerDeviceId, session)
            ? device
            : device with { Status = "online", IsSharing = false, ActiveQualityProfile = null };
    }

    // O teto vale só para aparelhos legados, que qualquer um cria sem conta. Perfis de conta já são
    // limitados pelo cadastro; contá-los aqui deixaria quem enche o registro barrar todas as contas.
    private void RequireLegacyCapacityLocked()
    {
        if (_profiles.Values.Count(profile => profile.DeviceSecretHash is not null) >= MaxProfiles)
            throw new TelaeDomainException("server_full", "O servidor está cheio. Tenta de novo mais tarde.");
    }

    private DeviceSnapshot ToDeviceSnapshot(ProfileRecord profile)
    {
        var online = _connectionByDevice.ContainsKey(profile.DeviceId);
        _sessionsBySharer.TryGetValue(profile.DeviceId, out var activeSession);
        var sharing = online && activeSession is not null;
        var status = sharing ? "transmitting" : online ? "online" : "offline";
        return new DeviceSnapshot(
            profile.DeviceId,
            profile.DisplayName,
            profile.FriendCode,
            status,
            sharing,
            sharing ? activeSession!.QualityProfile : null);
    }

    private void RequireOnlineDevice(string deviceId)
    {
        if (!_profiles.ContainsKey(deviceId))
            throw new TelaeDomainException("device_not_registered", "Esse aparelho ainda não está conectado. Reinicia o app e tenta de novo.");
        if (!_connectionByDevice.ContainsKey(deviceId))
            throw new TelaeDomainException("device_offline", "Essa pessoa está offline agora.");
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
            if (_profiles.Values.All(profile => !string.Equals(profile.FriendCode, code, StringComparison.OrdinalIgnoreCase))) return code;
        }

        throw new InvalidOperationException("Não foi possível gerar um código de amigo único.");
    }
}
