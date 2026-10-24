using Telae.Server.Core;

namespace Telae.Server.Tests;

public sealed class SharePreviewTests
{
    // JPEG de um pixel.
    internal static readonly string Jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/ooooA//2Q==";

    private static TelaeRegistry Friends(params string[] users)
    {
        var registry = new TelaeRegistry();
        foreach (var user in users) registry.RegisterAccountDevice($"id-{user}", user, user, $"conn-{user}");
        return registry;
    }

    [Fact]
    public void Preview_reaches_only_online_mutual_friends()
    {
        var registry = Friends("ana", "bia", "caio");
        registry.DeclareFriends("id-ana", ["bia", "caio"]);
        registry.DeclareFriends("id-bia", ["ana"]);
        registry.StartShare("id-ana", "1080p30");

        var (preview, connections) = registry.SetSharePreview("id-ana", Jpeg);

        Assert.Equal(["conn-bia"], connections);
        Assert.Equal("id-ana", preview.DeviceId);
        Assert.Single(registry.GetFriendPreviews("id-bia"));
        Assert.Empty(registry.GetFriendPreviews("id-caio"));
    }

    [Fact]
    public void Preview_ends_with_the_share()
    {
        var registry = Friends("ana", "bia");
        registry.DeclareFriends("id-ana", ["bia"]);
        registry.DeclareFriends("id-bia", ["ana"]);
        registry.StartShare("id-ana", "1080p30");
        registry.SetSharePreview("id-ana", Jpeg);

        registry.StopShare("id-ana");

        Assert.Empty(registry.GetFriendPreviews("id-bia"));
        Assert.Equal("share_not_active", Assert.Throws<TelaeDomainException>(() => registry.SetSharePreview("id-ana", Jpeg)).Code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("data:image/png;base64,iVBORw0KGgo=")]
    [InlineData("data:image/jpeg;base64,not-base64!")]
    [InlineData("data:image/jpeg;base64,R0lGODlh")]
    public void Preview_must_be_a_real_jpeg(string image)
    {
        var registry = Friends("ana");
        registry.StartShare("id-ana", "1080p30");

        Assert.Equal("invalid_preview", Assert.Throws<TelaeDomainException>(() => registry.SetSharePreview("id-ana", image)).Code);
    }

    [Fact]
    public void Preview_has_a_size_limit()
    {
        var registry = Friends("ana");
        registry.StartShare("id-ana", "1080p30");
        var huge = Jpeg + new string('A', TelaeRegistry.MaxPreviewLength);

        Assert.Equal("invalid_preview", Assert.Throws<TelaeDomainException>(() => registry.SetSharePreview("id-ana", huge)).Code);
    }

    [Fact]
    public void Removed_viewer_cannot_receive_or_fetch_previews_even_after_reconnecting()
    {
        var registry = Friends("ana", "bia");
        registry.DeclareFriends("id-ana", ["bia"]);
        registry.DeclareFriends("id-bia", ["ana"]);
        registry.StartShare("id-ana", "auto");
        registry.JoinFriendShare("id-bia", "ana");
        registry.RemoveViewer("id-ana", "id-bia");
        registry.RegisterAccountDevice("id-bia", "bia", "bia", "replacement");

        Assert.Empty(registry.SetSharePreview("id-ana", Jpeg).ConnectionIds);
        Assert.Empty(registry.GetFriendPreviews("id-bia"));
    }

    [Fact]
    public void Preview_rate_limit_survives_reconnect_and_restarting_the_share()
    {
        var clock = new PreviewClock();
        var registry = new TelaeRegistry(clock: clock);
        registry.RegisterAccountDevice("id-ana", "ana", "Ana", "first");
        registry.StartShare("id-ana", "auto");
        registry.SetSharePreview("id-ana", Jpeg);
        registry.StopShare("id-ana");
        registry.RegisterAccountDevice("id-ana", "ana", "Ana", "second");
        registry.StartShare("id-ana", "auto");

        Assert.Equal("rate_limited", Assert.Throws<TelaeDomainException>(() => registry.SetSharePreview("id-ana", Jpeg)).Code);
        clock.Now += TelaeRegistry.PreviewInterval;
        registry.SetSharePreview("id-ana", Jpeg);
    }

    [Fact]
    public void Offline_sharer_during_reconnect_grace_cannot_publish_or_appear_in_previews()
    {
        var registry = Friends("ana", "bia");
        registry.DeclareFriends("id-ana", ["bia"]);
        registry.DeclareFriends("id-bia", ["ana"]);
        registry.StartShare("id-ana", "auto");
        registry.SetSharePreview("id-ana", Jpeg);
        registry.BeginDisconnect("conn-ana");

        Assert.Empty(registry.GetFriendPreviews("id-bia"));
        Assert.Equal("device_offline", Assert.Throws<TelaeDomainException>(() => registry.SetSharePreview("id-ana", Jpeg)).Code);
    }

    [Fact]
    public void Small_compressed_jpeg_cannot_request_an_enormous_decoded_image()
    {
        var registry = Friends("ana");
        registry.StartShare("id-ana", "auto");
        var bytes = Convert.FromBase64String(Jpeg.Split(',')[1]);
        var frame = Array.FindIndex(bytes, value => value == 0xC0);
        Assert.True(frame > 0 && bytes[frame - 1] == 0xFF);
        bytes[frame + 4] = bytes[frame + 5] = bytes[frame + 6] = bytes[frame + 7] = 0xFF;
        var image = "data:image/jpeg;base64," + Convert.ToBase64String(bytes);

        Assert.True(image.Length < TelaeRegistry.MaxPreviewLength);
        Assert.Equal("invalid_preview", Assert.Throws<TelaeDomainException>(() => registry.SetSharePreview("id-ana", image)).Code);
    }

    private sealed class PreviewClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
