using System.Security.Cryptography;
using System.Text.Json;

namespace Telae.Server.Core;

// Persistência dos perfis e normalização de entradas.
public sealed partial class TelaeRegistry
{
    private void LoadProfiles()
    {
        if (string.IsNullOrWhiteSpace(_profilePath) || !File.Exists(_profilePath)) return;
        try
        {
            var profiles = JsonSerializer.Deserialize<List<ProfileRecord>>(File.ReadAllText(_profilePath)) ?? [];
            foreach (var profile in profiles) _profiles[profile.DeviceId] = profile;
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException($"O arquivo de perfis '{_profilePath}' está inválido.", exception);
        }
    }

    private void PersistProfiles()
    {
        if (string.IsNullOrWhiteSpace(_profilePath)) return;
        var folder = Path.GetDirectoryName(_profilePath);
        if (!string.IsNullOrWhiteSpace(folder)) Directory.CreateDirectory(folder);
        var temporaryPath = $"{_profilePath}.{Guid.NewGuid():N}.tmp";
        try
        {
            using (var file = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                4096, FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(file, _profiles.Values.OrderBy(profile => profile.DeviceId),
                    new JsonSerializerOptions { WriteIndented = true });
                file.Flush(flushToDisk: true);
            }
            ReplaceWithRetry(temporaryPath, _profilePath);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    /// <summary>No Windows, antivírus e indexadores seguram o arquivo por instantes; algumas tentativas curtas resolvem sem perder atomicidade.</summary>
    private static void ReplaceWithRetry(string source, string destination)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                File.Move(source, destination, overwrite: true);
                return;
            }
            catch (Exception exception) when (attempt < 6 && exception is UnauthorizedAccessException or IOException)
            {
                Thread.Sleep(20 * attempt);
            }
        }
    }

    private static string NormalizeDisplayName(string value)
    {
        var normalized = value?.Trim() ?? "";
        if (normalized.Length is < 1 or > 32)
            throw new TelaeDomainException("invalid_display_name", "O nome deve ter entre 1 e 32 caracteres.");
        return normalized;
    }

    private static string NormalizeFriendCode(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 32)
            throw new TelaeDomainException("invalid_friend_code", "Código inválido.");
        var normalized = value.Trim().Replace("-", "").ToUpperInvariant();
        if (normalized.Length is not (6 or 8) || !normalized.All(char.IsAsciiLetterOrDigit))
            throw new TelaeDomainException("invalid_friend_code", "Código inválido.");
        return normalized;
    }
}
