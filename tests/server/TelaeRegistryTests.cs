using Telae.Server.Core;

namespace Telae.Server.Tests;

public sealed class TelaeRegistryTests
{
    [Theory]
    [InlineData("1440p30")]
    [InlineData("1440p60")]
    public void Qhd_profile_is_preserved_for_start_join_and_live_quality_changes(string profile)
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));
        Assert.Equal(profile, registry.StartShare("device-nicolas", profile).QualityProfile);
        var invite = registry.CreateInvite("device-nicolas");
        Assert.Equal(profile, registry.JoinWithInvite("device-biel", invite.Code).QualityProfile);
        registry.UpdateShareQuality("device-nicolas", "1080p30");
        Assert.Equal(profile, registry.UpdateShareQuality("device-nicolas", profile).QualityProfile);
        Assert.Equal(profile, registry.GetActiveSessionForSharer("device-nicolas")!.QualityProfile);
    }

    [Fact]
    public void Viewer_cannot_join_before_sharer_explicitly_starts_sharing()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));

        var error = Assert.Throws<TelaeDomainException>(() =>
            registry.JoinShare("device-biel", "device-nicolas"));

        Assert.Equal("share_not_active", error.Code);
    }

    [Fact]
    public void Share_session_accepts_multiple_viewers()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));
        registry.RegisterDevice("device-caio", "Caio", "connection-caio", new string('a', 64));
        registry.StartShare("device-nicolas", "1080p60");

        registry.JoinWithInvite("device-biel", registry.CreateInvite("device-nicolas").Code);
        var session = registry.JoinWithInvite("device-caio", registry.CreateInvite("device-nicolas").Code);
        Assert.Contains("device-biel", session.ViewerDeviceIds);
        Assert.Contains("device-caio", session.ViewerDeviceIds);
        registry.ValidateSessionParticipant(session.SessionId, "device-caio", "device-nicolas");
        var error = Assert.Throws<TelaeDomainException>(() =>
            registry.ValidateSessionParticipant(session.SessionId, "device-biel", "device-caio"));
        Assert.Equal("not_session_participant", error.Code);
    }

    [Fact]
    public void Finalized_disconnect_ends_the_active_session()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));
        registry.StartShare("device-nicolas", "1080p30");
        registry.JoinWithInvite("device-biel", registry.CreateInvite("device-nicolas").Code);

        var pending = registry.BeginDisconnect("connection-nicolas");
        var result = registry.FinalizeDisconnect(pending.DeviceId!, pending.Generation);

        Assert.NotNull(result.EndedSession);
        Assert.Null(registry.GetActiveSessionForSharer("device-nicolas"));
        Assert.Equal("offline", result.ChangedDevice?.Status);
    }

    [Fact]
    public void Reconnect_before_finalize_preserves_the_active_session()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));
        registry.StartShare("device-nicolas", "1080p30");
        registry.JoinWithInvite("device-biel", registry.CreateInvite("device-nicolas").Code);

        var pending = registry.BeginDisconnect("connection-nicolas");
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas-reconnected", new string('a', 64));
        var result = registry.FinalizeDisconnect(pending.DeviceId!, pending.Generation);

        Assert.Null(result.EndedSession);
        Assert.Null(result.ChangedDevice);
        var session = registry.GetActiveSessionForSharer("device-nicolas");
        Assert.NotNull(session);
        Assert.Equal("device-biel", session.ViewerDeviceId);
        Assert.Equal("connection-nicolas-reconnected", registry.GetConnectionId("device-nicolas"));
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

    [Fact]
    public void Invite_allows_join_and_reports_specific_reasons_on_failure()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));
        registry.StartShare("device-nicolas", "1080p60");

        var invite = registry.CreateInvite("device-nicolas");
        var session = registry.JoinWithInvite("device-biel", invite.Code);
        Assert.Equal("device-biel", session.ViewerDeviceId);
    }

    [Fact]
    public void Join_with_unknown_invite_fails_with_invite_invalid()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));
        registry.StartShare("device-nicolas", "1080p60");

        var error = Assert.Throws<TelaeDomainException>(() =>
            registry.JoinWithInvite("device-biel", "ZZZZZZZZ"));
        Assert.Equal("invite_invalid", error.Code);
    }

    [Fact]
    public void Expired_invite_fails_with_invite_expired()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));
        registry.StartShare("device-nicolas", "1080p60");

        var invite = registry.CreateInvite("device-nicolas", TimeSpan.FromSeconds(-1));
        var error = Assert.Throws<TelaeDomainException>(() =>
            registry.JoinWithInvite("device-biel", invite.Code));
        Assert.Equal("invite_expired", error.Code);
    }

    [Fact]
    public void Invite_can_be_reused_by_multiple_viewers()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));
        registry.RegisterDevice("device-caio", "Caio", "connection-caio", new string('a', 64));
        registry.StartShare("device-nicolas", "1080p60");

        var invite = registry.CreateInvite("device-nicolas");
        registry.JoinWithInvite("device-biel", invite.Code);
        var session = registry.JoinWithInvite("device-caio", invite.Code);
        Assert.Equal(2, session.ViewerDeviceIds.Count);
        registry.LeaveShare("device-biel");
        Assert.Equal(["device-caio"], registry.GetActiveSessionForSharer("device-nicolas")!.ViewerDeviceIds);
    }

    [Fact]
    public void Stale_invite_cannot_rejoin_an_ended_session()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));
        registry.RegisterDevice("device-biel", "Biel", "connection-biel", new string('a', 64));
        registry.StartShare("device-nicolas", "1080p60");

        var invite = registry.CreateInvite("device-nicolas");
        registry.StopShare("device-nicolas");

        var error = Assert.Throws<TelaeDomainException>(() =>
            registry.JoinWithInvite("device-biel", invite.Code));
        Assert.Equal("share_not_active", error.Code);
    }

    [Fact]
    public void Invite_requires_an_active_share()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device-nicolas", "Nicolas", "connection-nicolas", new string('a', 64));

        var error = Assert.Throws<TelaeDomainException>(() =>
            registry.CreateInvite("device-nicolas"));
        Assert.Equal("share_not_active", error.Code);
    }
}
