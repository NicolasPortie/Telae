using System.Text.Json;
using Telae.Server.Core;

namespace Telae.Server.Tests;

public sealed class TelaeAuthorizationTests
{
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
