import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from '@microsoft/signalr'
import type {
  ConnectionStatus,
  DeviceSnapshot,
  IceServerDto,
  QualityProfile,
  ShareAccessResult,
  ShareSessionSnapshot,
  SignalingEnvelope,
  ViewerJoinedEvent,
  ViewerLeftEvent,
} from './types'

type Events = {
  presenceChanged: (device: DeviceSnapshot) => void
  friendRequestReceived: (device: DeviceSnapshot) => void
  viewerJoined: (event: ViewerJoinedEvent) => void
  viewerLeft: (event: ViewerLeftEvent) => void
  signalReceived: (envelope: SignalingEnvelope) => void
  sessionEnded: (sessionId: string) => void
  shareQualityChanged: (session: ShareSessionSnapshot) => void
  connectionChanged: (status: ConnectionStatus) => void
}

export class SignalingClient {
  private readonly connection: HubConnection
  private readonly listeners = new Map<keyof Events, Set<(...args: never[]) => void>>()
  private deviceId = ''
  private displayName = ''

  constructor(baseUrl: string) {
    this.connection = new HubConnectionBuilder()
      // O token de acesso é pedido ao processo principal a cada (re)conexão, então nunca vai vencido.
      .withUrl(`${baseUrl.replace(/\/$/, '')}/hubs/telae`, {
        accessTokenFactory: async () => (await window.telae.auth.getAccessToken()) ?? '',
      })
      .withAutomaticReconnect([0, 1000, 2500, 5000, 8000])
      .configureLogging(LogLevel.Warning)
      .build()

    this.connection.on('PresenceChanged', (device: DeviceSnapshot) => this.emit('presenceChanged', device))
    this.connection.on('FriendRequestReceived', (device: DeviceSnapshot) => this.emit('friendRequestReceived', device))
    this.connection.on('ViewerJoined', (event: ViewerJoinedEvent) => this.emit('viewerJoined', event))
    this.connection.on('ViewerLeft', (event: ViewerLeftEvent) => this.emit('viewerLeft', event))
    this.connection.on('SignalReceived', (envelope: SignalingEnvelope) => this.emit('signalReceived', envelope))
    this.connection.on('ShareQualityChanged', (session: ShareSessionSnapshot) => this.emit('shareQualityChanged', session))
    this.connection.on('SessionEnded', (sessionId: string) => this.emit('sessionEnded', sessionId))

    this.connection.onreconnecting(() => this.emit('connectionChanged', 'reconnecting'))
    this.connection.onreconnected(async () => {
      try {
        if (this.deviceId && this.displayName) {
          await this.connection.invoke('RegisterDevice', { deviceId: this.deviceId, displayName: this.displayName, deviceSecret: '' })
        }
        await this.connection.invoke('GetFriends', [])
        this.emit('connectionChanged', 'online')
      } catch {
        this.emit('connectionChanged', 'offline')
      }
    })
    this.connection.onclose(() => this.emit('connectionChanged', 'offline'))
  }

  on<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    const bucket = this.listeners.get(event) ?? new Set()
    bucket.add(listener as (...args: never[]) => void)
    this.listeners.set(event, bucket)
    return () => bucket.delete(listener as (...args: never[]) => void)
  }

  private emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) {
    for (const listener of this.listeners.get(event) ?? []) {
      ;(listener as (...emitArgs: unknown[]) => void)(...(args as unknown[]))
    }
  }

  /** A identidade vem do token da conta; `deviceId` e `displayName` só espelham o que o servidor confirma. */
  async connect(deviceId: string, displayName: string): Promise<DeviceSnapshot> {
    this.deviceId = deviceId
    this.displayName = displayName
    this.emit('connectionChanged', 'connecting')
    if (this.connection.state === HubConnectionState.Disconnected) await this.connection.start()
    const device = await this.connection.invoke<DeviceSnapshot>('RegisterDevice', { deviceId, displayName, deviceSecret: '' })
    this.emit('connectionChanged', 'online')
    return device
  }

  async disconnect() {
    if (this.connection.state !== HubConnectionState.Disconnected) await this.connection.stop()
  }

  lookupFriend(friendCode: string) {
    return this.connection.invoke<DeviceSnapshot | null>('LookupFriend', friendCode)
  }

  getFriendRequests() {
    return this.connection.invoke<DeviceSnapshot[]>('GetFriendRequests')
  }

  dismissFriendRequest(friendCode: string) {
    return this.connection.invoke('DismissFriendRequest', friendCode)
  }

  /** Lista de amigos da conta (vem do servidor, igual em todos os aparelhos), com a presença de cada um. */
  getFriends() {
    return this.connection.invoke<DeviceSnapshot[]>('GetFriends', [])
  }

  /** Adiciona pelo @usuário. O servidor valida e devolve quem foi adicionado. */
  addFriend(username: string) {
    return this.connection.invoke<DeviceSnapshot>('AddFriend', username)
  }

  removeFriend(username: string) {
    return this.connection.invoke('RemoveFriend', username)
  }

  joinFriendShare(friendCode: string) {
    return this.connection.invoke<ShareAccessResult>('JoinFriendShare', friendCode)
  }

  startShare(qualityProfile: QualityProfile) {
    return this.connection.invoke<ShareAccessResult>('StartShare', {
      deviceId: this.deviceId,
      qualityProfile,
    })
  }

  updateShareQuality(qualityProfile: QualityProfile) {
    return this.connection.invoke('UpdateShareQuality', qualityProfile)
  }

  removeViewer(viewerDeviceId: string) {
    return this.connection.invoke('RemoveViewer', viewerDeviceId)
  }

  getActiveShare() {
    return this.connection.invoke<ShareAccessResult['session'] | null>('GetActiveShare')
  }

  stopShare() {
    return this.connection.invoke('StopShare')
  }

  getTurnCredentials() {
    return this.connection.invoke<IceServerDto[]>('GetTurnCredentials')
  }

  leaveShare() {
    return this.connection.invoke('LeaveShare')
  }

  sendSignal(targetDeviceId: string, envelope: SignalingEnvelope) {
    return this.connection.invoke('SendSignal', targetDeviceId, envelope)
  }
}
