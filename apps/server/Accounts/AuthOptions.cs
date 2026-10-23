namespace Telae.Server.Accounts;

public sealed class AuthOptions
{
    /// <summary>Chave de assinatura dos tokens de acesso (mínimo de 32 caracteres). Obrigatória em produção.</summary>
    public string JwtKey { get; set; } = "";
    public string Issuer { get; set; } = "telae";
    public string Audience { get; set; } = "telae-desktop";
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 30;
    public int CodeMinutes { get; set; } = 15;
    public int MaxCodeAttempts { get; set; } = 5;
    public int MaxFailedLogins { get; set; } = 5;
    /// <summary>Limites por endereço IP e por minuto: cadastro, reenvio de código e recuperação de senha (rígido) e demais chamadas de conta.</summary>
    public int StrictRequestsPerMinute { get; set; } = 6;
    public int RequestsPerMinute { get; set; } = 30;
    public int LockoutMinutes { get; set; } = 15;
    /// <summary>Aceita clientes anteriores à 0.2 que se identificam só pela credencial do dispositivo.</summary>
    public bool AllowLegacyDevices { get; set; } = true;
    /// <summary>
    /// Quando falso, só quem está em <see cref="AllowedEmails"/> consegue criar conta (convite por e-mail).
    /// O servidor público do projeto roda fechado: quem não foi liberado não tem como entrar.
    /// </summary>
    public bool RegistrationOpen { get; set; } = true;
    /// <summary>E-mails liberados para criar conta com o cadastro fechado, separados por vírgula, ponto e vírgula ou espaço.</summary>
    public string AllowedEmails { get; set; } = "";
    /// <summary>Exige confirmar o e-mail com um código antes do primeiro acesso. Só desative em testes automatizados.</summary>
    public bool RequireEmailVerification { get; set; } = true;
}

public static class AuthOptionsExtensions
{
    /// <summary>Cadastro aberto, ou e-mail (já normalizado em minúsculas) presente na lista de liberados.</summary>
    public static bool IsRegistrationAllowed(this AuthOptions options, string normalizedEmail) =>
        options.RegistrationOpen ||
        options.AllowedEmails.Split([',', ';', ' ', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Contains(normalizedEmail, StringComparer.OrdinalIgnoreCase);
}

public sealed class SmtpOptions
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    /// <summary>Endereço remetente, por exemplo "Telae &lt;nao-responda@seudominio.com&gt;".</summary>
    public string From { get; set; } = "";
    /// <summary>StartTls (587), SslOnConnect (465) ou None (apenas em desenvolvimento).</summary>
    public string Security { get; set; } = "StartTls";
}
