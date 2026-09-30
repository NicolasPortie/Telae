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
  ViewerLeftEvent,
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
  viewerCount: number
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
    if (/failed to fetch|failed to complete negotiation|networkerror|websocket|typeerror|^error:|^http error/i.test(cleaned)) {
      return fallback
    }
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
  private readonly viewerQuality = new Map<string, QualityController>()
  private signaling: SignalingClient | null = null
  private peer: WebRtcPeer | null = null
  private readonly sharerPeers = new Map<string, WebRtcPeer>()
  private readonly connectedViewers = new Set<string>()
  private readonly pendingSignals: SignalingEnvelope[] = []
  private iceServers: IceServerDto[] = []
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
  private startInFlight = false
  private joiningInFlight = false
  private switchingInFlight = false
  private sampling = false
  private readonly viewerRestartAttempts = new Map<string, number>()
  private readonly viewerReconnectTimers = new Map<string, number>()

  constructor() {
    this.capture.subscribe(() => {
      if (this.capture.getSnapshot().state === 'ended' && this.localStream) void this.leave()
    })
  }

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
      viewerCount: this.sharerPeers.size,
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
      client.on('viewerLeft', (event) => this.handleViewerLeft(event)),
      client.on('signalReceived', (envelope) => void this.handleSignal(envelope)),
      client.on('sessionEnded', (sessionId) => this.handleSessionEnded(sessionId)),
      client.on('connectionChanged', (status) => this.handleSignalingChanged(status)),
    ]
    try {
      const device = await client.connect(saved.deviceId, name, saved.deviceSecret)
      this.signalingStatus = 'online'
      this.emit()
      return device
    } catch (error) {
      throw new Error(toUserMessage(error, 'Não foi possível conectar ao Telae. Verifique sua internet e tente novamente.'))
    }
  }

  async startSharing(sourceId: string, quality: QualityProfile): Promise<void> {
    if (this.startInFlight || this.joiningInFlight) throw new Error('Aguarde a operação atual terminar.')
    this.startInFlight = true
    try { await this.startSharingInternal(sourceId, quality) }
    finally { this.startInFlight = false }
  }

  private async startSharingInternal(sourceId: string, quality: QualityProfile): Promise<void> {
    const signaling = this.requireSignaling()
    if (this.role === 'viewer' && !['idle', 'ended'].includes(this.state))
      throw new Error('Saia da transmissão atual antes de compartilhar sua tela.')

    // Defesa contra navegação/duplo acionamento: uma transmissão local ativa
    // troca de fonte em vez de tentar criar uma segunda sessão no servidor.
    if (this.role === 'sharer' && this.session && this.localStream && !['idle', 'ended'].includes(this.state)) {
      await this.switchSource(sourceId)
      return
    }

    // Recupera versões anteriores da UI que podiam perder o estado local sem
    // encerrar a sessão remota. Ao iniciar uma nova transmissão, limpa apenas
    // uma sessão órfã deste mesmo dispositivo antes de criar a nova.
    const generation = ++this.generation
    this.teardownPeer()
    this.capture.reset()
    this.role = 'sharer'
    this.quality = quality
    this.includeAudio = true
    this.viewerPresence = 'none'
    this.viewerName = null
    this.setState('preparing')

    try {
      const staleShare = await signaling.getActiveShare()
      if (generation !== this.generation) return
      if (staleShare) await signaling.stopShare()
      if (generation !== this.generation) return
      const stream = await this.capture.start(sourceId, quality)
      if (generation !== this.generation) return
      if (!this.capture.getSnapshot().hasStream) throw new Error('A fonte escolhida foi encerrada. Selecione outra fonte.')
      this.localStream = stream
      this.includeAudio = this.localStream.getAudioTracks().length > 0
      const access = await signaling.startShare(quality)
      if (generation !== this.generation) {
        void signaling.stopShare().catch(() => undefined)
        return
      }
      this.session = access.session
      this.iceServers = access.iceServers
      const invite = await signaling.createInvite()
      if (generation !== this.generation) return
      this.inviteCode = invite.code
      this.inviteExpiresAt = invite.expiresAt
      this.setState('waiting-for-peer')
    } catch (error) {
      if (generation !== this.generation) return
      if (this.session) {
        void signaling.stopShare().catch(() => undefined)
      }
      this.teardownLocal()
      this.teardownPeer()
      this.session = null
      this.inviteCode = null
      this.inviteExpiresAt = null
      this.role = null
      this.setState('idle', toUserMessage(error, 'Não foi possível iniciar o Share Session.'))
      throw new Error(this.error ?? 'Não foi possível iniciar o Share Session.')
    }
  }

  async joinWithInvite(inviteCode: string): Promise<void> {
    if (this.startInFlight || this.joiningInFlight || (this.role !== null && !['idle', 'ended'].includes(this.state)))
      throw new Error('Encerre a sessão atual antes de entrar em outra.')
    const signaling = this.requireSignaling()
    const code = inviteCode.trim().replaceAll('-', '').toUpperCase()
    if (!code) throw new Error('Digite o código de convite.')
    this.joiningInFlight = true
    const generation = ++this.generation
    this.teardownPeer()
    this.role = 'viewer'
    this.setState('joining')

    try {
      const access = await signaling.joinWithInvite(code)
      if (generation !== this.generation) {
        void signaling.leaveShare().catch(() => undefined)
        return
      }
      this.session = access.session
      this.peerDeviceId = access.session.sharerDeviceId
      this.quality = (access.session.qualityProfile as QualityProfile) ?? 'auto'
      const pendingSignals = this.pendingSignals.splice(0)
      this.createPeer(access.iceServers, null)
      this.setState('negotiating')
      this.scheduleRestart(10_000)
      for (const pending of pendingSignals) {
        if (generation !== this.generation) return
        if (pending.sessionId === access.session.sessionId) await this.handleSignal(pending)
      }
    } catch (error) {
      if (generation !== this.generation) return
      void signaling.leaveShare().catch(() => undefined)
      this.teardownPeer()
      this.session = null
      this.role = null
      this.setState('idle', toUserMessage(error, 'Não foi possível entrar na transmissão.'))
      throw new Error(this.error ?? 'Não foi possível entrar na transmissão.')
    } finally {
      this.joiningInFlight = false
    }
  }

  async switchSource(sourceId: string): Promise<void> {
    if (this.role !== 'sharer' || !this.session || !this.localStream)
      throw new Error('Inicie a transmissão antes de trocar a fonte.')
    if (this.switchingInFlight) throw new Error('Aguarde a troca de fonte terminar.')
    this.switchingInFlight = true
    const generation = this.generation
    try {
      const { previous, current } = await this.capture.switchSource(sourceId, this.quality)
      try {
        if (generation !== this.generation) throw new Error('A transmissão foi encerrada durante a troca de fonte.')
        this.localStream = current
        this.includeAudio = current.getAudioTracks().length > 0
        this.emit()
        await Promise.all([...this.sharerPeers.values()].map((peer) => peer.replaceLocalStream(current)))
      } finally {
        this.capture.release(previous)
      }
    } finally {
      this.switchingInFlight = false
    }
  }

  async leave(): Promise<void> {
    ++this.generation
    const signaling = this.signaling
    const role = this.role
    this.role = null
    this.teardownLocal()
    this.teardownPeer()
    this.session = null
    this.inviteCode = null
    this.inviteExpiresAt = null
    this.viewerPresence = 'none'
    this.setState('ended')
    if (role === 'sharer') void signaling?.stopShare().catch(() => undefined)
    else if (role === 'viewer') void signaling?.leaveShare().catch(() => undefined)
  }

  resetToIdle() {
    if (this.session && this.role && !['idle', 'ended'].includes(this.state)) return
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
    this.teardownLocal()
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
      onStatus: (status) => { if (this.peer === peer) this.handlePeerStatus(status) },
    })
    this.peer = peer
    this.startDiagnosticsLoop()
  }

  private async handleViewerJoined(event: ViewerJoinedEvent) {
    if (this.role !== 'sharer' || this.session?.sessionId !== event.sessionId) return
    const viewerId = event.viewer.deviceId
    this.sharerPeers.get(viewerId)?.close()
    this.clearReconnectTimer(viewerId)
    this.viewerRestartAttempts.delete(viewerId)
    this.viewerQuality.set(viewerId, new QualityController())
    this.connectedViewers.delete(viewerId)
    const signaling = this.signaling
    const sessionId = this.session.sessionId
    const peer = new WebRtcPeer({
      iceServers: this.iceServers,
      qualityProfile: this.quality,
      ...(this.localStream ? { localStream: this.localStream } : {}),
      sendSignal: async (payload) => {
        await signaling?.sendSignal(viewerId, { sessionId, fromDeviceId: this.deviceId, payload })
      },
      onRemoteStream: () => undefined,
      onStatus: (status) => { if (this.sharerPeers.get(viewerId) === peer) this.handlePeerStatus(status, viewerId) },
    })
    this.sharerPeers.set(viewerId, peer)
    this.startDiagnosticsLoop()
    this.viewerName = event.viewer.displayName
    this.viewerPresence = 'joining'
    this.setState(this.connectedViewers.size ? 'live' : 'negotiating')
    this.scheduleRestart(10_000, viewerId)
    try {
      await peer.createOffer()
    } catch (error) {
      if (this.sharerPeers.get(viewerId) !== peer) return
      peer.close()
      this.sharerPeers.delete(viewerId)
      this.clearReconnectTimer(viewerId)
      this.viewerQuality.delete(viewerId)
      this.setState(this.connectedViewers.size ? 'live' : this.sharerPeers.size ? 'negotiating' : 'waiting-for-peer', toUserMessage(error, 'Não foi possível negociar com o Viewer.'))
    }
  }

  private handleViewerLeft(event: ViewerLeftEvent) {
    if (this.role !== 'sharer' || this.session?.sessionId !== event.sessionId) return
    this.sharerPeers.get(event.viewerDeviceId)?.close()
    this.sharerPeers.delete(event.viewerDeviceId)
    this.clearReconnectTimer(event.viewerDeviceId)
    this.viewerRestartAttempts.delete(event.viewerDeviceId)
    this.viewerQuality.delete(event.viewerDeviceId)
    this.connectedViewers.delete(event.viewerDeviceId)
    this.viewerPresence = this.connectedViewers.size ? 'live' : this.sharerPeers.size ? 'joining' : 'gone'
    this.setState(this.connectedViewers.size ? 'live' : this.sharerPeers.size ? 'negotiating' : 'waiting-for-peer')
  }

  private async handleSignal(envelope: SignalingEnvelope) {
    if (this.role === 'viewer' && !this.peer && this.state === 'joining') {
      this.pendingSignals.push(envelope)
      return
    }
    if (this.session?.sessionId !== envelope.sessionId) return
    const peer = this.role === 'sharer' ? this.sharerPeers.get(envelope.fromDeviceId) : this.peer
    if (!peer) return
    const generation = this.generation
    try {
      const wasOffer = envelope.payload.kind === 'offer'
      await peer.handleSignal(envelope.payload)
      if (generation !== this.generation) return
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
    ++this.generation
    this.teardownLocal()
    this.teardownPeer()
    this.session = null
    const wasViewer = this.role === 'viewer'
    this.role = null
    this.inviteCode = null
    this.inviteExpiresAt = null
    this.setState('ended', wasViewer ? 'O Sharer encerrou a transmissão.' : null)
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

  private handlePeerStatus(status: PeerStatus, viewerId?: string) {
    if (viewerId) {
      if (status === 'connected') {
        this.clearReconnectTimer(viewerId)
        this.viewerRestartAttempts.delete(viewerId)
        this.connectedViewers.add(viewerId)
        this.viewerPresence = 'live'
        this.liveSinceMs ??= Date.now()
        this.setState('live')
      } else if (status === 'disconnected' || status === 'failed') {
        this.connectedViewers.delete(viewerId)
        if (this.connectedViewers.size === 0) this.setState('reconnecting', 'Reconectando espectadores…')
        this.scheduleRestart(status === 'failed' ? 0 : 2000, viewerId)
      }
      return
    }
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

  private scheduleRestart(delayMs: number, viewerId?: string) {
    this.clearReconnectTimer(viewerId)
    const timer = window.setTimeout(() => {
      void this.attemptRestart('Tentando restabelecer a mídia…', viewerId)
    }, delayMs)
    if (viewerId) this.viewerReconnectTimers.set(viewerId, timer)
    else this.reconnectTimer = timer
  }

  private clearReconnectTimer(viewerId?: string) {
    if (viewerId) {
      const timer = this.viewerReconnectTimers.get(viewerId)
      if (timer !== undefined) window.clearTimeout(timer)
      this.viewerReconnectTimers.delete(viewerId)
      return
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async attemptRestart(message: string, viewerId?: string) {
    const peer = viewerId ? this.sharerPeers.get(viewerId) : this.peer
    if (!peer || this.state === 'ended' || this.state === 'idle') return
    const attempts = viewerId ? this.viewerRestartAttempts.get(viewerId) ?? 0 : this.restartAttempts
    if (attempts >= MAX_RESTART_ATTEMPTS) {
      this.clearReconnectTimer(viewerId)
      if (viewerId) {
        peer.close()
        this.sharerPeers.delete(viewerId)
        this.viewerQuality.delete(viewerId)
        this.viewerRestartAttempts.delete(viewerId)
        this.connectedViewers.delete(viewerId)
        this.viewerPresence = this.connectedViewers.size ? 'live' : 'gone'
        this.setState(this.connectedViewers.size ? 'live' : 'waiting-for-peer', 'Um espectador perdeu a conexão. Ele pode entrar novamente com o convite.')
      } else {
        void this.leave()
        this.setState('ended', 'Não foi possível restabelecer a conexão. Tente entrar novamente.')
      }
      return
    }
    if (viewerId) this.viewerRestartAttempts.set(viewerId, attempts + 1)
    else this.restartAttempts = attempts + 1
    if (!viewerId || this.connectedViewers.size === 0)
      this.setState('reconnecting', `${message} (tentativa ${attempts + 1}/${MAX_RESTART_ATTEMPTS})`)
    // O prazo cobre também chamadas de sinalização pendentes e ofertas sem resposta.
    this.scheduleRestart(10_000, viewerId)
    try {
      const servers = await this.signaling?.getTurnCredentials()
      if ((viewerId ? this.sharerPeers.get(viewerId) : this.peer) !== peer) return
      if (servers) peer.updateIceServers(servers)
      await peer.restartIce()
    } catch {
      // A próxima tentativa já tem prazo, mesmo quando o envio falha.
    }
  }

  private startDiagnosticsLoop() {
    this.clearDiagnosticsTimer()
    this.diagnosticsTimer = window.setInterval(() => {
      if (this.sampling) return
      const generation = this.generation
      this.sampling = true
      void (async () => {
        try {
          const peers = this.role === 'sharer' ? [...this.sharerPeers.entries()] : this.peer ? [['', this.peer] as const] : []
          const samples = await Promise.all(peers.map(async ([id, peer]) => {
            try { return { id, peer, stats: await peer.getDiagnostics() } } catch { return null }
          }))
          if (generation !== this.generation) return
          const valid = samples.filter((sample) => sample !== null).filter((sample) =>
            this.role === 'sharer' ? this.sharerPeers.get(sample.id) === sample.peer : this.peer === sample.peer)
          if (!valid.length) return
          const score = (stats: DiagnosticsSnapshot) => (stats.packetLossPercent ?? 0) * 100 + (stats.roundTripMs ?? 0)
          const stats = { ...valid.reduce((worst, sample) => score(sample.stats) > score(worst.stats) ? sample : worst).stats }
          // Amostra vazia antes do primeiro par selecionado: não polui a UI.
          if (stats.bitrateKbps === 0 && stats.roundTripMs === null && stats.transportPath === null) return
          this.diagnostics = stats
          if (this.role === 'sharer' && this.state === 'live') {
            this.diagnostics.bitrateKbps = valid.reduce((sum, sample) => sum + sample.stats.bitrateKbps, 0)
            await Promise.all(valid.map(async ({ id, peer, stats: peerStats }) => {
              const controller = this.viewerQuality.get(id)
              if (!controller) return
              const decision = controller.decide(this.quality, peerStats)
              await peer.applyQuality(decision.maxBitrateBps, decision.degradationPreference)
            }))
          }
          if (generation !== this.generation) return
          this.emit()
        } catch {
          // Amostragem de diagnóstico nunca derruba a sessão.
        } finally {
          this.sampling = false
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
    for (const id of this.viewerReconnectTimers.keys()) this.clearReconnectTimer(id)
  }

  private teardownPeer() {
    this.clearTimers()
    this.peer?.close()
    this.peer = null
    for (const peer of this.sharerPeers.values()) peer.close()
    this.sharerPeers.clear()
    this.connectedViewers.clear()
    this.viewerQuality.clear()
    this.viewerRestartAttempts.clear()
    this.pendingSignals.length = 0
    this.remoteStream = null
    this.diagnostics = EMPTY_DIAGNOSTICS
    this.restartAttempts = 0
  }

  private teardownLocal() {
    this.localStream = null
    this.capture.stop()
    this.liveSinceMs = null
  }

  private detachSignaling() {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    void this.signaling?.disconnect().catch(() => undefined)
    this.signaling = null
  }
}
