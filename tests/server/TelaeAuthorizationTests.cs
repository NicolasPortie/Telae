using System.Text.Json;
using Telae.Server.Core;

namespace Telae.Server.Tests;

public sealed class TelaeAuthorizationTests
{
    [Fact]
    public void Unchanged_registration_does_not_rewrite_profiles_but_a_rename_is_persisted()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"telae-persistence-{Guid.NewGuid():N}");
        var path = Path.Combine(folder, "profiles.json");
        try
        {
            var registry = new TelaeRegistry(path);
            registry.RegisterDevice("device", "Owner", "first", Secret);
            File.SetLastWriteTimeUtc(path, new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc));
            var timestamp = File.GetLastWriteTimeUtc(path);
            registry.RegisterDevice("device", " Owner ", "reconnected", Secret);
            Assert.Equal(timestamp, File.GetLastWriteTimeUtc(path));
            Assert.Equal("reconnected", registry.GetConnectionId("device"));
            registry.RegisterDevice("device", "Renamed", "reconnected", Secret);
            Assert.NotEqual(timestamp, File.GetLastWriteTimeUtc(path));
            Assert.Equal("Renamed", new TelaeRegistry(path).GetDevice("device")!.DisplayName);
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true); }
    }

    [Fact]
    public void Failed_persistence_rolls_back_identity_and_connection_changes()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"telae-persistence-{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        try
        {
            // A directory cannot be replaced by the atomic file move.
            var registry = new TelaeRegistry(folder);
            var error = Record.Exception(() => registry.RegisterDevice("device", "Owner", "connection", Secret));
            Assert.True(error is IOException or UnauthorizedAccessException);
            Assert.Null(registry.GetDevice("device"));
            Assert.False(registry.IsRegisteredConnection("connection"));
            Assert.Empty(Directory.GetFiles(folder));
        }
        finally { Directory.Delete(folder, recursive: true); }
    }

    [Fact]
    public async Task Concurrent_registrations_preserve_all_profiles_in_atomic_snapshot()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"telae-persistence-{Guid.NewGuid():N}");
        var path = Path.Combine(folder, "profiles.json");
        try
        {
            var registry = new TelaeRegistry(path);
            await Task.WhenAll(Enumerable.Range(0, 20).Select(index => Task.Run(() =>
                registry.RegisterDevice($"device-{index}", "Owner", $"connection-{index}", Secret))));
            var restored = new TelaeRegistry(path);
            for (var index = 0; index < 20; index++) Assert.NotNull(restored.GetDevice($"device-{index}"));
            Assert.Single(Directory.GetFiles(folder));
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true); }
    }
    private static readonly string Secret = new('a', 64);
    private static readonly string WrongSecret = new('b', 64);

    [Theory]
    [InlineData("")]
    [InlineData("short")]
    [InlineData(null)]
    public void Registration_requires_a_strong_device_credential(string? secret)
    {
        var registry = new TelaeRegistry();
        var error = Assert.Throws<TelaeDomainException>(() => registry.RegisterDevice("device", "Name", "connection", secret!));
        Assert.Equal("device_unauthorized", error.Code);
        Assert.Null(registry.GetDevice("device"));
    }

    [Fact]
    public void Wrong_credential_cannot_take_over_or_rename_an_existing_device()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device", "Owner", "owner-connection", Secret);
        var error = Assert.Throws<TelaeDomainException>(() => registry.RegisterDevice("device", "Attacker", "attacker-connection", WrongSecret));
        Assert.Equal("device_unauthorized", error.Code);
        Assert.Equal("owner-connection", registry.GetConnectionId("device"));
        Assert.Equal("Owner", registry.GetDevice("device")!.DisplayName);
    }

    [Fact]
    public void One_connection_cannot_register_multiple_identities()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("first", "First", "connection", Secret);
        Assert.Throws<TelaeDomainException>(() => registry.RegisterDevice("second", "Second", "connection", Secret));
        Assert.Null(registry.GetDevice("second"));
        Assert.Equal("first", registry.GetDeviceIdForConnection("connection"));
    }

    [Fact]
    public void A_device_identifier_alone_does_not_authorize_viewing()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("sharer", "Sharer", "sharer-connection", Secret);
        registry.RegisterDevice("viewer", "Viewer", "viewer-connection", Secret);
        registry.StartShare("sharer", "auto");
        Assert.Equal("share_not_active", Assert.Throws<TelaeDomainException>(() => registry.JoinShare("viewer", "sharer")).Code);

        registry.DeclareFriends("sharer", [registry.GetDevice("viewer")!.FriendCode]);
        registry.DeclareFriends("viewer", [registry.GetDevice("sharer")!.FriendCode]);
        // Ser amigo não basta para a reconexão direta: é preciso ter entrado pela lista de amigos.
        Assert.Equal("invite_required", Assert.Throws<TelaeDomainException>(() => registry.JoinShare("viewer", "sharer")).Code);
        Assert.Empty(registry.GetActiveSessionForSharer("sharer")!.ViewerDeviceIds);
        registry.JoinFriendShare("viewer", registry.GetDevice("sharer")!.FriendCode);
        Assert.Contains("viewer", registry.JoinShare("viewer", "sharer").ViewerDeviceIds);
        registry.LeaveShare("viewer");
        Assert.Equal("invite_required", Assert.Throws<TelaeDomainException>(() => registry.JoinShare("viewer", "sharer")).Code);
    }

    [Fact]
    public void Viewers_can_join_reconnect_and_rejoin_beyond_twelve()
    {
        const int viewerCount = 20;
        var viewers = Enumerable.Range(0, viewerCount).Select(index => $"viewer{index}").ToArray();
        var registry = TelaeRegistryTests.Friends(["sharer", .. viewers]);
        registry.StartShare("id-sharer", "auto");
        for (var index = 0; index < viewerCount; index++)
            Assert.Equal(index + 1, registry.JoinFriendShare($"id-{viewers[index]}", "sharer").Session.ViewerDeviceIds.Count);
        Assert.Equal(viewerCount, registry.JoinShare("id-viewer19", "id-sharer").ViewerDeviceIds.Count);
        registry.LeaveShare("id-viewer0");
        Assert.Equal(viewerCount, registry.JoinFriendShare("id-viewer0", "sharer").Session.ViewerDeviceIds.Count);
    }

    [Fact]
    public void Friends_can_join_and_switch_to_a_session_beyond_twelve()
    {
        var registry = new TelaeRegistry();
        registry.RegisterAccountDevice("sharer", "sharer", "Sharer", "sharer-connection");
        registry.RegisterAccountDevice("other", "other", "Other", "other-connection");
        const int viewerCount = 20;
        var viewerIds = Enumerable.Range(0, viewerCount).Select(index => $"viewer{index}").ToArray();
        registry.DeclareFriends("sharer", viewerIds);
        registry.DeclareFriends("other", [viewerIds[^1]]);
        registry.StartShare("sharer", "auto");
        registry.StartShare("other", "auto");
        for (var index = 0; index < viewerCount; index++)
        {
            var viewerId = viewerIds[index];
            registry.RegisterAccountDevice(viewerId, viewerId, "Viewer", $"connection-{index}");
            registry.DeclareFriends(viewerId, ["sharer", "other"]);
            if (index == viewerCount - 1)
                registry.JoinFriendShare(viewerId, "other");
            var result = registry.JoinFriendShare(viewerId, "sharer");
            Assert.Equal(index + 1, result.Session.ViewerDeviceIds.Count);
            if (index == viewerCount - 1)
                Assert.NotNull(result.Detached);
        }
        Assert.Empty(registry.GetActiveSessionForSharer("other")!.ViewerDeviceIds);
    }

    [Fact]
    public void Persisted_credential_is_hashed_and_legacy_identity_cannot_be_claimed()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"telae-auth-{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "profiles.json");
        try
        {
            var registry = new TelaeRegistry(path);
            registry.RegisterDevice("device", "Name", "connection", Secret);
            Assert.DoesNotContain(Secret, File.ReadAllText(path));
            new TelaeRegistry(path).RegisterDevice("device", "Name", "reconnected", Secret);
            Assert.Single(Directory.GetFiles(folder));
            File.WriteAllText(path, JsonSerializer.Serialize(new[] { new { DeviceId = "legacy", DisplayName = "Legacy", FriendCode = "ABC234" } }));
            var legacy = new TelaeRegistry(path);
            Assert.Equal("device_unauthorized", Assert.Throws<TelaeDomainException>(() => legacy.RegisterDevice("legacy", "Attacker", "connection", Secret)).Code);
        }
        finally { Directory.Delete(folder, recursive: true); }
    }

    [Fact]
    public void Forgetting_an_account_removes_its_connections_and_session_participation()
    {
        var registry = new TelaeRegistry();
        registry.RegisterAccountDevice("ana", "ana", "Ana", "ana-connection");
        registry.RegisterAccountDevice("bia", "bia", "Bia", "bia-connection");
        registry.DeclareFriends("ana", ["bia"]);
        registry.DeclareFriends("bia", ["ana"]);
        registry.StartShare("ana", "auto");
        var session = registry.JoinFriendShare("bia", "ana").Session;

        registry.ForgetAccount("bia");
        Assert.False(registry.IsRegisteredConnection("bia-connection"));
        Assert.Empty(registry.GetActiveSessionForSharer("ana")!.ViewerDeviceIds);
        Assert.Equal("device_not_registered", Assert.Throws<TelaeDomainException>(() => registry.ValidateSessionParticipant(session.SessionId, "bia", "ana")).Code);
        registry.ForgetAccount("ana");
        Assert.Null(registry.GetActiveSessionForSharer("ana"));
        Assert.Null(registry.FindConnectionId("ana"));
    }

    [Fact]
    public void A_removed_or_hidden_viewer_cannot_come_back_by_any_path()
    {
        var registry = TelaeRegistryTests.Friends("ana", "bia", "caio");
        registry.StartShare("id-ana", "auto");
        registry.JoinFriendShare("id-bia", "ana");
        registry.RemoveViewer("id-ana", "id-bia");
        Assert.Equal("share_not_active", Assert.Throws<TelaeDomainException>(() => registry.JoinFriendShare("id-bia", "ana")).Code);
        Assert.Equal("share_not_active", Assert.Throws<TelaeDomainException>(() => registry.JoinShare("id-bia", "id-ana")).Code);

        registry.SetHidden("id-ana", "id-caio", hidden: true);
        Assert.Equal("share_not_active", Assert.Throws<TelaeDomainException>(() => registry.JoinFriendShare("id-caio", "ana")).Code);
        Assert.Empty(registry.GetActiveSessionForSharer("id-ana")!.ViewerDeviceIds);
    }

    [Fact]
    public void Legacy_capacity_rejects_new_devices_but_never_blocks_accounts()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"telae-capacity-{Guid.NewGuid():N}");
        var path = Path.Combine(folder, "profiles.json");
        Directory.CreateDirectory(folder);
        try
        {
            File.WriteAllText(path, JsonSerializer.Serialize(Enumerable.Range(0, TelaeRegistry.MaxProfiles)
                .Select(index => new { DeviceId = $"device-{index}", DisplayName = "Name", FriendCode = $"user_{index}", DeviceSecretHash = new string('A', 64) })));
            var registry = new TelaeRegistry(path);

            Assert.Equal("server_full", Assert.Throws<TelaeDomainException>(() => registry.RegisterDevice("attacker", "Attacker", "new", Secret)).Code);
            Assert.Null(registry.GetDevice("attacker"));
            // Encher o registro com aparelhos legados não pode impedir contas de entrar.
            Assert.Equal("new_account", registry.EnsureAccountProfile("new-account", "new_account", "New").FriendCode);
            Assert.NotNull(registry.RegisterAccountDevice("other-account", "other_account", "Other", "account-connection"));
        }
        finally { Directory.Delete(folder, recursive: true); }
    }

    [Fact]
    public void A_request_cannot_be_dismissed_before_it_exists()
    {
        var registry = new TelaeRegistry();
        registry.RegisterAccountDevice("ana", "ana", "Ana", "ana-connection");
        registry.RegisterAccountDevice("bia", "bia", "Bia", "bia-connection");
        registry.DismissFriendRequest("ana", "bia");

        registry.DeclareFriends("bia", ["ana"]);

        Assert.Equal("bia", Assert.Single(registry.GetFriendRequests("ana")).DeviceId);
    }

    [Fact]
    public void Revocation_during_grace_ends_the_share_and_old_disconnects_cannot_end_a_later_session()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("sharer", "Sharer", "first", Secret);
        registry.StartShare("sharer", "auto");
        var previousDisconnect = registry.BeginDisconnect("first");

        Assert.NotNull(registry.RevokeDevice("sharer").EndedSession);
        registry.RegisterDevice("sharer", "Sharer", "second", Secret);
        var currentSession = registry.StartShare("sharer", "auto");
        var currentDisconnect = registry.BeginDisconnect("second");

        Assert.Null(registry.FinalizeDisconnect("sharer", previousDisconnect.Generation).EndedSession);
        Assert.Equal(currentSession.SessionId, registry.GetActiveSessionForSharer("sharer")!.SessionId);
        Assert.Equal(currentSession.SessionId, registry.FinalizeDisconnect("sharer", currentDisconnect.Generation).EndedSession!.SessionId);
    }

    [Fact]
    public void A_stale_connection_cannot_revoke_a_replacement_connection()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("device", "Owner", "first", Secret);
        registry.RegisterDevice("device", "Owner", "second", Secret);

        Assert.Null(registry.RevokeDevice("device", "first").ChangedDevice);
        Assert.Equal("second", registry.GetConnectionId("device"));
    }

    [Fact]
    public void Reusing_a_deleted_username_does_not_inherit_the_former_accounts_friendship()
    {
        var registry = new TelaeRegistry();
        registry.RegisterAccountDevice("ana", "ana", "Ana", "ana-connection");
        registry.RegisterAccountDevice("old-bia", "bia", "Bia", "old-connection");
        registry.DeclareFriends("ana", ["bia"]);
        registry.DeclareFriends("old-bia", ["ana"]);
        Assert.True(registry.AreMutualFriends("ana", "old-bia"));

        registry.ForgetAccount("old-bia");
        registry.RegisterAccountDevice("new-bia", "bia", "Bia", "new-connection");
        registry.DeclareFriends("new-bia", ["ana"]);

        Assert.False(registry.AreMutualFriends("ana", "new-bia"));
        registry.StartShare("ana", "auto");
        Assert.Equal("not_friends", Assert.Throws<TelaeDomainException>(() => registry.JoinFriendShare("new-bia", "ana")).Code);
        Assert.Empty(registry.SetSharePreview("ana", SharePreviewTests.Jpeg).ConnectionIds);
    }
}
