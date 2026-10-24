using Microsoft.AspNetCore.SignalR;
using Telae.Server.Core;
using Telae.Server.Hubs;

namespace Telae.Server.Tests;

public sealed class PresenceSubscriptionsTests
{
    [Fact]
    public async Task Registration_fails_when_the_session_is_revoked_after_the_database_check()
    {
        var registry = new TelaeRegistry();
        var presence = new PresenceSubscriptions(registry, new TestHubContext(new TestProxy()));

        // A revogação chega entre a consulta ao banco (fora da fila) e o registro (dentro dela).
        var registering = presence.RegisterAsync(new RegisterDeviceRequest("ana", "Ana", "", "ana"), "pending",
            authenticatedAccount: true, sessionId: "revoked",
            authorize: async () => { await presence.RevokeSessionAsync("ana", "revoked"); return true; });

        Assert.Equal("session_expired", (await Assert.ThrowsAsync<TelaeDomainException>(() => registering)).Code);
        Assert.Null(registry.FindConnectionId("ana"));
        Assert.Null(registry.GetDevice("ana"));
    }

    [Fact]
    public async Task Account_revocation_does_not_block_tokens_issued_afterwards()
    {
        var presence = new PresenceSubscriptions(new TelaeRegistry(), new TestHubContext(new TestProxy()));
        var before = DateTimeOffset.UtcNow.AddSeconds(-5);
        await presence.RevokeAccountAsync("ana");

        Assert.True(presence.IsRevoked("ana", "old-session", before));
        Assert.False(presence.IsRevoked("ana", "new-session", DateTimeOffset.UtcNow.AddSeconds(2)));
        Assert.False(presence.IsRevoked("bia", "other", before));
    }

    [Fact]
    public async Task Stalled_preview_recipient_is_cancelled_without_blocking_other_registrations()
    {
        var registry = new TelaeRegistry();
        registry.RegisterAccountDevice("ana", "ana", "Ana", "ana-connection");
        registry.RegisterAccountDevice("bia", "bia", "Bia", "bia-connection");
        registry.DeclareFriends("ana", ["bia"]);
        registry.DeclareFriends("bia", ["ana"]);
        registry.StartShare("ana", "auto");
        var proxy = new TestProxy { Stall = true };
        var presence = new PresenceSubscriptions(registry, new TestHubContext(proxy));
        var publishing = presence.PublishPreviewAsync("ana-connection", SharePreviewTests.Jpeg);
        await proxy.Started.Task;
        var registering = presence.RegisterAsync(new RegisterDeviceRequest("caio", "Caio", "", "caio"), "caio-connection", authenticatedAccount: true);

        await registering.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.False(publishing.IsCompleted);
        await presence.RevokeAccountAsync("bia").WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Null(registry.FindConnectionId("bia"));
        await publishing.WaitAsync(PresenceSubscriptions.PublicationTimeout + TimeSpan.FromSeconds(3));

        Assert.True(proxy.Cancelled);
        Assert.Equal("caio-connection", registry.FindConnectionId("caio"));
    }

    private sealed class TestProxy : IClientProxy
    {
        public bool Stall { get; init; }
        public bool Cancelled { get; private set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
        {
            Started.TrySetResult();
            if (!Stall) return;
            try { await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); }
            finally { Cancelled = cancellationToken.IsCancellationRequested; }
        }
    }

    private sealed class TestHubContext(IClientProxy proxy) : IHubContext<TelaeHub>
    {
        public IHubClients Clients { get; } = new TestClients(proxy);
        public IGroupManager Groups => throw new NotSupportedException();
    }

    private sealed class TestClients(IClientProxy proxy) : IHubClients
    {
        public IClientProxy All => proxy;
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => proxy;
        public IClientProxy Client(string connectionId) => proxy;
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => proxy;
        public IClientProxy Group(string groupName) => proxy;
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => proxy;
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => proxy;
        public IClientProxy User(string userId) => proxy;
        public IClientProxy Users(IReadOnlyList<string> userIds) => proxy;
    }
}
