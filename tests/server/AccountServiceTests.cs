using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Telae.Server.Accounts;

namespace Telae.Server.Tests;

internal sealed class FakeClock : TimeProvider
{
    private DateTimeOffset _now = new(2026, 10, 19, 12, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => _now;
    public void Advance(TimeSpan span) => _now += span;
}

internal sealed class CapturingEmail : IEmailSender
{
    public List<EmailMessage> Sent { get; } = [];
    public bool Fail { get; set; }

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        if (Fail) throw new InvalidOperationException("SMTP indisponível");
        Sent.Add(message);
        return Task.CompletedTask;
    }

    /// <summary>Último código de 6 dígitos enviado para o endereço.</summary>
    public string LastCode(string to) =>
        System.Text.RegularExpressions.Regex.Matches(Sent.Last(m => m.To == to).TextBody, @"\b\d{6}\b")[^1].Value;
}

public sealed class AccountServiceTests : IDisposable
{
    private const string Password = "uma-senha-bem-longa-42";
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private readonly FakeClock _clock = new();
    private readonly CapturingEmail _email = new();
    private readonly AuthOptions _options = new() { JwtKey = new string('k', 48) };

    public AccountServiceTests()
    {
        _connection.Open();
        using var db = NewDb();
        db.Database.EnsureCreated();
    }

    public void Dispose() => _connection.Dispose();

    private TelaeDbContext NewDb() =>
        new(new DbContextOptionsBuilder<TelaeDbContext>().UseSqlite(_connection).Options);

    private AccountService Service(TelaeDbContext db)
    {
        var options = Options.Create(_options);
        return new AccountService(db, new TokenService(options, _clock), _email, options, _clock);
    }

    private async Task<AuthResult> SignedUpAsync(string email = "ana@example.com", string username = "ana")
    {
        using var db = NewDb();
        var service = Service(db);
        await service.RegisterAsync(email, username, Password, "pt-BR", null, default);
        return await service.VerifyEmailAsync(email, _email.LastCode(email), null, default);
    }

    private static async Task<AccountException> FailureAsync(Func<Task> action) =>
        await Assert.ThrowsAsync<AccountException>(action);

    [Fact]
    public async Task Register_sends_a_code_and_verification_returns_a_session()
    {
        var session = await SignedUpAsync();
        Assert.Equal("ana", session.Account.Username);
        Assert.Equal("ana", session.Account.DisplayName);
        Assert.False(string.IsNullOrEmpty(session.AccessToken));
        Assert.Contains("Confirme seu e-mail", _email.Sent.Single().Subject);
    }

    [Theory]
    [InlineData("curta1")]
    [InlineData("1234567890")]
    [InlineData("aaaaaaaaaaaa")]
    [InlineData("minha-ana-senha")]
    public async Task Weak_passwords_are_rejected(string password)
    {
        using var db = NewDb();
        var error = await FailureAsync(() => Service(db).RegisterAsync("ana@example.com", "ana", password, null, null, default));
        Assert.Equal("weak_password", error.Code);
    }

    [Theory]
    [InlineData("ab")]
    [InlineData("com espaço")]
    [InlineData("Ana!")]
    [InlineData("a-b-c")]
    public async Task Invalid_usernames_are_rejected(string username)
    {
        using var db = NewDb();
        var error = await FailureAsync(() => Service(db).RegisterAsync("ana@example.com", username, Password, null, null, default));
        Assert.Equal("invalid_username", error.Code);
    }

    [Fact]
    public async Task Reserved_and_taken_usernames_are_rejected()
    {
        using var db = NewDb();
        var service = Service(db);
        Assert.Equal("username_reserved", (await FailureAsync(() => service.RegisterAsync("a@example.com", "Admin", Password, null, null, default))).Code);
        await SignedUpAsync();
        Assert.Equal("username_taken", (await FailureAsync(() => service.RegisterAsync("b@example.com", "ANA", Password, null, null, default))).Code);
    }

