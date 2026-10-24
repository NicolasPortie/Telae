using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.JsonWebTokens;
using System.Buffers.Binary;
using System.Security.Claims;
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
        return await service.VerifyEmailAsync(email, _email.LastCode(email), Password, null, default);
    }

    private static async Task<AccountException> FailureAsync(Func<Task> action) =>
        await Assert.ThrowsAsync<AccountException>(action);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Code_issuance_budget_survives_resends_and_scopes_for_each_purpose(bool reset)
    {
        using (var db = NewDb()) await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        var start = _clock.GetUtcNow();
        if (reset)
        {
            using var db = NewDb();
            await Service(db).ForgotPasswordAsync("ana", default);
        }
        for (var index = 1; index < _options.MaxCodesPerDay + 2; index++)
        {
            _clock.Advance(TimeSpan.FromSeconds(61));
            using var db = NewDb();
            if (reset) await Service(db).ForgotPasswordAsync(index % 2 == 0 ? "ana" : "ANA@example.com", default);
            else await Service(db).ResendVerificationAsync(index % 2 == 0 ? "ana" : "ANA@example.com", default);
        }
        using (var db = NewDb())
        {
            var purpose = reset ? OneTimeCodePurpose.ResetPassword : OneTimeCodePurpose.VerifyEmail;
            Assert.Equal(_options.MaxCodesPerDay, await db.OneTimeCodes.CountAsync(c => c.Purpose == purpose));
        }
        _clock.Advance(start.AddDays(1) - _clock.GetUtcNow());
        using (var db = NewDb())
        {
            if (reset) await Service(db).ForgotPasswordAsync("ana", default);
            else await Service(db).ResendVerificationAsync("ana", default);
            var purpose = reset ? OneTimeCodePurpose.ResetPassword : OneTimeCodePurpose.VerifyEmail;
            Assert.Equal(_options.MaxCodesPerDay + 1, await db.OneTimeCodes.CountAsync(c => c.Purpose == purpose));
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Failed_code_budget_is_daily_per_purpose_and_is_not_reset_by_new_codes(bool reset)
    {
        using (var db = NewDb()) await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        var start = _clock.GetUtcNow();
        for (var index = 0; index < _options.MaxFailedCodeAttemptsPerDay; index++)
        {
            using var db = NewDb();
            var service = Service(db);
            if (index % _options.MaxCodeAttempts == 0)
            {
                _clock.Advance(TimeSpan.FromSeconds(61));
                if (reset) await service.ForgotPasswordAsync("ana", default);
                else await service.ResendVerificationAsync("ana", default);
            }
            var correct = _email.LastCode("ana@example.com");
            var wrong = correct == "000000" ? "111111" : "000000";
            var identifier = index % 2 == 0 ? "ana" : "ana@example.com";
            Assert.Equal("invalid_code", (await FailureAsync(() => reset
                ? service.ResetPasswordAsync(identifier, wrong, Password, default)
                : service.VerifyEmailAsync(identifier, wrong, Password, null, default))).Code);
        }
        _clock.Advance(TimeSpan.FromSeconds(61));
        using (var db = NewDb())
        {
            var service = Service(db);
            if (reset) await service.ForgotPasswordAsync("ana", default);
            else await service.ResendVerificationAsync("ana", default);
            var correct = _email.LastCode("ana@example.com");
            Assert.Equal("invalid_code", (await FailureAsync(() => reset
                ? service.ResetPasswordAsync("ana", correct, Password, default)
                : service.VerifyEmailAsync("ana", correct, Password, null, default))).Code);
            Assert.Equal(_options.MaxFailedCodeAttemptsPerDay, await db.FailedCodeAttempts.CountAsync());
            // O outro propósito mantém seu próprio orçamento.
            if (reset)
            {
                await service.ResendVerificationAsync("ana", default);
                await service.VerifyEmailAsync("ana", _email.LastCode("ana@example.com"), Password, null, default);
            }
            else
            {
                await service.ForgotPasswordAsync("ana", default);
                await service.ResetPasswordAsync("ana", _email.LastCode("ana@example.com"), Password, default);
            }
            Assert.Equal(_options.MaxFailedCodeAttemptsPerDay, await db.FailedCodeAttempts.CountAsync());
        }
        _clock.Advance(start.AddDays(1).AddSeconds(61) - _clock.GetUtcNow());
        using (var db = NewDb())
        {
            var service = Service(db);
            await service.ForgotPasswordAsync("ana", default);
            await service.ResetPasswordAsync("ana", _email.LastCode("ana@example.com"), Password, default);
        }
    }

    [Fact]
    public async Task Successful_codes_do_not_spend_the_failure_budget_and_invalid_formats_do()
    {
        _options.MaxFailedCodeAttemptsPerDay = 2;
        using var db = NewDb();
        var service = Service(db);
        await service.RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        await FailureAsync(() => service.VerifyEmailAsync("ana", "invalid", Password, null, default));
        await service.VerifyEmailAsync("ana", _email.LastCode("ana@example.com"), Password, null, default);
        Assert.Single(await db.FailedCodeAttempts.ToListAsync());
    }

    [Fact]
    public async Task Login_backoff_is_exponential_and_another_address_can_still_sign_in()
    {
        await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        for (var attempt = 0; attempt < _options.MaxFailedLogins; attempt++)
            await FailureAsync(() => service.LoginAsync(attempt % 2 == 0 ? "ana" : "ana@example.com", "wrong", null, default, "198.51.100.1"));
        Assert.Equal("invalid_credentials", (await FailureAsync(() => service.LoginAsync("ana", Password, null, default, "::ffff:198.51.100.1"))).Code);
        Assert.NotNull(await service.LoginAsync("ana", Password, null, default, "198.51.100.2"));
        _clock.Advance(TimeSpan.FromSeconds(1));
        await FailureAsync(() => service.LoginAsync("ana", "wrong", null, default, "198.51.100.1"));
        _clock.Advance(TimeSpan.FromSeconds(1));
        await FailureAsync(() => service.LoginAsync("ana", Password, null, default, "198.51.100.1"));
        Assert.Equal(_options.MaxFailedLogins + 1, await db.PasswordAttempts.CountAsync());
        _clock.Advance(TimeSpan.FromSeconds(1));
        Assert.NotNull(await service.LoginAsync("ana", Password, null, default, "198.51.100.1"));
        Assert.Equal(_options.MaxFailedLogins + 1, await db.PasswordAttempts.CountAsync());
        Assert.False(await db.PasswordAttempts.AnyAsync(a => a.AppliesToPair));
    }

    [Fact]
    public async Task Distributed_failures_hit_the_global_ceiling_even_after_successes_and_expire()
    {
        var session = await SignedUpAsync();
        using var db = NewDb();
        db.PasswordAttempts.AddRange(Enumerable.Range(0, _options.MaxAccountFailedLogins - 1).Select(index => new PasswordAttempt
        {
            AccountId = session.Account.Id, ClientAddressHash = TokenService.Hash($"address-{index}"), CreatedAt = _clock.GetUtcNow(),
        }));
        await db.SaveChangesAsync();
        var service = Service(db);
        Assert.NotNull(await service.LoginAsync("ana", Password, null, default, "198.51.100.2"));
        await FailureAsync(() => service.LoginAsync("ana@example.com", "wrong", null, default, "198.51.100.1"));
        var blocked = await FailureAsync(() => service.LoginAsync("ana", Password, null, default, "198.51.100.2"));
        var absent = await FailureAsync(() => service.LoginAsync("absent", Password, null, default, "198.51.100.2"));
        Assert.Equal((absent.Code, absent.Status), (blocked.Code, blocked.Status));
        _clock.Advance(TimeSpan.FromMinutes(_options.LoginFailureWindowMinutes));
        Assert.NotNull(await service.LoginAsync("ana", Password, null, default, "198.51.100.2"));
        _clock.Advance(TimeSpan.FromDays(1));
        await service.PurgeExpiredAsync(default);
        Assert.Empty(await db.PasswordAttempts.ToListAsync());
    }

    [Fact]
    public async Task Without_email_delivery_sign_up_saves_nothing_and_answers_the_same_for_known_emails()
    {
        await SignedUpAsync();
        using var db = NewDb();
        var options = Options.Create(_options);
        var service = new AccountService(db, new TokenService(options, _clock), new UnavailableEmailSender(), options, _clock);

        Assert.Equal("email_unavailable", (await FailureAsync(() => service.RegisterAsync("new@example.com", "novo", Password, "pt-BR", null, default))).Code);
        Assert.Equal("email_unavailable", (await FailureAsync(() => service.RegisterAsync("ana@example.com", "outra", Password, "pt-BR", null, default))).Code);
        Assert.False(await db.Accounts.AnyAsync(a => a.NormalizedEmail == "new@example.com"));
    }

    [Fact]
    public async Task Verification_without_a_password_is_refused_before_spending_an_attempt()
    {
        using (var db = NewDb()) await Service(db).RegisterAsync("ana@example.com", "ana", Password, "pt-BR", null, default);
        var code = _email.LastCode("ana@example.com");
        for (var attempt = 0; attempt < 10; attempt++)
        {
            using var db = NewDb();
            Assert.Equal("invalid_request", (await FailureAsync(() => Service(db).VerifyEmailAsync("ana", code, null!, null, default))).Code);
        }
        using (var db = NewDb()) Assert.NotNull(await Service(db).VerifyEmailAsync("ana", code, Password, null, default));
    }

    [Fact]
    public async Task Closed_registration_rejects_anyone_who_is_not_allowed()
    {
        _options.RegistrationOpen = false;
        _options.AllowedEmails = "owner@example.com";
        using var db = NewDb();
        var failure = await FailureAsync(() => Service(db).RegisterAsync("stranger@example.com", "stranger", Password, "pt-BR", null, default));
        Assert.Equal("registration_closed", failure.Code);
        Assert.Equal(403, failure.Status);
        Assert.Empty(_email.Sent);
        Assert.False(await db.Accounts.AnyAsync());
    }

    [Fact]
    public async Task Closed_registration_with_no_allowed_emails_rejects_everyone()
    {
        _options.RegistrationOpen = false;
        using var db = NewDb();
        var failure = await FailureAsync(() => Service(db).RegisterAsync("ana@example.com", "ana", Password, "pt-BR", null, default));
        Assert.Equal("registration_closed", failure.Code);
    }

    [Theory]
    [InlineData("owner@example.com")]
    [InlineData("  Owner@Example.COM ")]
    public async Task Closed_registration_accepts_allowed_emails_in_any_case(string email)
    {
        _options.RegistrationOpen = false;
        _options.AllowedEmails = "friend@example.com; owner@example.com";
        using var db = NewDb();
        var result = await Service(db).RegisterAsync(email, "owner", Password, "pt-BR", null, default);
        Assert.True(result.VerificationRequired);
        Assert.Single(_email.Sent);
    }

    [Fact]
    public async Task Register_sends_a_code_and_verification_returns_a_session()
    {
        var session = await SignedUpAsync();
        Assert.Equal("ana", session.Account.Username);
        Assert.Equal("ana", session.Account.DisplayName);
        Assert.False(string.IsNullOrEmpty(session.AccessToken));
        Assert.Contains("Seu código do Telaê", _email.Sent.Single().Subject);
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
        Assert.Equal("You already have a Telaê account", _email.Sent.Last().Subject);
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
            await Service(db).VerifyEmailAsync("ana", _email.LastCode("ana@example.com"), Password, null, default);
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
            Assert.Equal("invalid_code", (await FailureAsync(() => Service(db).VerifyEmailAsync("ana", wrong, Password, null, default))).Code);
        }
        using (var db = NewDb())
            Assert.Equal("invalid_code", (await FailureAsync(() => Service(db).VerifyEmailAsync("ana", real, Password, null, default))).Code);
    }

    [Fact]
    public async Task Codes_expire()
    {
        using (var db = NewDb())
            await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        var code = _email.LastCode("ana@example.com");
        _clock.Advance(TimeSpan.FromMinutes(_options.CodeMinutes + 1));
        using var again = NewDb();
        Assert.Equal("invalid_code", (await FailureAsync(() => Service(again).VerifyEmailAsync("ana", code, Password, null, default))).Code);
    }

    [Fact]
    public async Task Resending_is_rate_limited_per_account()
    {
        using (var db = NewDb())
            await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        using (var db = NewDb())
            await Service(db).ResendVerificationAsync("ana", default);
        _clock.Advance(TimeSpan.FromSeconds(61));
        using (var db = NewDb())
            await Service(db).ResendVerificationAsync("ana", default);
        Assert.Equal(2, _email.Sent.Count);
    }

    [Fact]
    public async Task Repeated_failures_throttle_the_pair_until_the_backoff_passes()
    {
        await SignedUpAsync();
        for (var attempt = 0; attempt < _options.MaxFailedLogins; attempt++)
        {
            using var db = NewDb();
            Assert.Equal("invalid_credentials", (await FailureAsync(() => Service(db).LoginAsync("ana", "errada-errada-1", null, default))).Code);
        }
        using (var db = NewDb())
            Assert.Equal("invalid_credentials", (await FailureAsync(() => Service(db).LoginAsync("ana", Password, null, default))).Code);
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
            Assert.NotNull(await Service(db).VerifyEmailAsync("ana", _email.LastCode("ana@example.com"), Password, null, default));
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

    private static ClaimsPrincipal Principal(AuthResult session) => new(new ClaimsIdentity(
        new JsonWebTokenHandler().ReadJsonWebToken(session.AccessToken).Claims, "Bearer"));

    [Fact]
    public async Task Rotation_preserves_access_but_logout_invalidates_the_entire_session_family()
    {
        var first = await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        var second = await service.RefreshAsync(first.RefreshToken, null, default);
        Assert.True(await service.IsSessionActiveAsync(Principal(first), default));
        Assert.True(await service.IsSessionActiveAsync(Principal(second), default));
        await service.LogoutAsync(first.RefreshToken, default);
        Assert.False(await service.IsSessionActiveAsync(Principal(first), default));
        Assert.False(await service.IsSessionActiveAsync(Principal(second), default));
    }

    [Fact]
    public async Task Logging_out_one_session_keeps_another_login_active()
    {
        var first = await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        var second = await service.LoginAsync("ana", Password, null, default);
        await service.LogoutAsync(first.RefreshToken, default);
        Assert.False(await service.IsSessionActiveAsync(Principal(first), default));
        Assert.True(await service.IsSessionActiveAsync(Principal(second), default));
    }

    [Fact]
    public async Task Password_change_reset_and_deletion_invalidate_access_tokens()
    {
        var first = await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        var changed = await service.ChangePasswordAsync(first.Account.Id, Password, "outra-senha-segura-27", null, default);
        Assert.False(await service.IsSessionActiveAsync(Principal(first), default));
        Assert.True(await service.IsSessionActiveAsync(Principal(changed), default));
        await service.ForgotPasswordAsync("ana", default);
        await service.ResetPasswordAsync("ana", _email.LastCode("ana@example.com"), Password, default);
        Assert.False(await service.IsSessionActiveAsync(Principal(changed), default));
        var last = await service.LoginAsync("ana", Password, null, default);
        await service.DeleteAsync(last.Account.Id, Password, default);
        Assert.False(await service.IsSessionActiveAsync(Principal(last), default));
    }

    [Fact]
    public async Task Session_validation_rejects_expiry_and_tokens_without_a_session_claim()
    {
        var session = await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        var withoutSession = new ClaimsPrincipal(new ClaimsIdentity(Principal(session).Claims.Where(c => c.Type != TokenService.SessionIdClaim), "Bearer"));
        Assert.False(await service.IsSessionActiveAsync(withoutSession, default));
        _clock.Advance(TimeSpan.FromMinutes(_options.AccessTokenMinutes));
        Assert.False(await service.IsSessionActiveAsync(Principal(session), default));
    }

    [Fact]
    public async Task Password_confirmation_failures_share_the_pair_backoff()
    {
        var session = await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        for (var attempt = 0; attempt < _options.MaxFailedLogins; attempt++)
        {
            if (attempt % 2 == 0)
                Assert.Equal("invalid_credentials", (await FailureAsync(() => service.ChangePasswordAsync(session.Account.Id, "senha-errada-42", "outra-senha-segura-27", null, default))).Code);
            else
                Assert.Equal("invalid_credentials", (await FailureAsync(() => service.DeleteAsync(session.Account.Id, "senha-errada-42", default))).Code);
        }
        Assert.Equal("invalid_credentials", (await FailureAsync(() => service.LoginAsync("ana", Password, null, default))).Code);
        Assert.Equal("invalid_credentials", (await FailureAsync(() => service.ChangePasswordAsync(session.Account.Id, Password, "outra-senha-segura-27", null, default))).Code);
        _clock.Advance(TimeSpan.FromMinutes(_options.LockoutMinutes + 1));
        Assert.NotNull(await service.LoginAsync("ana", Password, null, default));
    }

    [Fact]
    public async Task Existing_email_cannot_be_detected_using_a_taken_public_username()
    {
        await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        var existing = await FailureAsync(() => service.RegisterAsync("ana@example.com", "ana", Password, null, null, default));
        var absent = await FailureAsync(() => service.RegisterAsync("absent@example.com", "ana", Password, null, null, default));
        Assert.Equal((absent.Code, absent.Status), (existing.Code, existing.Status));
    }

    [Fact]
    public async Task Recovery_does_not_reveal_account_existence_through_cooldown_or_delivery_errors()
    {
        await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        _email.Fail = true;
        await service.ForgotPasswordAsync("ana", default);
        await service.ForgotPasswordAsync("ana@example.com", default);
        await service.ForgotPasswordAsync("absent@example.com", default);
        Assert.Equal("email_unavailable", (await FailureAsync(() => service.RegisterAsync("bia@example.com", "bia", Password, null, null, default))).Code);
        await service.ResendVerificationAsync("bia", default);
        await service.ResendVerificationAsync("absent@example.com", default);
    }

    [Fact]
    public async Task Reset_does_not_validate_a_new_password_until_the_code_is_correct()
    {
        await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        await service.ForgotPasswordAsync("ana", default);
        var real = _email.LastCode("ana@example.com");
        var wrong = real == "000000" ? "111111" : "000000";
        var existing = await FailureAsync(() => service.ResetPasswordAsync("ana", wrong, "curta", default));
        var absent = await FailureAsync(() => service.ResetPasswordAsync("absent@example.com", wrong, "curta", default));
        Assert.Equal((absent.Code, absent.Status), (existing.Code, existing.Status));
    }

    [Fact]
    public async Task Login_rehashes_older_identity_hashes_with_the_increased_work_factor()
    {
        var session = await SignedUpAsync();
        using (var db = NewDb())
        {
            var account = await db.Accounts.SingleAsync();
            account.PasswordHash = new PasswordHasher<Account>(Options.Create(new PasswordHasherOptions { IterationCount = 100_000 })).HashPassword(account, Password);
            await db.SaveChangesAsync();
        }
        using (var db = NewDb()) await Service(db).LoginAsync("ana", Password, null, default);
        using var check = NewDb();
        var upgraded = Convert.FromBase64String((await check.Accounts.SingleAsync()).PasswordHash);
        Assert.Equal(220_000u, BinaryPrimitives.ReadUInt32BigEndian(upgraded.AsSpan(5, 4)));
    }

    [Fact]
    public async Task Duplicate_registration_notices_have_a_shared_account_cooldown()
    {
        await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        await service.RegisterAsync("ana@example.com", "another_name", Password, null, null, default);
        await service.RegisterAsync("ANA@example.com", "different_name", Password, null, null, default);
        Assert.Equal(2, _email.Sent.Count);
    }

    [Fact]
    public async Task Changing_a_password_invalidates_outstanding_recovery_codes()
    {
        var session = await SignedUpAsync();
        using var db = NewDb();
        var service = Service(db);
        await service.ForgotPasswordAsync("ana", default);
        var oldCode = _email.LastCode("ana@example.com");
        var changed = await service.ChangePasswordAsync(session.Account.Id, Password, "outra-senha-segura-27", null, default);
        Assert.Equal("invalid_code", (await FailureAsync(() => service.ResetPasswordAsync("ana", oldCode, Password, default))).Code);
        Assert.True(await service.IsSessionActiveAsync(Principal(changed), default));
    }

    [Fact]
    public async Task Mailbox_verification_uses_the_owners_password_after_an_attacker_preregisters_the_email()
    {
        const string attackerPassword = "senha-do-invasor-473";
        using var db = NewDb();
        var service = Service(db);
        await service.RegisterAsync("ana@example.com", "pending_user", attackerPassword, null, null, default);
        var result = await service.RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        Assert.True(result.VerificationRequired);
        var code = _email.LastCode("ana@example.com");
        var owner = await service.VerifyEmailAsync("ana@example.com", code, Password, null, default);
        Assert.Equal("invalid_credentials", (await FailureAsync(() => service.LoginAsync("ana@example.com", attackerPassword, null, default))).Code);
        Assert.NotNull(await service.LoginAsync("ana@example.com", Password, null, default));
        Assert.True(await service.IsSessionActiveAsync(Principal(owner), default));
        Assert.Equal("invalid_code", (await FailureAsync(() => service.VerifyEmailAsync("ana@example.com", code, attackerPassword, null, default))).Code);
        Assert.NotNull(await service.LoginAsync("ana@example.com", Password, null, default));
    }

    [Fact]
    public async Task Pending_registration_recovery_needs_a_valid_email_code_and_invalidates_verification()
    {
        using var db = NewDb();
        var service = Service(db);
        await service.RegisterAsync("ana@example.com", "ana", Password, null, null, default);
        var verification = _email.LastCode("ana@example.com");
        await service.ForgotPasswordAsync("ana@example.com", default);
        var reset = _email.LastCode("ana@example.com");
        var wrong = reset == "000000" ? "111111" : "000000";
        Assert.Equal("invalid_code", (await FailureAsync(() => service.ResetPasswordAsync("ana", wrong, "outra-senha-segura-27", default))).Code);
        Assert.False((await db.Accounts.SingleAsync()).EmailVerified);
        await service.ResetPasswordAsync("ana", reset, "outra-senha-segura-27", default);
        Assert.True((await db.Accounts.SingleAsync()).EmailVerified);
        Assert.Equal("invalid_code", (await FailureAsync(() => service.VerifyEmailAsync("ana", verification, Password, null, default))).Code);
        Assert.NotNull(await service.LoginAsync("ana", "outra-senha-segura-27", null, default));
    }
}
