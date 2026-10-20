import { t } from '../i18n'
import { getProcessAudioDiagnostics } from './capture'
import { PROFILE_CEILINGS, QualityController } from './quality-controller'
import { qualityConstraints, qualityContentMode, qualityFramerate } from './quality-profiles'
import { applyVideoConstraints, getVideoConstraints } from './video-scaler'
import { SignalingClient } from './signaling'
import { StreamController } from './stream-controller'
import type { DeviceSnapshot } from './types'
import { WebRtcPeer } from './webrtc'
import type {
  ConnectionStatus,
  ContentMode,
  DiagnosticsSnapshot,
  IceServerDto,
  PeerStatus,
  QualityProfile,
  ShareAccessResult,
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
  viewerPresence: ViewerPresence
  viewerName: string | null
  viewerCount: number
  viewers: Array<{ deviceId: string; displayName: string; state: string }>
  contentMode: ContentMode
  audioMuted: boolean
  uploadBudgetMbps: number
  relayAvailable: boolean
  audioBuffer: ReturnType<typeof getProcessAudioDiagnostics>
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
// Estados em que o Viewer já está ligado a uma transmissão (troca de amigo sem passar por idle).
const VIEWING_STATES: SessionState[] = ['joining', 'negotiating', 'live', 'reconnecting']

function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    const cleaned = error.message.replace(/^HubException:\s*/i, '').replace(/^Server returned an error:\s*/i, '').trim()
    if (/failed to fetch|failed to complete negotiation|networkerror|websocket|typeerror|^error:|^http error/i.test(cleaned)) {
      return fallback
    }
    // Mensagens de domínio do servidor chegam em português; o catálogo traduz as conhecidas.
    return cleaned ? t(cleaned) : fallback
  }
  return fallback
}