    [Fact]
    public async Task Registering_an_existing_verified_email_does_not_reveal_it()
    {
        await SignedUpAsync();
        using var db = NewDb();
        var result = await Service(db).RegisterAsync("ANA@example.com", "outra_ana", Password, "en", null, default);
        Assert.True(result.VerificationRequired);
        Assert.Null(result.Session);
        Assert.Equal("You already have a Telae account", _email.Sent.Last().Subject);
        Assert.False(await db.Accounts.AnyAsync(a => a.Username == "outra_ana"));
    }

    [Fact]
    public async Task Login_requires_a_verified_email_and_accepts_email_or_username()
    {
        using (var db = NewDb())
            await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        using (var db = NewDb())
            Assert.Equal("email_not_verified", (await FailureAsync(() => Service(db).LoginAsync("ana@example.com", Password, null, default))).Code);

        using (var db = NewDb())
            await Service(db).VerifyEmailAsync("ana", _email.LastCode("ana@example.com"), null, default);
        using (var db = NewDb())
        {
            var service = Service(db);
            Assert.Equal("ana", (await service.LoginAsync("Ana@Example.com", Password, null, default)).Account.Username);
            Assert.Equal("ana", (await service.LoginAsync("ANA", Password, null, default)).Account.Username);
        }
    }

    [Fact]
    public async Task Wrong_codes_are_limited_and_a_used_code_cannot_be_reused()
    {
        using (var db = NewDb())
            await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        var real = _email.LastCode("ana@example.com");
        var wrong = real == "000000" ? "111111" : "000000";

        for (var attempt = 0; attempt < _options.MaxCodeAttempts; attempt++)
        {
            using var db = NewDb();
            Assert.Equal("invalid_code", (await FailureAsync(() => Service(db).VerifyEmailAsync("ana", wrong, null, default))).Code);
        }
        using (var db = NewDb())
            Assert.Equal("invalid_code", (await FailureAsync(() => Service(db).VerifyEmailAsync("ana", real, null, default))).Code);
    }

    [Fact]
    public async Task Codes_expire()
    {
        using (var db = NewDb())
            await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        var code = _email.LastCode("ana@example.com");
        _clock.Advance(TimeSpan.FromMinutes(_options.CodeMinutes + 1));
        using var again = NewDb();
        Assert.Equal("invalid_code", (await FailureAsync(() => Service(again).VerifyEmailAsync("ana", code, null, default))).Code);
    }

    [Fact]
    public async Task Resending_is_rate_limited_per_account()
    {
        using (var db = NewDb())
            await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        using (var db = NewDb())
            Assert.Equal("code_cooldown", (await FailureAsync(() => Service(db).ResendVerificationAsync("ana", default))).Code);
        _clock.Advance(TimeSpan.FromSeconds(61));
        using (var db = NewDb())
            await Service(db).ResendVerificationAsync("ana", default);
        Assert.Equal(2, _email.Sent.Count);
    }

    [Fact]
    public async Task Repeated_failures_lock_the_account_until_the_lockout_passes()
    {
        await SignedUpAsync();
        for (var attempt = 0; attempt < _options.MaxFailedLogins; attempt++)
        {
            using var db = NewDb();
            Assert.Equal("invalid_credentials", (await FailureAsync(() => Service(db).LoginAsync("ana", "errada-errada-1", null, default))).Code);
        }
        using (var db = NewDb())
            Assert.Equal("account_locked", (await FailureAsync(() => Service(db).LoginAsync("ana", Password, null, default))).Code);
        _clock.Advance(TimeSpan.FromMinutes(_options.LockoutMinutes + 1));
        using (var db = NewDb())
            Assert.NotNull(await Service(db).LoginAsync("ana", Password, null, default));
    }

