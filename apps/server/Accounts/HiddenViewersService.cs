using Microsoft.EntityFrameworkCore;

namespace Telae.Server.Accounts;

/// <summary>
/// Pessoas que não veem as transmissões de uma conta. É silencioso: quem foi ocultado continua vendo a conta
/// online e não é avisado. Pode incluir quem não é amigo.
/// </summary>
public sealed class HiddenViewersService(TelaeDbContext db, TimeProvider clock)
{
    public const int MaxHidden = 200;
    // O limite é por conta, inclusive quando pedidos chegam por conexões e scopes diferentes.
    private static readonly SemaphoreSlim[] AccountLocks = Enumerable.Range(0, 256).Select(_ => new SemaphoreSlim(1, 1)).ToArray();

    public async Task<IReadOnlyList<FriendAccount>> ListAsync(Guid accountId, CancellationToken ct) =>
        await db.HiddenViewers.AsNoTracking()
            .Where(h => h.AccountId == accountId)
            .OrderBy(h => h.Hidden!.Username)
            .Select(h => new FriendAccount(h.Hidden!.Id, h.Hidden.Username, h.Hidden.DisplayName))
            .ToListAsync(ct);

    public async Task<IReadOnlyList<Guid>> ListIdsAsync(Guid accountId, CancellationToken ct) =>
        await db.HiddenViewers.AsNoTracking().Where(h => h.AccountId == accountId).Select(h => h.HiddenId).ToListAsync(ct);

    public async Task<FriendAccount> HideAsync(Guid accountId, string username, CancellationToken ct,
        Func<FriendAccount, Task>? apply = null)
    {
        var normalized = FriendsService.NormalizeUsername(username);
        var target = await db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.NormalizedUsername == normalized && a.EmailVerified, ct)
            ?? throw new AccountException("friend_not_found", 404);
        if (target.Id == accountId) throw new AccountException("cannot_hide_self");
        var result = new FriendAccount(target.Id, target.Username, target.DisplayName);
        var gate = GateFor(accountId);
        await gate.WaitAsync(ct);
        try
        {
            if (!await db.HiddenViewers.AnyAsync(h => h.AccountId == accountId && h.HiddenId == target.Id, ct))
            {
                if (await db.HiddenViewers.CountAsync(h => h.AccountId == accountId, ct) >= MaxHidden)
                    throw new AccountException("too_many_hidden");
                db.HiddenViewers.Add(new HiddenViewer { AccountId = accountId, HiddenId = target.Id, CreatedAt = clock.GetUtcNow() });
                await db.SaveChangesAsync(ct);
            }
            // Banco e acesso em memória seguem a mesma ordem, inclusive entre conexões da mesma conta.
            if (apply is not null) await apply(result);
            return result;
        }
        finally { gate.Release(); }
    }

    public async Task<FriendAccount?> UnhideAsync(Guid accountId, string username, CancellationToken ct,
        Func<FriendAccount, Task>? apply = null)
    {
        var normalized = FriendsService.NormalizeUsername(username);
        var target = await db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.NormalizedUsername == normalized, ct);
        if (target is null) return null;
        var gate = GateFor(accountId);
        await gate.WaitAsync(ct);
        try
        {
            await db.HiddenViewers.Where(h => h.AccountId == accountId && h.HiddenId == target.Id).ExecuteDeleteAsync(ct);
            var result = new FriendAccount(target.Id, target.Username, target.DisplayName);
            if (apply is not null) await apply(result);
            return result;
        }
        finally { gate.Release(); }
    }

    private static SemaphoreSlim GateFor(Guid accountId) =>
        AccountLocks[(accountId.GetHashCode() & int.MaxValue) % AccountLocks.Length];
}
