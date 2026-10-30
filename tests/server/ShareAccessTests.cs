using Telae.Server.Core;

namespace Telae.Server.Tests;

/// <summary>Regra de acesso no registro: todos os amigos ou só os escolhidos, ocultos, prévia e mudanças no meio da transmissão.</summary>
public sealed class ShareAccessTests
{
    private static readonly string Jpeg = SharePreviewTests.Jpeg;

    private static TelaeRegistry Friends(params string[] users) => TelaeRegistryTests.Friends(users);

    private static ShareAudienceDto Audience(string mode, string[]? selected = null) =>
        new(mode, selected);

    private static bool SeesLive(TelaeRegistry registry, string observer, string sharer) =>
        registry.ForObserver($"id-{observer}", registry.GetDevice($"id-{sharer}")!).IsSharing;

    private static string Code(Action action) => Assert.Throws<TelaeDomainException>(action).Code;

    [Theory]
    [InlineData("friends", "bia", true)]
    [InlineData("friends", "caio", true)]
    [InlineData("selected", "bia", true)]
    [InlineData("selected", "caio", false)]
    public void Access_matrix_decides_presence_and_entry(string mode, string observer, bool allowed)
    {
        var registry = Friends("ana", "bia", "caio");
        registry.StartShare("id-ana", "auto", Audience(mode, ["bia"]));

        var seen = registry.ForObserver($"id-{observer}", registry.GetDevice("id-ana")!);
        Assert.Equal(allowed, seen.IsSharing);
        Assert.Equal(allowed ? "transmitting" : "online", seen.Status);
        if (!allowed) Assert.Null(seen.ActiveQualityProfile);

        if (allowed) registry.JoinFriendShare($"id-{observer}", "ana");
        else Assert.Equal("share_not_active", Code(() => registry.JoinFriendShare($"id-{observer}", "ana")));
    }

    [Fact]
    public void Friends_outside_the_audience_see_no_live_status_ordering_or_preview()
    {
        var registry = Friends("ana", "bia", "caio", "duda");
        registry.StartShare("id-ana", "auto", Audience("selected", ["bia"]));

        var forCaio = registry.GetFriendsForObserver("id-caio", ["ana", "duda"]);
        Assert.All(forCaio, friend => Assert.Equal("online", friend.Status));
        // A ordem não pode denunciar a transmissão: "ana" não vem antes de "duda" por estar ao vivo.
        Assert.Equal(["ana", "duda"], forCaio.Select(friend => friend.FriendCode));
        Assert.Equal("transmitting", registry.GetFriendsForObserver("id-bia", ["ana"]).Single().Status);

        var (_, connections) = registry.SetSharePreview("id-ana", Jpeg);
        Assert.Equal(["conn-bia"], connections);
        Assert.Single(registry.GetFriendPreviews("id-bia"));
        Assert.Empty(registry.GetFriendPreviews("id-caio"));
    }

    [Fact]
    public void Selected_list_keeps_only_mutual_friends_and_rejects_unknown_modes()
    {
        var registry = Friends("ana", "bia");
        registry.RegisterAccountDevice("id-estranho", "estranho", "estranho", "conn-estranho");

        registry.StartShare("id-ana", "auto", Audience("selected", ["@BIA", "estranho", "ninguem", "a!"]));

        Assert.Equal(["bia"], registry.GetShareAudience("id-ana")!.Selected);
        Assert.Equal("invalid_audience", Code(() => registry.UpdateShareAudience("id-ana", Audience("none"))));
        Assert.Equal("invalid_audience", Code(() => registry.UpdateShareAudience("id-ana", Audience("public"))));
        Assert.Equal("invalid_audience", Code(() => registry.UpdateShareAudience("id-ana",
            Audience("selected", Enumerable.Range(0, TelaeRegistry.MaxSelectedViewers + 1).Select(i => $"user{i}").ToArray()))));
    }

    [Fact]
    public void Old_clients_without_an_audience_keep_today_behavior()
    {
        var registry = Friends("ana", "bia");
        registry.StartShare("id-ana", "auto");

        var audience = registry.GetShareAudience("id-ana")!;
        Assert.Equal("friends", audience.Mode);
        Assert.Empty(audience.Selected!);
        Assert.True(SeesLive(registry, "bia", "ana"));
    }

    // ---- mudar quem pode ver no meio da transmissão ----

