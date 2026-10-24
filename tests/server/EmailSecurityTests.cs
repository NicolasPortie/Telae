using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Telae.Server.Accounts;

namespace Telae.Server.Tests;

public sealed class EmailSecurityTests
{
    [Fact]
    public async Task Missing_smtp_never_exposes_a_code_through_a_log_delivery_fallback()
    {
        var sender = new UnavailableEmailSender();
        var error = await Assert.ThrowsAsync<AccountException>(() => sender.SendAsync(
            EmailTemplates.ResetPassword("private@example.com", "ana", "123456", 15, "pt-BR")));
        Assert.Equal("email_unavailable", error.Code);
    }

    [Fact]
    public async Task Development_delivery_writes_to_a_local_file_instead_of_the_log()
    {
        var directory = Path.Combine(Path.GetTempPath(), "telae-dev-mail-" + Guid.NewGuid().ToString("N"));
        try
        {
            await new DevelopmentFileEmailSender(directory).SendAsync(EmailTemplates.VerifyEmail("ana@example.com", "ana", "123456", 15, "pt-BR"));
            var file = Assert.Single(Directory.GetFiles(directory));
            Assert.Contains("123456", await File.ReadAllTextAsync(file));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public async Task Delivery_is_queued_without_contacting_smtp_and_the_queue_is_bounded()
    {
        var smtp = new SmtpEmailSender(Options.Create(new SmtpOptions()), NullLogger<SmtpEmailSender>.Instance);
        using var sender = new QueuedEmailSender(smtp, NullLogger<QueuedEmailSender>.Instance);
        var message = EmailTemplates.VerifyEmail("private@example.com", "ana", "123456", 15, "pt-BR");
        for (var index = 0; index < 256; index++) await sender.SendAsync(message);
        Assert.Equal("email_unavailable", (await Assert.ThrowsAsync<AccountException>(() => sender.SendAsync(message))).Code);
    }

    [Theory]
    [InlineData(0, 15, 5)]
    [InlineData(61, 15, 5)]
    [InlineData(15, 16, 5)]
    [InlineData(15, 15, 11)]
    public void Unsafe_token_or_code_limits_fail_validation(int accessMinutes, int codeMinutes, int attempts)
    {
        var options = new AuthOptions
        {
            JwtKey = new string('k', 48), AccessTokenMinutes = accessMinutes, CodeMinutes = codeMinutes, MaxCodeAttempts = attempts,
        };
        Assert.True(new AuthOptionsValidator().Validate(null, options).Failed);
    }
}
