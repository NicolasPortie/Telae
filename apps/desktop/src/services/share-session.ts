import { QualityController } from './quality-controller'
import { SignalingClient } from './signaling'
import { StreamController } from './stream-controller'
import type { DeviceSnapshot } from './types'
import { WebRtcPeer } from './webrtc'
import type {
  ConnectionStatus,
  DiagnosticsSnapshot,
  IceServerDto,
  PeerStatus,
  QualityProfile,
  ShareSessionSnapshot,
  SignalingEnvelope,
  TransportPath,
  ViewerJoinedEvent,
} from './types'

export type SessionRole = 'sharer' | 'viewer'

/** Modelo canônico de Share Session (ARCHITECTURE.md) + joining do Viewer. */
export type SessionState =
  | 'idle'
  | 'preparing'
  | 'waiting-for-peer'
  | 'joining'
  | 'negotiating'
  | 'live'
  | 'reconnecting'
  | 'ended'

export type ViewerPresence = 'none' | 'joining' | 'live' | 'gone'

export type ConnectionQuality = 'good' | 'degraded' | 'poor' | 'unknown'

export type SessionSnapshot = {
  state: SessionState
  role: SessionRole | null
  error: string | null
  session: ShareSessionSnapshot | null
  inviteCode: string | null
  inviteExpiresAt: string | null
  viewerPresence: ViewerPresence
  viewerName: string | null
  quality: QualityProfile
  includeAudio: boolean
  diagnostics: DiagnosticsSnapshot
  transportPath: TransportPath
  connectionQuality: ConnectionQuality
  liveSinceMs: number | null
  signaling: ConnectionStatus
  hasLocalStream: boolean
  hasRemoteStream: boolean
}

const EMPTY_DIAGNOSTICS: DiagnosticsSnapshot = {
  bitrateKbps: 0,
  roundTripMs: null,
  packetLossPercent: null,
  framesPerSecond: null,
  codec: null,
  jitterMs: null,
  width: null,
  height: null,
  availableOutgoingKbps: null,
  transportPath: null,
  candidateType: null,
}

const MAX_RESTART_ATTEMPTS = 3

function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    const cleaned = error.message.replace(/^HubException:\s*/i, '').replace(/^Server returned an error:\s*/i, '').trim()
    return cleaned || fallback
  }
  return fallback
}

/**
 * ShareSessionController — módulo profundo dos Tickets 02–07.
 *
 * Interface pequena: connect / startSharing / joinWithInvite / leave /
 * subscribe / getSnapshot / media getters. A UI renderiza o snapshot;
 * ela nunca coordena captura, SDP, ICE ou qualidade diretamente.
 */
export class ShareSessionController {
  private readonly capture = new StreamController()
  private readonly qualityController = new QualityController()
  private signaling: SignalingClient | null = null
  private peer: WebRtcPeer | null = null
  private readonly listeners = new Set<() => void>()

