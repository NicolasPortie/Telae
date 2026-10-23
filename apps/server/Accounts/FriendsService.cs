using Microsoft.EntityFrameworkCore;

namespace Telae.Server.Accounts;

public sealed record FriendAccount(Guid Id, string Username, string DisplayName);

/// <summary>
/// Lista de amigos por conta, no banco. O identificador público é o <c>@usuário</c>: não existe mais código de amigo.
/// Cada linha é uma aresta dirigida; a amizade vale quando as duas existem.
/// </summary>
public sealed class FriendsService(TelaeDbContext db, TimeProvider clock)
{
    public const int MaxFriends = 200;

    public static string NormalizeUsername(string? value)
    {
        var normalized = (value ?? "").Trim().TrimStart('@').ToLowerInvariant();
        if (normalized.Length is < 3 or > 20 || !normalized.All(c => char.IsAsciiLetterOrDigit(c) || c == '_'))
            throw new AccountException("invalid_username");
        return normalized;
    }

    public async Task<FriendAccount?> FindByUsernameAsync(string username, CancellationToken ct)
    {
        var normalized = NormalizeUsername(username);
        var account = await db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.NormalizedUsername == normalized && a.EmailVerified, ct);
        return account is null ? null : new FriendAccount(account.Id, account.Username, account.DisplayName);
    }

    /// <summary>Quem esta conta adicionou (a lista que ela declara), em ordem alfabética.</summary>
    public async Task<IReadOnlyList<FriendAccount>> ListAsync(Guid accountId, CancellationToken ct) =>
        await db.Friendships.AsNoTracking()
            .Where(f => f.AccountId == accountId)
            .OrderBy(f => f.Friend!.Username)
            .Select(f => new FriendAccount(f.Friend!.Id, f.Friend.Username, f.Friend.DisplayName))
            .ToListAsync(ct);

    public async Task<FriendAccount> AddAsync(Guid accountId, string username, CancellationToken ct)
    {
        var friend = await FindByUsernameAsync(username, ct) ?? throw new AccountException("friend_not_found", 404);
        if (friend.Id == accountId) throw new AccountException("cannot_add_self");
        if (await db.Friendships.AnyAsync(f => f.AccountId == accountId && f.FriendId == friend.Id, ct))
            throw new AccountException("already_friends", 409);
        if (await db.Friendships.CountAsync(f => f.AccountId == accountId, ct) >= MaxFriends)
            throw new AccountException("too_many_friends");

        db.Friendships.Add(new Friendship { AccountId = accountId, FriendId = friend.Id, CreatedAt = clock.GetUtcNow() });
        // Adicionar de volta desfaz uma dispensa anterior desse mesmo pedido.
        var dismissed = await db.DismissedRequests.Where(d => d.AccountId == accountId && d.FromId == friend.Id).ToListAsync(ct);
        db.DismissedRequests.RemoveRange(dismissed);
        await db.SaveChangesAsync(ct);
        return friend;
    }

    public async Task RemoveAsync(Guid accountId, string username, CancellationToken ct)
    {
        var friend = await FindByUsernameAsync(username, ct) ?? throw new AccountException("friend_not_found", 404);
        var edges = await db.Friendships.Where(f => f.AccountId == accountId && f.FriendId == friend.Id).ToListAsync(ct);
        db.Friendships.RemoveRange(edges);
        // Quem remove deixa de ser "pedinte" para o outro lado: a dispensa dele caduca.
        var dismissed = await db.DismissedRequests.Where(d => d.AccountId == friend.Id && d.FromId == accountId).ToListAsync(ct);
        db.DismissedRequests.RemoveRange(dismissed);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Pedidos a aceitar: quem me adicionou, eu ainda não adicionei e não dispensei.</summary>
    public async Task<IReadOnlyList<FriendAccount>> PendingRequestsAsync(Guid accountId, CancellationToken ct) =>
        await db.Friendships.AsNoTracking()
            .Where(f => f.FriendId == accountId
                && !db.Friendships.Any(back => back.AccountId == accountId && back.FriendId == f.AccountId)
                && !db.DismissedRequests.Any(d => d.AccountId == accountId && d.FromId == f.AccountId))
            .OrderBy(f => f.Account!.Username)
            .Select(f => new FriendAccount(f.Account!.Id, f.Account.Username, f.Account.DisplayName))
            .ToListAsync(ct);

    public async Task DismissAsync(Guid accountId, string username, CancellationToken ct)
    {
        var from = await FindByUsernameAsync(username, ct) ?? throw new AccountException("friend_not_found", 404);
        if (from.Id == accountId) return;
        if (await db.DismissedRequests.AnyAsync(d => d.AccountId == accountId && d.FromId == from.Id, ct)) return;
        db.DismissedRequests.Add(new DismissedRequest { AccountId = accountId, FromId = from.Id, CreatedAt = clock.GetUtcNow() });
        await db.SaveChangesAsync(ct);
    }
}
