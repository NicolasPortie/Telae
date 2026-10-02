using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using Telae.Server.Core;
using Telae.Server.Hubs;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddTrustedClientAddress(builder.Configuration);

builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
    options.AddFilter(typeof(DomainErrorFilter));
    options.AddFilter<InputLimitFilter>();
    options.MaximumReceiveMessageSize = 128 * 1024;
});

builder.Services.Configure<IceConfiguration>(builder.Configuration.GetSection("Ice"));
builder.Services.AddSingleton<IValidateOptions<TurnConfiguration>, TurnConfigurationValidator>();
builder.Services.AddOptions<TurnConfiguration>().Bind(builder.Configuration.GetSection("Turn")).ValidateOnStart();
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
builder.Services.AddSingleton<PresenceSubscriptions>();
builder.Services.AddSingleton<InputLimitFilter>();

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

app.UseForwardedHeaders();
app.UseCors();
var updatesPath = builder.Configuration["Updates:Path"];
if (string.IsNullOrWhiteSpace(updatesPath))
{
    updatesPath = Path.Combine(Path.GetDirectoryName(profilePath)!, "updates", "windows");
}
else if (!Path.IsPathRooted(updatesPath))
{
    updatesPath = Path.Combine(builder.Environment.ContentRootPath, updatesPath);
}

Directory.CreateDirectory(updatesPath);
var updateContentTypes = new FileExtensionContentTypeProvider();
updateContentTypes.Mappings[".yml"] = "text/yaml";
updateContentTypes.Mappings[".blockmap"] = "application/octet-stream";
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(updatesPath),
    RequestPath = "/updates/windows",
    ContentTypeProvider = updateContentTypes,
    OnPrepareResponse = context =>
    {
        context.Context.Response.Headers.CacheControl =
            context.File.Name == "latest.yml" ? "no-store" : "public, max-age=86400";
        context.Context.Response.Headers.XContentTypeOptions = "nosniff";
    }
});
app.MapGet("/health", (IOptions<IceConfiguration> ice, IOptions<TurnConfiguration> turn) =>
    Results.Ok(new { service = "telae-signaling", status = "ok", connectivity = ConnectivityHealth.From(ice.Value, turn.Value) }));
app.MapHub<TelaeHub>("/hubs/telae");

app.Run();
