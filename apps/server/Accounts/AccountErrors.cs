namespace Telae.Server.Accounts;

/// <summary>Erro previsível de conta: <see cref="Code"/> é estável e o cliente o traduz para o usuário.</summary>
public sealed class AccountException(string code, int status = 400) : Exception(code)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
}
