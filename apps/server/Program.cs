using Microsoft.AspNetCore.SignalR;
using Telae.Server.Core;
using Telae.Server.Hubs;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
    options.AddFilter(typeof(DomainErrorFilter));
});

builder.Services.Configure<IceConfiguration>(builder.Configuration.GetSection("Ice"));
builder.Services.Configure<TurnConfiguration>(builder.Configuration.GetSection("Turn"));
builder.Services.Configure<ReconnectConfiguration>(builder.Configuration.GetSection("Reconnect"));

var profilePath = builder.Configuration["Profiles:Path"];
if (string.IsNullOrWhiteSpace(profilePath))
{
    profilePath = Path.Combine(builder.Environment.ContentRootPath, "data", "profiles.json");
}
else if (!Path.IsPathRooted(profilePath))
{
    profilePath = Path.Combine(builder.Environment.ContentRootPath, profilePath);
}

builder.Services.AddSingleton(new TelaeRegistry(profilePath));
builder.Services.AddSingleton<DisconnectCoordinator>();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy
            .SetIsOriginAllowed(origin =>
                origin.StartsWith("http://localhost:", StringComparison.OrdinalIgnoreCase) ||
                origin.StartsWith("https://localhost:", StringComparison.OrdinalIgnoreCase) ||
                origin.StartsWith("file://", StringComparison.OrdinalIgnoreCase) ||
                origin.Equals("null", StringComparison.OrdinalIgnoreCase))
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors();
app.MapGet("/health", () => Results.Ok(new { service = "telae-signaling", status = "ok" }));
app.MapHub<TelaeHub>("/hubs/telae");

app.Run();
