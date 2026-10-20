export type LocalProfile = {
  deviceId: string
  deviceSecret: string
  displayName: string
  friendCodes: string[]
  /** Conta à qual os amigos locais pertencem; ao entrar com outra conta a lista é zerada. */
  accountId?: string
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

export type AudioBridgeState = { captureId?: string } & (
  | { status: 'idle' }
  | { status: 'starting'; processId: number }
  | { status: 'capturing'; metadata: AudioStreamMetadata }
  | { status: 'error'; message: string }
)

export type AudioChunk = { captureId: string; data: Uint8Array }

export type AppSettings = {
  /** Idioma da interface; `auto` segue o idioma do Windows. */
  language: 'auto' | 'pt-BR' | 'en'
  /** Avisa quando um amigo começa a transmitir e o Telae não está em foco. */
  notifyFriendLive: boolean
  /** Abre o Telae minimizado ao iniciar o Windows. */
  launchAtLogin: boolean
}

export type DesktopEnvironment = {
  version: string
  platform: NodeJS.Platform
  isPackaged: boolean
  signalingUrl: string
  forceRelay?: boolean
}

export type UpdateStatus =
  | { phase: 'idle' | 'checking' | 'current'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready' | 'installing'; version: string }
  | { phase: 'error'; version: string; message: string }

/** Conta autenticada. O e-mail é exibido só ao próprio usuário. */
export type AccountInfo = {
  id: string
  username: string
  displayName: string
  email: string
}

/** Códigos estáveis devolvidos pelo servidor; a interface os traduz. */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'invalid_code'
  | 'weak_password'
  | 'invalid_username'
  | 'username_reserved'
  | 'username_taken'
  | 'invalid_email'
  | 'email_taken'
  | 'account_locked'
  | 'code_cooldown'
  | 'rate_limited'
  | 'email_unavailable'
  | 'invalid_session'
  | 'invalid_display_name'
  | 'network'
  | 'unknown'

/** Resultado de uma chamada de conta: erros previsíveis voltam como dado, não como exceção entre processos. */
export type AuthOutcome<T = void> = { ok: true; data: T } | { ok: false; code: AuthErrorCode }

export type RegisterOutcome = {
  /** Falso quando o servidor dispensa a confirmação por e-mail (ambientes de teste). */
  verificationRequired: boolean
  account: AccountInfo | null
}

export type TelaeAuthApi = {
  /** Conta da sessão guardada neste computador, validada no servidor quando possível. */
  getSession(): Promise<AccountInfo | null>
  register(input: { email: string; username: string; password: string; language: string }): Promise<AuthOutcome<RegisterOutcome>>
  verifyEmail(identifier: string, code: string): Promise<AuthOutcome<AccountInfo>>
  resendVerification(identifier: string): Promise<AuthOutcome>
  login(identifier: string, password: string): Promise<AuthOutcome<AccountInfo>>
  logout(): Promise<void>
  forgotPassword(identifier: string): Promise<AuthOutcome>
  resetPassword(identifier: string, code: string, newPassword: string): Promise<AuthOutcome>
  updateDisplayName(displayName: string): Promise<AuthOutcome<AccountInfo>>
  changePassword(currentPassword: string, newPassword: string): Promise<AuthOutcome>
  deleteAccount(password: string): Promise<AuthOutcome>
  /** Token de acesso válido para o SignalR (renovado em segundo plano). */
  getAccessToken(): Promise<string | null>
  onSessionChanged(listener: (account: AccountInfo | null) => void): () => void
}

export type TelaeDesktopApi = {
  auth: TelaeAuthApi
  getLocalProfile(): Promise<LocalProfile>
  setDisplayName(displayName: string): Promise<LocalProfile>
  addFriendCode(friendCode: string): Promise<LocalProfile>
  removeFriendCode(friendCode: string): Promise<LocalProfile>
  listCaptureSources(): Promise<CaptureSource[]>
  selectCaptureSource(sourceId: string): Promise<void>
  resolveWindowAudioProcess(sourceId: string): Promise<number>
  listAudioProcesses(): Promise<AudioProcess[]>
  startAudioCapture(processId: number, captureId: string): Promise<void>
  startScreenAudioCapture(captureId: string): Promise<void>
  stopAudioCapture(captureId: string): Promise<void>
  getEnvironment(): Promise<DesktopEnvironment>
  setSignalingUrl(signalingUrl: string): Promise<DesktopEnvironment>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<void>
  setSessionActive(active: boolean): Promise<void>
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void
  onAudioChunk(listener: (chunk: AudioChunk) => void): () => void
  onAudioState(listener: (state: AudioBridgeState) => void): () => void
}