    [Fact]
    public async Task Unknown_accounts_and_wrong_passwords_look_the_same()
    {
        await SignedUpAsync();
        using var db = NewDb();
        var unknown = await FailureAsync(() => Service(db).LoginAsync("ninguem", Password, null, default));
        var wrong = await FailureAsync(() => Service(db).LoginAsync("ana", "errada-errada-1", null, default));
        Assert.Equal((unknown.Code, unknown.Status), (wrong.Code, wrong.Status));
    }

    [Fact]
    public async Task Refresh_rotates_and_reusing_an_old_token_revokes_every_session()
    {
        var first = await SignedUpAsync();
        AuthResult second;
        using (var db = NewDb())
            second = await Service(db).RefreshAsync(first.RefreshToken, null, default);
        Assert.NotEqual(first.RefreshToken, second.RefreshToken);

        using (var db = NewDb())
            Assert.Equal("invalid_session", (await FailureAsync(() => Service(db).RefreshAsync(first.RefreshToken, null, default))).Code);
        // O token novo também deixou de valer: a reutilização foi tratada como roubo.
        using (var db = NewDb())
            Assert.Equal("invalid_session", (await FailureAsync(() => Service(db).RefreshAsync(second.RefreshToken, null, default))).Code);
    }

    [Fact]
    public async Task Refresh_tokens_expire_and_logout_revokes()
    {
        var session = await SignedUpAsync();
        using (var db = NewDb())
            await Service(db).LogoutAsync(session.RefreshToken, default);
        using (var db = NewDb())
            Assert.Equal("invalid_session", (await FailureAsync(() => Service(db).RefreshAsync(session.RefreshToken, null, default))).Code);

        AuthResult login;
        using (var db = NewDb())
            login = await Service(db).LoginAsync("ana", Password, null, default);
        _clock.Advance(TimeSpan.FromDays(_options.RefreshTokenDays + 1));
        using (var db = NewDb())
            Assert.Equal("invalid_session", (await FailureAsync(() => Service(db).RefreshAsync(login.RefreshToken, null, default))).Code);
    }

    [Fact]
    public async Task Only_hashes_are_stored_never_the_password_token_or_code()
    {
        var session = await SignedUpAsync();
        using var db = NewDb();
        var account = await db.Accounts.SingleAsync();
        var token = await db.RefreshTokens.SingleAsync();
        var code = await db.OneTimeCodes.SingleAsync();
        Assert.DoesNotContain(Password, account.PasswordHash);
        Assert.NotEqual(session.RefreshToken, token.TokenHash);
        Assert.NotEqual(_email.LastCode("ana@example.com"), code.CodeHash);
        Assert.Equal(64, token.TokenHash.Length);
    }

    [Fact]
    public async Task Password_reset_requires_the_code_and_revokes_sessions()
    {
        var session = await SignedUpAsync();
        _clock.Advance(TimeSpan.FromSeconds(61));
        using (var db = NewDb())
            await Service(db).ForgotPasswordAsync("ana@example.com", default);
        var code = _email.LastCode("ana@example.com");

        using (var db = NewDb())
            Assert.Equal("invalid_code", (await FailureAsync(() => Service(db).ResetPasswordAsync("ana", code == "000000" ? "111111" : "000000", "nova-senha-bem-longa-9", default))).Code);
        using (var db = NewDb())
            Assert.Equal("weak_password", (await FailureAsync(() => Service(db).ResetPasswordAsync("ana", code, "curta", default))).Code);
        using (var db = NewDb())
            await Service(db).ResetPasswordAsync("ana", code, "nova-senha-bem-longa-9", default);

        using (var db = NewDb())
            Assert.Equal("invalid_session", (await FailureAsync(() => Service(db).RefreshAsync(session.RefreshToken, null, default))).Code);
        using (var db = NewDb())
        {
            var service = Service(db);
            Assert.Equal("invalid_credentials", (await FailureAsync(() => service.LoginAsync("ana", Password, null, default))).Code);
            Assert.NotNull(await service.LoginAsync("ana", "nova-senha-bem-longa-9", null, default));
        }
    }