    [Fact]
    public void Switching_to_selected_keeps_who_is_listed_and_takes_out_who_is_not()
    {
        var registry = Friends("ana", "bia", "caio", "duda");
        registry.StartShare("id-ana", "auto");
        foreach (var viewer in new[] { "bia", "caio", "duda" }) registry.JoinFriendShare($"id-{viewer}", "ana");
        registry.SetSharePreview("id-ana", Jpeg);

        var change = registry.UpdateShareAudience("id-ana", Audience("selected", ["bia", "caio"]));

        Assert.Equal(["id-duda"], change.Access.Detached.Select(d => d.ViewerDeviceId));
        Assert.Equal(["id-bia", "id-caio"], change.Session.ViewerDeviceIds);
        // Quem saiu deixa de ver o cartão e de receber a miniatura; a próxima volta só para quem ainda pode ver.
        Assert.NotEmpty(change.PreviewRemovalConnectionIds);
        Assert.Empty(registry.GetFriendPreviews("id-duda"));
        Assert.False(SeesLive(registry, "duda", "ana"));
        Assert.Equal("share_not_active", Code(() => registry.JoinFriendShare("id-duda", "ana")));
    }

    [Fact]
    public void Adding_someone_during_the_stream_lets_them_in_without_joining_them_automatically()
    {
        var registry = Friends("ana", "bia", "caio");
        registry.StartShare("id-ana", "auto", Audience("selected", ["bia"]));
        registry.JoinFriendShare("id-bia", "ana");
        registry.SetSharePreview("id-ana", Jpeg);
        Assert.False(SeesLive(registry, "caio", "ana"));

        var change = registry.UpdateShareAudience("id-ana", Audience("selected", ["bia", "caio"]));

        Assert.Empty(change.Access.Detached);
        // Ampliar o público não apaga a miniatura de ninguém.
        Assert.Empty(change.PreviewRemovalConnectionIds);
        Assert.Equal(["id-bia"], change.Session.ViewerDeviceIds);
        Assert.True(SeesLive(registry, "caio", "ana"));
        Assert.Single(registry.GetFriendPreviews("id-caio"));
        registry.JoinFriendShare("id-caio", "ana");
    }

    [Fact]
    public void Going_back_to_all_friends_keeps_everyone_and_opens_the_stream_to_the_rest()
    {
        var registry = Friends("ana", "bia", "caio");
        registry.StartShare("id-ana", "auto", Audience("selected", ["bia"]));
        registry.JoinFriendShare("id-bia", "ana");

        var change = registry.UpdateShareAudience("id-ana", Audience("friends"));

        Assert.Empty(change.Access.Detached);
        Assert.Equal(["id-bia"], change.Session.ViewerDeviceIds);
        Assert.True(SeesLive(registry, "caio", "ana"));
    }

    [Fact]
    public void Someone_removed_from_the_stream_stays_out_even_if_the_list_still_has_them()
    {
        var registry = Friends("ana", "bia", "caio");
        registry.StartShare("id-ana", "auto", Audience("selected", ["bia"]));
        registry.JoinFriendShare("id-bia", "ana");
        registry.RemoveViewer("id-ana", "id-bia");

        registry.UpdateShareAudience("id-ana", Audience("selected", ["bia"]));

        Assert.Equal("share_not_active", Code(() => registry.JoinFriendShare("id-bia", "ana")));
        Assert.False(SeesLive(registry, "bia", "ana"));
    }