  private state: SessionState = 'idle'
  private role: SessionRole | null = null
  private error: string | null = null
  private session: ShareSessionSnapshot | null = null
  private inviteCode: string | null = null
  private inviteExpiresAt: string | null = null
  private viewerPresence: ViewerPresence = 'none'
  private viewerName: string | null = null
  private quality: QualityProfile = 'auto'
  private includeAudio = true
  private diagnostics: DiagnosticsSnapshot = EMPTY_DIAGNOSTICS
  private liveSinceMs: number | null = null
  private signalingStatus: ConnectionStatus = 'offline'
  private deviceId = ''
  private peerDeviceId: string | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private generation = 0
  private restartAttempts = 0
  private reconnectTimer: number | null = null
  private diagnosticsTimer: number | null = null
  private unsubscribers: (() => void)[] = []

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  getSnapshot(): SessionSnapshot {
    const loss = this.diagnostics.packetLossPercent
    const rtt = this.diagnostics.roundTripMs
    let connectionQuality: ConnectionQuality = 'unknown'
    if (loss !== null || rtt !== null) {
      connectionQuality =
        (loss ?? 0) > 10 || (rtt ?? 0) > 500
          ? 'poor'
          : (loss ?? 0) > 3 || (rtt ?? 0) > 250
            ? 'degraded'
            : 'good'
    }
    return {
      state: this.state,
      role: this.role,
      error: this.error,
      session: this.session,
      inviteCode: this.inviteCode,
      inviteExpiresAt: this.inviteExpiresAt,
      viewerPresence: this.viewerPresence,
      viewerName: this.viewerName,
      quality: this.quality,
      includeAudio: this.includeAudio,
      diagnostics: this.diagnostics,
      transportPath: this.diagnostics.transportPath,
      connectionQuality,
      liveSinceMs: this.liveSinceMs,
      signaling: this.signalingStatus,
      hasLocalStream: this.localStream !== null,
      hasRemoteStream: this.remoteStream !== null,
    }
  }

  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream
  }

  private setState(state: SessionState, error: string | null = null) {
    this.state = state
    this.error = error
    this.emit()
  }

  async connect(displayName?: string): Promise<DeviceSnapshot> {
    if (typeof window === 'undefined' || typeof window.telae === 'undefined') {
      throw new Error('Abra o Telae pelo Electron para conectar.')
    }
    this.detachSignaling()
    const profile = await window.telae.getLocalProfile()
    const name = (displayName ?? profile.displayName).trim()
    if (!name) throw new Error('Informe seu nome para entrar.')
    const saved = name !== profile.displayName ? await window.telae.setDisplayName(name) : profile
    this.deviceId = saved.deviceId

    const environment = await window.telae.getEnvironment()
    const client = new SignalingClient(environment.signalingUrl)
    this.signaling = client
    this.unsubscribers = [
      client.on('viewerJoined', (event) => void this.handleViewerJoined(event)),
      client.on('viewerLeft', (sessionId) => this.handleViewerLeft(sessionId)),
      client.on('signalReceived', (envelope) => void this.handleSignal(envelope)),
      client.on('sessionEnded', (sessionId) => this.handleSessionEnded(sessionId)),
      client.on('connectionChanged', (status) => this.handleSignalingChanged(status)),
    ]
    try {
      const device = await client.connect(saved.deviceId, name)
      this.signalingStatus = 'online'
      this.emit()
      return device
    } catch (error) {
      throw new Error(toUserMessage(error, 'Não foi possível conectar ao serviço de sinalização.'))
    }
  }

  async startSharing(sourceId: string, quality: QualityProfile, includeAudio: boolean): Promise<void> {
    const signaling = this.requireSignaling()
    const generation = ++this.generation
    this.teardownPeer()
    this.capture.reset()
    this.role = 'sharer'
    this.quality = quality
    this.includeAudio = includeAudio
    this.qualityController.reset()
    this.viewerPresence = 'none'
    this.viewerName = null
    this.setState('preparing')

    try {
      this.localStream = await this.capture.start(sourceId, quality, includeAudio)
      if (generation !== this.generation) return
      const access = await signaling.startShare(quality)
      if (generation !== this.generation) return
      this.session = access.session
      this.createPeer(access.iceServers, this.localStream)
      const invite = await signaling.createInvite()
      if (generation !== this.generation) return
      this.inviteCode = invite.code
      this.inviteExpiresAt = invite.expiresAt
      this.setState('waiting-for-peer')
    } catch (error) {
      if (generation !== this.generation) return
      this.teardownLocal()
      this.setState('idle', toUserMessage(error, 'Não foi possível iniciar o Share Session.'))
      throw new Error(this.error ?? 'Não foi possível iniciar o Share Session.')
    }
  }

  async joinWithInvite(inviteCode: string): Promise<void> {
    const signaling = this.requireSignaling()
    const code = inviteCode.trim().replaceAll('-', '').toUpperCase()
    if (!code) throw new Error('Digite o código de convite.')
    const generation = ++this.generation
    this.teardownPeer()
    this.role = 'viewer'
    this.setState('joining')

    try {
      const access = await signaling.joinWithInvite(code)
      if (generation !== this.generation) return
      this.session = access.session
      this.peerDeviceId = access.session.sharerDeviceId
      this.quality = (access.session.qualityProfile as QualityProfile) ?? 'auto'
      this.createPeer(access.iceServers, null)
      this.setState('negotiating')
    } catch (error) {
      if (generation !== this.generation) return
      this.setState('idle', toUserMessage(error, 'Não foi possível entrar na transmissão.'))
      throw new Error(this.error ?? 'Não foi possível entrar na transmissão.')
    }
  }

  async leave(): Promise<void> {
    const generation = ++this.generation
    void generation
    const signaling = this.signaling
    try {
      if (this.role === 'sharer') await signaling?.stopShare()
      else if (this.role === 'viewer') await signaling?.leaveShare()
    } catch {
      // Sair localmente mesmo se a sinalização falhar (offline).
    }
    this.teardownLocal()
    this.teardownPeer()
    this.session = null
    this.inviteCode = null
    this.role = null
    this.viewerPresence = 'none'
    this.setState('ended')
  }

  resetToIdle() {
    this.generation += 1
    this.teardownLocal()
    this.teardownPeer()
    this.session = null
    this.inviteCode = null
    this.role = null
    this.viewerPresence = 'none'
    this.setState('idle')
  }

  dispose() {
    this.generation += 1
    this.clearTimers()
    this.teardownPeer()
    this.capture.stop()
    this.detachSignaling()
  }

  // ---- private ----

  private requireSignaling(): SignalingClient {
    if (!this.signaling) throw new Error('Conecte-se antes de iniciar um Share Session.')
    return this.signaling
  }

  private createPeer(iceServers: IceServerDto[], localStream: MediaStream | null) {
    this.teardownPeer()
    const signaling = this.signaling
    const peer = new WebRtcPeer({
      iceServers,
      qualityProfile: this.quality,
      ...(localStream ? { localStream } : {}),
      sendSignal: async (payload) => {
        const target = this.peerDeviceId
        const sessionId = this.session?.sessionId
        if (!signaling || !target || !sessionId) return
        await signaling.sendSignal(target, { sessionId, fromDeviceId: this.deviceId, payload })
      },
      onRemoteStream: (stream) => {
        this.remoteStream = stream
        if (this.state === 'negotiating' || this.state === 'reconnecting') {
          this.liveSinceMs ??= Date.now()
          this.setState('live')
        } else {
          this.emit()
        }
      },
      onStatus: (status) => this.handlePeerStatus(status),
    })
    this.peer = peer
    this.startDiagnosticsLoop()
  }

  private async handleViewerJoined(event: ViewerJoinedEvent) {
    if (this.role !== 'sharer' || this.session?.sessionId !== event.sessionId) return
    this.peerDeviceId = event.viewer.deviceId
    this.viewerName = event.viewer.displayName
    this.viewerPresence = 'joining'
    this.setState('negotiating')
    try {
      await this.peer?.createOffer()
    } catch (error) {
      this.setState('waiting-for-peer', toUserMessage(error, 'Não foi possível negociar com o Viewer.'))
    }
  }

  private handleViewerLeft(sessionId: string) {
    if (this.role !== 'sharer' || this.session?.sessionId !== sessionId) return
    this.peerDeviceId = null
    this.viewerPresence = 'gone'
    this.teardownPeer()
    if (this.session) this.createPeerSilent()
    this.setState('waiting-for-peer')
  }

  /** Recria o peer do Sharer sem refazer a captura (Viewer saiu; sessão continua). */
  private createPeerSilent() {
    if (!this.localStream || !this.session) return
    void this.signaling
      ?.getTurnCredentials()
      .then((iceServers) => {
        if (this.role === 'sharer' && this.session) this.createPeer(iceServers, this.localStream)
      })
      .catch(() => undefined)
  }

  private async handleSignal(envelope: SignalingEnvelope) {
    if (this.session?.sessionId !== envelope.sessionId || !this.peer) return
    if (!this.peerDeviceId) this.peerDeviceId = envelope.fromDeviceId
    try {
      const wasOffer = envelope.payload.kind === 'offer'
      await this.peer.handleSignal(envelope.payload)
      if (wasOffer && this.role === 'viewer' && this.state !== 'live') {
        this.setState('negotiating')
      }
    } catch {
      if (this.state === 'negotiating') {
        this.setState(this.role === 'viewer' ? 'joining' : 'waiting-for-peer', 'Falha ao negociar a conexão. Tentando de novo…')
      }
    }
  }

  private handleSessionEnded(sessionId: string) {
    if (this.session?.sessionId !== sessionId) return
    this.teardownLocal()
    this.teardownPeer()
    this.session = null
    this.setState('ended', this.role === 'viewer' ? 'O Sharer encerrou a transmissão.' : null)
  }

  private handleSignalingChanged(status: ConnectionStatus) {
    this.signalingStatus = status
    if (status === 'online' && (this.state === 'live' || this.state === 'reconnecting') && this.peer) {
      void this.peer.getDiagnostics().then((stats) => {
        if ((stats.roundTripMs ?? 0) === 0 && stats.bitrateKbps === 0) void this.attemptRestart('Sinalização reconectada. Restabelecendo mídia…')
      }).catch(() => undefined)
    }
    this.emit()
  }

  private handlePeerStatus(status: PeerStatus) {
    if (status === 'connected') {
      this.restartAttempts = 0
      this.clearReconnectTimer()
      if (this.state === 'negotiating' || this.state === 'reconnecting') {
        this.liveSinceMs ??= Date.now()
        if (this.role === 'sharer') this.viewerPresence = 'live'
        this.setState('live')
      } else {
        this.emit()
      }
      return
    }
    if (status === 'disconnected') {
      if (this.state === 'live' || this.state === 'negotiating') {
        this.setState('reconnecting', 'Conexão instável. Tentando restabelecer…')
        this.scheduleRestart(2000)
      }
      return
    }
    if (status === 'failed') {
      if (this.state === 'live' || this.state === 'negotiating' || this.state === 'reconnecting') {
        void this.attemptRestart('A conexão falhou. Tentando restabelecer…')
      }
    }
  }

  private scheduleRestart(delayMs: number) {
    this.clearReconnectTimer()
    this.reconnectTimer = window.setTimeout(() => {
      void this.attemptRestart('Tentando restabelecer a mídia…')
    }, delayMs)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async attemptRestart(message: string) {
    if (!this.peer || this.state === 'ended' || this.state === 'idle') return
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.clearReconnectTimer()
      this.setState('ended', 'Não foi possível restabelecer a conexão. Tente um novo Share Session.')
      return
    }
    this.restartAttempts += 1
    this.setState('reconnecting', `${message} (tentativa ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS})`)
    try {
      await this.peer.restartIce()
    } catch {
      this.scheduleRestart(3000)
    }
  }

  private startDiagnosticsLoop() {
    this.clearDiagnosticsTimer()
    this.diagnosticsTimer = window.setInterval(() => {
      void (async () => {
        if (!this.peer) return
        try {
          const stats = await this.peer.getDiagnostics()
          // Amostra vazia antes do primeiro par selecionado: não polui a UI.
          if (stats.bitrateKbps === 0 && stats.roundTripMs === null && stats.transportPath === null) return
          this.diagnostics = stats
          if (this.role === 'sharer' && this.state === 'live') {
            const decision = this.qualityController.decide(this.quality, stats)
            await this.peer.applyQuality(decision.maxBitrateBps, decision.degradationPreference)
          }
          this.emit()
        } catch {
          // Amostragem de diagnóstico nunca derruba a sessão.
        }
      })()
    }, 1000)
  }

  private clearDiagnosticsTimer() {
    if (this.diagnosticsTimer !== null) {
      window.clearInterval(this.diagnosticsTimer)
      this.diagnosticsTimer = null
    }
  }

  private clearTimers() {
    this.clearReconnectTimer()
    this.clearDiagnosticsTimer()
  }

  private teardownPeer() {
    this.clearTimers()
    this.peer?.close()
    this.peer = null
    this.remoteStream = null
    this.diagnostics = EMPTY_DIAGNOSTICS
    this.restartAttempts = 0
  }

  private teardownLocal() {
    this.capture.stop()
    this.localStream = null
    this.liveSinceMs = null
  }

  private detachSignaling() {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    void this.signaling?.disconnect().catch(() => undefined)
    this.signaling = null
  }
}
