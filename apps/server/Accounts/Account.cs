namespace Telae.Server.Accounts;

/// <summary>Conta de usuário. O e-mail só é usado para entrar e recuperar a senha; nunca é exposto a outros usuários.</summary>
public sealed class Account
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    /// <summary>E-mail em minúsculas, usado para unicidade e busca.</summary>
    public string NormalizedEmail { get; set; } = "";
    public string Username { get; set; } = "";
    public string NormalizedUsername { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool EmailVerified { get; set; }
    public int FailedLoginCount { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
    /// <summary>Idioma preferido para os e-mails transacionais.</summary>
    public string Language { get; set; } = "pt-BR";

    public List<RefreshToken> RefreshTokens { get; set; } = [];
    public List<OneTimeCode> OneTimeCodes { get; set; } = [];
}

public sealed class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AccountId { get; set; }
    public Account? Account { get; set; }
    /// <summary>SHA-256 do token; o valor original só existe no cliente.</summary>
    public string TokenHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    /// <summary>Token que substituiu este na rotação; reutilizar um token já trocado revoga a família.</summary>
    public Guid? ReplacedById { get; set; }
    public string? UserAgent { get; set; }
}

public enum OneTimeCodePurpose { VerifyEmail = 1, ResetPassword = 2 }

/// <summary>Código numérico de uso único (verificação de e-mail ou redefinição de senha).</summary>
public sealed class OneTimeCode
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AccountId { get; set; }
    public Account? Account { get; set; }
    public OneTimeCodePurpose Purpose { get; set; }
    public string CodeHash { get; set; } = "";
    public int Attempts { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
}