    [Fact]
    public void Preview_remains_available_when_an_audience_change_keeps_access()
    {
        var registry = Friends("ana", "bia", "caio");
        registry.StartShare("id-ana", "auto", Audience("selected", ["bia"]));
        registry.SetSharePreview("id-ana", Jpeg);

        var change = registry.UpdateShareAudience("id-ana", Audience("selected", ["bia"]));

        Assert.Empty(change.PreviewRemovalConnectionIds);
        Assert.Single(registry.GetFriendPreviews("id-bia"));
        Assert.Empty(registry.GetFriendPreviews("id-caio"));
        Assert.True(SeesLive(registry, "bia", "ana"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Denied_friend_entry_does_not_reveal_a_share_during_disconnect_grace(bool hidden)
    {
        var registry = Friends("ana", "bia");
        if (hidden) registry.SetHidden("id-ana", "id-bia", hidden: true);
        registry.StartShare("id-ana", "auto", Audience(hidden ? "friends" : "selected", []));
        var pending = registry.BeginDisconnect("conn-ana");

        Assert.Equal("share_not_active", Code(() => registry.JoinFriendShare("id-bia", "ana")));

        registry.FinalizeDisconnect(pending.DeviceId!, pending.Generation);
        Assert.Equal("share_not_active", Code(() => registry.JoinFriendShare("id-bia", "ana")));
    }

    // ---- ocultar ----

    [Fact]
    public void Preview_removal_only_reaches_people_previously_allowed_to_receive_it()
    {
        var registry = Friends("ana", "bia", "caio", "duda");
        registry.SetHidden("id-ana", "id-caio", hidden: true);
        registry.StartShare("id-ana", "auto", Audience("selected", ["bia", "caio"]));
        registry.SetSharePreview("id-ana", Jpeg);

        var change = registry.UpdateShareAudience("id-ana", Audience("selected", []));

        Assert.Equal(["conn-bia"], change.PreviewRemovalConnectionIds);
        Assert.Empty(registry.SetHidden("id-ana", "id-duda", hidden: true).PreviewRemovalConnectionIds);
        Assert.Empty(registry.UpdateShareAudience("id-ana", Audience("friends")).PreviewRemovalConnectionIds);
    }

    [Fact]
    public void Stale_database_reads_cannot_undo_hidden_viewer_changes()
    {
        var registry = Friends("ana", "bia");
        registry.InitializeHiddenViewers("id-ana", []);
        registry.SetHidden("id-ana", "id-bia", hidden: true);
        registry.InitializeHiddenViewers("id-ana", []);
        Assert.True(registry.IsHidden("id-ana", "id-bia"));

        registry.SetHidden("id-ana", "id-bia", hidden: false);
        registry.InitializeHiddenViewers("id-ana", ["id-bia"]);
        Assert.False(registry.IsHidden("id-ana", "id-bia"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Denied_reconnection_does_not_reveal_whether_the_share_is_still_active(bool removed)
    {
        var registry = Friends("ana", "bia");
        registry.StartShare("id-ana", "auto");
        if (removed)
        {
            registry.JoinFriendShare("id-bia", "ana");
            registry.RemoveViewer("id-ana", "id-bia");
        }
        else registry.DeclareFriends("id-bia", []);

        var active = Assert.Throws<TelaeDomainException>(() => registry.JoinShare("id-bia", "id-ana"));
        registry.StopShare("id-ana");
        var ended = Assert.Throws<TelaeDomainException>(() => registry.JoinShare("id-bia", "id-ana"));

        Assert.Equal((ended.Code, ended.Message), (active.Code, active.Message));
        Assert.Equal("share_not_active", active.Code);
    }

    [Fact]
    public void Hidden_friends_see_nothing_and_are_removed_on_the_spot()
    {
        var registry = Friends("ana", "bia");
        registry.StartShare("id-ana", "auto");
        registry.JoinFriendShare("id-bia", "ana");
        registry.SetSharePreview("id-ana", Jpeg);

        var change = registry.SetHidden("id-ana", "id-bia", hidden: true);

        Assert.Equal("id-bia", change.Access.Detached.Single().ViewerDeviceId);
        Assert.Equal(["conn-bia"], change.PreviewRemovalConnectionIds);
        Assert.Equal("online", registry.ForObserver("id-bia", registry.GetDevice("id-ana")!).Status);
        Assert.Empty(registry.GetFriendPreviews("id-bia"));
        // A resposta é a mesma de "não está transmitindo": nada revela que a pessoa foi ocultada.
        Assert.Equal("share_not_active", Code(() => registry.JoinFriendShare("id-bia", "ana")));
        Assert.True(registry.IsHidden("id-ana", "id-bia"));

        registry.SetHidden("id-ana", "id-bia", hidden: false);
        registry.JoinFriendShare("id-bia", "ana");
    }

    [Fact]
    public void Hidden_list_loaded_at_connection_applies_before_anyone_joins()
    {
        var registry = Friends("ana", "bia", "caio");
        registry.InitializeHiddenViewers("id-ana", ["id-bia", "id-ana"]);
        registry.StartShare("id-ana", "auto");

        Assert.False(SeesLive(registry, "bia", "ana"));
        Assert.True(SeesLive(registry, "caio", "ana"));
        Assert.False(registry.IsHidden("id-ana", "id-ana"));
    }

    // ---- amizade e contas ----

    [Fact]
    public void Ending_the_friendship_takes_the_person_out_of_the_stream()
    {
        var registry = Friends("ana", "bia");
        registry.StartShare("id-ana", "auto");
        registry.JoinFriendShare("id-bia", "ana");

        var declared = registry.DeclareFriends("id-bia", []);

        Assert.Equal("id-bia", declared.Detached.Single().ViewerDeviceId);
    }

    [Fact]
    public void Forgetting_an_account_clears_its_hidden_lists()
    {
        var registry = Friends("ana", "bia");
        registry.StartShare("id-ana", "auto");
        registry.SetHidden("id-bia", "id-ana", hidden: true);

        registry.ForgetAccount("id-bia");

        Assert.False(registry.IsHidden("id-bia", "id-ana"));
    }
}
