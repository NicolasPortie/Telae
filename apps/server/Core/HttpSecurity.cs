using Microsoft.AspNetCore.Http.Features;

namespace Telae.Server.Core;

public static class HttpSecurity
{
    public static IServiceCollection AddTelaeCors(this IServiceCollection services)
    {
        services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy => policy
                .SetIsOriginAllowed(origin =>
                    origin.StartsWith("http://localhost:", StringComparison.OrdinalIgnoreCase) ||
                    origin.StartsWith("https://localhost:", StringComparison.OrdinalIgnoreCase) ||
                    origin.Equals("telae://app", StringComparison.Ordinal) ||
                    origin.StartsWith("file://", StringComparison.OrdinalIgnoreCase) ||
                    origin.Equals("null", StringComparison.OrdinalIgnoreCase))
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials());
        });
        return services;
    }

    public const long AuthBodyLimit = 16 * 1024;

    public static IApplicationBuilder UseTelaeHttpSecurity(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            var isAuth = context.Request.Path.StartsWithSegments("/auth");
            context.Response.OnStarting(() =>
            {
                context.Response.Headers.XContentTypeOptions = "nosniff";
                context.Response.Headers.XFrameOptions = "DENY";
                context.Response.Headers.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";
                context.Response.Headers["Referrer-Policy"] = "no-referrer";
                if (isAuth) context.Response.Headers.CacheControl = "no-store";
                return Task.CompletedTask;
            });

            if (isAuth)
            {
                // Limita o corpo antes da leitura do JSON, inclusive sem Content-Length.
                var bodyLimit = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
                if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = AuthBodyLimit;
                if (context.Request.ContentLength > AuthBodyLimit)
                {
                    context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                    await context.Response.WriteAsJsonAsync(new { code = "invalid_request" });
                    return;
                }
            }

            await next(context);
        });
}
