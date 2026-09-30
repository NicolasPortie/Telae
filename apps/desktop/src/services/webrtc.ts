import type {
  DiagnosticsSnapshot,
  IceServerDto,
  PeerStatus,
  QualityProfile,
  SignalingPayload,
  TransportPath,
} from './types'

type PeerOptions = {
  iceServers: IceServerDto[]
  localStream?: MediaStream
  qualityProfile: QualityProfile
  sendSignal(payload: SignalingPayload): Promise<void>
  onRemoteStream(stream: MediaStream): void
  onStatus(status: PeerStatus): void
}

const bitrateCeilings: Record<QualityProfile, number> = {
  auto: 10_000_000,
  '720p60': 6_000_000,
  '1080p30': 8_000_000,
  '1080p60': 12_000_000,
}

function toRtcIceServers(servers: IceServerDto[]): RTCIceServer[] {
  return servers.map((server) => ({
    urls: server.urls,
    username: server.username ?? undefined,
    credential: server.credential ?? undefined,
  }))
}

function preferCodec(transceiver: RTCRtpTransceiver, kind: 'video' | 'audio', mimeType: string) {
  const capabilities = RTCRtpReceiver.getCapabilities(kind)
  if (!capabilities?.codecs?.length || !transceiver.setCodecPreferences) return
  const preferred = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() === mimeType.toLowerCase())
  const others = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== mimeType.toLowerCase())
  if (preferred.length) transceiver.setCodecPreferences([...preferred, ...others])
}

export class WebRtcPeer {
  private readonly peer: RTCPeerConnection
  private readonly sendSignal: PeerOptions['sendSignal']
  private readonly onRemoteStream: PeerOptions['onRemoteStream']
  private readonly qualityProfile: QualityProfile
  private pendingCandidates: RTCIceCandidateInit[] = []
  private remoteStream: MediaStream | null = null
  private lastVideoBytes = 0
  private lastStatsAt = 0
  private closed = false
  private readonly localSenders = new Map<'video' | 'audio', RTCRtpSender>()

  constructor(options: PeerOptions) {
    this.sendSignal = options.sendSignal
    this.onRemoteStream = options.onRemoteStream
    this.qualityProfile = options.qualityProfile
    this.peer = new RTCPeerConnection({ iceServers: toRtcIceServers(options.iceServers) })

    if (options.localStream) {
      for (const track of options.localStream.getTracks()) {
        const sender = this.peer.addTrack(track, options.localStream)
        this.localSenders.set(track.kind as 'video' | 'audio', sender)
        const transceiver = this.peer.getTransceivers().find((item) => item.sender === sender)
        if (transceiver && track.kind === 'video') preferCodec(transceiver, 'video', 'video/H264')
        if (transceiver && track.kind === 'audio') preferCodec(transceiver, 'audio', 'audio/opus')
      }
    }

    this.peer.onicecandidate = (event) => {
      if (!event.candidate) return
      void this.sendSignal({
        kind: 'candidate',
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment,
        },
      })
    }

    this.peer.ontrack = (event) => {
      if (event.streams[0]) {
        this.remoteStream = event.streams[0]
      } else {
        this.remoteStream ??= new MediaStream()
        if (!this.remoteStream.getTracks().some((track) => track.id === event.track.id)) {
          this.remoteStream.addTrack(event.track)
        }
      }
      this.onRemoteStream(this.remoteStream)
    }

