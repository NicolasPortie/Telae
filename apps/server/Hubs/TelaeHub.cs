using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Telae.Server.Accounts;
using Telae.Server.Core;

namespace Telae.Server.Hubs;

public sealed class TelaeHub(
    TelaeRegistry registry,
    DisconnectCoordinator disconnectCoordinator,
    PresenceSubscriptions presence,
    IOptions<IceConfiguration> iceConfiguration,
    IOptions<TurnConfiguration> turnConfiguration,
    IServiceProvider services) : Hub
{
    public async Task<DeviceSnapshot> RegisterDevice(RegisterDeviceRequest request)
    {
        if (Context.User?.Identity?.IsAuthenticated == true)
        {
            // Conta autenticada: a identidade vem do token, nunca do que o cliente informa.
            var accountId = Context.User.FindFirstValue(TokenService.AccountIdClaim);
            var accounts = services.GetService<AccountService>();
            var account = Guid.TryParse(accountId, out var id) && accounts is not null
                ? await accounts.FindActiveAsync(id, Context.ConnectionAborted)
                : null;
            if (account is null) throw new TelaeDomainException("session_expired", "Sua sessão acabou. Entra de novo.");
            return await presence.RegisterAsync(
                new RegisterDeviceRequest(account.Id.ToString(), account.DisplayName, "", account.Username), Context.ConnectionId,
                authenticatedAccount: true, sessionId: Context.User.FindFirstValue(TokenService.SessionIdClaim),
                authorize: () => accounts!.IsSessionActiveAsync(Context.User, Context.ConnectionAborted));
        }

        if (request is null) throw new TelaeDomainException("invalid_request", "Não deu pra registrar este aparelho. Reinicia o app e tenta de novo.");
        var allowLegacy = services.GetService<IOptions<AuthOptions>>()?.Value.AllowLegacyDevices ?? true;
        if (!allowLegacy) throw new TelaeDomainException("login_required", "Entra na sua conta pra continuar.");
        return await presence.RegisterAsync(request, Context.ConnectionId);
    }

    /// <summary>Conta autenticada desta conexão (token validado), ou nulo no caminho legado.</summary>
    private Guid? AuthenticatedAccountId() =>
        Context.User?.Identity?.IsAuthenticated == true && Guid.TryParse(Context.User.FindFirstValue(TokenService.AccountIdClaim), out var id) ? id : null;

    private FriendsService Friends() =>
        services.GetService<FriendsService>() ?? throw new TelaeDomainException("accounts_unavailable", "Esse servidor não oferece contas.");

    private static TelaeDomainException FriendFailure(AccountException error) => error.Code switch
    {
        "friend_not_found" => new TelaeDomainException("friend_not_found", "Não deu pra achar ninguém com esse @. Confere e tenta de novo."),
        "cannot_add_self" => new TelaeDomainException("cannot_add_self", "Você não pode se adicionar."),
        "already_friends" => new TelaeDomainException("already_friends", "Esse amigo já está na sua lista."),
        "too_many_friends" => new TelaeDomainException("too_many_friends", "Sua lista chegou ao limite de 200 amigos."),
        _ => new TelaeDomainException("invalid_friend_code", "Esse @ não parece certo. Usa de 3 a 20 letras, números ou _."),
    };

    private DeviceSnapshot ProfileOf(FriendAccount account) =>
        registry.EnsureAccountProfile(account.Id.ToString(), account.Username, account.DisplayName);

    public async Task<DeviceSnapshot?> LookupFriend(string friendCode)
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        if (AuthenticatedAccountId() is null)
            return registry.FindByFriendCode(friendCode) is { } device ? registry.ForObserver(deviceId, device) : null;
        try
        {
            var found = await Friends().FindByUsernameAsync(friendCode, Context.ConnectionAborted);
            return found is null ? null : registry.ForObserver(deviceId, ProfileOf(found));
        }
        catch (AccountException error) { throw FriendFailure(error); }
    }

    /// <summary>
    /// Declara a lista de amigos da conexão e devolve cada um com a presença atual. Contas ignoram o argumento:
    /// a lista vem do banco, então é a mesma em todos os aparelhos.
    /// </summary>
    public async Task<IReadOnlyList<DeviceSnapshot>> GetFriends(string[] friendCodes)
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var account = AuthenticatedAccountId();
        if (account is not null)
            friendCodes = (await Friends().ListAsync(account.Value, Context.ConnectionAborted)).Select(friend =>
            {
                ProfileOf(friend);
                return friend.Username;
            }).ToArray();
        if (friendCodes is null || friendCodes.Length > 200)
            throw new TelaeDomainException("invalid_friend_list", "A lista de amigos pode ter até 200 pessoas.");
        // Quem deixou de ser amigo (de qualquer um dos lados) sai da transmissão em andamento.
        var declared = await presence.DeclareFriendsAsync(Context.ConnectionId, friendCodes);
        foreach (var detachment in declared.Detached)
        {
            await NotifyAsync(detachment.ViewerDeviceId, "SessionEnded", detachment.SessionId);
            await NotifyAsync(detachment.SharerDeviceId, "ViewerLeft",
                new ViewerLeftEvent(detachment.SessionId, detachment.ViewerDeviceId));
        }
        // Contas só avisam o alvo quando o pedido é feito (AddFriend); reconectar não repete o aviso.
        if (account is null)
        {
            var requester = registry.GetDevice(deviceId);
            if (requester is not null)
                foreach (var targetId in declared.NewRequestDeviceIds)
                    await NotifyAsync(targetId, "FriendRequestReceived", registry.ForObserver(targetId, requester));
        }
        return registry.GetDevicesByFriendCodes(friendCodes).Select(friend => registry.ForObserver(deviceId, friend)).ToArray();
    }

    /// <summary>Adiciona um amigo pelo @usuário (só contas) e avisa quem foi adicionado, se estiver online.</summary>
    public async Task<DeviceSnapshot> AddFriend(string username)
    {
        var account = AuthenticatedAccountId() ?? throw new TelaeDomainException("login_required", "Entra na sua conta pra continuar.");
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        FriendAccount friend;
        try { friend = await Friends().AddAsync(account, username, Context.ConnectionAborted); }
        catch (AccountException error) { throw FriendFailure(error); }

        var snapshot = ProfileOf(friend);
        await GetFriends([]);
        // Se a outra pessoa já tinha adicionado de volta, é amizade mútua e não há pedido a avisar.
        var requester = registry.GetDevice(deviceId);
        if (requester is not null && !registry.AreMutualFriends(deviceId, friend.Id.ToString()))
            await NotifyAsync(friend.Id.ToString(), "FriendRequestReceived", registry.ForObserver(friend.Id.ToString(), requester));
        return registry.ForObserver(deviceId, snapshot);
    }

    public async Task RemoveFriend(string username)
    {
        var account = AuthenticatedAccountId() ?? throw new TelaeDomainException("login_required", "Entra na sua conta pra continuar.");
        registry.GetDeviceIdForConnection(Context.ConnectionId);
        try { await Friends().RemoveAsync(account, username, Context.ConnectionAborted); }
        catch (AccountException error) { throw FriendFailure(error); }
        await GetFriends([]);
    }

    public async Task<IReadOnlyList<DeviceSnapshot>> GetFriendRequests()
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        if (AuthenticatedAccountId() is not { } account)
            return registry.GetFriendRequests(deviceId).Select(friend => registry.ForObserver(deviceId, friend)).ToArray();
        var pending = await Friends().PendingRequestsAsync(account, Context.ConnectionAborted);
        return pending.Select(friend => registry.ForObserver(deviceId, ProfileOf(friend))).ToArray();
    }

    public async Task DismissFriendRequest(string friendCode)
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        if (AuthenticatedAccountId() is { } account)
        {
            try { await Friends().DismissAsync(account, friendCode, Context.ConnectionAborted); }
            catch (AccountException error) { throw FriendFailure(error); }
            return;
        }
        registry.DismissFriendRequest(deviceId, friendCode);
    }

    public async Task<ShareAccessResult> StartShare(StartShareRequest request)
    {
        if (request is null) throw new TelaeDomainException("invalid_request", "Não deu pra iniciar a transmissão. Tenta de novo.");
        EnsureCallerMatches(request.DeviceId);
        var session = registry.StartShare(request.DeviceId, request.QualityProfile);
        await presence.PublishAsync(registry.GetDevice(request.DeviceId)!);
        return new ShareAccessResult(session, GetIceServers(request.DeviceId));
    }

    /// <summary>Miniatura da tela de quem transmite, repassada aos amigos mútuos online.</summary>
    public async Task PublishSharePreview(string image)
    {
        await presence.PublishPreviewAsync(Context.ConnectionId, image);
    }

    public Task<IReadOnlyList<SharePreviewEvent>> GetFriendPreviews()
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        return Task.FromResult(registry.GetFriendPreviews(deviceId));
    }

    public Task<ShareSessionSnapshot?> GetActiveShare()
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        return Task.FromResult(registry.GetActiveSessionForSharer(deviceId));
    }

    public async Task StopShare()
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var session = await presence.StopShareAsync(Context.ConnectionId);

        foreach (var viewerDeviceId in session.ViewerDeviceIds)
        {
            try
            {
                await Clients.Client(registry.GetConnectionId(viewerDeviceId))
                    .SendAsync("SessionEnded", session.SessionId);
            }
            catch (TelaeDomainException) { }
        }

        await presence.PublishAsync(registry.GetDevice(deviceId)!);
    }

    public async Task<ShareSessionSnapshot> RemoveViewer(string viewerDeviceId)
    {
        var session = await presence.RemoveViewerAsync(Context.ConnectionId, viewerDeviceId);
        try
        {
            await Clients.Client(registry.GetConnectionId(viewerDeviceId)).SendAsync("SessionEnded", session.SessionId);
        }
        catch (TelaeDomainException) { }
        await Clients.Caller.SendAsync("ViewerLeft", new ViewerLeftEvent(session.SessionId, viewerDeviceId));
        return session;
    }

    public async Task<ShareSessionSnapshot> UpdateShareQuality(string qualityProfile)
    {
        var sharerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var session = registry.UpdateShareQuality(sharerDeviceId, qualityProfile);
        await presence.PublishAsync(registry.GetDevice(sharerDeviceId)!);
        foreach (var viewer in session.ViewerDeviceIds)
        {
            try
            {
                await Clients.Client(registry.GetConnectionId(viewer)).SendAsync("ShareQualityChanged", session);
            }
            catch (TelaeDomainException) { }
        }
        return session;
    }

    public Task<InviteSnapshot> CreateInvite()
    {
        var sharerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        return Task.FromResult(registry.CreateInvite(sharerDeviceId));
    }

    public async Task<ShareAccessResult> JoinWithInvite(string inviteCode)
    {
        var viewerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var session = registry.JoinWithInvite(viewerDeviceId, inviteCode);
        await Clients.Client(registry.GetConnectionId(session.SharerDeviceId)).SendAsync(
            "ViewerJoined",
            new ViewerJoinedEvent(session.SessionId, registry.GetDevice(viewerDeviceId)!));
        return new ShareAccessResult(session, GetIceServers(viewerDeviceId));
    }

    public Task<IReadOnlyList<IceServerDto>> GetTurnCredentials()
    {
        var deviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        return Task.FromResult(GetIceServers(deviceId));
    }

    public async Task<ShareAccessResult> JoinShare(string sharerDeviceId)
    {
        var viewerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var session = registry.JoinShare(viewerDeviceId, sharerDeviceId);
        await Clients.Client(registry.GetConnectionId(sharerDeviceId)).SendAsync(
            "ViewerJoined",
            new ViewerJoinedEvent(session.SessionId, registry.GetDevice(viewerDeviceId)!));
        return new ShareAccessResult(session, GetIceServers(viewerDeviceId));
    }

    public async Task<ShareAccessResult> JoinFriendShare(string friendCode)
    {
        var viewerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var result = registry.JoinFriendShare(viewerDeviceId, friendCode);
        // A troca já foi aplicada no registro: as notificações não podem lançar exceção aqui.
        if (result.Detached is { } detached)
            await NotifyAsync(detached.SharerDeviceId, "ViewerLeft",
                new ViewerLeftEvent(detached.SessionId, detached.ViewerDeviceId));
        await NotifyAsync(result.Session.SharerDeviceId, "ViewerJoined",
            new ViewerJoinedEvent(result.Session.SessionId, registry.GetDevice(viewerDeviceId)!));
        return new ShareAccessResult(result.Session, GetIceServers(viewerDeviceId));
    }

    public async Task LeaveShare()
    {
        var viewerDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        var result = registry.LeaveShare(viewerDeviceId);
        if (result.Session is not null && result.SharerConnectionId is not null && result.ViewerDeviceId is not null)
            await Clients.Client(result.SharerConnectionId).SendAsync("ViewerLeft", new ViewerLeftEvent(result.Session.SessionId, result.ViewerDeviceId));
    }

    public async Task SendSignal(string targetDeviceId, SignalingEnvelope envelope)
    {
        var fromDeviceId = registry.GetDeviceIdForConnection(Context.ConnectionId);
        if (string.IsNullOrWhiteSpace(targetDeviceId) || targetDeviceId.Length > 128 ||
            envelope?.Payload is null || string.IsNullOrWhiteSpace(envelope.SessionId) || envelope.SessionId.Length > 128 ||
            string.IsNullOrWhiteSpace(envelope.FromDeviceId) || envelope.FromDeviceId.Length > 128 ||
            envelope.Payload.Kind is not ("offer" or "answer" or "candidate") ||
            (envelope.Payload.Kind is "offer" or "answer" && string.IsNullOrWhiteSpace(envelope.Payload.Sdp)) ||
            envelope.Payload.Sdp?.Length > 65_536 || envelope.Payload.Candidate?.Candidate?.Length > 4096 ||
            envelope.Payload.Candidate?.SdpMid?.Length > 256 || envelope.Payload.Candidate?.UsernameFragment?.Length > 256)
            throw new TelaeDomainException("invalid_signal", "Não deu pra completar a conexão. Tenta entrar de novo.");
        if (!string.Equals(fromDeviceId, envelope.FromDeviceId, StringComparison.Ordinal))
            throw new TelaeDomainException("invalid_signal_sender", "Não deu pra completar a conexão. Tenta entrar de novo.");

        await presence.SendSignalAsync(Context.ConnectionId, targetDeviceId, envelope);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await presence.RemoveAsync(Context.ConnectionId);
        disconnectCoordinator.Schedule(registry.BeginDisconnect(Context.ConnectionId));
        await base.OnDisconnectedAsync(exception);
    }

    private IReadOnlyList<IceServerDto> GetIceServers(string deviceId)
    {
        var servers = iceConfiguration.Value.Servers.Count > 0
            ? iceConfiguration.Value.Servers
            : new List<IceServerDto> { new(["stun:stun.l.google.com:19302"]) };

        var turn = turnConfiguration.Value;
        if (string.IsNullOrWhiteSpace(turn.Secret) || turn.Urls.Length == 0)
            return servers;

        var (username, password) = TurnCredentialIssuer.Issue(
            turn.Secret, deviceId, DateTimeOffset.UtcNow, turn.TtlSeconds);
        return [.. servers, new IceServerDto(turn.Urls, username, password)];
    }

    private async Task NotifyAsync(string deviceId, string method, object payload)
    {
        var connectionId = registry.FindConnectionId(deviceId);
        if (connectionId is not null)
            await Clients.Client(connectionId).SendAsync(method, payload);
    }

    private void EnsureCallerMatches(string deviceId)
    {
        if (registry.GetDeviceIdForConnection(Context.ConnectionId) != deviceId)
            throw new TelaeDomainException("device_mismatch", "Não deu pra completar a conexão. Tenta entrar de novo.");
    }
}
