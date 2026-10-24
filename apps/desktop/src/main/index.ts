import { resolveLocale, setLocale, t } from '../i18n/index.ts'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { release } from 'node:os'
import { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, safeStorage, session, shell } from 'electron'
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
import { signedUpdateVerifier } from './update-signature.ts'
import { readLocalProfile, writeJsonAtomically, writeLocalProfile, type SecretCipher } from './profile-store.ts'
import { AuthServerClient } from './auth-client.ts'
import { AuthSession } from './auth-session.ts'
import { createSessionStorage } from './auth-store.ts'
import { resolveAudioBridgePath } from './audio-bridge-path.ts'
import { migrateBuiltInServer, normalizeSignalingUrl, SignalingServerSettings } from './signaling-url.ts'
import { allowsPermission, isRendererOrigin, isTrustedFrame, secureIpcHandler } from './ipc-security.ts'
import { guardRendererNavigation, PACKAGED_RENDERER_URL, packagedRendererResponse, rendererContentSecurityPolicy, withRendererCsp } from './renderer-security.ts'

protocol.registerSchemesAsPrivileged([{ scheme: 'telae', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

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

const profilePath = () => path.join(app.getPath('userData'), 'profile.json')
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const LOCAL_SIGNALING_URL = 'http://localhost:5015'
// Definido na compilação dos instaladores oficiais (TELAE_DEFAULT_SERVER_URL). Vazio em builds do código aberto.
const BUILT_IN_SIGNALING_URL = typeof __TELAE_DEFAULT_SERVER_URL__ === 'string' ? __TELAE_DEFAULT_SERVER_URL__.replace(/\/+$/, '') : ''
const PREVIOUS_SIGNALING_URL = typeof __TELAE_PREVIOUS_SERVER_URL__ === 'string' ? __TELAE_PREVIOUS_SERVER_URL__ : ''
const DEFAULT_SIGNALING_URL = app.isPackaged && BUILT_IN_SIGNALING_URL ? BUILT_IN_SIGNALING_URL : LOCAL_SIGNALING_URL
const UPDATE_PUBLIC_KEY = typeof __TELAE_UPDATE_PUBLIC_KEY__ === 'string' ? __TELAE_UPDATE_PUBLIC_KEY__ : ''

const updates = new DesktopUpdates((status) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status)
}, BUILT_IN_SIGNALING_URL, UPDATE_PUBLIC_KEY && BUILT_IN_SIGNALING_URL ? signedUpdateVerifier(UPDATE_PUBLIC_KEY, BUILT_IN_SIGNALING_URL, (input, init) => net.fetch(String(input), init)) : undefined)

function readSignalingUrl(): string {
  try {
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as { signalingUrl?: string }
    if (settings.signalingUrl) {
      const saved = normalizeSignalingUrl(settings.signalingUrl)
      const migrated = app.isPackaged ? migrateBuiltInServer(saved, BUILT_IN_SIGNALING_URL, PREVIOUS_SIGNALING_URL) : saved
      if (migrated !== saved) {
        writeJsonAtomically(settingsPath(), { ...readStoredSettings(), signalingUrl: migrated })
        return migrated
      }
      // Instaladores antigos apontavam para o localhost mesmo fora do servidor.
      if (app.isPackaged && BUILT_IN_SIGNALING_URL && saved === LOCAL_SIGNALING_URL) return BUILT_IN_SIGNALING_URL
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
  return signalingServer.saveForRestart(value)
}

const signalingServer = new SignalingServerSettings(readSignalingUrl(), signalingUrl => {
  writeJsonAtomically(settingsPath(), { ...readStoredSettings(), signalingUrl })
})

const SECRET_PREFIX = 'safe:'

/** Cofre do sistema para a credencial; sem ele (ex.: Linux sem keyring) o perfil segue em arquivo local. */
function profileCipher(): SecretCipher | undefined {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) return undefined
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
  if (!authSession) {
    const serverUrl = signalingServer.activeUrl
    authSession = new AuthSession(
      new AuthServerClient(() => serverUrl),
      createSessionStorage(authSessionPath(), profileCipher, serverUrl),
      syncProfileWithAccount,
    )
  }
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

function rendererUrl(): string {
  return !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).toString()
    : PACKAGED_RENDERER_URL
}

function registerRendererSecurity() {
  const documentUrl = rendererUrl()
  const policy = rendererContentSecurityPolicy(signalingServer.activeUrl,
    documentUrl === PACKAGED_RENDERER_URL ? undefined : documentUrl)
  // O protocolo local permite enviar a CSP também no app empacotado.
  session.defaultSession.protocol.handle('telae', request => packagedRendererResponse(request,
    path.join(__dirname, '../renderer'), url => net.fetch(url), policy))
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: details.url === documentUrl
      ? withRendererCsp(details.responseHeaders, policy) : details.responseHeaders })
  })
}

