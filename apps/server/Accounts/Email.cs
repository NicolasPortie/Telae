using System.Threading.Channels;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Telae.Server.Accounts;

public sealed record EmailMessage(string To, string Subject, string TextBody, string HtmlBody);

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

/// <summary>Envio real por SMTP (MailKit). Configure <c>Smtp:*</c> por variáveis de ambiente.</summary>
public sealed class SmtpEmailSender(IOptions<SmtpOptions> options, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        var smtp = options.Value;
        var mime = new MimeMessage();
        mime.From.Add(MailboxAddress.Parse(smtp.From));
        mime.To.Add(MailboxAddress.Parse(message.To));
        mime.Subject = message.Subject;
        mime.Body = new BodyBuilder { TextBody = message.TextBody, HtmlBody = message.HtmlBody }.ToMessageBody();

        var security = Enum.TryParse<SecureSocketOptions>(smtp.Security, ignoreCase: true, out var parsed)
            ? parsed
            : SecureSocketOptions.StartTls;
        using var client = new SmtpClient { Timeout = 10_000 };
        await client.ConnectAsync(smtp.Host, smtp.Port, security, cancellationToken);
        if (!string.IsNullOrWhiteSpace(smtp.User))
            await client.AuthenticateAsync(smtp.User, smtp.Password, cancellationToken);
        await client.SendAsync(mime, cancellationToken);
        await client.DisconnectAsync(quit: true, cancellationToken);
        logger.LogInformation("E-mail transacional enviado.");
    }
}

public sealed class UnavailableEmailSender : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default) =>
        throw new AccountException("email_unavailable", 503);
}

/// <summary>Só para desenvolvimento sem SMTP: grava cada mensagem num arquivo local, fora dos logs.</summary>
public sealed class DevelopmentFileEmailSender(string directory) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, $"{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid():N}.txt");
        await File.WriteAllTextAsync(file, $"Para: {message.To}\nAssunto: {message.Subject}\n\n{message.TextBody}", cancellationToken);
    }
}

public sealed class QueuedEmailSender(SmtpEmailSender sender, ILogger<QueuedEmailSender> logger) : BackgroundService, IEmailSender
{
    private readonly Channel<EmailMessage> _messages = Channel.CreateBounded<EmailMessage>(new BoundedChannelOptions(256)
    {
        SingleReader = true,
        FullMode = BoundedChannelFullMode.Wait,
    });

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!_messages.Writer.TryWrite(message)) throw new AccountException("email_unavailable", 503);
        return Task.CompletedTask;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var message in _messages.Reader.ReadAllAsync(stoppingToken))
        {
            try { await sender.SendAsync(message, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception)
            {
                logger.LogWarning("Falha no envio de e-mail transacional.");
            }
        }
    }
}

public static class EmailTemplates
{
    public static EmailMessage VerifyEmail(string to, string username, string code, int minutes, string language) =>
        Build(to, language,
            pt: ("Seu código do Telaê", $"Oi, {username}!", "Esse é o código pra confirmar seu e-mail:", $"Vale por {minutes} minutos. Se não foi você, ignora este e-mail."),
            en: ("Your Telaê code", $"Hi {username}!", "Here is the code to confirm your email:", $"It's good for {minutes} minutes. If this wasn't you, just ignore this email."),
            code);

    public static EmailMessage ResetPassword(string to, string username, string code, int minutes, string language) =>
        Build(to, language,
            pt: ("Código pra trocar sua senha do Telaê", $"Oi, {username}.", "Use este código pra criar uma senha nova:", $"Vale por {minutes} minutos. Se você não pediu, ignora este e-mail: sua senha continua a mesma."),
            en: ("Code to reset your Telaê password", $"Hi {username}.", "Use this code to set a new password:", $"It's good for {minutes} minutes. If you didn't ask for it, ignore this email: your password stays the same."),
            code);

    public static EmailMessage AlreadyRegistered(string to, string language) =>
        Build(to, language,
            pt: ("Você já tem conta no Telaê", "Oi!", "Alguém tentou criar uma conta com este e-mail, mas ele já tem uma. Entra normalmente no app ou usa \"Esqueci minha senha\".", "Se não foi você, não precisa fazer nada."),
            en: ("You already have a Telaê account", "Hi!", "Someone tried to create an account with this email, but it is already registered. Sign in normally in the app or use \"Forgot password\".", "If this wasn't you, no action is needed."),
            code: null);

    private static EmailMessage Build(string to, string language,
        (string Subject, string Greeting, string Lead, string Footer) pt,
        (string Subject, string Greeting, string Lead, string Footer) en, string? code)
    {
        var text = language.StartsWith("en", StringComparison.OrdinalIgnoreCase) ? en : pt;
        var plain = $"{text.Greeting}\n\n{text.Lead}\n{(code is null ? "" : $"\n    {code}\n")}\n{text.Footer}\n\nTelaê";
        var codeBlock = code is null ? "" : $"<p style=\"font:600 32px ui-monospace,Consolas,monospace;letter-spacing:.3em;margin:24px 0;color:#111\">{code}</p>";
        var html = $"""
            <div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#222;max-width:480px;margin:auto;padding:24px">
              <p style="font-weight:600;font-size:18px;margin:0 0 16px">Telaê</p>
              <p>{System.Net.WebUtility.HtmlEncode(text.Greeting)}</p>
              <p>{System.Net.WebUtility.HtmlEncode(text.Lead)}</p>
              {codeBlock}
              <p style="color:#666;font-size:13px">{System.Net.WebUtility.HtmlEncode(text.Footer)}</p>
            </div>
            """;
        return new EmailMessage(to, text.Subject, plain, html);
    }
}
