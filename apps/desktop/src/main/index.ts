import { resolveLocale, setLocale, t } from '../i18n/index.ts'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { release } from 'node:os'
import { app, BrowserWindow, desktopCapturer, ipcMain, safeStorage, session } from 'electron'
import type {
  AudioBridgeState,
  AudioProcess,
  AudioStreamMetadata,
  AccountInfo,
  AppSettings,
  CaptureSource,
  LocalProfile,
} from '../shared/contracts.ts'
import { DesktopUpdates } from './updates.ts'
import { readLocalProfile, writeJsonAtomically, writeLocalProfile, type SecretCipher } from './profile-store.ts'
import { AuthServerClient } from './auth-client.ts'
import { AuthSession } from './auth-session.ts'
import { createSessionStorage } from './auth-store.ts'
import { resolveAudioBridgePath } from './audio-bridge-path.ts'

// Sharing remains active when the main window is minimized or covered.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

if (process.platform === 'win32' && Number(release().split('.')[2]) >= 26100) {
  // Chromium uses WGC screen capture on Windows 11 24H2 and later.
  // WGC textures require the zero-copy capture path as well. Configure both
  // before ready so Chromium avoids CPU copies/scaling for every desktop frame.
  // Preserve switches supplied by the launcher (including Playwright).
  const enabledFeatures = app.commandLine.getSwitchValue('enable-features').split(',').filter(Boolean)
  app.commandLine.appendSwitch('enable-features', [...new Set([
    ...enabledFeatures, 'ZeroCopyDesktopCapture', 'WebRtcAllowWgcUsingTexture',
  ])].join(','))
}

let mainWindow: BrowserWindow | null = null
let audioBridge: ChildProcess | null = null
let audioBridgeCaptureId: string | null = null
let audioState: AudioBridgeState = { status: 'idle' }
let selectedCaptureSourceId: string | null = null
const updates = new DesktopUpdates((status) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status)
})

const profilePath = () => path.join(app.getPath('userData'), 'profile.json')
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const LOCAL_SIGNALING_URL = 'http://localhost:5015'
const PUBLIC_SIGNALING_URL = 'https://telae.nicolasportie.com'
const DEFAULT_SIGNALING_URL = app.isPackaged ? PUBLIC_SIGNALING_URL : LOCAL_SIGNALING_URL

function normalizeSignalingUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error(t('Falta o endereço do servidor.'))

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(t('Esse endereço não parece válido. Use algo como https://telae.seudominio.com.'))
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(t('O endereço precisa começar com http:// ou https://.'))
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(t('Use só o endereço do servidor, sem usuário nem senha.'))
  }

  return trimmed
}

function readSignalingUrl(): string {
  try {
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as { signalingUrl?: string }
    if (settings.signalingUrl) {
      const saved = normalizeSignalingUrl(settings.signalingUrl)
      // Instaladores antigos apontavam para o localhost mesmo fora do servidor.
      if (app.isPackaged && saved === LOCAL_SIGNALING_URL) return PUBLIC_SIGNALING_URL
      return saved
    }
  } catch {
    // Arquivo ausente/corrompido: usa configuração do ambiente ou padrão local.
  }

  const fromEnvironment = process.env.TELAE_SIGNALING_URL?.trim()
  if (fromEnvironment) {
    try {
      return normalizeSignalingUrl(fromEnvironment)
    } catch {
      // Variável inválida não impede a inicialização do app.
    }
  }
  return DEFAULT_SIGNALING_URL
}

const DEFAULT_SETTINGS: AppSettings = { language: 'auto', notifyFriendLive: true, launchAtLogin: false }

type StoredSettings = Partial<AppSettings> & { signalingUrl?: string }

function readStoredSettings(): StoredSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? parsed as StoredSettings : {}
  } catch {
    return {}
  }
}

