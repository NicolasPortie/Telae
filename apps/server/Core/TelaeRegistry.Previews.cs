namespace Telae.Server.Core;

// Miniaturas da tela de quem está transmitindo, vistas só por amigos mútuos no início do app.
public sealed partial class TelaeRegistry
{
    private const string PreviewPrefix = "data:image/jpeg;base64,";
    public const int MaxPreviewLength = 96 * 1024;
    public static readonly TimeSpan PreviewInterval = TimeSpan.FromSeconds(6);

    /// <summary>Guarda a miniatura da sessão ativa e devolve as conexões dos amigos mútuos online.</summary>
    public (SharePreviewEvent Preview, IReadOnlyList<string> ConnectionIds) SetSharePreview(string sharerDeviceId, string image)
    {
        ValidatePreview(image);
        lock (_gate)
        {
            RequireOnlineDevice(sharerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Você não está transmitindo agora.");
            var now = _clock.GetUtcNow();
            if (_lastPreviewByDevice.TryGetValue(sharerDeviceId, out var last) && now - last < PreviewInterval)
                throw new TelaeDomainException("rate_limited", "Muitos pedidos em pouco tempo. Espera um minuto e tenta de novo.");
            _lastPreviewByDevice[sharerDeviceId] = now;
            var preview = new SharePreviewEvent(sharerDeviceId, image, now);
            session.Preview = preview;
            var connections = _connectionByDevice
                .Where(pair => pair.Key != sharerDeviceId && AreMutualFriendsLocked(sharerDeviceId, pair.Key)
                    && !session.BlockedViewerDeviceIds.Contains(pair.Key))
                .Select(pair => pair.Value)
                .ToArray();
            return (preview, connections);
        }
    }

    /// <summary>Miniaturas atuais dos amigos mútuos que estão transmitindo.</summary>
    public IReadOnlyList<SharePreviewEvent> GetFriendPreviews(string deviceId)
    {
        lock (_gate)
        {
            RequireOnlineDevice(deviceId);
            return _sessionsBySharer.Values
                .Where(session => session.Preview is not null && _connectionByDevice.ContainsKey(session.SharerDeviceId)
                    && AreMutualFriendsLocked(deviceId, session.SharerDeviceId)
                    && !session.BlockedViewerDeviceIds.Contains(deviceId))
                .Select(session => session.Preview!)
                .ToArray();
        }
    }

    private static void ValidatePreview(string image)
    {
        if (string.IsNullOrEmpty(image) || image.Length > MaxPreviewLength || !image.StartsWith(PreviewPrefix, StringComparison.Ordinal))
            throw new TelaeDomainException("invalid_preview", "A miniatura da tela é inválida.");
        var bytes = new byte[(image.Length - PreviewPrefix.Length) * 3 / 4];
        if (!Convert.TryFromBase64String(image[PreviewPrefix.Length..], bytes, out var written)
            || !HasSafeDimensions(bytes.AsSpan(0, written)))
            throw new TelaeDomainException("invalid_preview", "A miniatura da tela é inválida.");
    }

    private static bool HasSafeDimensions(ReadOnlySpan<byte> jpeg)
    {
        if (jpeg.Length < 14 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 || jpeg[^2] != 0xFF || jpeg[^1] != 0xD9) return false;
        var dimensionsFound = false;
        var offset = 2;
        while (offset + 3 < jpeg.Length)
        {
            if (jpeg[offset++] != 0xFF) return false;
            while (offset < jpeg.Length && jpeg[offset] == 0xFF) offset++;
            if (offset + 2 >= jpeg.Length) return false;
            var marker = jpeg[offset++];
            var length = (jpeg[offset] << 8) | jpeg[offset + 1];
            if (length < 2 || offset + length > jpeg.Length) return false;
            if (marker == 0xDA) return dimensionsFound && length >= 6;
            if (marker is >= 0xC0 and <= 0xCF && marker is not (0xC4 or 0xC8 or 0xCC))
            {
                if (dimensionsFound || length < 8) return false;
                var height = (jpeg[offset + 3] << 8) | jpeg[offset + 4];
                var width = (jpeg[offset + 5] << 8) | jpeg[offset + 6];
                // Limita a memória usada ao abrir uma miniatura comprimida.
                if (width is < 1 or > 4096 || height is < 1 or > 4096 || width * height > 4_194_304) return false;
                dimensionsFound = true;
            }
            offset += length;
        }
        return false;
    }
}
