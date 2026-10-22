using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Telae.Server.Accounts;

public static class AccountsSetup
{
    /// <summary>
    /// Banco de contas: PostgreSQL quando há <c>ConnectionStrings:Telae</c>; sem ela, SQLite em arquivo
    /// (apenas desenvolvimento e testes). E-mail: SMTP quando <c>Smtp:Host</c> está definido, senão o código vai para o log.
    /// </summary>
    public static IServiceCollection AddTelaeAccounts(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.AddOptions<AuthOptions>().Bind(configuration.GetSection("Auth"));
        services.AddOptions<SmtpOptions>().Bind(configuration.GetSection("Smtp"));
        services.PostConfigure<AuthOptions>(auth =>
        {
            if (!string.IsNullOrWhiteSpace(auth.JwtKey)) return;
            if (!environment.IsDevelopment() && !environment.IsEnvironment("Testing"))
                throw new InvalidOperationException("Auth:JwtKey é obrigatória (mínimo de 32 caracteres). Defina a variável de ambiente Auth__JwtKey.");
            // Chave efêmera: os tokens deixam de valer a cada reinício. Só para desenvolvimento.
            auth.JwtKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        });
        services.AddSingleton<IValidateOptions<AuthOptions>, AuthOptionsValidator>();

        var postgres = configuration.GetConnectionString("Telae");
        services.AddDbContext<TelaeDbContext>(options =>
        {
            if (!string.IsNullOrWhiteSpace(postgres)) options.UseNpgsql(postgres);
            else
            {
                var directory = Path.Combine(environment.ContentRootPath, "data");
                Directory.CreateDirectory(directory);
                options.UseSqlite($"Data Source={Path.Combine(directory, "telae-dev.db")}");
            }
        });

        services.AddSingleton(TimeProvider.System);
        services.AddScoped<TokenService>();
        services.AddScoped<AccountService>();
        services.AddScoped<FriendsService>();
        services.AddHostedService<AccountMaintenance>();

        var smtp = configuration.GetSection("Smtp").Get<SmtpOptions>();
        if (!string.IsNullOrWhiteSpace(smtp?.Host)) services.AddSingleton<IEmailSender, SmtpEmailSender>();
        else services.AddSingleton<IEmailSender, LogEmailSender>();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<AuthOptions>>((jwt, auth) =>
            {
                jwt.MapInboundClaims = false;
                jwt.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = auth.Value.Issuer,
                    ValidAudience = auth.Value.Audience,
                    IssuerSigningKey = TokenService.SigningKey(auth.Value.JwtKey),
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = TokenService.UsernameClaim,
                };
                // O SignalR (WebSocket) envia o token na query string.
                jwt.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        var token = context.Request.Query["access_token"];
                        if (!string.IsNullOrEmpty(token) && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                            context.Token = token;
                        return Task.CompletedTask;
                    },
                };
            });
        services.AddAuthorization();
        return services;
    }

    /// <summary>PostgreSQL aplica as migrações; SQLite (desenvolvimento) cria o esquema direto.</summary>
    public static async Task InitializeAccountsDatabaseAsync(this IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TelaeDbContext>();
        if (db.Database.IsNpgsql())
        {
            await db.Database.MigrateAsync();
            return;
        }

        // SQLite é só para desenvolvimento e testes e não usa migrações: se o arquivo veio de uma versão
        // anterior (esquema diferente), ele é recriado em vez de falhar na primeira consulta.
        await db.Database.EnsureCreatedAsync();
        try
        {
            _ = await db.Accounts.AnyAsync();
            _ = await db.Friendships.AnyAsync();
            _ = await db.DismissedRequests.AnyAsync();
        }
        catch (Exception exception) when (exception is Microsoft.Data.Sqlite.SqliteException)
        {
            services.GetService<ILoggerFactory>()?.CreateLogger("Telae.Accounts")
                .LogWarning("Banco SQLite de desenvolvimento com esquema antigo; recriando.");
            await db.Database.EnsureDeletedAsync();
            await db.Database.EnsureCreatedAsync();
        }
    }
}

public sealed class AuthOptionsValidator : IValidateOptions<AuthOptions>
{
    public ValidateOptionsResult Validate(string? name, AuthOptions options) =>
        options.JwtKey.Length < 32
            ? ValidateOptionsResult.Fail("Auth:JwtKey precisa ter pelo menos 32 caracteres.")
            : ValidateOptionsResult.Success;
}

/// <summary>Limpeza diária de códigos, sessões expiradas e contas que nunca confirmaram o e-mail.</summary>
public sealed class AccountMaintenance(IServiceScopeFactory scopes, ILogger<AccountMaintenance> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(12));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var removed = await scope.ServiceProvider.GetRequiredService<AccountService>().PurgeExpiredAsync(stoppingToken);
                if (removed > 0) logger.LogInformation("Manutenção de contas removeu {Count} registros expirados.", removed);
            }
            catch (OperationCanceledException) { }
            catch (Exception exception)
            {
                logger.LogError(exception, "Falha na manutenção de contas.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