    [Fact]
    public async Task Forgot_password_answers_the_same_for_unknown_accounts()
    {
        using var db = NewDb();
        await Service(db).ForgotPasswordAsync("ninguem@example.com", default);
        Assert.Empty(_email.Sent);
    }

    [Fact]
    public async Task Changing_the_password_needs_the_current_one_and_returns_a_fresh_session()
    {
        var session = await SignedUpAsync();
        using (var db = NewDb())
            Assert.Equal("invalid_credentials", (await FailureAsync(() => Service(db).ChangePasswordAsync(session.Account.Id, "errada-errada-1", "nova-senha-bem-longa-9", null, default))).Code);
        AuthResult fresh;
        using (var db = NewDb())
            fresh = await Service(db).ChangePasswordAsync(session.Account.Id, Password, "nova-senha-bem-longa-9", null, default);
        using (var db = NewDb())
        {
            var service = Service(db);
            // A sessão nova funciona; só depois a antiga é recusada (reutilizá-la antes revogaria a nova).
            Assert.NotNull(await service.RefreshAsync(fresh.RefreshToken, null, default));
            Assert.Equal("invalid_session", (await FailureAsync(() => service.RefreshAsync(session.RefreshToken, null, default))).Code);
        }
    }

    [Fact]
    public async Task Display_name_is_validated_and_deleting_the_account_removes_everything()
    {
        var session = await SignedUpAsync();
        using (var db = NewDb())
        {
            var service = Service(db);
            Assert.Equal("invalid_display_name", (await FailureAsync(() => service.UpdateDisplayNameAsync(session.Account.Id, "   ", default))).Code);
            Assert.Equal("Ana Souza", (await service.UpdateDisplayNameAsync(session.Account.Id, " Ana Souza ", default)).DisplayName);
            Assert.Equal("invalid_credentials", (await FailureAsync(() => service.DeleteAsync(session.Account.Id, "errada-errada-1", default))).Code);
            await service.DeleteAsync(session.Account.Id, Password, default);
        }
        using var check = NewDb();
        Assert.Empty(await check.Accounts.ToListAsync());
        Assert.Empty(await check.RefreshTokens.ToListAsync());
        Assert.Empty(await check.OneTimeCodes.ToListAsync());
    }

    [Fact]
    public async Task An_unavailable_mail_server_is_reported_without_losing_the_account()
    {
        _email.Fail = true;
        using (var db = NewDb())
            Assert.Equal("email_unavailable", (await FailureAsync(() => Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default))).Code);
        _email.Fail = false;
        _clock.Advance(TimeSpan.FromSeconds(61));
        using (var db = NewDb())
            await Service(db).ResendVerificationAsync("ana", default);
        using (var db = NewDb())
            Assert.NotNull(await Service(db).VerifyEmailAsync("ana", _email.LastCode("ana@example.com"), null, default));
    }

    [Fact]
    public async Task Maintenance_removes_expired_codes_old_sessions_and_unverified_accounts()
    {
        using (var db = NewDb())
            await Service(db).RegisterAsync("nova@example.com", "nova", Password, null, null, default);
        await SignedUpAsync();
        _clock.Advance(TimeSpan.FromDays(40));
        using var cleanup = NewDb();
        Assert.True(await Service(cleanup).PurgeExpiredAsync(default) >= 3);
        Assert.Equal(["ana"], await cleanup.Accounts.Select(a => a.Username).ToListAsync());
    }

    [Fact]
    public async Task Without_required_verification_registration_signs_in_immediately()
    {
        _options.RequireEmailVerification = false;
        using var db = NewDb();
        var result = await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        Assert.False(result.VerificationRequired);
        Assert.NotNull(result.Session);
        Assert.Empty(_email.Sent);
    }
}
