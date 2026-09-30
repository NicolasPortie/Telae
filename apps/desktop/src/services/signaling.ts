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
  InviteSnapshot,
  QualityProfile,
  ShareAccessResult,
  SignalingEnvelope,
  ViewerJoinedEvent,
  ViewerLeftEvent,
} from './types'

type Events = {
  presenceChanged: (device: DeviceSnapshot) => void
  viewerJoined: (event: ViewerJoinedEvent) => void
  viewerLeft: (event: ViewerLeftEvent) => void
  signalReceived: (envelope: SignalingEnvelope) => void
  sessionEnded: (sessionId: string) => void
  connectionChanged: (status: ConnectionStatus) => void
}

export class SignalingClient {
  private readonly connection: HubConnection
  private readonly listeners = new Map<keyof Events, Set<(...args: never[]) => void>>()
  private deviceId = ''
  private displayName = ''
  private deviceSecret = ''

  constructor(baseUrl: string) {
    this.connection = new HubConnectionBuilder()
      .withUrl(`${baseUrl.replace(/\/$/, '')}/hubs/telae`)
      .withAutomaticReconnect([0, 1000, 2500, 5000, 8000])
      .configureLogging(LogLevel.Warning)
      .build()

    this.connection.on('PresenceChanged', (device: DeviceSnapshot) => this.emit('presenceChanged', device))
    this.connection.on('ViewerJoined', (event: ViewerJoinedEvent) => this.emit('viewerJoined', event))
    this.connection.on('ViewerLeft', (event: ViewerLeftEvent) => this.emit('viewerLeft', event))
    this.connection.on('SignalReceived', (envelope: SignalingEnvelope) => this.emit('signalReceived', envelope))
    this.connection.on('SessionEnded', (sessionId: string) => this.emit('sessionEnded', sessionId))

    this.connection.onreconnecting(() => this.emit('connectionChanged', 'reconnecting'))
    this.connection.onreconnected(async () => {
      try {
        if (this.deviceId && this.displayName) {
          await this.connection.invoke('RegisterDevice', { deviceId: this.deviceId, displayName: this.displayName, deviceSecret: this.deviceSecret })
        }
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

  async connect(deviceId: string, displayName: string, deviceSecret: string): Promise<DeviceSnapshot> {
    this.deviceId = deviceId
    this.displayName = displayName
    this.deviceSecret = deviceSecret
    this.emit('connectionChanged', 'connecting')
    if (this.connection.state === HubConnectionState.Disconnected) await this.connection.start()
    const device = await this.connection.invoke<DeviceSnapshot>('RegisterDevice', { deviceId, displayName, deviceSecret })
    this.emit('connectionChanged', 'online')
    return device
  }

  async disconnect() {
    if (this.connection.state !== HubConnectionState.Disconnected) await this.connection.stop()
  }

  lookupFriend(friendCode: string) {
    return this.connection.invoke<DeviceSnapshot | null>('LookupFriend', friendCode)
  }

  getFriends(friendCodes: string[]) {
    if (friendCodes.length === 0) return Promise.resolve([] as DeviceSnapshot[])
    return this.connection.invoke<DeviceSnapshot[]>('GetFriends', friendCodes)
  }

  startShare(qualityProfile: QualityProfile) {
    return this.connection.invoke<ShareAccessResult>('StartShare', {
      deviceId: this.deviceId,
      qualityProfile,
    })
  }

  getActiveShare() {
    return this.connection.invoke<ShareAccessResult['session'] | null>('GetActiveShare')
  }

  stopShare() {
    return this.connection.invoke('StopShare')
  }

  joinShare(sharerDeviceId: string) {
    return this.connection.invoke<ShareAccessResult>('JoinShare', sharerDeviceId)
  }

  createInvite() {
    return this.connection.invoke<InviteSnapshot>('CreateInvite')
  }

  joinWithInvite(inviteCode: string) {
    return this.connection.invoke<ShareAccessResult>('JoinWithInvite', inviteCode)
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
