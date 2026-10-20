using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Telae.Server.Accounts;

public sealed record RegisterRequest(string Email, string Username, string Password, string? Language);
public sealed record LoginRequest(string Identifier, string Password);
public sealed record VerifyRequest(string Identifier, string Code);
public sealed record IdentifierRequest(string Identifier);
public sealed record ResetRequest(string Identifier, string Code, string NewPassword);
public sealed record RefreshRequest(string RefreshToken);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public sealed record DisplayNameRequest(string DisplayName);
public sealed record PasswordConfirmRequest(string Password);

public static class AuthEndpoints
{
    private const string Strict = "auth-strict";
    private const string Standard = "auth";

    public static IServiceCollection AddAuthRateLimits(this IServiceCollection services) =>
        services.AddRateLimiter(limiter =>
        {
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            // Ações que enviam e-mail ou criam contas: poucas por minuto por endereço.
            limiter.AddPolicy(Strict, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 6, Window = TimeSpan.FromMinutes(1) }));
            limiter.AddPolicy(Standard, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
            limiter.OnRejected = async (context, token) =>
            {
                context.HttpContext.Response.ContentType = "application/json";
                await context.HttpContext.Response.WriteAsync("{\"code\":\"rate_limited\"}", token);
            };
        });

    public static void MapAuth(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/auth");

        auth.MapPost("/register", (RegisterRequest request, AccountService accounts, HttpContext http, CancellationToken ct) =>
            Run(async () =>
            {
                var result = await accounts.RegisterAsync(request.Email, request.Username, request.Password, request.Language, UserAgent(http), ct);
                return Results.Ok(new { verificationRequired = result.VerificationRequired, session = result.Session });
            })).RequireRateLimiting(Strict);

        auth.MapPost("/verify-email", (VerifyRequest request, AccountService accounts, HttpContext http, CancellationToken ct) =>
            Run(async () => Results.Ok(await accounts.VerifyEmailAsync(request.Identifier, request.Code, UserAgent(http), ct))))
            .RequireRateLimiting(Standard);

        auth.MapPost("/resend-verification", (IdentifierRequest request, AccountService accounts, CancellationToken ct) =>
            Run(async () => { await accounts.ResendVerificationAsync(request.Identifier, ct); return Results.NoContent(); }))
            .RequireRateLimiting(Strict);

        auth.MapPost("/login", (LoginRequest request, AccountService accounts, HttpContext http, CancellationToken ct) =>
            Run(async () => Results.Ok(await accounts.LoginAsync(request.Identifier, request.Password, UserAgent(http), ct))))
            .RequireRateLimiting(Standard);

        auth.MapPost("/refresh", (RefreshRequest request, AccountService accounts, HttpContext http, CancellationToken ct) =>
            Run(async () => Results.Ok(await accounts.RefreshAsync(request.RefreshToken, UserAgent(http), ct))))
            .RequireRateLimiting(Standard);

        auth.MapPost("/logout", (RefreshRequest request, AccountService accounts, CancellationToken ct) =>
            Run(async () => { await accounts.LogoutAsync(request.RefreshToken, ct); return Results.NoContent(); }))
            .RequireRateLimiting(Standard);

        auth.MapPost("/forgot-password", (IdentifierRequest request, AccountService accounts, CancellationToken ct) =>
            Run(async () => { await accounts.ForgotPasswordAsync(request.Identifier, ct); return Results.NoContent(); }))
            .RequireRateLimiting(Strict);

        auth.MapPost("/reset-password", (ResetRequest request, AccountService accounts, CancellationToken ct) =>
            Run(async () => { await accounts.ResetPasswordAsync(request.Identifier, request.Code, request.NewPassword, ct); return Results.NoContent(); }))
            .RequireRateLimiting(Standard);

        var signedIn = auth.MapGroup("").RequireAuthorization().RequireRateLimiting(Standard);

        signedIn.MapGet("/me", (ClaimsPrincipal user, AccountService accounts, CancellationToken ct) =>
            Run(async () => Results.Ok(await accounts.GetProfileAsync(AccountId(user), ct))));

        signedIn.MapPatch("/me", (DisplayNameRequest request, ClaimsPrincipal user, AccountService accounts, CancellationToken ct) =>
            Run(async () => Results.Ok(await accounts.UpdateDisplayNameAsync(AccountId(user), request.DisplayName, ct))));

        signedIn.MapPost("/change-password", (ChangePasswordRequest request, ClaimsPrincipal user, AccountService accounts, HttpContext http, CancellationToken ct) =>
            Run(async () => Results.Ok(await accounts.ChangePasswordAsync(AccountId(user), request.CurrentPassword, request.NewPassword, UserAgent(http), ct))));

        signedIn.MapPost("/delete-account", (PasswordConfirmRequest request, ClaimsPrincipal user, AccountService accounts, CancellationToken ct) =>
            Run(async () => { await accounts.DeleteAsync(AccountId(user), request.Password, ct); return Results.NoContent(); }));
    }

    internal static Guid AccountId(ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue(TokenService.AccountIdClaim), out var id) ? id : throw new AccountException("invalid_session", 401);

    private static string? UserAgent(HttpContext http) => http.Request.Headers.UserAgent.ToString() is { Length: > 0 } agent ? agent : null;

    private static async Task<IResult> Run(Func<Task<IResult>> action)
    {
        try { return await action(); }
        catch (AccountException exception) { return Results.Json(new { code = exception.Code }, statusCode: exception.Status); }
    }
}
