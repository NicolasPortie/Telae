export type LocalProfile = {
  deviceId: string
  displayName: string
  friendCodes: string[]
}

export type CaptureSource = {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnailDataUrl: string
}

export type AudioProcess = {
  processId: number
  processName: string
  windowTitle: string
}

export type AudioStreamMetadata = {
  processId: number
  sampleRate: number
  channels: number
  sampleFormat: 'f32le'
}

export type AudioBridgeState =
  | { status: 'idle' }
  | { status: 'starting'; processId: number }
  | { status: 'capturing'; metadata: AudioStreamMetadata }
  | { status: 'error'; message: string }

export type DesktopEnvironment = {
  platform: NodeJS.Platform
  isPackaged: boolean
  signalingUrl: string
}

export type UpdateStatus =
  | { phase: 'idle' | 'checking' | 'current'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; version: string; message: string }

export type TelaeDesktopApi = {
  getLocalProfile(): Promise<LocalProfile>
  setDisplayName(displayName: string): Promise<LocalProfile>
  addFriendCode(friendCode: string): Promise<LocalProfile>
  removeFriendCode(friendCode: string): Promise<LocalProfile>
  listCaptureSources(): Promise<CaptureSource[]>
  selectCaptureSource(sourceId: string): Promise<void>
  resolveWindowAudioProcess(sourceId: string): Promise<number>
  listAudioProcesses(): Promise<AudioProcess[]>
  startAudioCapture(processId: number): Promise<void>
  stopAudioCapture(processId?: number): Promise<void>
  getEnvironment(): Promise<DesktopEnvironment>
  setSignalingUrl(signalingUrl: string): Promise<DesktopEnvironment>
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<void>
  setSessionActive(active: boolean): Promise<void>
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void
  onAudioChunk(listener: (chunk: Uint8Array) => void): () => void
  onAudioState(listener: (state: AudioBridgeState) => void): () => void
}
