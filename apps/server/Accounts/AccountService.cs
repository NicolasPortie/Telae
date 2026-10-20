using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Telae.Server.Accounts;

public sealed record AccountDto(Guid Id, string Username, string DisplayName, string Email);
public sealed record RegisterResult(bool VerificationRequired, AuthResult? Session);
public sealed record AuthResult(string AccessToken, DateTimeOffset AccessTokenExpiresAt, string RefreshToken, AccountDto Account);

public sealed partial class AccountService(
    TelaeDbContext db,
    TokenService tokens,
    IEmailSender email,
    IOptions<AuthOptions> options,
    TimeProvider clock)
{
    private static readonly PasswordHasher<Account> Hasher = new();
    private static readonly string DummyHash = Hasher.HashPassword(new Account(), "telae-dummy-password-for-timing");
    private static readonly TimeSpan CodeCooldown = TimeSpan.FromSeconds(60);

    private static readonly HashSet<string> ReservedUsernames = new(StringComparer.Ordinal)
    {
        "admin", "administrator", "telae", "support", "suporte", "root", "system", "moderator", "staff", "help", "null", "undefined", "me",
    };

    private static readonly HashSet<string> CommonPasswords = new(StringComparer.OrdinalIgnoreCase)
    {
        "1234567890", "12345678910", "0123456789", "password123", "password1234", "qwertyuiop", "1q2w3e4r5t", "iloveyou123",
        "senha12345", "senha123456", "abcdefghij", "qwerty12345", "123456789a", "admin12345", "letmein1234", "welcome1234",
    };

    [GeneratedRegex("^[a-z0-9_]{3,20}$")]
    private static partial Regex UsernamePattern();

    [GeneratedRegex(@"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")]
    private static partial Regex EmailPattern();

    private AuthOptions Auth => options.Value;

    // ── Cadastro e verificação ────────────────────────────────────────────

    /// <summary>Cria a conta e envia o código. Responde igual quando o e-mail já existe, para não revelar quem tem conta.</summary>
    public async Task<RegisterResult> RegisterAsync(string emailAddress, string username, string password, string? language, string? userAgent, CancellationToken ct)
    {
        var normalizedEmail = NormalizeEmail(emailAddress);
        var normalizedUsername = NormalizeUsername(username);
        ValidatePassword(password, normalizedEmail, normalizedUsername);
        var lang = NormalizeLanguage(language);

        var existing = await db.Accounts.FirstOrDefaultAsync(a => a.NormalizedEmail == normalizedEmail, ct);
        if (existing is not null && !Auth.RequireEmailVerification) throw new AccountException("email_taken", 409);
        if (existing is not null)
        {
            if (existing.EmailVerified) await email.SendAsync(EmailTemplates.AlreadyRegistered(existing.Email, lang), ct);
            else await SendCodeAsync(existing, OneTimeCodePurpose.VerifyEmail, ct, ignoreCooldown: false, swallowCooldown: true);
            return new RegisterResult(true, null);
        }

        if (await db.Accounts.AnyAsync(a => a.NormalizedUsername == normalizedUsername, ct))
            throw new AccountException("username_taken", 409);

        var account = new Account
        {
            Email = emailAddress.Trim(),
            NormalizedEmail = normalizedEmail,
            Username = normalizedUsername,
            NormalizedUsername = normalizedUsername,
            DisplayName = normalizedUsername,
            Language = lang,
            CreatedAt = clock.GetUtcNow(),
            EmailVerified = !Auth.RequireEmailVerification,
        };
        account.PasswordHash = Hasher.HashPassword(account, password);
        db.Accounts.Add(account);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { throw new AccountException("username_taken", 409); }
        if (!Auth.RequireEmailVerification) return new RegisterResult(false, await IssueSessionAsync(account, userAgent, ct));
        await SendCodeAsync(account, OneTimeCodePurpose.VerifyEmail, ct, ignoreCooldown: true);
        return new RegisterResult(true, null);
    }

    public async Task<AuthResult> VerifyEmailAsync(string identifier, string code, string? userAgent, CancellationToken ct)
    {
        var account = await FindByIdentifierAsync(identifier, ct) ?? throw new AccountException("invalid_code");
        // Conta já verificada: o código não vale mais como credencial.
        if (account.EmailVerified) throw new AccountException("invalid_code");
        await ConsumeCodeAsync(account, OneTimeCodePurpose.VerifyEmail, code, ct);
        account.EmailVerified = true;
        account.LastLoginAt = clock.GetUtcNow();
        return await IssueSessionAsync(account, userAgent, ct);
    }

    public async Task ResendVerificationAsync(string identifier, CancellationToken ct)
    {
        var account = await FindByIdentifierAsync(identifier, ct);
        // Sem revelar se a conta existe ou já foi verificada.
        if (account is null || account.EmailVerified) return;
        await SendCodeAsync(account, OneTimeCodePurpose.VerifyEmail, ct, ignoreCooldown: false);
    }

    // ── Login e sessão ────────────────────────────────────────────────────

    public async Task<AuthResult> LoginAsync(string identifier, string password, string? userAgent, CancellationToken ct)
    {
        var account = await FindByIdentifierAsync(identifier, ct);
        var now = clock.GetUtcNow();
        if (account is null)
        {
            // Mesmo custo de uma senha errada, para não revelar se a conta existe pelo tempo de resposta.
            Hasher.VerifyHashedPassword(new Account(), DummyHash, password ?? "");
            throw new AccountException("invalid_credentials", 401);
        }
        if (account.LockedUntil is { } until && until > now)
            throw new AccountException("account_locked", 429);

        var verdict = Hasher.VerifyHashedPassword(account, account.PasswordHash, password ?? "");
        if (verdict == PasswordVerificationResult.Failed)
        {
            account.FailedLoginCount++;
            if (account.FailedLoginCount >= Auth.MaxFailedLogins)
            {
                account.LockedUntil = now.AddMinutes(Auth.LockoutMinutes);
                account.FailedLoginCount = 0;
            }
            await db.SaveChangesAsync(ct);
            throw new AccountException("invalid_credentials", 401);
        }

        account.FailedLoginCount = 0;
        account.LockedUntil = null;
        if (verdict == PasswordVerificationResult.SuccessRehashNeeded)
            account.PasswordHash = Hasher.HashPassword(account, password!);

        if (!account.EmailVerified)
        {
            await db.SaveChangesAsync(ct);
            await SendCodeAsync(account, OneTimeCodePurpose.VerifyEmail, ct, ignoreCooldown: false, swallowCooldown: true);
            throw new AccountException("email_not_verified", 403);
        }

        account.LastLoginAt = now;
        return await IssueSessionAsync(account, userAgent, ct);
    }

    public async Task<AuthResult> RefreshAsync(string refreshToken, string? userAgent, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(refreshToken) || refreshToken.Length > 128) throw new AccountException("invalid_session", 401);
        var hash = TokenService.Hash(refreshToken);
        var token = await db.RefreshTokens.Include(t => t.Account).FirstOrDefaultAsync(t => t.TokenHash == hash, ct)
            ?? throw new AccountException("invalid_session", 401);
        var now = clock.GetUtcNow();

        if (token.RevokedAt is not null)
        {
            // Token já trocado sendo reutilizado: possível roubo. Encerra todas as sessões da conta.
            await RevokeAllAsync(token.AccountId, ct);
            throw new AccountException("invalid_session", 401);
        }
        if (token.ExpiresAt <= now || token.Account is null) throw new AccountException("invalid_session", 401);

        var (next, raw) = NewRefreshRecord(token.Account, userAgent);
        token.RevokedAt = now;
        token.ReplacedById = next.Id;
        db.RefreshTokens.Add(next);
        await db.SaveChangesAsync(ct);
        var (access, expires) = tokens.CreateAccessToken(token.Account);
        return new AuthResult(access, expires, raw, ToDto(token.Account));
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(refreshToken) || refreshToken.Length > 128) return;
        var hash = TokenService.Hash(refreshToken);
        var token = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.RevokedAt == null, ct);
        if (token is null) return;
        token.RevokedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
    }

    // ── Senha ─────────────────────────────────────────────────────────────

    public async Task ForgotPasswordAsync(string identifier, CancellationToken ct)
    {
        var account = await FindByIdentifierAsync(identifier, ct);
        if (account is null || !account.EmailVerified) return;
        await SendCodeAsync(account, OneTimeCodePurpose.ResetPassword, ct, ignoreCooldown: false, swallowCooldown: true);
    }

    public async Task ResetPasswordAsync(string identifier, string code, string newPassword, CancellationToken ct)
    {
        var account = await FindByIdentifierAsync(identifier, ct) ?? throw new AccountException("invalid_code");
        ValidatePassword(newPassword, account.NormalizedEmail, account.NormalizedUsername);
        await ConsumeCodeAsync(account, OneTimeCodePurpose.ResetPassword, code, ct);
        account.PasswordHash = Hasher.HashPassword(account, newPassword);
        account.FailedLoginCount = 0;
        account.LockedUntil = null;
        await RevokeAllAsync(account.Id, ct, save: false);
        await db.SaveChangesAsync(ct);
    }

    public async Task<AuthResult> ChangePasswordAsync(Guid accountId, string currentPassword, string newPassword, string? userAgent, CancellationToken ct)
    {
        var account = await GetAsync(accountId, ct);
        if (Hasher.VerifyHashedPassword(account, account.PasswordHash, currentPassword ?? "") == PasswordVerificationResult.Failed)
            throw new AccountException("invalid_credentials", 401);
        ValidatePassword(newPassword, account.NormalizedEmail, account.NormalizedUsername);
        account.PasswordHash = Hasher.HashPassword(account, newPassword);
        await RevokeAllAsync(account.Id, ct, save: false);
        return await IssueSessionAsync(account, userAgent, ct);
    }

    // ── Perfil e exclusão ─────────────────────────────────────────────────

    public async Task<AccountDto> GetProfileAsync(Guid accountId, CancellationToken ct) => ToDto(await GetAsync(accountId, ct));

    public async Task<AccountDto> UpdateDisplayNameAsync(Guid accountId, string displayName, CancellationToken ct)
    {
        var name = (displayName ?? "").Trim();
        if (name.Length is < 1 or > 32) throw new AccountException("invalid_display_name");
        var account = await GetAsync(accountId, ct);
        account.DisplayName = name;
        await db.SaveChangesAsync(ct);
        return ToDto(account);
    }

    /// <summary>Exclusão definitiva (LGPD): remove a conta, as sessões e os códigos em cascata.</summary>
    public async Task DeleteAsync(Guid accountId, string password, CancellationToken ct)
    {
        var account = await GetAsync(accountId, ct);
        if (Hasher.VerifyHashedPassword(account, account.PasswordHash, password ?? "") == PasswordVerificationResult.Failed)
            throw new AccountException("invalid_credentials", 401);
        db.Accounts.Remove(account);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Usado pelo hub: confirma que a conta do token ainda existe e devolve o nome atual.</summary>
    public async Task<AccountDto?> FindActiveAsync(Guid accountId, CancellationToken ct)
    {
        var account = await db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == accountId && a.EmailVerified, ct);
        return account is null ? null : ToDto(account);
    }

    // ── Manutenção ────────────────────────────────────────────────────────

    public async Task<int> PurgeExpiredAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var codes = await db.OneTimeCodes.Where(c => c.ExpiresAt < now.AddDays(-1)).ExecuteDeleteAsync(ct);
        var refresh = await db.RefreshTokens.Where(t => t.ExpiresAt < now.AddDays(-7)).ExecuteDeleteAsync(ct);
        var stale = await db.Accounts.Where(a => !a.EmailVerified && a.CreatedAt < now.AddDays(-7)).ExecuteDeleteAsync(ct);
        return codes + refresh + stale;
    }

    // ── Auxiliares ────────────────────────────────────────────────────────

    private async Task<Account> GetAsync(Guid accountId, CancellationToken ct) =>
        await db.Accounts.FirstOrDefaultAsync(a => a.Id == accountId, ct) ?? throw new AccountException("invalid_session", 401);

    private async Task<Account?> FindByIdentifierAsync(string identifier, CancellationToken ct)
    {
        var value = (identifier ?? "").Trim().ToLowerInvariant();
        if (value.Length is 0 or > 254) return null;
        return value.Contains('@')
            ? await db.Accounts.FirstOrDefaultAsync(a => a.NormalizedEmail == value, ct)
            : await db.Accounts.FirstOrDefaultAsync(a => a.NormalizedUsername == value, ct);
    }

    private async Task<AuthResult> IssueSessionAsync(Account account, string? userAgent, CancellationToken ct)
    {
        var (record, raw) = NewRefreshRecord(account, userAgent);
        db.RefreshTokens.Add(record);
        await db.SaveChangesAsync(ct);
        var (access, expires) = tokens.CreateAccessToken(account);
        return new AuthResult(access, expires, raw, ToDto(account));
    }

    private (RefreshToken Record, string Raw) NewRefreshRecord(Account account, string? userAgent)
    {
        var raw = TokenService.NewRefreshToken();
        var now = clock.GetUtcNow();
        return (new RefreshToken
        {
            AccountId = account.Id,
            TokenHash = TokenService.Hash(raw),
            CreatedAt = now,
            ExpiresAt = now.AddDays(Auth.RefreshTokenDays),
            UserAgent = userAgent is { Length: > 256 } ? userAgent[..256] : userAgent,
        }, raw);
    }

    private async Task RevokeAllAsync(Guid accountId, CancellationToken ct, bool save = true)
    {
        var now = clock.GetUtcNow();
        var active = await db.RefreshTokens.Where(t => t.AccountId == accountId && t.RevokedAt == null).ToListAsync(ct);
        foreach (var token in active) token.RevokedAt = now;
        if (save) await db.SaveChangesAsync(ct);
    }

    private async Task SendCodeAsync(Account account, OneTimeCodePurpose purpose, CancellationToken ct, bool ignoreCooldown, bool swallowCooldown = false)
    {
        var now = clock.GetUtcNow();
        var open = await db.OneTimeCodes.Where(c => c.AccountId == account.Id && c.Purpose == purpose && c.ConsumedAt == null).ToListAsync(ct);
        if (!ignoreCooldown && open.Any(c => now - c.CreatedAt < CodeCooldown))
        {
            if (swallowCooldown) return;
            throw new AccountException("code_cooldown", 429);
        }
        db.OneTimeCodes.RemoveRange(open);

        var code = TokenService.NewCode();
        db.OneTimeCodes.Add(new OneTimeCode
        {
            AccountId = account.Id,
            Purpose = purpose,
            CodeHash = tokens.HashCode(account.Id, purpose, code),
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(Auth.CodeMinutes),
        });
        await db.SaveChangesAsync(ct);

        var message = purpose == OneTimeCodePurpose.VerifyEmail
            ? EmailTemplates.VerifyEmail(account.Email, account.Username, code, Auth.CodeMinutes, account.Language)
            : EmailTemplates.ResetPassword(account.Email, account.Username, code, Auth.CodeMinutes, account.Language);
        try { await email.SendAsync(message, ct); }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // O código já foi gravado; o usuário pode pedir um novo quando o envio voltar.
            throw new AccountException("email_unavailable", 503);
        }
    }

    private async Task ConsumeCodeAsync(Account account, OneTimeCodePurpose purpose, string code, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var stored = await db.OneTimeCodes
            .Where(c => c.AccountId == account.Id && c.Purpose == purpose && c.ConsumedAt == null && c.ExpiresAt > now)
            .OrderByDescending(c => c.CreatedAt)
            .FirstOrDefaultAsync(ct);
        if (stored is null || stored.Attempts >= Auth.MaxCodeAttempts) throw new AccountException("invalid_code");

        stored.Attempts++;
        var expected = Encoding.UTF8.GetBytes(stored.CodeHash);
        var actual = Encoding.UTF8.GetBytes(tokens.HashCode(account.Id, purpose, (code ?? "").Trim()));
        if (!CryptographicOperations.FixedTimeEquals(expected, actual))
        {
            await db.SaveChangesAsync(ct);
            throw new AccountException("invalid_code");
        }
        stored.ConsumedAt = now;
    }

    private static AccountDto ToDto(Account account) => new(account.Id, account.Username, account.DisplayName, account.Email);

    private static string NormalizeEmail(string value)
    {
        var normalized = (value ?? "").Trim().ToLowerInvariant();
        if (normalized.Length > 254 || !EmailPattern().IsMatch(normalized)) throw new AccountException("invalid_email");
        return normalized;
    }

    private static string NormalizeUsername(string value)
    {
        var normalized = (value ?? "").Trim().ToLowerInvariant();
        if (!UsernamePattern().IsMatch(normalized)) throw new AccountException("invalid_username");
        if (ReservedUsernames.Contains(normalized)) throw new AccountException("username_reserved");
        return normalized;
    }

    private static string NormalizeLanguage(string? language) =>
        language?.StartsWith("en", StringComparison.OrdinalIgnoreCase) == true ? "en" : "pt-BR";

    private static void ValidatePassword(string? password, string normalizedEmail, string normalizedUsername)
    {
        if (password is null || password.Length is < 10 or > 128) throw new AccountException("weak_password");
        if (CommonPasswords.Contains(password)) throw new AccountException("weak_password");
        var lower = password.ToLower(CultureInfo.InvariantCulture);
        if (lower.Contains(normalizedUsername) || lower == normalizedEmail || lower == normalizedEmail.Split('@')[0])
            throw new AccountException("weak_password");
        if (password.Distinct().Count() < 4) throw new AccountException("weak_password");
    }
}
