export type DeviceSnapshot = {
  deviceId: string
  displayName: string
  friendCode: string
  status: 'offline' | 'online' | 'transmitting'
  isSharing: boolean
  activeQualityProfile: string | null
}

export type ShareSessionSnapshot = {
  sessionId: string
  sharerDeviceId: string
  sharerDisplayName: string
  qualityProfile: QualityProfile
  viewerDeviceId: string | null
  viewerDeviceIds: string[]
  startedAt: string
}

export type IceServerDto = {
  urls: string[]
  username?: string | null
  credential?: string | null
}

export type ShareAccessResult = {
  session: ShareSessionSnapshot
  iceServers: IceServerDto[]
}

export type IceCandidatePayload = {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type SignalingPayload = {
  kind: 'offer' | 'answer' | 'candidate'
  sdp?: string | null
  candidate?: IceCandidatePayload | null
}

export type SignalingEnvelope = {
  sessionId: string
  fromDeviceId: string
  payload: SignalingPayload
}

export type ViewerJoinedEvent = {
  sessionId: string
  viewer: DeviceSnapshot
}

export type ViewerLeftEvent = { sessionId: string; viewerDeviceId: string }

export type QualityProfile = 'auto' | '720p60' | '1080p30' | '1080p60' | '1440p30' | '1440p60'
export type ContentMode = 'text' | 'motion'

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting'


export type PeerStatus = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

export type TransportPath = 'direct' | 'relay' | null

export type DiagnosticsSnapshot = {
  qualityLimitationReason?: string | null
  encodeMs?: number | null
  captureFramesPerSecond?: number | null
  audioLevel?: number | null
  audioReceiving?: boolean | null
  framesDecoded?: number | null
  /** Médias do último intervalo de amostragem, calculadas por deltas. */
  decodeMs?: number | null
  jitterBufferDelayMs?: number | null
  audioBitrateKbps?: number | null
  /** Contadores acumulados desde o início da transmissão. */
  freezeCount?: number | null
  freezeDurationMs?: number | null
  framesDropped?: number | null
  pliCount?: number | null
  nackCount?: number | null
  bitrateKbps: number
  roundTripMs: number | null
  packetLossPercent: number | null
  framesPerSecond: number | null
  codec: string | null
  jitterMs: number | null
  width: number | null
  height: number | null
  availableOutgoingKbps: number | null
  transportPath: TransportPath
  candidateType: string | null
}
