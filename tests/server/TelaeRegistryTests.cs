using Telae.Server.Core;

namespace Telae.Server.Tests;

public sealed class TelaeRegistryTests
{
    /// <summary>Contas online e amigas entre si (cada uma declara todas as outras).</summary>
    internal static TelaeRegistry Friends(params string[] users) => FriendsWithClock(null, users);

    internal static TelaeRegistry FriendsWithClock(TimeProvider? clock, params string[] users)
    {
        var registry = new TelaeRegistry(clock: clock);
        foreach (var user in users) registry.RegisterAccountDevice($"id-{user}", user, user, $"conn-{user}");
        foreach (var user in users) registry.DeclareFriends($"id-{user}", users.Where(other => other != user));
        return registry;
    }

    [Theory]
    [InlineData("1440p30")]
    [InlineData("1440p60")]
    public void Qhd_profile_is_preserved_for_start_join_and_live_quality_changes(string profile)
    {
        var registry = Friends("nicolas", "biel");
        Assert.Equal(profile, registry.StartShare("id-nicolas", profile).QualityProfile);
        Assert.Equal(profile, registry.JoinFriendShare("id-biel", "nicolas").Session.QualityProfile);
        registry.UpdateShareQuality("id-nicolas", "1080p30");
        Assert.Equal(profile, registry.UpdateShareQuality("id-nicolas", profile).QualityProfile);
        Assert.Equal(profile, registry.GetActiveSessionForSharer("id-nicolas")!.QualityProfile);
    }

    [Fact]
    public void Viewer_cannot_join_before_sharer_explicitly_starts_sharing()
    {
        var registry = Friends("nicolas", "biel");

        var error = Assert.Throws<TelaeDomainException>(() => registry.JoinShare("id-biel", "id-nicolas"));

        Assert.Equal("share_not_active", error.Code);
    }

    [Fact]
    public void Share_session_accepts_multiple_viewers()
    {
        var registry = Friends("nicolas", "biel", "caio");
        registry.StartShare("id-nicolas", "1080p60");

        registry.JoinFriendShare("id-biel", "nicolas");
        var session = registry.JoinFriendShare("id-caio", "nicolas").Session;
        Assert.Contains("id-biel", session.ViewerDeviceIds);
        Assert.Contains("id-caio", session.ViewerDeviceIds);
        registry.ValidateSessionParticipant(session.SessionId, "id-caio", "id-nicolas");
        var error = Assert.Throws<TelaeDomainException>(() =>
            registry.ValidateSessionParticipant(session.SessionId, "id-biel", "id-caio"));
        Assert.Equal("not_session_participant", error.Code);
    }

    [Fact]
    public void Finalized_disconnect_ends_the_active_session()
    {
        var registry = Friends("nicolas", "biel");
        registry.StartShare("id-nicolas", "1080p30");
        registry.JoinFriendShare("id-biel", "nicolas");

        var pending = registry.BeginDisconnect("conn-nicolas");
        var result = registry.FinalizeDisconnect(pending.DeviceId!, pending.Generation);

        Assert.NotNull(result.EndedSession);
        Assert.Null(registry.GetActiveSessionForSharer("id-nicolas"));
        Assert.Equal("offline", result.ChangedDevice?.Status);
    }

    [Fact]
    public void Reconnect_before_finalize_preserves_the_active_session()
    {
        var registry = Friends("nicolas", "biel");
        registry.StartShare("id-nicolas", "1080p30");
        registry.JoinFriendShare("id-biel", "nicolas");

        var pending = registry.BeginDisconnect("conn-nicolas");
        registry.RegisterAccountDevice("id-nicolas", "nicolas", "nicolas", "conn-nicolas-reconnected");
        var result = registry.FinalizeDisconnect(pending.DeviceId!, pending.Generation);

        Assert.Null(result.EndedSession);
        Assert.Null(result.ChangedDevice);
        var session = registry.GetActiveSessionForSharer("id-nicolas");
        Assert.NotNull(session);
        Assert.Equal("id-biel", session.ViewerDeviceId);
        Assert.Equal("conn-nicolas-reconnected", registry.GetConnectionId("id-nicolas"));
    }

    [Fact]
    public void Friend_code_and_profile_survive_registry_restart()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"telae-tests-{Guid.NewGuid():N}");
        var path = Path.Combine(folder, "profiles.json");

        try
        {
            var first = new TelaeRegistry(path);
            var profile = first.RegisterDevice("stable-device-id", "Nicolas", "connection-1", new string('a', 64));

            var second = new TelaeRegistry(path);
            var restored = second.FindByFriendCode(profile.FriendCode);

            Assert.NotNull(restored);
            Assert.Equal("stable-device-id", restored.DeviceId);
            Assert.Equal("Nicolas", restored.DisplayName);
            Assert.Equal("offline", restored.Status);
        }
        finally
        {
            if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
        }
    }
}