function registerIpc() {
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => {
    ipcMain.handle(channel, secureIpcHandler(channel, listener, () => ({
      contents: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null,
      rendererUrl: rendererUrl(),
    })))
  }
  handle('profile:get', () => persistProfile(readProfile()))
  handle('profile:set-name', (_event, displayName: string) => {
    const normalized = displayName.trim().slice(0, 32)
    if (!normalized) throw new Error(t('Escreve seu nome.'))
    const profile = readProfile()
    profile.displayName = normalized
    return persistProfile(profile)
  })

  handle('capture:list-sources', async (): Promise<CaptureSource[]> => {
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

  handle('capture:select-source', async (_event, sourceId: string): Promise<void> => {
    if (!sourceId?.trim()) throw new Error(t('Escolhe uma tela ou janela antes de começar.'))
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    if (!sources.some((source) => source.id === sourceId)) {
      throw new Error(t('Essa tela ou janela não está mais disponível. Escolhe outra.'))
    }
    selectedCaptureSourceId = sourceId
  })

  handle('capture:resolve-window-audio', async (_event, sourceId: string): Promise<number> => {
    if (sourceId !== selectedCaptureSourceId || !sourceId.startsWith('window:'))
      throw new Error(t('Escolhe uma janela pra pegar o som dela.'))
    const match = /^window:(\d+):/.exec(sourceId)
    if (!match) throw new Error(t('Não deu pra identificar essa janela. Escolhe de novo.'))
    const result = await execFileAsync(findAudioBridge(), ['resolve-window', match[1]], { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 })
    const processId = Number(result.stdout.trim())
    if (!Number.isInteger(processId) || processId <= 0)
      throw new Error(t('Não deu pra achar o som desse app.'))
    return processId
  })

  handle('audio:list-processes', async (): Promise<AudioProcess[]> => {
    const executable = findAudioBridge()
    const result = await execFileAsync(executable, ['list'], { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 })
    return JSON.parse(result.stdout) as AudioProcess[]
  })

  const startAudioBridge = (processId: number, captureId: string, screen = false) => {
    if (typeof captureId !== 'string' || !/^[a-f0-9-]{36}$/i.test(captureId)) throw new Error(t('Não deu pra usar essa captura de som. Tenta de novo.'))
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
        sendAudioState({ status: 'error', message: t('A captura do som parou de repente. Tenta de novo.', { code: String(code) }), captureId })
      } else if (audioState.status !== 'error') {
        sendAudioState({ status: 'idle', captureId })
      }
    })
  }

  handle('audio:start', (_event, processId: number, captureId: string) => {
    if (!Number.isInteger(processId) || processId <= 0) throw new Error(t('Não deu pra achar o som desse app.'))
    startAudioBridge(processId, captureId)
  })
  handle('audio:start-screen', (_event, captureId: string) => {
    if (!selectedCaptureSourceId?.startsWith('screen:')) throw new Error(t('Escolhe uma tela pra pegar o som.'))
    startAudioBridge(0, captureId, true)
  })

  handle('audio:stop', (_event, captureId: string) => {
    if (typeof captureId === 'string') stopAudioBridge(captureId)
  })
  handle('environment:get', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    signalingUrl: signalingServer.activeUrl,
    forceRelay: !app.isPackaged && process.env.TELAE_E2E_RELAY === '1',
  }))
  handle('environment:set-signaling-url', (_event, signalingUrl: string) => {
    const saved = persistSignalingUrl(signalingUrl)
    void updates.check()
    return { version: app.getVersion(), platform: process.platform, isPackaged: app.isPackaged, signalingUrl: saved }
  })
  handle('auth:session', async () => {
    const auth = getAuth()
    const account = await auth.restore()
    if (account) syncProfileWithAccount(account)
    return account
  })
  handle('auth:register', (_event, input: { email: string; username: string; password: string; language: string }) => getAuth().register(input))
  handle('auth:verify-email', (_event, identifier: string, code: string, password: string) => getAuth().verifyEmail(identifier, code, password))
  handle('auth:resend-verification', (_event, identifier: string) => getAuth().resendVerification(String(identifier)))
  handle('auth:login', (_event, identifier: string, password: string) => getAuth().login(String(identifier), String(password)))
  handle('auth:logout', () => getAuth().logout())
  handle('auth:forgot-password', (_event, identifier: string) => getAuth().forgotPassword(String(identifier)))
  handle('auth:reset-password', (_event, identifier: string, code: string, newPassword: string) => getAuth().resetPassword(String(identifier), String(code), String(newPassword)))
  handle('auth:update-display-name', (_event, displayName: string) => getAuth().updateDisplayName(String(displayName)))
  handle('auth:change-password', (_event, current: string, next: string) => getAuth().changePassword(String(current), String(next)))
  handle('auth:delete-account', (_event, password: string) => getAuth().deleteAccount(String(password)))
  handle('auth:access-token', () => getAuth().getAccessToken())
  handle('settings:get', () => readSettings())
  handle('settings:update', (_event, patch: Partial<AppSettings>) => persistSettings(patch ?? {}))
  handle('update:status', () => updates.getStatus())
  handle('update:check', async () => {
    const downloadUrl = updates.getManualDownloadUrl()
    if (downloadUrl) await shell.openExternal(downloadUrl)
    else await updates.check()
  })
  handle('update:session-active', (_event, active: boolean) => updates.setSessionActive(active === true))
}

