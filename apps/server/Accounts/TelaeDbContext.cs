using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Telae.Server.Accounts;

public sealed class TelaeDbContext(DbContextOptions<TelaeDbContext> options) : DbContext(options)
{
    public DbSet<FailedCodeAttempt> FailedCodeAttempts => Set<FailedCodeAttempt>();
    public DbSet<PasswordAttempt> PasswordAttempts => Set<PasswordAttempt>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<OneTimeCode> OneTimeCodes => Set<OneTimeCode>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<DismissedRequest> DismissedRequests => Set<DismissedRequest>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configuration)
    {
        // O SQLite (desenvolvimento e testes) não compara DateTimeOffset; o PostgreSQL usa timestamptz nativo.
        if (Database.IsSqlite()) configuration.Properties<DateTimeOffset>().HaveConversion<DateTimeOffsetToBinaryConverter>();
    }

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Account>(account =>
        {
            account.HasIndex(a => a.NormalizedEmail).IsUnique();
            account.HasIndex(a => a.NormalizedUsername).IsUnique();
            account.Property(a => a.Email).HasMaxLength(254);
            account.Property(a => a.NormalizedEmail).HasMaxLength(254);
            account.Property(a => a.Username).HasMaxLength(20);
            account.Property(a => a.NormalizedUsername).HasMaxLength(20);
            account.Property(a => a.DisplayName).HasMaxLength(32);
            account.Property(a => a.PasswordHash).HasMaxLength(512);
            account.Property(a => a.Language).HasMaxLength(8);
        });

        model.Entity<RefreshToken>(token =>
        {
            token.HasIndex(t => t.TokenHash).IsUnique();
            token.HasIndex(t => t.AccountId);
            token.HasIndex(t => t.SessionId);
            token.Property(t => t.TokenHash).HasMaxLength(64);
            token.Property(t => t.UserAgent).HasMaxLength(256);
            token.HasOne(t => t.Account).WithMany(a => a.RefreshTokens).HasForeignKey(t => t.AccountId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<Friendship>(friendship =>
        {
            friendship.HasKey(f => new { f.AccountId, f.FriendId });
            friendship.HasIndex(f => f.FriendId);
            friendship.HasOne(f => f.Account).WithMany().HasForeignKey(f => f.AccountId).OnDelete(DeleteBehavior.Cascade);
            friendship.HasOne(f => f.Friend).WithMany().HasForeignKey(f => f.FriendId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<DismissedRequest>(dismissed =>
        {
            dismissed.HasKey(d => new { d.AccountId, d.FromId });
            dismissed.HasOne(d => d.Account).WithMany().HasForeignKey(d => d.AccountId).OnDelete(DeleteBehavior.Cascade);
            dismissed.HasOne(d => d.From).WithMany().HasForeignKey(d => d.FromId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<FailedCodeAttempt>(attempt =>
        {
            attempt.HasIndex(a => new { a.AccountId, a.Purpose, a.CreatedAt });
            attempt.HasOne<Account>().WithMany().HasForeignKey(a => a.AccountId).OnDelete(DeleteBehavior.Cascade);
        });
        model.Entity<PasswordAttempt>(attempt =>
        {
            attempt.HasIndex(a => new { a.AccountId, a.CreatedAt });
            attempt.Property(a => a.ClientAddressHash).HasMaxLength(64);
            attempt.HasOne<Account>().WithMany().HasForeignKey(a => a.AccountId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<OneTimeCode>(code =>
        {
            code.HasIndex(c => new { c.AccountId, c.Purpose });
            code.Property(c => c.CodeHash).HasMaxLength(64);
            code.HasOne(c => c.Account).WithMany(a => a.OneTimeCodes).HasForeignKey(c => c.AccountId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