function readSettings(): AppSettings {
  const stored = readStoredSettings()
  return {
    language: stored.language === 'pt-BR' || stored.language === 'en' ? stored.language : DEFAULT_SETTINGS.language,
    notifyFriendLive: typeof stored.notifyFriendLive === 'boolean' ? stored.notifyFriendLive : DEFAULT_SETTINGS.notifyFriendLive,
    launchAtLogin: typeof stored.launchAtLogin === 'boolean' ? stored.launchAtLogin : DEFAULT_SETTINGS.launchAtLogin,
  }
}

function persistSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...readSettings() }
  if (patch.language === 'auto' || patch.language === 'pt-BR' || patch.language === 'en') next.language = patch.language
  if (typeof patch.notifyFriendLive === 'boolean') next.notifyFriendLive = patch.notifyFriendLive
  if (typeof patch.launchAtLogin === 'boolean') next.launchAtLogin = patch.launchAtLogin
  writeJsonAtomically(settingsPath(), { ...readStoredSettings(), ...next })
  // Só instalações empacotadas registram a inicialização; o modo de desenvolvimento não deve alterar o Windows.
  setLocale(resolveLocale(next.language, app.getLocale()))
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: next.launchAtLogin ? ['--hidden'] : [] })
  return next
}

function persistSignalingUrl(value: string): string {
  const signalingUrl = normalizeSignalingUrl(value)
  writeJsonAtomically(settingsPath(), { ...readStoredSettings(), signalingUrl })
  return signalingUrl
}

const SECRET_PREFIX = 'safe:'

/** Cofre do sistema para a credencial; sem ele (ex.: Linux sem keyring) o perfil segue em arquivo local. */
function profileCipher(): SecretCipher | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  return {
    encrypt: plain => SECRET_PREFIX + safeStorage.encryptString(plain).toString('base64'),
    decrypt: encoded => {
      if (!encoded.startsWith(SECRET_PREFIX)) return null
      try { return safeStorage.decryptString(Buffer.from(encoded.slice(SECRET_PREFIX.length), 'base64')) } catch { return null }
    },
  }
}

function readProfile(): LocalProfile {
  return readLocalProfile(profilePath(), profileCipher())
}

function persistProfile(profile: LocalProfile): LocalProfile {
  writeLocalProfile(profilePath(), profile, profileCipher())
  return profile
}

const authSessionPath = () => path.join(app.getPath('userData'), 'session.json')
let authSession: AuthSession | null = null

