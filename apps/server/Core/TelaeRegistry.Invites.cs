using System.Security.Cryptography;
using System.Text.Json;

namespace Telae.Server.Core;

// Convites legados (clientes até 0.1.20).
public sealed partial class TelaeRegistry
{
    public InviteSnapshot CreateInvite(string sharerDeviceId, TimeSpan? timeToLive = null)
    {
        lock (_gate)
        {
            RequireOnlineDevice(sharerDeviceId);
            if (!_sessionsBySharer.TryGetValue(sharerDeviceId, out var session))
                throw new TelaeDomainException("share_not_active", "Inicie a transmissão antes de gerar um convite.");

            PurgeExpiredInvitesLocked();
            var code = GenerateUniqueInviteCode();
            var invite = new InviteRecord(code, session.SessionId, sharerDeviceId, DateTimeOffset.UtcNow + (timeToLive ?? InviteLifetime));
            _invitesByCode.Add(code, invite);
            return new InviteSnapshot(invite.Code, invite.SessionId, invite.ExpiresAt);
        }
    }

    public ShareSessionSnapshot JoinWithInvite(string viewerDeviceId, string inviteCode)
    {
        lock (_gate)
        {
            RequireOnlineDevice(viewerDeviceId);
            var normalized = NormalizeInviteCode(inviteCode);
            if (!_invitesByCode.TryGetValue(normalized, out var invite))
                throw new TelaeDomainException("invite_invalid", "Este convite não existe. Confira o código e tente de novo.");
            if (invite.ExpiresAt <= DateTimeOffset.UtcNow)
                throw new TelaeDomainException("invite_expired", "Este convite expirou. Peça um novo convite ao Sharer.");
            if (!_sessionsBySharer.TryGetValue(invite.SharerDeviceId, out var session) || session.SessionId != invite.SessionId)
                throw new TelaeDomainException("share_not_active", "Esta transmissão já terminou.");

            return AttachViewerLocked(viewerDeviceId, session);
        }
    }

    private string GenerateUniqueInviteCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        Span<byte> bytes = stackalloc byte[8];

        for (var attempt = 0; attempt < 100; attempt++)
        {
            RandomNumberGenerator.Fill(bytes);
            var chars = new char[8];
            for (var i = 0; i < chars.Length; i++) chars[i] = alphabet[bytes[i] % alphabet.Length];
            var code = new string(chars);
            if (!_invitesByCode.ContainsKey(code)) return code;
        }

        throw new InvalidOperationException("Não foi possível gerar um código de convite único.");
    }

    private void PurgeExpiredInvitesLocked()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var code in _invitesByCode.Values.Where(i => i.ExpiresAt <= now).Select(i => i.Code).ToArray())
            _invitesByCode.Remove(code);
    }
}
