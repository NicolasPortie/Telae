using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Telae.Server.Core;

namespace Telae.Server.Accounts;

public sealed record AccountDto(Guid Id, string Username, string DisplayName, string Email);
public sealed record RegisterResult(bool VerificationRequired, AuthResult? Session);
public sealed record AuthResult(string AccessToken, DateTimeOffset AccessTokenExpiresAt, string RefreshToken, AccountDto Account);

public sealed partial class AccountService(
    TelaeDbContext db,
    TokenService tokens,
    IEmailSender email,
    IOptions<AuthOptions> options,
    TimeProvider clock,
    PresenceSubscriptions? presence = null)
{
    private static readonly PasswordHasher<Account> Hasher = new(Options.Create(new PasswordHasherOptions { IterationCount = 220_000 }));
    private static readonly SemaphoreSlim[] AccountLocks = Enumerable.Range(0, 256).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
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
        if (!Auth.IsRegistrationAllowed(normalizedEmail)) throw new AccountException("registration_closed", 403);
        var normalizedUsername = NormalizeUsername(username);
        ValidatePassword(password, normalizedEmail, normalizedUsername);
        var lang = NormalizeLanguage(language);
        // Sem como mandar o código, nada é gravado e a resposta é a mesma para e-mail novo ou já cadastrado.
        if (Auth.RequireEmailVerification && email is UnavailableEmailSender) throw new AccountException("email_unavailable", 503);

        if (await db.Accounts.AnyAsync(a => a.NormalizedUsername == normalizedUsername, ct))
            throw new AccountException("username_taken", 409);

        var existing = await db.Accounts.FirstOrDefaultAsync(a => a.NormalizedEmail == normalizedEmail, ct);
        if (existing is not null && !Auth.RequireEmailVerification) throw new AccountException("email_taken", 409);
        if (existing is not null)
        {
            using var held = await LockAccountAsync(existing, ct);
            Hasher.VerifyHashedPassword(new Account(), DummyHash, password);
            if (existing.EmailVerified) await SendCodeAsync(existing, OneTimeCodePurpose.RegistrationNotice, ct, ignoreCooldown: false, swallowCooldown: true, language: lang);
            else await SendCodeAsync(existing, OneTimeCodePurpose.VerifyEmail, ct, ignoreCooldown: false, swallowCooldown: true);
            return new RegisterResult(true, null);
        }

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
        using var initialCodeLock = await LockAccountAsync(account, ct);
        await SendCodeAsync(account, OneTimeCodePurpose.VerifyEmail, ct, ignoreCooldown: false, swallowCooldown: true);
        return new RegisterResult(true, null);
    }

    public async Task<AuthResult> VerifyEmailAsync(string identifier, string code, string password, string? userAgent, CancellationToken ct)
    {
        // Versões antigas não mandam a senha: recusa antes de gastar uma tentativa do código.
        if (string.IsNullOrEmpty(password)) throw new AccountException("invalid_request");
        var account = await FindByIdentifierAsync(identifier, ct) ?? throw new AccountException("invalid_code");
        using var held = await LockAccountAsync(account, ct);
        // Conta já verificada: o código não vale mais como credencial.
        if (account.EmailVerified) throw new AccountException("invalid_code");
        await ConsumeCodeAsync(account, OneTimeCodePurpose.VerifyEmail, code, ct,
            () => ValidatePassword(password, account.NormalizedEmail, account.NormalizedUsername));
        account.PasswordHash = Hasher.HashPassword(account, password);
        account.EmailVerified = true;
        account.FailedLoginCount = 0;
        account.LockedUntil = null;
        await InvalidateCodesAsync(account.Id, ct);
        account.LastLoginAt = clock.GetUtcNow();
        return await IssueSessionAsync(account, userAgent, ct);
    }

    public async Task ResendVerificationAsync(string identifier, CancellationToken ct)
    {
        var account = await FindByIdentifierAsync(identifier, ct);
        // Sem revelar se a conta existe ou já foi verificada.
        if (account is null || account.EmailVerified) return;
        using var held = await LockAccountAsync(account, ct);
        if (account.EmailVerified) return;
        try { await SendCodeAsync(account, OneTimeCodePurpose.VerifyEmail, ct, ignoreCooldown: false, swallowCooldown: true); }
        catch (AccountException error) when (error.Code == "email_unavailable") { }
    }

    // ── Login e sessão ────────────────────────────────────────────────────

    public async Task<AuthResult> LoginAsync(string identifier, string password, string? userAgent, CancellationToken ct, string? clientAddress = null)
    {
        if (password is null || password.Length is < 1 or > 128) throw new AccountException("invalid_credentials", 401);
        var account = await FindByIdentifierAsync(identifier, ct);
        var now = clock.GetUtcNow();
        if (account is null)
        {
            // Mesmo custo de uma senha errada, para não revelar se a conta existe pelo tempo de resposta.
            Hasher.VerifyHashedPassword(new Account(), DummyHash, password ?? "");
            throw new AccountException("invalid_credentials", 401);
        }
        using var held = await LockAccountAsync(account, ct);
        var verdict = await VerifyPasswordAsync(account, password, clientAddress, ct);
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
        using var held = await LockAccountAsync(token.Account!, ct);
        await db.Entry(token).ReloadAsync(ct);
        var now = clock.GetUtcNow();

        if (token.RevokedAt is not null)
        {
            // Token já trocado sendo reutilizado: possível roubo. Encerra todas as sessões da conta.
            if (token.ReplacedById is not null && await db.RefreshTokens.AnyAsync(t =>
                t.AccountId == token.AccountId && t.SessionId == token.SessionId && t.RevokedAt == null && t.ExpiresAt > now, ct))
            {
                await RevokeAllAsync(token.AccountId, ct);
                if (presence is not null) await presence.RevokeAccountAsync(token.AccountId.ToString());
            }
            throw new AccountException("invalid_session", 401);
        }
        if (token.ExpiresAt <= now || token.SessionId == Guid.Empty || token.Account is null) throw new AccountException("invalid_session", 401);

        var (next, raw) = NewRefreshRecord(token.Account, userAgent);
        next.SessionId = token.SessionId;
        token.RevokedAt = now;
        token.ReplacedById = next.Id;
        db.RefreshTokens.Add(next);
        await db.SaveChangesAsync(ct);
        var (access, expires) = tokens.CreateAccessToken(token.Account, next.SessionId);
        return new AuthResult(access, expires, raw, ToDto(token.Account));
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(refreshToken) || refreshToken.Length > 128) return;
        var hash = TokenService.Hash(refreshToken);
        var token = await db.RefreshTokens.Include(t => t.Account).FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (token is null) return;
        using var held = await LockAccountAsync(token.Account!, ct);
        var now = clock.GetUtcNow();
        await db.RefreshTokens.Where(t => t.AccountId == token.AccountId && t.SessionId == token.SessionId && t.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(t => t.RevokedAt, now), ct);
        if (presence is not null) await presence.RevokeSessionAsync(token.AccountId.ToString(), token.SessionId.ToString());
    }

    // ── Senha ─────────────────────────────────────────────────────────────

    public async Task ForgotPasswordAsync(string identifier, CancellationToken ct)
    {
        var account = await FindByIdentifierAsync(identifier, ct);
        if (account is null) return;
        using var held = await LockAccountAsync(account, ct);
        try { await SendCodeAsync(account, OneTimeCodePurpose.ResetPassword, ct, ignoreCooldown: false, swallowCooldown: true); }
        catch (AccountException error) when (error.Code == "email_unavailable") { }
    }

    public async Task ResetPasswordAsync(string identifier, string code, string newPassword, CancellationToken ct)
    {
        var account = await FindByIdentifierAsync(identifier, ct) ?? throw new AccountException("invalid_code");
        using var held = await LockAccountAsync(account, ct);
        await ConsumeCodeAsync(account, OneTimeCodePurpose.ResetPassword, code, ct,
            () => ValidatePassword(newPassword, account.NormalizedEmail, account.NormalizedUsername));
        account.PasswordHash = Hasher.HashPassword(account, newPassword);
        account.EmailVerified = true;
        account.FailedLoginCount = 0;
        account.LockedUntil = null;
        await InvalidateCodesAsync(account.Id, ct);
        await RevokeAllAsync(account.Id, ct, save: false);
        await db.SaveChangesAsync(ct);
        if (presence is not null) await presence.RevokeAccountAsync(account.Id.ToString());
    }

    public async Task<AuthResult> ChangePasswordAsync(Guid accountId, string currentPassword, string newPassword, string? userAgent, CancellationToken ct, string? clientAddress = null)
    {
        var account = await GetAsync(accountId, ct);
        using var held = await LockAccountAsync(account, ct);
        if (currentPassword is null || currentPassword.Length is < 1 or > 128) throw new AccountException("invalid_credentials", 401);
        await VerifyPasswordAsync(account, currentPassword, clientAddress, ct);
        ValidatePassword(newPassword, account.NormalizedEmail, account.NormalizedUsername);
        account.PasswordHash = Hasher.HashPassword(account, newPassword);
        await InvalidateCodesAsync(account.Id, ct);
        await RevokeAllAsync(account.Id, ct, save: false);
        var session = await IssueSessionAsync(account, userAgent, ct);
        if (presence is not null) await presence.RevokeAccountAsync(account.Id.ToString());
        return session;
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
    public async Task DeleteAsync(Guid accountId, string password, CancellationToken ct, string? clientAddress = null)
    {
        var account = await GetAsync(accountId, ct);
        using var held = await LockAccountAsync(account, ct);
        if (password is null || password.Length is < 1 or > 128) throw new AccountException("invalid_credentials", 401);
        await VerifyPasswordAsync(account, password, clientAddress, ct);
        db.Accounts.Remove(account);
        await db.SaveChangesAsync(ct);
        if (presence is not null) await presence.RevokeAccountAsync(account.Id.ToString());
    }

    /// <summary>Usado pelo hub: confirma que a conta do token ainda existe e devolve o nome atual.</summary>
    public async Task<AccountDto?> FindActiveAsync(Guid accountId, CancellationToken ct)
    {
        var account = await db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == accountId && a.EmailVerified, ct);
        return account is null ? null : ToDto(account);
    }

    // ── Manutenção ────────────────────────────────────────────────────────

    /// <param name="requireUnexpiredToken">
    /// Falso para conexões do hub já abertas: o token foi validado ao conectar e uma transmissão longa
    /// não deve cair quando ele vence. A revogação da sessão continua valendo na hora.
    /// </param>
    public async Task<bool> IsSessionActiveAsync(ClaimsPrincipal user, CancellationToken ct, bool requireUnexpiredToken = true)
    {
        if (!Guid.TryParse(user.FindFirstValue(TokenService.AccountIdClaim), out var accountId) ||
            !Guid.TryParse(user.FindFirstValue(TokenService.SessionIdClaim), out var sessionId) || sessionId == Guid.Empty) return false;
        if (requireUnexpiredToken && (!long.TryParse(user.FindFirstValue("exp"), out var expiration) ||
            expiration <= clock.GetUtcNow().ToUnixTimeSeconds())) return false;
        var now = clock.GetUtcNow();
        return await db.RefreshTokens.AsNoTracking().AnyAsync(t =>
            t.AccountId == accountId && t.SessionId == sessionId && t.RevokedAt == null && t.ExpiresAt > now &&
            t.Account != null && t.Account.EmailVerified, ct);
    }

    public async Task<int> PurgeExpiredAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var codes = await db.OneTimeCodes.Where(c => c.ExpiresAt < now.AddDays(-1)).ExecuteDeleteAsync(ct);
        var refresh = await db.RefreshTokens.Where(t => t.ExpiresAt < now.AddDays(-7)).ExecuteDeleteAsync(ct);
        var stale = await db.Accounts.Where(a => !a.EmailVerified && a.CreatedAt < now.AddDays(-7)).ExecuteDeleteAsync(ct);
        var failedCodes = await db.FailedCodeAttempts.Where(a => a.CreatedAt <= now.AddDays(-1)).ExecuteDeleteAsync(ct);
        var passwordAttempts = await db.PasswordAttempts.Where(a => a.CreatedAt <= now.AddDays(-1)).ExecuteDeleteAsync(ct);
        return codes + refresh + stale + failedCodes + passwordAttempts;
    }

    // ── Auxiliares ────────────────────────────────────────────────────────

    private async Task<Account> GetAsync(Guid accountId, CancellationToken ct) =>
        await db.Accounts.FirstOrDefaultAsync(a => a.Id == accountId, ct) ?? throw new AccountException("invalid_session", 401);

    private async Task<Account?> FindByIdentifierAsync(string identifier, CancellationToken ct)
    {
        if (identifier is null || identifier.Length > 320) return null;
        var value = identifier.Trim().ToLowerInvariant();
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
        var (access, expires) = tokens.CreateAccessToken(account, record.SessionId);
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

    private Task<int> InvalidateCodesAsync(Guid accountId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        return db.OneTimeCodes.Where(code => code.AccountId == accountId && code.ConsumedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(code => code.ConsumedAt, now), ct);
    }

    private async Task SendCodeAsync(Account account, OneTimeCodePurpose purpose, CancellationToken ct, bool ignoreCooldown, bool swallowCooldown = false, string? language = null)
    {
        var now = clock.GetUtcNow();
        var open = await db.OneTimeCodes.Where(c => c.AccountId == account.Id && c.Purpose == purpose && c.ConsumedAt == null).ToListAsync(ct);
        if (!ignoreCooldown && open.Any(c => now - c.CreatedAt < CodeCooldown))
        {
            if (swallowCooldown) return;
            throw new AccountException("code_cooldown", 429);
        }
        var issued = await db.OneTimeCodes.CountAsync(c => c.AccountId == account.Id && c.Purpose == purpose && c.CreatedAt > now.AddDays(-1), ct);
        if (issued >= Auth.MaxCodesPerDay)
        {
            if (swallowCooldown) return;
            throw new AccountException("code_cooldown", 429);
        }
        foreach (var previous in open) previous.ConsumedAt = now;

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

        var message = purpose switch
        {
            OneTimeCodePurpose.VerifyEmail => EmailTemplates.VerifyEmail(account.Email, account.Username, code, Auth.CodeMinutes, account.Language),
            OneTimeCodePurpose.ResetPassword => EmailTemplates.ResetPassword(account.Email, account.Username, code, Auth.CodeMinutes, account.Language),
            _ => EmailTemplates.AlreadyRegistered(account.Email, language ?? account.Language),
        };
        try { await email.SendAsync(message, ct); }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // O código já foi gravado; o usuário pode pedir um novo quando o envio voltar.
            throw new AccountException("email_unavailable", 503);
        }
    }

    private async Task ConsumeCodeAsync(Account account, OneTimeCodePurpose purpose, string code, CancellationToken ct, Action? validate = null)
    {
        var now = clock.GetUtcNow();
        if (await db.FailedCodeAttempts.CountAsync(a => a.AccountId == account.Id && a.Purpose == purpose && a.CreatedAt > now.AddDays(-1), ct)
            >= Auth.MaxFailedCodeAttemptsPerDay) throw new AccountException("invalid_code");
        if (code is null || code.Length != 6 || !code.All(char.IsAsciiDigit))
            await RejectCodeAsync(account.Id, purpose, now, ct);
        var stored = await db.OneTimeCodes.AsNoTracking()
            .Where(c => c.AccountId == account.Id && c.Purpose == purpose && c.ConsumedAt == null && c.ExpiresAt > now)
            .OrderByDescending(c => c.CreatedAt)
            .FirstOrDefaultAsync(ct);
        if (stored is null || stored.Attempts >= Auth.MaxCodeAttempts)
        {
            await RejectCodeAsync(account.Id, purpose, now, ct);
            return;
        }

        var attempted = await db.OneTimeCodes.Where(c => c.Id == stored.Id && c.ConsumedAt == null && c.ExpiresAt > now && c.Attempts < Auth.MaxCodeAttempts)
            .ExecuteUpdateAsync(setters => setters.SetProperty(c => c.Attempts, c => c.Attempts + 1), ct);
        if (attempted != 1) throw new AccountException("invalid_code");
        var expected = Encoding.UTF8.GetBytes(stored.CodeHash);
        var actual = Encoding.UTF8.GetBytes(tokens.HashCode(account.Id, purpose, (code ?? "").Trim()));
        if (!CryptographicOperations.FixedTimeEquals(expected, actual))
            await RejectCodeAsync(account.Id, purpose, now, ct);
        validate?.Invoke();
        var consumed = await db.OneTimeCodes.Where(c => c.Id == stored.Id && c.ConsumedAt == null && c.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(c => c.ConsumedAt, now), ct);
        if (consumed != 1) throw new AccountException("invalid_code");
    }

    private async Task RejectCodeAsync(Guid accountId, OneTimeCodePurpose purpose, DateTimeOffset now, CancellationToken ct)
    {
        db.FailedCodeAttempts.Add(new FailedCodeAttempt { AccountId = accountId, Purpose = purpose, CreatedAt = now });
        await db.SaveChangesAsync(ct);
        throw new AccountException("invalid_code");
    }

    private async Task<PasswordVerificationResult> VerifyPasswordAsync(Account account, string password, string? clientAddress, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        // O endereço já passou pelos proxies confiáveis.
        var address = System.Net.IPAddress.TryParse(clientAddress, out var ip) ? ip.MapToIPv6().ToString() : "unknown";
        var addressHash = TokenService.Hash(address);
        var recent = db.PasswordAttempts.Where(a => a.AccountId == account.Id && a.CreatedAt > now.AddMinutes(-Auth.LoginFailureWindowMinutes));
        var total = await recent.CountAsync(ct);
        var pair = recent.Where(a => a.ClientAddressHash == addressHash && a.AppliesToPair);
        var failures = await pair.CountAsync(ct);
        var last = await pair.OrderByDescending(a => a.CreatedAt).FirstOrDefaultAsync(ct);
        var backoff = TimeSpan.FromSeconds(Math.Min(Auth.LockoutMinutes * 60,
            Auth.LoginBackoffSeconds * Math.Pow(2, Math.Min(30, failures - Auth.MaxFailedLogins))));
        if (total >= Auth.MaxAccountFailedLogins ||
            (failures >= Auth.MaxFailedLogins && last is not null && last.CreatedAt + backoff > now))
        {
            Hasher.VerifyHashedPassword(new Account(), DummyHash, password);
            throw new AccountException("invalid_credentials", 401);
        }
        var verdict = Hasher.VerifyHashedPassword(account, account.PasswordHash, password);
        if (verdict == PasswordVerificationResult.Failed)
        {
            db.PasswordAttempts.Add(new PasswordAttempt { AccountId = account.Id, ClientAddressHash = addressHash, CreatedAt = now });
            await db.SaveChangesAsync(ct);
            throw new AccountException("invalid_credentials", 401);
        }
        // O sucesso zera só o par; o teto global mantém as falhas.
        await db.PasswordAttempts.Where(a => a.AccountId == account.Id && a.ClientAddressHash == addressHash && a.AppliesToPair)
            .ExecuteUpdateAsync(setters => setters.SetProperty(a => a.AppliesToPair, false), ct);
        account.FailedLoginCount = 0;
        account.LockedUntil = null;
        return verdict;
    }

    private async Task<IDisposable> LockAccountAsync(Account account, CancellationToken ct)
    {
        var gate = AccountLocks[(account.Id.GetHashCode() & int.MaxValue) % AccountLocks.Length];
        await gate.WaitAsync(ct);
        try
        {
            await db.Entry(account).ReloadAsync(ct);
            if (db.Entry(account).State == EntityState.Detached) throw new AccountException("invalid_session", 401);
            return new AccountLock(gate);
        }
        catch { gate.Release(); throw; }
    }

    private sealed class AccountLock(SemaphoreSlim gate) : IDisposable
    {
        public void Dispose() => gate.Release();
    }

    private static AccountDto ToDto(Account account) => new(account.Id, account.Username, account.DisplayName, account.Email);

    private static string NormalizeEmail(string value)
    {
        if (value is null || value.Length > 320) throw new AccountException("invalid_email");
        var normalized = value.Trim().ToLowerInvariant();
        if (normalized.Length > 254 || !EmailPattern().IsMatch(normalized)) throw new AccountException("invalid_email");
        return normalized;
    }

    private static string NormalizeUsername(string value)
    {
        if (value is null || value.Length > 64) throw new AccountException("invalid_username");
        var normalized = value.Trim().ToLowerInvariant();
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
