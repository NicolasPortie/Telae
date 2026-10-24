using Microsoft.AspNetCore.Builder;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Telae.Server.Accounts;

namespace Telae.Server.Tests;

public sealed class AccountsSetupSecurityTests
{
    [Fact]
    public void Legacy_devices_are_disabled_unless_explicitly_enabled()
    {
        Assert.False(new AuthOptions().AllowLegacyDevices);
        Assert.True(new AuthOptions { AllowLegacyDevices = true }.AllowLegacyDevices);
    }

    [Theory]
    [InlineData(nameof(AuthOptions.MaxCodesPerDay), 0)]
    [InlineData(nameof(AuthOptions.MaxCodesPerDay), 101)]
    [InlineData(nameof(AuthOptions.MaxFailedCodeAttemptsPerDay), 0)]
    [InlineData(nameof(AuthOptions.MaxFailedCodeAttemptsPerDay), 101)]
    [InlineData(nameof(AuthOptions.LoginBackoffSeconds), 0)]
    [InlineData(nameof(AuthOptions.LoginBackoffSeconds), 61)]
    [InlineData(nameof(AuthOptions.LoginFailureWindowMinutes), 0)]
    [InlineData(nameof(AuthOptions.LoginFailureWindowMinutes), 1441)]
    [InlineData(nameof(AuthOptions.MaxAccountFailedLogins), 49)]
    [InlineData(nameof(AuthOptions.MaxAccountFailedLogins), 1001)]
    public void Abuse_limits_must_be_bounded_and_global_ceiling_must_allow_independent_clients(string property, int value)
    {
        var options = new AuthOptions { JwtKey = new string('k', 48) };
        typeof(AuthOptions).GetProperty(property)!.SetValue(options, value);
        Assert.True(new AuthOptionsValidator().Validate(null, options).Failed);
    }

    [Fact]
    public void Default_abuse_limits_are_valid()
    {
        Assert.True(new AuthOptionsValidator().Validate(null, new AuthOptions { JwtKey = new string('k', 48) }).Succeeded);
    }

    [Fact]
    public void Production_without_postgres_fails_instead_of_opening_a_development_database()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Production" });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Telae"] = null });
        Assert.Throws<InvalidOperationException>(() => builder.Services.AddTelaeAccounts(builder.Configuration, builder.Environment));
    }

    [Theory]
    [InlineData("None")]
    [InlineData("Auto")]
    [InlineData("StartTlsWhenAvailable")]
    public void Production_smtp_cannot_disable_or_downgrade_encryption(string security)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Production" });
        var result = new SmtpOptionsValidator(builder.Environment).Validate(null, new SmtpOptions
        {
            Host = "mail.example.com", Security = security,
        });
        Assert.True(result.Failed);
    }

    [Fact]
    public async Task An_incompatible_development_database_is_preserved()
    {
        var root = Path.Combine(Path.GetTempPath(), "telae-schema-" + Guid.NewGuid().ToString("N"));
        var data = Path.Combine(root, "data");
        Directory.CreateDirectory(data);
        var database = Path.Combine(data, "telae-dev.db");
        try
        {
            using (var connection = new SqliteConnection($"Data Source={database};Pooling=False"))
            {
                await connection.OpenAsync();
                using var command = connection.CreateCommand();
                command.CommandText = "CREATE TABLE Accounts (Id TEXT PRIMARY KEY); INSERT INTO Accounts VALUES ('preserve-me');";
                await command.ExecuteNonQueryAsync();
            }
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing", ContentRootPath = root });
            builder.Services.AddTelaeAccounts(builder.Configuration, builder.Environment);
            await using (var app = builder.Build())
                await Assert.ThrowsAsync<InvalidOperationException>(() => app.Services.InitializeAccountsDatabaseAsync());
            using var check = new SqliteConnection($"Data Source={database};Pooling=False");
            await check.OpenAsync();
            using var query = check.CreateCommand();
            query.CommandText = "SELECT Id FROM Accounts";
            Assert.Equal("preserve-me", await query.ExecuteScalarAsync());
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            Directory.Delete(root, recursive: true);
        }
    }
}
