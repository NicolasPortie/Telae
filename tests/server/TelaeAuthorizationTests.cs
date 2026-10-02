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
        var error = Assert.Throws<TelaeDomainException>(() => registry.JoinShare("viewer", "sharer"));
        Assert.Equal("invite_required", error.Code);
        Assert.Empty(registry.GetActiveSessionForSharer("sharer")!.ViewerDeviceIds);
        registry.JoinWithInvite("viewer", registry.CreateInvite("sharer").Code);
        Assert.Contains("viewer", registry.JoinShare("viewer", "sharer").ViewerDeviceIds);
        registry.LeaveShare("viewer");
        Assert.Equal("invite_required", Assert.Throws<TelaeDomainException>(() => registry.JoinShare("viewer", "sharer")).Code);
    }

    [Fact]
    public void Viewer_limit_is_enforced_and_a_freed_slot_can_be_reused()
    {
        var registry = new TelaeRegistry();
        registry.RegisterDevice("sharer", "Sharer", "sharer-connection", Secret);
        registry.StartShare("sharer", "auto");
        var invite = registry.CreateInvite("sharer");
        for (var index = 0; index < 13; index++)
        {
            registry.RegisterDevice($"viewer-{index}", "Viewer", $"connection-{index}", Secret);
            if (index < 12) registry.JoinWithInvite($"viewer-{index}", invite.Code);
        }
        Assert.Equal("share_full", Assert.Throws<TelaeDomainException>(() => registry.JoinWithInvite("viewer-12", invite.Code)).Code);
        registry.LeaveShare("viewer-0");
        Assert.Equal(12, registry.JoinWithInvite("viewer-12", invite.Code).ViewerDeviceIds.Count);
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
}