    this.peer.onconnectionstatechange = () => options.onStatus(this.peer.connectionState as PeerStatus)
  }

  async createOffer() {
    const offer = await this.peer.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false })
    await this.peer.setLocalDescription(offer)
    await this.applySenderQuality()
    await this.sendSignal({ kind: 'offer', sdp: offer.sdp })
  }

  async replaceLocalStream(stream: MediaStream) {
    if (this.closed) return
    for (const kind of ['video', 'audio'] as const) {
      const next = stream.getTracks().find((track) => track.kind === kind) ?? null
      const sender = this.localSenders.get(kind)
      if (sender) await sender.replaceTrack(next)
      else if (next) this.localSenders.set(kind, this.peer.addTrack(next, stream))
    }
    await this.createOffer()
  }

  async restartIce() {
    if (this.closed) return
    const offer = await this.peer.createOffer({ iceRestart: true })
    await this.peer.setLocalDescription(offer)
    await this.sendSignal({ kind: 'offer', sdp: offer.sdp })
  }

  async applyQuality(maxBitrateBps: number, degradationPreference: RTCDegradationPreference) {
    if (this.closed) return
    const sender = this.peer.getSenders().find((item) => item.track?.kind === 'video')
    if (!sender) return
    try {
      const parameters = sender.getParameters()
      if (!parameters.encodings?.length) parameters.encodings = [{}]
      parameters.encodings[0].maxBitrate = maxBitrateBps
      ;(parameters as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference }).degradationPreference =
        degradationPreference
      await sender.setParameters(parameters)
    } catch {
      // Sender ainda sem encodings negociados — a próxima amostra tenta de novo.
    }
  }

  async handleSignal(payload: SignalingPayload) {
    if (payload.kind === 'candidate' && payload.candidate) {
      const candidate: RTCIceCandidateInit = {
        candidate: payload.candidate.candidate,
        sdpMid: payload.candidate.sdpMid ?? undefined,
        sdpMLineIndex: payload.candidate.sdpMLineIndex ?? undefined,
        usernameFragment: payload.candidate.usernameFragment ?? undefined,
      }
      if (!this.peer.remoteDescription) this.pendingCandidates.push(candidate)
      else await this.peer.addIceCandidate(candidate)
      return
    }

    if (payload.kind === 'offer' && payload.sdp) {
      await this.peer.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
      await this.flushCandidates()
      const answer = await this.peer.createAnswer()
      await this.peer.setLocalDescription(answer)
      await this.sendSignal({ kind: 'answer', sdp: answer.sdp })
      return
    }

    if (payload.kind === 'answer' && payload.sdp) {
      await this.peer.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
      await this.flushCandidates()
    }
  }

  async getDiagnostics(): Promise<DiagnosticsSnapshot> {
    const empty: DiagnosticsSnapshot = {
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
    if (this.closed) return empty

    const reports = await this.peer.getStats()
    type StatItem = RTCStats & Record<string, unknown>
    let videoReport: StatItem | null = null
    let pair: StatItem | null = null
    let codecName: string | null = null

    for (const report of reports.values()) {
      const item = report as StatItem
      if ((item.type === 'inbound-rtp' || item.type === 'outbound-rtp') && item.kind === 'video') videoReport = item
      if (item.type === 'candidate-pair' && item.state === 'succeeded' && (item.nominated === true || item.selected === true)) {
        pair = item
      }
    }

    if (!videoReport) return empty
    const item: StatItem = videoReport

    const bytes = Number(item.bytesReceived ?? item.bytesSent ?? 0)
    const now = Number(item.timestamp ?? performance.now())
    let bitrateKbps = 0
    if (this.lastStatsAt > 0 && now > this.lastStatsAt && bytes >= this.lastVideoBytes) {
      bitrateKbps = Math.round(((bytes - this.lastVideoBytes) * 8) / (now - this.lastStatsAt))
    }
    this.lastVideoBytes = bytes
    this.lastStatsAt = now

    const received = Number(item.packetsReceived ?? 0)
    const lost = Number(item.packetsLost ?? 0)
    const packetLossPercent = received + lost > 0 ? Math.max(0, (lost / (received + lost)) * 100) : null

    if (typeof item.codecId === 'string') {
      const codec = reports.get(item.codecId) as StatItem | undefined
      if (codec && typeof codec.mimeType === 'string') codecName = codec.mimeType.replace('video/', '')
    }

    let transportPath: TransportPath = null
    let candidateType: string | null = null
    let roundTripMs: number | null = null
    let availableOutgoingKbps: number | null = null
    if (pair) {
      const p = pair
      if (typeof p.currentRoundTripTime === 'number') roundTripMs = Math.round(p.currentRoundTripTime * 1000)
      if (typeof p.availableOutgoingBitrate === 'number') availableOutgoingKbps = Math.round(p.availableOutgoingBitrate / 1000)
      const localId = typeof p.localCandidateId === 'string' ? p.localCandidateId : null
      const remoteId = typeof p.remoteCandidateId === 'string' ? p.remoteCandidateId : null
      const local = localId ? (reports.get(localId) as StatItem | undefined) : undefined
      const remote = remoteId ? (reports.get(remoteId) as StatItem | undefined) : undefined
      const localType = typeof local?.candidateType === 'string' ? (local.candidateType as string) : null
      const remoteType = typeof remote?.candidateType === 'string' ? (remote.candidateType as string) : null
      candidateType = localType ?? remoteType
      if (localType === 'relay' || remoteType === 'relay') transportPath = 'relay'
      else if (localType ?? remoteType) transportPath = 'direct'
    }

    return {
      bitrateKbps,
      roundTripMs,
      packetLossPercent,
      framesPerSecond: typeof item.framesPerSecond === 'number' ? item.framesPerSecond : null,
      codec: codecName,
      jitterMs: typeof item.jitter === 'number' ? Math.round(item.jitter * 1000) : null,
      width: typeof item.frameWidth === 'number' ? item.frameWidth : null,
      height: typeof item.frameHeight === 'number' ? item.frameHeight : null,
      availableOutgoingKbps,
      transportPath,
      candidateType,
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.pendingCandidates = []
    this.peer.onicecandidate = null
    this.peer.ontrack = null
    this.peer.onconnectionstatechange = null
    this.peer.close()
  }

  private async flushCandidates() {
    const candidates = this.pendingCandidates
    this.pendingCandidates = []
    for (const candidate of candidates) await this.peer.addIceCandidate(candidate)
  }

  private async applySenderQuality() {
    await this.applyQuality(bitrateCeilings[this.qualityProfile], 'maintain-resolution')
  }
}
