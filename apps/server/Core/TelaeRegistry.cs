using System.Security.Cryptography;
using System.Text.Json;

namespace Telae.Server.Core;

public sealed partial class TelaeRegistry
{
    private readonly object _gate = new();
    private readonly string? _profilePath;
    private readonly TimeProvider _clock;
    private readonly Dictionary<string, ProfileRecord> _profiles = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _deviceByConnection = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _connectionByDevice = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> _disconnectGenerationByDevice = new(StringComparer.Ordinal);
    private long _disconnectGeneration;
    private readonly Dictionary<string, ShareSessionRecord> _sessionsBySharer = new(StringComparer.Ordinal);
    // Quem cada conta escolheu não deixar ver as transmissões dela (dono -> ocultos). Vem do banco.
    private readonly Dictionary<string, HashSet<string>> _hiddenByOwner = new(StringComparer.Ordinal);
    private readonly HashSet<string> _initializedHiddenOwners = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DateTimeOffset> _lastPreviewByDevice = new(StringComparer.Ordinal);
    // Lista de amigos declarada por cada dispositivo (GetFriends). Persiste entre reconexões:
    // só muda quando o próprio dispositivo envia uma nova lista.
    private readonly Dictionary<string, HashSet<string>> _declaredFriendsByDevice = new(StringComparer.Ordinal);
    // Pedidos dispensados: quem dispensou (key) -> quem pediu (set). Some quando o pedido deixa de
    // existir (quem pediu removeu) ou quando a amizade vira mútua.
    private readonly Dictionary<string, HashSet<string>> _dismissedRequests = new(StringComparer.Ordinal);

    public const int MaxProfiles = 10_000;

    public TelaeRegistry(string? profilePath = null, TimeProvider? clock = null)
    {
        _profilePath = profilePath;
        _clock = clock ?? TimeProvider.System;
        LoadProfiles();
    }

    private sealed class ProfileRecord
    {
        public ProfileRecord(string deviceId, string displayName, string friendCode)
        {
            DeviceId = deviceId;
            DisplayName = displayName;
            FriendCode = friendCode;
        }

        public string DeviceId { get; init; }
        public string DisplayName { get; set; }
        public string FriendCode { get; set; }
        public string? DeviceSecretHash { get; init; }
    }

    private sealed class ShareSessionRecord(
        string sessionId,
        string sharerDeviceId,
        string qualityProfile,
        DateTimeOffset startedAt)
    {
        public string SessionId { get; } = sessionId;
        public string SharerDeviceId { get; } = sharerDeviceId;
        public string QualityProfile { get; set; } = qualityProfile;
        public HashSet<string> ViewerDeviceIds { get; } = new(StringComparer.Ordinal);
        public HashSet<string> BlockedViewerDeviceIds { get; } = new(StringComparer.Ordinal);
        public DateTimeOffset StartedAt { get; } = startedAt;
        // Miniatura mais recente da tela; vive só em memória e some com a sessão.
        public SharePreviewEvent? Preview { get; set; }
        public ShareAudience Audience { get; set; } = ShareAudience.Default;
    }

    private enum AudienceMode { Friends, Selected }

    private sealed record ShareAudience(AudienceMode Mode, IReadOnlySet<string> SelectedIds)
    {
        public static readonly ShareAudience Default = new(AudienceMode.Friends, new HashSet<string>());
    }

}