/** Alinha o perfil local à conta (nome vindo do servidor) e avisa a interface. */
function syncProfileWithAccount(account: AccountInfo | null) {
  if (account) {
    const profile = readProfile()
    profile.accountId = account.id
    profile.displayName = account.displayName
    persistProfile(profile)
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('auth:changed', account)
}

function getAuth(): AuthSession {
  authSession ??= new AuthSession(
    new AuthServerClient(readSignalingUrl),
    createSessionStorage(authSessionPath(), profileCipher),
    syncProfileWithAccount,
  )
  return authSession
}

function findAudioBridge(): string {
  return resolveAudioBridgePath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
}

function sendAudioState(state: AudioBridgeState) {
  audioState = state
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('audio:state', state)
}

function stopAudioBridge(captureId?: string) {
  if (captureId !== undefined && captureId !== audioBridgeCaptureId) return
  const active = audioBridge
  const stoppedId = audioBridgeCaptureId ?? undefined
  audioBridge = null
  audioBridgeCaptureId = null
  if (active && !active.killed) active.kill()
  sendAudioState({ status: 'idle', captureId: stoppedId })
}

function registerIpc() {
  ipcMain.handle('profile:get', () => persistProfile(readProfile()))
  ipcMain.handle('profile:set-name', (_event, displayName: string) => {
    const normalized = displayName.trim().slice(0, 32)
    if (!normalized) throw new Error(t('Escreva seu nome.'))
    const profile = readProfile()
    profile.displayName = normalized
    return persistProfile(profile)
  })

  ipcMain.handle('capture:list-sources', async (): Promise<CaptureSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 400, height: 225 },
      fetchWindowIcons: false,
    })
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnailDataUrl: source.thumbnail.toDataURL(),
    }))
  })

  ipcMain.handle('capture:select-source', async (_event, sourceId: string): Promise<void> => {
    if (!sourceId?.trim()) throw new Error(t('Escolha uma tela ou janela antes de começar.'))
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    if (!sources.some((source) => source.id === sourceId)) {
      throw new Error(t('Essa tela ou janela não está mais disponível.'))
    }
    selectedCaptureSourceId = sourceId
  })

  ipcMain.handle('capture:resolve-window-audio', async (_event, sourceId: string): Promise<number> => {
    if (sourceId !== selectedCaptureSourceId || !sourceId.startsWith('window:'))
      throw new Error(t('Selecione uma janela válida para capturar seu áudio.'))
    const match = /^window:(\d+):/.exec(sourceId)
    if (!match) throw new Error(t('Não consegui identificar essa janela.'))
    const result = await execFileAsync(findAudioBridge(), ['resolve-window', match[1]], { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 })
    const processId = Number(result.stdout.trim())
    if (!Number.isInteger(processId) || processId <= 0)
      throw new Error(t('Não consegui identificar o áudio desse app.'))
    return processId
  })

  ipcMain.handle('audio:list-processes', async (): Promise<AudioProcess[]> => {
    const executable = findAudioBridge()
    const result = await execFileAsync(executable, ['list'], { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 })
    return JSON.parse(result.stdout) as AudioProcess[]
  })

  const startAudioBridge = (processId: number, captureId: string, screen = false) => {
    if (typeof captureId !== 'string' || !/^[a-f0-9-]{36}$/i.test(captureId)) throw new Error(t('Captura de áudio inválida.'))
    stopAudioBridge()
    const executable = findAudioBridge()
    sendAudioState({ status: 'starting', processId, captureId })

    const child = spawn(executable, screen ? ['capture-screen'] : ['capture', '--pid', String(processId)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    audioBridge = child
    audioBridgeCaptureId = captureId
    let stderrBuffer = ''

    child.stdout.on('data', (chunk: Buffer) => {
      if (audioBridge === child && mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('audio:chunk', { captureId, data: new Uint8Array(chunk) })
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (audioBridge !== child) return
      stderrBuffer += chunk.toString('utf8')
      const lines = stderrBuffer.split(/\r?\n/)
      stderrBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('TELAE_FORMAT ')) {
          const metadata = JSON.parse(line.slice('TELAE_FORMAT '.length)) as AudioStreamMetadata
          sendAudioState({ status: 'capturing', metadata, captureId })
        } else if (line.startsWith('TELAE_ERROR ')) {
          sendAudioState({ status: 'error', message: line.slice('TELAE_ERROR '.length), captureId })
        }
      }
    })
    child.on('error', (error) => {
      if (audioBridge === child) sendAudioState({ status: 'error', message: error.message, captureId })
    })
    child.on('exit', (code) => {
      if (audioBridge !== child) return
      audioBridge = null
      audioBridgeCaptureId = null
      if (code && code !== 0 && audioState.status !== 'error') {
        sendAudioState({ status: 'error', message: t('O capturador de áudio encerrou com código {code}.', { code: String(code) }), captureId })
      } else if (audioState.status !== 'error') {
        sendAudioState({ status: 'idle', captureId })
      }
    })
  }

  ipcMain.handle('audio:start', (_event, processId: number, captureId: string) => {
    if (!Number.isInteger(processId) || processId <= 0) throw new Error(t('Processo de áudio inválido.'))
    startAudioBridge(processId, captureId)
  })
  ipcMain.handle('audio:start-screen', (_event, captureId: string) => {
    if (!selectedCaptureSourceId?.startsWith('screen:')) throw new Error(t('Selecione uma tela para capturar o áudio.'))
    startAudioBridge(0, captureId, true)
  })

  ipcMain.handle('audio:stop', (_event, captureId: string) => {
    if (typeof captureId === 'string') stopAudioBridge(captureId)
  })
  ipcMain.handle('environment:get', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    signalingUrl: readSignalingUrl(),
    forceRelay: !app.isPackaged && process.env.TELAE_E2E_RELAY === '1',
  }))
  ipcMain.handle('environment:set-signaling-url', (_event, signalingUrl: string) => {
    const saved = persistSignalingUrl(signalingUrl)
    void updates.check(saved)
    return { version: app.getVersion(), platform: process.platform, isPackaged: app.isPackaged, signalingUrl: saved }
  })
  ipcMain.handle('auth:session', async () => {
    const auth = getAuth()
    const account = await auth.restore()
    if (account) syncProfileWithAccount(account)
    return account
  })
  ipcMain.handle('auth:register', (_event, input: { email: string; username: string; password: string; language: string }) => getAuth().register(input))
  ipcMain.handle('auth:verify-email', (_event, identifier: string, code: string) => getAuth().verifyEmail(String(identifier), String(code)))
  ipcMain.handle('auth:resend-verification', (_event, identifier: string) => getAuth().resendVerification(String(identifier)))
  ipcMain.handle('auth:login', (_event, identifier: string, password: string) => getAuth().login(String(identifier), String(password)))
  ipcMain.handle('auth:logout', () => getAuth().logout())
  ipcMain.handle('auth:forgot-password', (_event, identifier: string) => getAuth().forgotPassword(String(identifier)))
  ipcMain.handle('auth:reset-password', (_event, identifier: string, code: string, newPassword: string) => getAuth().resetPassword(String(identifier), String(code), String(newPassword)))
  ipcMain.handle('auth:update-display-name', (_event, displayName: string) => getAuth().updateDisplayName(String(displayName)))
  ipcMain.handle('auth:change-password', (_event, current: string, next: string) => getAuth().changePassword(String(current), String(next)))
  ipcMain.handle('auth:delete-account', (_event, password: string) => getAuth().deleteAccount(String(password)))
  ipcMain.handle('auth:access-token', () => getAuth().getAccessToken())
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>) => persistSettings(patch ?? {}))
  ipcMain.handle('update:status', () => updates.getStatus())
  ipcMain.handle('update:check', () => updates.check(readSignalingUrl()))
  ipcMain.handle('update:session-active', (_event, active: boolean) => updates.setSessionActive(active === true))
}

function registerDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sourceId = selectedCaptureSourceId
    if (!sourceId) {
      callback({})
      return
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    const source = sources.find((candidate) => candidate.id === sourceId)
    if (!source) {
      callback({})
      return
    }

    callback({
      video: source,
    })
  })
}

async function createWindow() {
  await mkdir(app.getPath('userData'), { recursive: true })
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 790,
    minWidth: 640,
    minHeight: 560,
    backgroundColor: '#0a0908',
    title: 'Telaê',
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '../../public/icon.png') }),
    autoHideMenuBar: true,
    // Barra de título integrada: a interface desenha o cabeçalho e o Windows mantém os controles da janela.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0c0a', symbolColor: '#bdb6aa', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sharing and playback must keep their cadence while the user uses another app.
      backgroundThrottling: false,
    },
  })

  // Início automático com o Windows: abre minimizado, sem roubar o foco.
  if (process.argv.includes('--hidden')) mainWindow.minimize()

  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('render-process-gone', () => {
    void stopAudioBridge()
  })

  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.telae.desktop')
    setLocale(resolveLocale(readSettings().language, app.getLocale()))
    registerIpc()
    registerDisplayMediaHandler()
    await createWindow()
    void updates.check(readSignalingUrl())
    // Apps left open also receive releases published after startup.
    const updateCheckTimer = setInterval(() => void updates.check(readSignalingUrl()), 15 * 60 * 1000)
    updateCheckTimer.unref()
    app.once('before-quit', () => clearInterval(updateCheckTimer))
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow()
    })
  })
}

app.on('before-quit', () => {
  if (audioBridge && !audioBridge.killed) audioBridge.kill()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
