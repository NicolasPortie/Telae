using System.Net;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;

namespace Telae.Server.Core;

public sealed class ClientAddressConfiguration
{
    // Sem proxies explícitos, nenhum cabeçalho encaminhado é aceito.
    public string[] KnownProxies { get; set; } = [];
    public string HeaderName { get; set; } = "CF-Connecting-IP";
}

public sealed class ClientAddressValidator : IValidateOptions<ClientAddressConfiguration>
{
    public ValidateOptionsResult Validate(string? name, ClientAddressConfiguration options)
    {
        if (options.HeaderName is not ("CF-Connecting-IP" or "X-Forwarded-For"))
            return ValidateOptionsResult.Fail("ClientAddress:HeaderName must be CF-Connecting-IP or X-Forwarded-For.");
        if (options.KnownProxies is null || options.KnownProxies.Length > 16 ||
            options.KnownProxies.Any(value => !IPAddress.TryParse(value, out var address) ||
                address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any) ||
                address.Equals(IPAddress.None) || address.MapToIPv6().Equals(IPAddress.Any.MapToIPv6())))
            return ValidateOptionsResult.Fail("ClientAddress:KnownProxies must contain at most 16 explicit proxy IP addresses; wildcards and networks are forbidden.");
        return ValidateOptionsResult.Success;
    }
}

public static class TrustedClientAddress
{
    public static IServiceCollection AddTrustedClientAddress(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IValidateOptions<ClientAddressConfiguration>, ClientAddressValidator>();
        services.AddOptions<ClientAddressConfiguration>().Bind(configuration.GetSection("ClientAddress")).ValidateOnStart();
        services.AddOptions<ForwardedHeadersOptions>().Configure<IOptions<ClientAddressConfiguration>>((options, configured) =>
        {
            var settings = configured.Value;
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();
            options.ForwardLimit = 1;
            options.ForwardedForHeaderName = settings.HeaderName;
            // Só o proxy autorizado pode informar o IP e o esquema externos.
            options.ForwardedHeaders = settings.KnownProxies.Length == 0
                ? ForwardedHeaders.None : ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            foreach (var proxy in settings.KnownProxies)
                options.KnownProxies.Add(IPAddress.Parse(proxy));
        });
        return services;
    }
}