/**
 * ShareSessionController — orquestra sinalização, captura e transporte de uma Share Session.
 *
 * Interface pequena: connect / startSharing / joinFriendShare / leave /
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
  private myFriendCode: string | null = null
  // Verdadeiro entre o pedido de entrada e a resposta do servidor: sinais chegam antes do fim do join.
  private joinPending = false
  private viewerPresence: ViewerPresence = 'none'
  private viewerName: string | null = null
  private quality: QualityProfile = '1080p30'
  private includeAudio = true
  private contentMode: ContentMode = 'text'
  private audioMuted = false
  private uploadBudgetMbps = 40
  private forceRelay = false
  private framePresented = false
  private readonly viewerNames = new Map<string, string>()
  private readonly viewerStates = new Map<string, PeerStatus>()
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
      viewerPresence: this.viewerPresence,
      viewerName: this.viewerName,
      viewerCount: this.connectedViewers.size,
      viewers: [...this.sharerPeers.keys()].map(deviceId => ({ deviceId, displayName: this.viewerNames.get(deviceId) ?? 'Espectador', state: this.viewerStates.get(deviceId) ?? 'connecting' })),
      contentMode: this.contentMode,
      audioMuted: this.audioMuted,
      uploadBudgetMbps: this.uploadBudgetMbps,
      relayAvailable: this.iceServers.some(server => server.urls.some(url => /^turns?:/i.test(url))),
      audioBuffer: getProcessAudioDiagnostics(this.localStream),
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

  async fetchFriends(friendCodes: string[]): Promise<DeviceSnapshot[]> {
    const signaling = this.requireSignaling()
    return signaling.getFriends(friendCodes)
  }

  lookupFriend(friendCode: string): Promise<DeviceSnapshot | null> {
    return this.requireSignaling().lookupFriend(friendCode)
  }

  getMyFriendCode(): string | null {
    return this.myFriendCode
  }

  onPresenceChanged(listener: (device: DeviceSnapshot) => void): () => void {
    if (!this.signaling) return () => undefined
    return this.signaling.on('presenceChanged', listener)
  }

  fetchFriendRequests(): Promise<DeviceSnapshot[]> {
    return this.requireSignaling().getFriendRequests()
  }

  dismissFriendRequest(friendCode: string): Promise<void> {
    return this.requireSignaling().dismissFriendRequest(friendCode).then(() => undefined)
  }

  onFriendRequest(listener: (device: DeviceSnapshot) => void): () => void {
    if (!this.signaling) return () => undefined
    return this.signaling.on('friendRequestReceived', listener)
  }

  /** Conecta com a conta da sessão atual; o servidor confirma a identidade pelo token de acesso. */
  async connect(): Promise<DeviceSnapshot> {
    if (typeof window === 'undefined' || typeof window.telae === 'undefined') {
      throw new Error('Abra o Telae pelo Electron para conectar.')
    }
    this.detachSignaling()
    const account = await window.telae.auth.getSession()
    if (!account) throw new Error(t('Entre na sua conta para continuar.'))
    const saved = await window.telae.getLocalProfile()
    this.deviceId = account.id

    const environment = await window.telae.getEnvironment()
    this.forceRelay = environment.forceRelay === true
    const client = new SignalingClient(environment.signalingUrl)
    this.signaling = client
    this.unsubscribers = [
      client.on('presenceChanged', () => this.emit()),
      client.on('viewerJoined', (event) => void this.handleViewerJoined(event)),
      client.on('viewerLeft', (event) => this.handleViewerLeft(event)),
      client.on('signalReceived', (envelope) => void this.handleSignal(envelope)),
      client.on('sessionEnded', (sessionId) => this.handleSessionEnded(sessionId)),
      client.on('shareQualityChanged', (session) => {
        if (this.role === 'viewer' && this.session?.sessionId === session.sessionId) { this.session = session; this.quality = session.qualityProfile; this.emit() }
      }),
      client.on('connectionChanged', (status) => this.handleSignalingChanged(status)),
    ]
    try {
      const device = await client.connect(account.id, account.displayName)
      this.myFriendCode = device.friendCode ?? null
      this.signalingStatus = 'online'
      this.emit()
      // Declara a lista de amigos local: o servidor só libera entrada por amizade mútua.
      // Sempre enviada (mesmo vazia) para que revogações pendentes sejam aplicadas.
      try {
        await client.getFriends(saved.friendCodes ?? [])
      } catch { /* presença e amizade são restauradas na próxima conexão */ }
      return device
    } catch (error) {
      throw new Error(toUserMessage(error, t('Não foi possível conectar ao Telae. Verifique sua internet e tente novamente.')))
    }
  }

  async startSharing(sourceId: string, quality: QualityProfile): Promise<void> {
    if (this.startInFlight || this.joiningInFlight) throw new Error(t('Aguarde a operação atual terminar.'))
    this.startInFlight = true
    try { await this.startSharingInternal(sourceId, quality) }
    finally { this.startInFlight = false }
  }

  private async startSharingInternal(sourceId: string, quality: QualityProfile): Promise<void> {
    const signaling = this.requireSignaling()
    if (this.role === 'viewer' && !['idle', 'ended'].includes(this.state))
      throw new Error(t('Saia da transmissão atual antes de compartilhar sua tela.'))

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
    this.audioMuted = false
    this.contentMode = qualityContentMode(quality)
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
      if (!this.capture.getSnapshot().hasStream) throw new Error(t('A fonte escolhida foi encerrada. Selecione outra fonte.'))
      this.localStream = stream
      const video = stream.getVideoTracks()[0]
      if (video) video.contentHint = this.contentMode === 'motion' ? 'motion' : 'detail'
      this.includeAudio = this.localStream.getAudioTracks().length > 0
      const access = await signaling.startShare(quality)
      if (generation !== this.generation) {
        void signaling.stopShare().catch(() => undefined)
        return
      }
      this.session = access.session
      this.iceServers = access.iceServers
      this.validateRelayConfiguration()
      this.setState('waiting-for-peer')
    } catch (error) {
      if (generation !== this.generation) return
      if (this.session) {
        void signaling.stopShare().catch(() => undefined)
      }
      this.teardownLocal()
      this.teardownPeer()
      this.session = null
      this.role = null
      this.setState('idle', toUserMessage(error, t('Não foi possível iniciar a transmissão.')))
      throw new Error(this.error ?? t('Não foi possível iniciar a transmissão.'))
    }
  }

  /**
   * Entra na transmissão de um amigo mútuo. Se o espectador já assiste outro amigo, o servidor
   * faz a troca em uma única operação: se ela for recusada, a transmissão atual continua.
   */
  async joinFriendShare(friendCode: string): Promise<void> {
    const code = friendCode.trim().replaceAll('-', '').toUpperCase()
    if (!code || code.length !== 6) throw new Error(t('Código de amigo deve ter 6 caracteres.'))
    if (this.startInFlight || this.joiningInFlight) throw new Error(t('Aguarde a operação atual terminar.'))
    if (this.role === 'sharer' && !['idle', 'ended'].includes(this.state))
      throw new Error(t('Encerre sua transmissão antes de assistir a um amigo.'))
    const signaling = this.requireSignaling()
    const switching = this.role === 'viewer' && VIEWING_STATES.includes(this.state)
    const generation = this.generation
    if (!switching) {
      this.teardownPeer()
      this.role = 'viewer'
      this.setState('joining')
    }

    this.joiningInFlight = true
    this.joinPending = true
    let access: ShareAccessResult
    try {
      access = await signaling.joinFriendShare(code)
    } catch (error) {
      this.joinPending = false
      this.pendingSignals.length = 0
      this.joiningInFlight = false
      const message = toUserMessage(error, t('Não foi possível entrar na transmissão do amigo.'))
      if (generation !== this.generation) throw new Error(message)
      if (!switching) {
        // Nada foi anexado no servidor: a entrada anterior (se houver) já foi liberada localmente.
        this.session = null
        this.role = null
        this.setState('idle', message)
      }
      // Na troca, a transmissão atual permanece intacta.
      throw new Error(message)
    }

    this.joinPending = false
    const pending = this.pendingSignals.splice(0)
    try {
      if (generation !== this.generation) {
        // A sessão terminou ou o usuário saiu durante a chamada: desfaz a entrada no servidor.
        void signaling.leaveShare().catch(() => undefined)
        return
      }
      this.validateRelayConfiguration(access.iceServers)
      const next = ++this.generation
      this.teardownPeer()
      this.liveSinceMs = null
      this.role = 'viewer'
      this.session = access.session
      this.iceServers = access.iceServers
      this.peerDeviceId = access.session.sharerDeviceId
      this.quality = (access.session.qualityProfile as QualityProfile) ?? '1080p30'
      this.createPeer(access.iceServers, null)
      this.setState('negotiating')
      this.scheduleRestart(10_000)
      for (const env of pending) {
        if (next !== this.generation) return
        if (env.sessionId === access.session.sessionId) await this.handleSignal(env)
      }
    } catch (error) {
      // O servidor já anexou o espectador: desfaz a entrada e encerra o estado local.
      void signaling.leaveShare().catch(() => undefined)
      this.teardownPeer()
      this.session = null
      this.role = null
      this.liveSinceMs = null
      this.setState('idle', toUserMessage(error, t('Não foi possível entrar na transmissão do amigo.')))
      throw new Error(this.error ?? t('Não foi possível entrar na transmissão do amigo.'))
    } finally {
      this.joiningInFlight = false
    }
  }

  async switchSource(sourceId: string): Promise<void> {
    if (this.role !== 'sharer' || !this.session || !this.localStream)
      throw new Error(t('Inicie a transmissão antes de trocar a fonte.'))
    if (this.switchingInFlight) throw new Error(t('Aguarde a troca de fonte terminar.'))
    this.switchingInFlight = true
    const generation = this.generation
    try {
      const transaction = await this.capture.prepareSwitch(sourceId, this.quality)
      const { previous, current } = transaction
      const peers = [...this.sharerPeers.entries()]
      try {
        if (generation !== this.generation) return
        for (const track of current.getAudioTracks()) track.enabled = !this.audioMuted
        const video = current.getVideoTracks()[0]
        if (video) video.contentHint = this.contentMode === 'motion' ? 'motion' : 'detail'
        if (video && this.quality === 'auto' && this.contentMode === 'motion') {
          await applyVideoConstraints(current, qualityConstraints(this.quality, this.contentMode)).catch(() => {
            this.error = t('A fonte foi trocada; ela manteve a taxa de quadros disponível.')
          })
        }
        if (generation !== this.generation) return
        const replacements = await Promise.allSettled(peers.map(([, peer]) => peer.replaceLocalStream(current)))
        // A viewer may join while sender replacement is awaiting native work.
        while (generation === this.generation) {
          const added = [...this.sharerPeers.entries()].filter(([, peer]) => !peers.some(([, known]) => known === peer))
          if (!added.length) break
          peers.push(...added)
          replacements.push(...await Promise.allSettled(added.map(([, peer]) => peer.replaceLocalStream(current))))
        }
        if (generation !== this.generation) return
        const failure = replacements.find(result => result.status === 'rejected')
        if (failure) {
          // Wait for every rollback before disposing the tentative capture.
          const rollbacks = await Promise.allSettled(peers.map(([, peer]) => peer.replaceLocalStream(previous)))
          for (let index = 0; index < rollbacks.length; index++) {
            const [id, peer] = peers[index]
            if (rollbacks[index].status === 'rejected' && this.sharerPeers.get(id) === peer) {
              this.handleViewerLeft({ sessionId: this.session!.sessionId, viewerDeviceId: id })
            }
          }
          throw failure.reason
        }
        transaction.commit()
        this.localStream = current
        this.includeAudio = current.getAudioTracks().some(track => track.readyState === 'live')
        this.emit()
      } finally { transaction.rollback() }
    } finally { this.switchingInFlight = false }
  }

  confirmVideoPresented(stream: MediaStream) {
    if (this.role !== 'viewer' || this.remoteStream !== stream || !['negotiating', 'reconnecting', 'live'].includes(this.state)) return
    this.framePresented = true
    this.clearReconnectTimer()
    this.restartAttempts = 0
    this.liveSinceMs ??= Date.now()
    this.setState('live')
  }

  private validateRelayConfiguration(iceServers: IceServerDto[] = this.iceServers) {
    if (this.forceRelay && !iceServers.some(server => server.urls.some(url => /^turns?:/i.test(url))))
      throw new Error(t('O teste via servidor exige TURN configurado. Nenhuma credencial TURN foi recebida.'))
  }

  setAudioMuted(muted: boolean) {
    if (this.role !== 'sharer' || !this.localStream) return
    this.audioMuted = muted
    for (const track of this.localStream.getAudioTracks()) track.enabled = !muted
    this.emit()
  }

  setUploadBudget(mbps: number) {
    if (!Number.isFinite(mbps) || mbps < 2 || mbps > 200) throw new Error(t('Informe um limite entre 2 e 200 Mbps.'))
    this.uploadBudgetMbps = mbps
    for (const controller of this.viewerQuality.values()) controller.reset()
    this.emit()
  }

  async setQuality(quality: QualityProfile, contentMode: ContentMode = qualityContentMode(quality)) {
    if (this.role !== 'sharer' || !this.localStream) throw new Error(t('Inicie a transmissão antes de ajustar a qualidade.'))
    if (this.switchingInFlight) throw new Error(t('Aguarde a alteração atual terminar.'))
    if (quality === this.quality && contentMode === this.contentMode) return
    this.switchingInFlight = true
    const stream = this.localStream
    const generation = this.generation
    const video = stream.getVideoTracks()[0]
    const previous = getVideoConstraints(stream)
    try {
      await applyVideoConstraints(stream, qualityConstraints(quality, contentMode))
      if (generation !== this.generation) return
      const session = await this.requireSignaling().updateShareQuality(quality) as ShareSessionSnapshot | undefined
      if (session && session.sessionId === this.session?.sessionId) this.session = session
      if (generation !== this.generation) return
      this.quality = quality
      this.contentMode = contentMode
      video.contentHint = contentMode === 'motion' ? 'motion' : 'detail'
      for (const controller of this.viewerQuality.values()) controller.reset()
      const bitrate = Math.min(PROFILE_CEILINGS[quality], this.uploadBudgetMbps * 1_000_000 / Math.max(1, this.sharerPeers.size))
      await Promise.all([...this.sharerPeers.values()].map(async peer => {
        await peer.setQualityProfile(quality)
        await peer.applyQuality(bitrate, contentMode === 'motion' ? 'maintain-framerate' : 'maintain-resolution', {
          maxFramerate: qualityFramerate(quality, contentMode), scaleResolutionDownBy: 1,
        })
      }))
      this.emit()
    } catch (error) {
      if (generation === this.generation) await applyVideoConstraints(stream, previous).catch(() => undefined)
      throw error
    } finally { this.switchingInFlight = false }
  }

  async removeViewer(deviceId: string) {
    if (this.role !== 'sharer' || !this.sharerPeers.has(deviceId)) return
    const sessionId = this.session?.sessionId
    await this.requireSignaling().removeViewer(deviceId)
    if (sessionId && this.session?.sessionId === sessionId) this.handleViewerLeft({ sessionId, viewerDeviceId: deviceId })
  }

  async leave(): Promise<void> {
    ++this.generation
    const signaling = this.signaling
    const role = this.role
    this.role = null
    this.teardownLocal()
    this.teardownPeer()
    this.session = null
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

  /** Encerra tudo ao sair da conta: transmissão, conexão e o código de amigo em memória. */
  signOut() {
    this.dispose()
    this.myFriendCode = null
    this.signalingStatus = 'offline'
    this.session = null
    this.role = null
    this.viewerPresence = 'none'
    this.setState('idle')
  }

  // ---- private ----

  private requireSignaling(): SignalingClient {
    if (!this.signaling) throw new Error(t('Conecte-se antes de iniciar uma transmissão.'))
    return this.signaling
  }

  private createPeer(iceServers: IceServerDto[], localStream: MediaStream | null) {
    this.teardownPeer()
    const signaling = this.signaling
    const peer = new WebRtcPeer({
      iceServers,
      qualityProfile: this.quality,
      iceTransportPolicy: this.forceRelay ? 'relay' : 'all',
      ...(localStream ? { localStream } : {}),
      sendSignal: async (payload) => {
        const target = this.peerDeviceId
        const sessionId = this.session?.sessionId
        if (!signaling || !target || !sessionId) return
        await signaling.sendSignal(target, { sessionId, fromDeviceId: this.deviceId, payload })
      },
      onRemoteStream: (stream) => {
        this.remoteStream = stream
        this.includeAudio = stream.getAudioTracks().some(track => track.readyState === 'live')
        this.emit()
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
      iceTransportPolicy: this.forceRelay ? 'relay' : 'all',
      ...(this.localStream ? { localStream: this.localStream } : {}),
      sendSignal: async (payload) => {
        await signaling?.sendSignal(viewerId, { sessionId, fromDeviceId: this.deviceId, payload })
      },
      onRemoteStream: () => undefined,
      onStatus: (status) => { if (this.sharerPeers.get(viewerId) === peer) this.handlePeerStatus(status, viewerId) },
    })
    this.sharerPeers.set(viewerId, peer)
    this.viewerNames.set(viewerId, event.viewer.displayName)
    this.viewerStates.set(viewerId, 'connecting')
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
      this.viewerNames.delete(viewerId)
      this.viewerStates.delete(viewerId)
      this.clearReconnectTimer(viewerId)
      this.viewerQuality.delete(viewerId)
      this.setState(this.connectedViewers.size ? 'live' : this.sharerPeers.size ? 'negotiating' : 'waiting-for-peer', toUserMessage(error, t('Não foi possível conectar o espectador.')))
    }
  }

  private handleViewerLeft(event: ViewerLeftEvent) {
    if (this.role !== 'sharer' || this.session?.sessionId !== event.sessionId) return
    this.sharerPeers.get(event.viewerDeviceId)?.close()
    this.sharerPeers.delete(event.viewerDeviceId)
    this.viewerNames.delete(event.viewerDeviceId)
    this.viewerStates.delete(event.viewerDeviceId)
    this.clearReconnectTimer(event.viewerDeviceId)
    this.viewerRestartAttempts.delete(event.viewerDeviceId)
    this.viewerQuality.delete(event.viewerDeviceId)
    this.connectedViewers.delete(event.viewerDeviceId)
    this.viewerPresence = this.connectedViewers.size ? 'live' : this.sharerPeers.size ? 'joining' : 'gone'
    this.setState(this.connectedViewers.size ? 'live' : this.sharerPeers.size ? 'negotiating' : 'waiting-for-peer')
  }

  private async handleSignal(envelope: SignalingEnvelope) {
    if (this.role === 'viewer' && this.joinPending) {
      this.pendingSignals.push(envelope)
      return
    }
    if (!this.session || this.session.sessionId !== envelope.sessionId) return
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
        this.setState(this.role === 'viewer' ? 'joining' : 'waiting-for-peer', t('Falha ao negociar a conexão. Tentando de novo…'))
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
    this.setState('ended', wasViewer ? t('A transmissão foi encerrada ou seu acesso foi removido.') : null)
  }

  private handleSignalingChanged(status: ConnectionStatus) {
    this.signalingStatus = status
    if (status === 'online' && (this.state === 'live' || this.state === 'reconnecting') && this.peer) {
      void this.peer.getDiagnostics().then((stats) => {
        if ((stats.roundTripMs ?? 0) === 0 && stats.bitrateKbps === 0) void this.attemptRestart(t('Sinalização reconectada. Restabelecendo mídia…'))
      }).catch(() => undefined)
    }
    this.emit()
  }

  private handlePeerStatus(status: PeerStatus, viewerId?: string) {
    if (viewerId) {
      this.viewerStates.set(viewerId, status)
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
      if (this.role !== 'viewer' || this.framePresented) this.restartAttempts = 0
      this.clearReconnectTimer()
      if (this.role === 'viewer' && !this.framePresented) this.scheduleRestart(10_000)
      if (this.state === 'negotiating' || this.state === 'reconnecting') {
        if (this.role !== 'viewer' || this.framePresented) this.liveSinceMs ??= Date.now()
        if (this.role === 'sharer') this.viewerPresence = 'live'
        if (this.role !== 'viewer' || this.framePresented) this.setState('live')
        else this.emit()
      } else {
        this.emit()
      }
      return
    }
    if (status === 'disconnected') {
      if (this.role === 'viewer') this.framePresented = false
      if (this.state === 'live' || this.state === 'negotiating') {
        this.setState('reconnecting', t('Conexão instável. Tentando restabelecer…'))
        this.scheduleRestart(2000)
      }
      return
    }
    if (status === 'failed') {
      if (this.role === 'viewer') this.framePresented = false
      if (this.state === 'live' || this.state === 'negotiating' || this.state === 'reconnecting') {
        void this.attemptRestart(t('A conexão falhou. Tentando restabelecer…'))
      }
    }
  }

  private scheduleRestart(delayMs: number, viewerId?: string) {
    this.clearReconnectTimer(viewerId)
    const timer = window.setTimeout(() => {
      void this.attemptRestart(t('Tentando restabelecer a mídia…'), viewerId)
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
        this.viewerNames.delete(viewerId)
        this.viewerStates.delete(viewerId)
        this.viewerQuality.delete(viewerId)
        this.viewerRestartAttempts.delete(viewerId)
        this.connectedViewers.delete(viewerId)
        this.viewerPresence = this.connectedViewers.size ? 'live' : 'gone'
        this.setState(this.connectedViewers.size ? 'live' : 'waiting-for-peer', t('Um espectador perdeu a conexão. Ele pode entrar novamente pela lista de amigos.'))
      } else {
        void this.leave()
        this.setState('ended', t('Não foi possível restabelecer a conexão. Tente entrar novamente.'))
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
          const stream = this.role === 'sharer' ? this.localStream : this.remoteStream
          this.includeAudio = stream?.getAudioTracks().some(track => track.readyState === 'live') ?? false
          if (this.role === 'sharer' && this.state === 'live') {
            this.diagnostics.bitrateKbps = valid.reduce((sum, sample) => sum + sample.stats.bitrateKbps, 0)
            await Promise.all(valid.map(async ({ id, peer, stats: peerStats }) => {
              const controller = this.viewerQuality.get(id)
              if (!controller) return
              const decision = controller.decide(this.quality, peerStats, this.contentMode, this.uploadBudgetMbps * 1_000_000 / Math.max(1, this.sharerPeers.size))
              await peer.applyQuality(decision.maxBitrateBps, decision.degradationPreference, { maxFramerate: decision.maxFramerate, scaleResolutionDownBy: decision.scaleResolutionDownBy })
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
    this.viewerNames.clear()
    this.viewerStates.clear()
    this.framePresented = false
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
