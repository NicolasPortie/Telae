using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Telae.Server.Accounts;

namespace Telae.Server.Tests;

public sealed class HiddenViewersTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), "telae-hidden-" + Guid.NewGuid().ToString("N") + ".db");
    private readonly ServiceProvider _services;
    private readonly Guid _ownerId = Guid.NewGuid();

    public HiddenViewersTests()
    {
        var services = new ServiceCollection();
        services.AddDbContext<TelaeDbContext>(options => options.UseSqlite($"Data Source={_path};Pooling=False"));
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<HiddenViewersService>();
        _services = services.BuildServiceProvider();
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TelaeDbContext>();
        db.Database.EnsureCreated();
        db.Accounts.Add(Person("owner", _ownerId));
        db.SaveChanges();
    }

    private static Account Person(string username, Guid? id = null) => new()
    {
        Id = id ?? Guid.NewGuid(), Username = username, NormalizedUsername = username,
        Email = $"{username}@example.com", NormalizedEmail = $"{username}@example.com",
        DisplayName = username, EmailVerified = true,
    };

    public void Dispose()
    {
        _services.Dispose();
        File.Delete(_path);
    }

    [Fact]
    public async Task Concurrent_requests_in_separate_scopes_cannot_exceed_the_account_limit()
    {
        using (var scope = _services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TelaeDbContext>();
            var existing = Enumerable.Range(0, HiddenViewersService.MaxHidden - 1).Select(index => Person($"hidden{index}")).ToArray();
            db.Accounts.AddRange(existing);
            db.Accounts.AddRange(Enumerable.Range(0, 12).Select(index => Person($"candidate{index}")));
            db.HiddenViewers.AddRange(existing.Select(person => new HiddenViewer { AccountId = _ownerId, HiddenId = person.Id }));
            await db.SaveChangesAsync();
        }

        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var attempts = Enumerable.Range(0, 12).Select(index => Task.Run(async () =>
        {
            await start.Task;
            using var scope = _services.CreateScope();
            try
            {
                await scope.ServiceProvider.GetRequiredService<HiddenViewersService>().HideAsync(_ownerId, $"candidate{index}", default);
                return true;
            }
            catch (AccountException error) when (error.Code == "too_many_hidden") { return false; }
        })).ToArray();
        start.SetResult();

        Assert.Equal(1, (await Task.WhenAll(attempts)).Count(success => success));
        using var check = _services.CreateScope();
        Assert.Equal(HiddenViewersService.MaxHidden, await check.ServiceProvider.GetRequiredService<TelaeDbContext>().HiddenViewers.CountAsync());
    }

    [Fact]
    public async Task Hiding_twice_is_idempotent_and_unhiding_keeps_the_friendship()
    {
        var target = Person("friend");
        using (var scope = _services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TelaeDbContext>();
            db.Accounts.Add(target);
            db.Friendships.Add(new Friendship { AccountId = _ownerId, FriendId = target.Id });
            await db.SaveChangesAsync();
        }

        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(async () =>
        {
            using var scope = _services.CreateScope();
            var hidden = await scope.ServiceProvider.GetRequiredService<HiddenViewersService>().HideAsync(_ownerId, "@FRIEND", default);
            Assert.Equal(target.Id, hidden.Id);
        })));
        using (var scope = _services.CreateScope())
        {
            var service = scope.ServiceProvider.GetRequiredService<HiddenViewersService>();
            Assert.Equal([target.Id], await service.ListIdsAsync(_ownerId, default));
            await service.UnhideAsync(_ownerId, "friend", default);
            await service.UnhideAsync(_ownerId, "friend", default);
        }

        using var check = _services.CreateScope();
        var database = check.ServiceProvider.GetRequiredService<TelaeDbContext>();
        Assert.Empty(await database.HiddenViewers.ToListAsync());
        Assert.Single(await database.Friendships.ToListAsync());
    }

    [Fact]
    public async Task A_later_change_waits_for_the_previous_change_to_reach_live_access()
    {
        using (var scope = _services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TelaeDbContext>();
            db.Accounts.Add(Person("friend"));
            await db.SaveChangesAsync();
        }
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var resume = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var live = false;
        using var firstScope = _services.CreateScope();
        using var secondScope = _services.CreateScope();
        var first = firstScope.ServiceProvider.GetRequiredService<HiddenViewersService>().HideAsync(_ownerId, "friend", default,
            async _ => { entered.SetResult(); await resume.Task; live = true; });
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var second = secondScope.ServiceProvider.GetRequiredService<HiddenViewersService>().UnhideAsync(_ownerId, "friend", default,
            _ => { live = false; return Task.CompletedTask; });
        try
        {
            await Assert.ThrowsAsync<TimeoutException>(() => second.WaitAsync(TimeSpan.FromMilliseconds(200)));
        }
        finally { resume.SetResult(); }
        await Task.WhenAll((Task)first, second);

        Assert.False(live);
        using var check = _services.CreateScope();
        Assert.Empty(await check.ServiceProvider.GetRequiredService<TelaeDbContext>().HiddenViewers.ToListAsync());
    }

    [Fact]
    public async Task Startup_adds_hidden_viewers_to_an_existing_database_without_losing_accounts_or_friendships()
    {
        var friend = Person("existingfriend");
        using (var scope = _services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TelaeDbContext>();
            db.Accounts.Add(friend);
            db.Friendships.Add(new Friendship { AccountId = _ownerId, FriendId = friend.Id });
            await db.SaveChangesAsync();
            // Simula o esquema anterior: todas as tabelas de contas já existem, exceto a nova lista de ocultos.
            await db.Database.ExecuteSqlRawAsync("DROP TABLE \"HiddenViewers\"");
        }

        await _services.InitializeAccountsDatabaseAsync();

        using (var scope = _services.CreateScope())
        {
            var service = scope.ServiceProvider.GetRequiredService<HiddenViewersService>();
            Assert.Empty(await service.ListIdsAsync(_ownerId, default));
            Assert.Equal(friend.Id, (await service.HideAsync(_ownerId, "existingfriend", default)).Id);
        }

        using var check = _services.CreateScope();
        var database = check.ServiceProvider.GetRequiredService<TelaeDbContext>();
        Assert.Equal(2, await database.Accounts.CountAsync());
        Assert.Equal("owner", (await database.Accounts.SingleAsync(account => account.Id == _ownerId)).Username);
        Assert.Equal("existingfriend", (await database.Accounts.SingleAsync(account => account.Id == friend.Id)).Username);
        var friendship = await database.Friendships.SingleAsync();
        Assert.Equal((_ownerId, friend.Id), (friendship.AccountId, friendship.FriendId));
        var hidden = await database.HiddenViewers.SingleAsync();
        Assert.Equal((_ownerId, friend.Id), (hidden.AccountId, hidden.HiddenId));
    }
}
