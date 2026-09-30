using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Telae.Server.Hubs;

namespace Telae.Server.Core;

public sealed class DisconnectCoordinator(
    TelaeRegistry registry,
    IHubContext<TelaeHub> hubContext,
    IOptions<ReconnectConfiguration> reconnectConfiguration,
    IHostApplicationLifetime applicationLifetime,
    ILogger<DisconnectCoordinator> logger)
{
    public void Schedule(PendingDisconnect pending)
    {
        if (pending.DeviceId is null) return;
        _ = FinalizeAsync(pending);
    }

    private async Task FinalizeAsync(PendingDisconnect pending)
    {
        try
        {
            var graceMilliseconds = Math.Max(0, reconnectConfiguration.Value.GracePeriodMilliseconds);
            if (graceMilliseconds > 0)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(graceMilliseconds), applicationLifetime.ApplicationStopping);
            }

            var result = registry.FinalizeDisconnect(pending.DeviceId!, pending.Generation);
            if (result.ChangedDevice is not null)
                await hubContext.Clients.All.SendAsync("PresenceChanged", result.ChangedDevice, applicationLifetime.ApplicationStopping);

            if (result.EndedSession is not null)
            {
                foreach (var viewerDeviceId in result.EndedSession.ViewerDeviceIds)
                {
                    try
                    {
                        await hubContext.Clients.Client(registry.GetConnectionId(viewerDeviceId))
                            .SendAsync("SessionEnded", result.EndedSession.SessionId, applicationLifetime.ApplicationStopping);
                    }
                    catch (TelaeDomainException) { }
                }
            }

            if (result.ViewerLeftSession is not null && result.ViewerLeftDeviceId is not null)
            {
                try
                {
                    await hubContext.Clients.Client(registry.GetConnectionId(result.ViewerLeftSession.SharerDeviceId))
                        .SendAsync("ViewerLeft", new ViewerLeftEvent(result.ViewerLeftSession.SessionId, result.ViewerLeftDeviceId), applicationLifetime.ApplicationStopping);
                }
                catch (TelaeDomainException) { }
            }
        }
        catch (OperationCanceledException) when (applicationLifetime.ApplicationStopping.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            logger.LogError(error, "Failed to finalize disconnected device {DeviceId}", pending.DeviceId);
        }
    }
}