function registerDisplayMediaHandler() {
  const trusted = (contents: Electron.WebContents | null, url: string | undefined, mainFrame: boolean) =>
    !!mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents && mainFrame && isRendererOrigin(url, rendererUrl())
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    allowsPermission(permission, trusted(contents, details.requestingUrl, details.isMainFrame), !!selectedCaptureSourceId))
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(allowsPermission(permission, trusted(contents, details.requestingUrl, details.isMainFrame), !!selectedCaptureSourceId,
      (details as { mediaTypes?: string[] }).mediaTypes ?? ['video'])))
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sourceId = selectedCaptureSourceId
    if (!sourceId || !mainWindow || mainWindow.isDestroyed() || !isTrustedFrame(request.frame, mainWindow.webContents, rendererUrl())) {
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

    if (!mainWindow || mainWindow.isDestroyed() || !isTrustedFrame(request.frame, mainWindow.webContents, rendererUrl()) || selectedCaptureSourceId !== sourceId) {
      callback({})
      return
    }
    callback({ video: source })
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

  guardRendererNavigation(mainWindow.webContents)
  mainWindow.webContents.on('render-process-gone', () => {
    void stopAudioBridge()
  })

  await mainWindow.loadURL(rendererUrl())
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
    registerRendererSecurity()
    registerDisplayMediaHandler()
    await createWindow()
    void updates.check()
    // Apps left open also receive releases published after startup.
    const updateCheckTimer = setInterval(() => void updates.check(), 15 * 60 * 1000)
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
