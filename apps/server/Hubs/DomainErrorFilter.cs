using Microsoft.AspNetCore.SignalR;
using Telae.Server.Core;

namespace Telae.Server.Hubs;

/// <summary>
/// Converte erros de domínio em HubException para que o cliente receba o
/// motivo específico (ex.: convite expirado). Sem isso, fora de Development o
/// SignalR entrega apenas "An unexpected error occurred".
/// </summary>
public sealed class DomainErrorFilter : IHubFilter
{
    public async ValueTask<object?> InvokeMethodAsync(
        HubInvocationContext invocationContext,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        try
        {
            return await next(invocationContext);
        }
        catch (TelaeDomainException exception)
        {
            throw new HubException(exception.Message);
        }
    }
}
