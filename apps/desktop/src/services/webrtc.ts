import type {
  DiagnosticsSnapshot,
  IceServerDto,
  PeerStatus,
  QualityProfile,
  SignalingPayload,
  TransportPath,
} from './types'
import { PROFILE_CEILINGS } from './quality-controller'
import { qualityContentMode, qualityFramerate } from './quality-profiles'

export type PeerOptions = {
  iceServers: IceServerDto[]
  iceTransportPolicy?: RTCIceTransportPolicy
  localStream?: MediaStream
  qualityProfile: QualityProfile
  sendSignal(payload: SignalingPayload): Promise<void>
  onRemoteStream(stream: MediaStream): void
  onStatus(status: PeerStatus): void
}

type SenderQuality = {
  maxBitrateBps: number
  degradationPreference: RTCDegradationPreference
  maxFramerate?: number
  scaleResolutionDownBy?: number
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
  private qualityProfile: QualityProfile
  private pendingCandidates: RTCIceCandidateInit[] = []
  private remoteStream: MediaStream | null = null
  private lastVideoBytes = 0
  private lastStatsAt = 0
  private closed = false
  private readonly localSenders = new Map<'video' | 'audio', RTCRtpSender>()
  private readonly polite: boolean
  private ignoreOffer = false
  private negotiationQueue: Promise<void> = Promise.resolve()
  private parameterQueue: Promise<void> = Promise.resolve()
  private requestedQuality: SenderQuality | null = null
  private lastLossReportId: string | null = null
  private lastPacketCount = 0
  private lastPacketsLost = 0
  private lastAudioReportId: string | null = null
  private lastAudioBytes = 0
  private lastEncodeReportId: string | null = null
  private lastEncodedFrames = 0
  private lastEncodeTime = 0
  private qualityWarnings = 0

  constructor(options: PeerOptions) {
    this.sendSignal = options.sendSignal
    this.onRemoteStream = options.onRemoteStream
    this.qualityProfile = options.qualityProfile
    this.polite = !options.localStream
    this.peer = new RTCPeerConnection({ iceServers: toRtcIceServers(options.iceServers),
      iceTransportPolicy: options.iceTransportPolicy })

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
      }).catch(() => undefined)
    }

    this.peer.ontrack = (event) => {
      // Use the same target for audio/video so synchronization does not add a larger buffer.
      try {
        if ('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = 0
      } catch {
        // Older runtimes retain their default adaptive buffer.
      }
      // Áudio adicionado numa troca de fonte pode chegar com outro msid.
      // A superfície de playback mantém vídeo e áudio no mesmo stream local.
      this.remoteStream ??= new MediaStream()
      for (const track of this.remoteStream.getTracks()) {
        if (track.kind === event.track.kind && track.id !== event.track.id) this.remoteStream.removeTrack(track)
      }
      if (!this.remoteStream.getTracks().some((track) => track.id === event.track.id)) {
        this.remoteStream.addTrack(event.track)
      }
      this.onRemoteStream(this.remoteStream)
    }

    this.peer.onconnectionstatechange = () => options.onStatus(this.peer.connectionState as PeerStatus)
  }

  async createOffer() {
    return this.enqueueNegotiation(() => this.createOfferInternal())
  }

  private async createOfferInternal(iceRestart = false) {
    if (this.peer.signalingState === 'have-local-offer') await this.peer.setLocalDescription({ type: 'rollback' })
    const offer = await this.peer.createOffer(iceRestart ? { iceRestart: true } : { offerToReceiveAudio: false, offerToReceiveVideo: false })
    await this.peer.setLocalDescription(offer)
    await this.applySenderQuality()
    if (this.closed) throw new Error('The peer was closed during negotiation.')
    await this.sendSignal({ kind: 'offer', sdp: offer.sdp })
  }

  async replaceLocalStream(stream: MediaStream) {
    if (this.closed) throw new Error('The peer was closed before source replacement.')
    return this.enqueueNegotiation(async () => {
      const changed: Array<{ kind: 'video' | 'audio'; sender: RTCRtpSender; previous: MediaStreamTrack | null; added: boolean }> = []
      try {
        for (const kind of ['video', 'audio'] as const) {
          if (this.closed) throw new Error('The peer was closed during source replacement.')
          const next = stream.getTracks().find((track) => track.kind === kind) ?? null
          const sender = this.localSenders.get(kind)
          if (sender) {
            changed.push({ kind, sender, previous: sender.track, added: false })
            await sender.replaceTrack(next)
          } else if (next) {
            const added = this.peer.addTrack(next, stream)
            changed.push({ kind, sender: added, previous: null, added: true })
            this.localSenders.set(kind, added)
          }
        }
        await this.createOfferInternal()
      } catch (error) {
        try {
          if (this.closed) throw error
          if (this.peer.signalingState === 'have-local-offer') await this.peer.setLocalDescription({ type: 'rollback' })
          // Settle every restoration before the caller releases its staged capture.
          const restored = await Promise.allSettled(changed.map(async ({ kind, sender, previous, added }) => {
            await sender.replaceTrack(previous)
            if (added) {
              this.peer.removeTrack(sender)
              this.localSenders.delete(kind)
            }
          }))
          if (restored.some(result => result.status === 'rejected')) this.close()
        } catch { this.close() }
        throw error
      }
    }, true)
  }

  async restartIce() {
    return this.enqueueNegotiation(() => this.createOfferInternal(true))
  }

  updateIceServers(servers: IceServerDto[]) {
    if (!this.closed) this.peer.setConfiguration({ ...this.peer.getConfiguration(), iceServers: toRtcIceServers(servers) })
  }

  private enqueueNegotiation(operation: () => Promise<void>, rejectIfClosed = false): Promise<void> {
    const pending = this.negotiationQueue.then(async () => {
      if (this.closed) {
        if (rejectIfClosed) throw new Error('The peer was closed before source replacement.')
        return
      }
      await operation()
    })
    this.negotiationQueue = pending.catch(() => undefined)
    return pending
  }

  async setQualityProfile(profile: QualityProfile) {
    this.qualityProfile = profile
    if (this.requestedQuality) this.requestedQuality = { ...this.requestedQuality,
      maxBitrateBps: Math.min(this.requestedQuality.maxBitrateBps, PROFILE_CEILINGS[profile]) }
    await this.applySenderQuality()
  }

  async applyQuality(maxBitrateBps: number, degradationPreference: RTCDegradationPreference,
    options: { maxFramerate?: number; scaleResolutionDownBy?: number } = {}) {
    if (this.closed) return
    this.requestedQuality = { ...this.requestedQuality, ...options,
      maxBitrateBps: Math.min(maxBitrateBps, PROFILE_CEILINGS[this.qualityProfile]), degradationPreference }
    await this.queueSenderQuality(this.requestedQuality)
  }

  private queueSenderQuality(quality: SenderQuality): Promise<void> {
    const pending = this.parameterQueue.then(() => this.writeSenderQuality(quality))
    this.parameterQueue = pending.catch(() => undefined)
    return pending
  }

  private async writeSenderQuality(requested: SenderQuality) {
    if (this.closed) return
    const sender = this.peer.getSenders().find((item) => item.track?.kind === 'video')
    if (!sender) return
    try {
      const { degradationPreference, maxFramerate, scaleResolutionDownBy } = requested
      const maxBitrateBps = Math.min(requested.maxBitrateBps, PROFILE_CEILINGS[this.qualityProfile])
      const parameters = sender.getParameters()
      if (!parameters.encodings?.length) parameters.encodings = [{}]
      const encoding = parameters.encodings[0]
      const quality = parameters as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference }
      if (encoding.maxBitrate === maxBitrateBps && quality.degradationPreference === degradationPreference &&
        (maxFramerate === undefined || encoding.maxFramerate === maxFramerate) &&
        (scaleResolutionDownBy === undefined || encoding.scaleResolutionDownBy === scaleResolutionDownBy)) return
      encoding.maxBitrate = maxBitrateBps
      if (maxFramerate !== undefined) encoding.maxFramerate = maxFramerate
      if (scaleResolutionDownBy !== undefined) encoding.scaleResolutionDownBy = scaleResolutionDownBy
      quality.degradationPreference = degradationPreference
      await sender.setParameters(parameters)
    } catch (error) {
      // Retry on the next sample; cap warnings per peer so a failure cannot flood logs.
      if (this.qualityWarnings++ < 3) console.warn('Telae: failed to apply sender quality', error)
    }
  }

  async handleSignal(payload: SignalingPayload) {
    return this.enqueueNegotiation(() => this.handleSignalInternal(payload))
  }

  private async handleSignalInternal(payload: SignalingPayload) {
    if (payload.kind === 'candidate' && payload.candidate) {
      if (this.ignoreOffer) return
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
      const collision = this.peer.signalingState !== 'stable'
      this.ignoreOffer = collision && !this.polite
      if (this.ignoreOffer) return
      if (collision) await this.peer.setLocalDescription({ type: 'rollback' })
      await this.peer.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
      await this.flushCandidates()
      const answer = await this.peer.createAnswer()
      await this.peer.setLocalDescription(answer)
      await this.sendSignal({ kind: 'answer', sdp: answer.sdp })
      return
    }

    if (payload.kind === 'answer' && payload.sdp) {
      if (this.peer.signalingState !== 'have-local-offer') return
      this.ignoreOffer = false
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
      qualityLimitationReason: null,
      encodeMs: null,
      audioLevel: null,
      audioReceiving: null,
      framesDecoded: null,
    }
    if (this.closed) return empty

    const reports = await this.peer.getStats()
    type StatItem = RTCStats & Record<string, unknown>
    let videoReport: StatItem | null = null
    let pair: StatItem | null = null
    let codecName: string | null = null
    let audioReport: StatItem | null = null

    for (const report of reports.values()) {
      const item = report as StatItem
      if ((item.type === 'inbound-rtp' || item.type === 'outbound-rtp') && item.kind === 'video') videoReport = item
      if (item.type === 'inbound-rtp' && item.kind === 'audio') audioReport = item
      if (item.type === 'candidate-pair' && item.state === 'succeeded' && (item.nominated === true || item.selected === true)) {
        pair = item
      }
    }

    if (audioReport) {
      const bytes = typeof audioReport.bytesReceived === 'number' ? audioReport.bytesReceived : null
      empty.audioReceiving = bytes === null || this.lastAudioReportId !== audioReport.id ? null : bytes > this.lastAudioBytes
      empty.audioLevel = typeof audioReport.audioLevel === 'number' ? audioReport.audioLevel : null
      this.lastAudioReportId = audioReport.id
      this.lastAudioBytes = bytes ?? 0
    } else {
      this.lastAudioReportId = null
      this.lastAudioBytes = 0
    }

    // Prefer the transport used by this RTP stream, then any selected transport.
    const transport = typeof videoReport?.transportId === 'string' ? reports.get(videoReport.transportId) as StatItem | undefined : undefined
    const transports = transport ? [transport] : [...reports.values()].filter(report => report.type === 'transport') as StatItem[]
    for (const transport of transports) {
      if (typeof transport.selectedCandidatePairId !== 'string') continue
      const selected = reports.get(transport.selectedCandidatePairId) as StatItem | undefined
      if (selected?.type === 'candidate-pair') { pair = selected; break }
    }
    if (!videoReport) return empty
    const item: StatItem = videoReport
    const source = typeof item.mediaSourceId === 'string' ? reports.get(item.mediaSourceId) as StatItem | undefined : undefined

    const bytes = Number(item.bytesReceived ?? item.bytesSent ?? 0)
    const now = Number(item.timestamp ?? performance.now())
    let bitrateKbps = 0
    if (this.lastStatsAt > 0 && now > this.lastStatsAt && bytes >= this.lastVideoBytes) {
      bitrateKbps = Math.round(((bytes - this.lastVideoBytes) * 8) / (now - this.lastStatsAt))
    }
    this.lastVideoBytes = bytes
    this.lastStatsAt = now
    let encodeMs: number | null = null
    if (typeof item.totalEncodeTime === 'number' && typeof item.framesEncoded === 'number') {
      const same = this.lastEncodeReportId === item.id
      const frames = same ? item.framesEncoded - this.lastEncodedFrames : 0
      const seconds = same ? item.totalEncodeTime - this.lastEncodeTime : 0
      if (frames > 0 && seconds >= 0) encodeMs = seconds * 1000 / frames
      this.lastEncodeReportId = item.id
      this.lastEncodedFrames = item.framesEncoded
      this.lastEncodeTime = item.totalEncodeTime
    } else this.lastEncodeReportId = null

    let lossReport: StatItem | undefined = item.type === 'inbound-rtp' ? item : undefined
    if (item.type === 'outbound-rtp') {
      lossReport = typeof item.remoteId === 'string' ? reports.get(item.remoteId) as StatItem | undefined : undefined
      lossReport ??= [...reports.values()].find((report) => report.type === 'remote-inbound-rtp' &&
        (report as StatItem).localId === item.id) as StatItem | undefined
    }
    let packetLossPercent: number | null = null
    if (lossReport && typeof lossReport.packetsLost === 'number') {
      const lost = Math.max(0, lossReport.packetsLost)
      const total = item.type === 'outbound-rtp' ? Number(item.packetsSent ?? 0) : Number(item.packetsReceived ?? 0) + lost
      const sameReport = this.lastLossReportId === lossReport.id
      const countDelta = sameReport ? total - this.lastPacketCount : total
      const lostDelta = sameReport ? lost - this.lastPacketsLost : lost
      if (countDelta > 0) packetLossPercent = Math.min(100, Math.max(0, lostDelta / countDelta * 100))
      this.lastLossReportId = lossReport.id
      this.lastPacketCount = total
      this.lastPacketsLost = lost
    }

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
      ...empty,
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
      qualityLimitationReason: typeof item.qualityLimitationReason === 'string' ? item.qualityLimitationReason : null,
      encodeMs,
      captureFramesPerSecond: typeof source?.framesPerSecond === 'number' ? source.framesPerSecond : null,
      framesDecoded: typeof item.framesDecoded === 'number' ? item.framesDecoded : null,
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
    const track = this.localSenders.get('video')?.track
    const mode = track?.contentHint === 'motion' ? 'motion'
      : track?.contentHint === 'detail' || track?.contentHint === 'text' ? 'text' : qualityContentMode(this.qualityProfile)
    this.requestedQuality ??= {
      maxBitrateBps: PROFILE_CEILINGS[this.qualityProfile],
      degradationPreference: mode === 'motion' ? 'maintain-framerate' : 'maintain-resolution',
      maxFramerate: qualityFramerate(this.qualityProfile, mode), scaleResolutionDownBy: 1,
    }
    await this.queueSenderQuality(this.requestedQuality)
  }
}
