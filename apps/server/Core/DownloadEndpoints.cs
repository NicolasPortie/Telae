using System.Text.RegularExpressions;

namespace Telae.Server.Core;

public static partial class DownloadEndpoints
{
    public static void MapTelaeDownloads(this WebApplication app, string updatesPath) =>
        app.MapGet("/download/windows", async (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var manifest = new FileInfo(Path.Combine(updatesPath, "latest.yml"));
            if (!manifest.Exists || manifest.Length > 16 * 1024) return Results.NotFound();
            var match = VersionLine().Match(await File.ReadAllTextAsync(manifest.FullName, context.RequestAborted));
            if (!match.Success) return Results.NotFound();
            var filename = $"Telae-Setup-{match.Groups[1].Value}.exe";
            return File.Exists(Path.Combine(updatesPath, filename))
                ? Results.Redirect($"/updates/windows/{filename}") : Results.NotFound();
        });

    [GeneratedRegex(@"^version: ([0-9]+\.[0-9]+\.[0-9]+)\r?$", RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex VersionLine();
}
