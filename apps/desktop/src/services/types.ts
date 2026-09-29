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

export type QualityProfile = 'auto' | '720p60' | '1080p30' | '1080p60'

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting'

export type InviteSnapshot = {
  code: string
  sessionId: string
  expiresAt: string
}

export type PeerStatus = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

export type TransportPath = 'direct' | 'relay' | null

export type DiagnosticsSnapshot = {
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
