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
    /// (apenas desenvolvimento e testes). E-mail: SMTP quando <c>Smtp:Host</c> está definido; sem ele, o envio fica indisponível.
    /// </summary>
    public static IServiceCollection AddTelaeAccounts(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.AddOptions<AuthOptions>().Bind(configuration.GetSection("Auth")).ValidateOnStart();
        services.AddOptions<SmtpOptions>().Bind(configuration.GetSection("Smtp")).ValidateOnStart();
        services.AddSingleton<IValidateOptions<SmtpOptions>>(new SmtpOptionsValidator(environment));
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
        if (string.IsNullOrWhiteSpace(postgres) && !environment.IsDevelopment() && !environment.IsEnvironment("Testing"))
            throw new InvalidOperationException("ConnectionStrings:Telae é obrigatória em produção. Configure o PostgreSQL.");
        services.AddDbContext<TelaeDbContext>(options =>
        {
            if (!string.IsNullOrWhiteSpace(postgres)) options.UseNpgsql(postgres);
            else
            {
                // Testes automatizados apontam para um arquivo próprio e descartável (Accounts:DevelopmentDatabase).
                var file = configuration["Accounts:DevelopmentDatabase"];
                if (string.IsNullOrWhiteSpace(file))
                {
                    var directory = Path.Combine(environment.ContentRootPath, "data");
                    Directory.CreateDirectory(directory);
                    file = Path.Combine(directory, "telae-dev.db");
                }
                options.UseSqlite($"Data Source={file}");
            }
        });

        services.AddSingleton(TimeProvider.System);
        services.AddScoped<TokenService>();
        services.AddScoped<AccountService>();
        services.AddScoped<FriendsService>();
        services.AddHostedService<AccountMaintenance>();

        var smtp = configuration.GetSection("Smtp").Get<SmtpOptions>();
        if (!string.IsNullOrWhiteSpace(smtp?.Host))
        {
            services.AddSingleton<SmtpEmailSender>();
            services.AddSingleton<QueuedEmailSender>();
            services.AddSingleton<IEmailSender>(provider => provider.GetRequiredService<QueuedEmailSender>());
            services.AddHostedService(provider => provider.GetRequiredService<QueuedEmailSender>());
        }
        // Sem SMTP em desenvolvimento, as mensagens vão para arquivos em data/dev-mail (nunca para o log).
        else if (environment.IsDevelopment())
            services.AddSingleton<IEmailSender>(new DevelopmentFileEmailSender(Path.Combine(environment.ContentRootPath, "data", "dev-mail")));
        else services.AddSingleton<IEmailSender, UnavailableEmailSender>();

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
                    ClockSkew = TimeSpan.Zero,
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    NameClaimType = TokenService.UsernameClaim,
                };
                // O SignalR (WebSocket) envia o token na query string.
                jwt.Events = new JwtBearerEvents
                {
                    OnTokenValidated = async context =>
                    {
                        var accounts = context.HttpContext.RequestServices.GetRequiredService<AccountService>();
                        if (context.Principal is null || !await accounts.IsSessionActiveAsync(context.Principal, context.HttpContext.RequestAborted))
                            context.Fail("invalid_session");
                    },
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

        // Banco antigo deve ser atualizado ou removido explicitamente.
        await db.Database.EnsureCreatedAsync();
        try
        {
            _ = await db.Accounts.AnyAsync();
            _ = await db.FailedCodeAttempts.AnyAsync();
            _ = await db.PasswordAttempts.AnyAsync();
            _ = await db.Friendships.AnyAsync();
            _ = await db.DismissedRequests.AnyAsync();
            _ = await db.RefreshTokens.Select(token => token.SessionId).FirstOrDefaultAsync();
        }
        catch (Exception exception) when (exception is Microsoft.Data.Sqlite.SqliteException)
        {
            throw new InvalidOperationException("Não foi possível abrir o banco de desenvolvimento. Confira o esquema e preserve os dados antes de recriá-lo.");
        }
    }
}

public sealed class SmtpOptionsValidator(IHostEnvironment environment) : IValidateOptions<SmtpOptions>
{
    public ValidateOptionsResult Validate(string? name, SmtpOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.Host)) return ValidateOptionsResult.Success;
        if (options.Port is < 1 or > 65535) return ValidateOptionsResult.Fail("Smtp:Port precisa ser uma porta válida.");
        if (!environment.IsDevelopment() && !environment.IsEnvironment("Testing") &&
            !options.Security.Equals("StartTls", StringComparison.OrdinalIgnoreCase) &&
            !options.Security.Equals("SslOnConnect", StringComparison.OrdinalIgnoreCase))
            return ValidateOptionsResult.Fail("Smtp:Security precisa exigir uma conexão segura em produção.");
        return ValidateOptionsResult.Success;
    }
}

public sealed class AuthOptionsValidator(IHostEnvironment? environment = null) : IValidateOptions<AuthOptions>
{
    public ValidateOptionsResult Validate(string? name, AuthOptions options)
    {
        var strictMaximum = environment is not null && (environment.IsDevelopment() || environment.IsEnvironment("Testing")) ? 10_000 : 60;
        if (string.IsNullOrWhiteSpace(options.JwtKey) || options.JwtKey.Length < 32)
            return ValidateOptionsResult.Fail("Auth:JwtKey precisa ter pelo menos 32 caracteres.");
        if (string.IsNullOrWhiteSpace(options.Issuer) || string.IsNullOrWhiteSpace(options.Audience) ||
            options.AccessTokenMinutes is < 1 or > 60 || options.RefreshTokenDays is < 1 or > 90 ||
            options.CodeMinutes is < 1 or > 15 || options.MaxCodeAttempts is < 1 or > 10 ||
            options.MaxCodesPerDay is < 1 or > 100 || options.MaxFailedCodeAttemptsPerDay is < 1 or > 100 ||
            options.MaxFailedLogins is < 1 or > 20 || options.LockoutMinutes is < 1 or > 60 ||
            options.LoginBackoffSeconds is < 1 or > 60 || options.LoginBackoffSeconds > options.LockoutMinutes * 60 ||
            options.LoginFailureWindowMinutes is < 1 or > 1440 ||
            options.MaxAccountFailedLogins < options.MaxFailedLogins * 10 || options.MaxAccountFailedLogins > 1000 ||
            options.StrictRequestsPerMinute < 1 || options.StrictRequestsPerMinute > strictMaximum || options.RequestsPerMinute is < 1 or > 10_000)
            return ValidateOptionsResult.Fail("Auth: os prazos e limites precisam estar dentro dos valores permitidos.");
        return ValidateOptionsResult.Success;
    }
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
            catch (Exception)
            {
                logger.LogError("Falha na manutenção de contas.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
