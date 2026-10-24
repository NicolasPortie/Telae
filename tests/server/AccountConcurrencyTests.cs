using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Telae.Server.Accounts;

namespace Telae.Server.Tests;

public sealed class AccountConcurrencyTests : IDisposable
{
    private const string Password = "uma-senha-bem-longa-42";
    private readonly string _path = Path.Combine(Path.GetTempPath(), "telae-account-race-" + Guid.NewGuid().ToString("N") + ".db");
    private readonly FakeClock _clock = new();
    private readonly CapturingEmail _email = new();
    private readonly AuthOptions _options = new() { JwtKey = new string('k', 48) };

    public AccountConcurrencyTests()
    {
        using var db = NewDb();
        db.Database.EnsureCreated();
    }

    private TelaeDbContext NewDb() => new(new DbContextOptionsBuilder<TelaeDbContext>()
        .UseSqlite($"Data Source={_path};Pooling=False").Options);

    private AccountService Service(TelaeDbContext db) => new(db, new TokenService(Options.Create(_options), _clock),
        _email, Options.Create(_options), _clock);

    public void Dispose()
    {
        File.Delete(_path);
    }

    private async Task RegisterAsync()
    {
        using var db = NewDb();
        await Service(db).RegisterAsync("ana@example.com", "ana", Password, null, null, default);
    }

    [Fact]
    public async Task Parallel_verification_consumes_a_code_once()
    {
        await RegisterAsync();
        var code = _email.LastCode("ana@example.com");
        var attempts = await Task.WhenAll(Enumerable.Range(0, 8).Select(index => Task.Run(async () =>
        {
            using var db = NewDb();
            try
            {
                await Service(db).VerifyEmailAsync(index % 2 == 0 ? "ana" : "ana@example.com", code, Password, null, default);
                return true;
            }
            catch (AccountException error) when (error.Code == "invalid_code") { return false; }
        })));
        Assert.Equal(1, attempts.Count(success => success));
        using var check = NewDb();
        Assert.Equal(1, await check.RefreshTokens.CountAsync());
    }

    [Fact]
    public async Task Parallel_wrong_codes_cannot_lose_attempts_or_exceed_the_account_limit()
    {
        await RegisterAsync();
        var code = _email.LastCode("ana@example.com");
        var wrong = code == "000000" ? "111111" : "000000";
        await Task.WhenAll(Enumerable.Range(0, 12).Select(index => Task.Run(async () =>
        {
            using var db = NewDb();
            var error = await Assert.ThrowsAsync<AccountException>(() =>
                Service(db).VerifyEmailAsync(index % 2 == 0 ? "ana" : "ana@example.com", wrong, Password, null, default));
            Assert.Equal("invalid_code", error.Code);
        })));
        using var check = NewDb();
        Assert.Equal(_options.MaxCodeAttempts, (await check.OneTimeCodes.SingleAsync()).Attempts);
        Assert.Equal("invalid_code", (await Assert.ThrowsAsync<AccountException>(() =>
            Service(check).VerifyEmailAsync("ana", code, Password, null, default))).Code);
    }

    [Fact]
    public async Task Parallel_resends_share_the_daily_issuance_budget_across_scopes_and_identifiers()
    {
        _options.MaxCodesPerDay = 2;
        await RegisterAsync();
        _clock.Advance(TimeSpan.FromSeconds(61));
        await Task.WhenAll(Enumerable.Range(0, 8).Select(index => Task.Run(async () =>
        {
            using var db = NewDb();
            await Service(db).ResendVerificationAsync(index % 2 == 0 ? "ana" : "ana@example.com", default);
        })));
        _clock.Advance(TimeSpan.FromSeconds(61));
        using var check = NewDb();
        await Service(check).ResendVerificationAsync("ana", default);
        Assert.Equal(2, await check.OneTimeCodes.CountAsync());
    }

    [Fact]
    public async Task Parallel_failures_cannot_exceed_the_daily_failed_code_budget()
    {
        _options.MaxFailedCodeAttemptsPerDay = 3;
        await RegisterAsync();
        var code = _email.LastCode("ana@example.com");
        var wrong = code == "000000" ? "111111" : "000000";
        await Task.WhenAll(Enumerable.Range(0, 8).Select(index => Task.Run(async () =>
        {
            using var db = NewDb();
            Assert.Equal("invalid_code", (await Assert.ThrowsAsync<AccountException>(() =>
                Service(db).VerifyEmailAsync(index % 2 == 0 ? "ana" : "ana@example.com", wrong, Password, null, default))).Code);
        })));
        using var check = NewDb();
        Assert.Equal(3, await check.FailedCodeAttempts.CountAsync());
        Assert.Equal(3, (await check.OneTimeCodes.SingleAsync()).Attempts);
    }

    [Fact]
    public async Task Parallel_refresh_replay_cannot_create_two_active_successors()
    {
        await RegisterAsync();
        AuthResult session;
        using (var db = NewDb())
            session = await Service(db).VerifyEmailAsync("ana", _email.LastCode("ana@example.com"), Password, null, default);
        var results = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Task.Run(async () =>
        {
            using var db = NewDb();
            try { return await Service(db).RefreshAsync(session.RefreshToken, null, default); }
            catch (AccountException error) when (error.Code == "invalid_session") { return null; }
        })));
        Assert.Single(results, result => result is not null);
        using var check = NewDb();
        Assert.Equal(2, await check.RefreshTokens.CountAsync());
        Assert.False(await check.RefreshTokens.AnyAsync(t => t.RevokedAt == null));
    }

    [Fact]
    public async Task Parallel_login_failures_throttle_the_same_pair_across_both_identifiers()
    {
        await RegisterAsync();
        using (var db = NewDb())
            await Service(db).VerifyEmailAsync("ana", _email.LastCode("ana@example.com"), Password, null, default);
        await Task.WhenAll(Enumerable.Range(0, 10).Select(index => Task.Run(async () =>
        {
            using var db = NewDb();
            Assert.Equal("invalid_credentials", (await Assert.ThrowsAsync<AccountException>(() =>
                Service(db).LoginAsync(index % 2 == 0 ? "ana" : "ana@example.com", "senha-errada-42", null, default))).Code);
        })));
        using var check = NewDb();
        Assert.Equal(_options.MaxFailedLogins, await check.PasswordAttempts.CountAsync());
        Assert.Equal("invalid_credentials", (await Assert.ThrowsAsync<AccountException>(() =>
            Service(check).LoginAsync("ana", Password, null, default))).Code);
    }
}
