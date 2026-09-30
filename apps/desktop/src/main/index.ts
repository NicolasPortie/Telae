import { randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import type {
  AudioBridgeState,
  AudioProcess,
  AudioStreamMetadata,
  CaptureSource,
  LocalProfile,
} from '../shared/contracts.ts'
import { DesktopUpdates } from './updates.ts'

let mainWindow: BrowserWindow | null = null
let audioBridge: ChildProcess | null = null
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
  if (!trimmed) throw new Error('Informe o endereço do servidor de sinalização.')

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Informe uma URL válida, como https://telae.seudominio.com.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('O servidor de sinalização deve usar http:// ou https://.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Use somente o endereço base do servidor, sem credenciais, parâmetros ou fragmentos.')
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

function persistSignalingUrl(value: string): string {
  const signalingUrl = normalizeSignalingUrl(value)
  writeFileSync(settingsPath(), JSON.stringify({ signalingUrl }, null, 2), 'utf8')
  return signalingUrl
}

function readProfile(): LocalProfile {
  try {
    const parsed = JSON.parse(readFileSync(profilePath(), 'utf8')) as Partial<LocalProfile>
    return {
      deviceId: parsed.deviceId || randomUUID(),
      displayName: parsed.displayName?.trim() || '',
      friendCodes: Array.isArray(parsed.friendCodes) ? parsed.friendCodes.filter((code: string) => Boolean(code)) : [],
    }
  } catch {
    return { deviceId: randomUUID(), displayName: '', friendCodes: [] }
  }
}

function persistProfile(profile: LocalProfile): LocalProfile {
  writeFileSync(profilePath(), JSON.stringify(profile, null, 2), 'utf8')
  return profile
}

function normalizeFriendCode(value: string): string {
  return value.trim().replaceAll('-', '').toUpperCase()
}

function findAudioBridge(): string {
  const executable = 'Telae.AudioBridge.exe'
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'audio-bridge', executable)]
    : [
        path.resolve(app.getAppPath(), '..', 'audio-bridge', 'bin', 'Debug', 'net10.0-windows10.0.19041.0', executable),
        path.resolve(app.getAppPath(), '..', 'audio-bridge', 'bin', 'Release', 'net10.0-windows10.0.19041.0', executable),
      ]

  const found = candidates.find(existsSync)
  if (!found) throw new Error('Audio bridge não encontrado. Compile apps/audio-bridge antes de iniciar o desktop.')
  return found
}

function sendAudioState(state: AudioBridgeState) {
  audioState = state
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('audio:state', state)
}

async function stopAudioBridge() {
  const active = audioBridge
  audioBridge = null
  if (active && !active.killed) active.kill()
  sendAudioState({ status: 'idle' })
}

function registerIpc() {
  ipcMain.handle('profile:get', () => persistProfile(readProfile()))
  ipcMain.handle('profile:set-name', (_event, displayName: string) => {
    const normalized = displayName.trim().slice(0, 32)
    if (!normalized) throw new Error('Informe seu nome.')
    const profile = readProfile()
    profile.displayName = normalized
    return persistProfile(profile)
  })
  ipcMain.handle('profile:add-friend', (_event, friendCode: string) => {
    const code = normalizeFriendCode(friendCode)
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Código de amigo inválido.')
    const profile = readProfile()
    if (!profile.friendCodes.includes(code)) profile.friendCodes.push(code)
    return persistProfile(profile)
  })
  ipcMain.handle('profile:remove-friend', (_event, friendCode: string) => {
    const profile = readProfile()
    profile.friendCodes = profile.friendCodes.filter((code) => code !== normalizeFriendCode(friendCode))
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
    if (!sourceId?.trim()) throw new Error('Escolha uma Capture Source antes de iniciar.')
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    if (!sources.some((source) => source.id === sourceId)) {
      throw new Error('A Capture Source escolhida não está mais disponível.')
    }
    selectedCaptureSourceId = sourceId
  })

  ipcMain.handle('audio:list-processes', (): AudioProcess[] => {
    const executable = findAudioBridge()
    const result = spawnSync(executable, ['list'], { encoding: 'utf8', windowsHide: true })
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Não foi possível listar os aplicativos de áudio.')
    return JSON.parse(result.stdout) as AudioProcess[]
  })

  ipcMain.handle('audio:start', async (_event, processId: number) => {
    if (!Number.isInteger(processId) || processId <= 0) throw new Error('Processo de áudio inválido.')
    await stopAudioBridge()
    const executable = findAudioBridge()
    sendAudioState({ status: 'starting', processId })

    const child = spawn(executable, ['capture', '--pid', String(processId)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    audioBridge = child
    let stderrBuffer = ''

    child.stdout.on('data', (chunk: Buffer) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('audio:chunk', new Uint8Array(chunk))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8')
      const lines = stderrBuffer.split(/\r?\n/)
      stderrBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('TELAE_FORMAT ')) {
          const metadata = JSON.parse(line.slice('TELAE_FORMAT '.length)) as AudioStreamMetadata
          sendAudioState({ status: 'capturing', metadata })
        } else if (line.startsWith('TELAE_ERROR ')) {
          sendAudioState({ status: 'error', message: line.slice('TELAE_ERROR '.length) })
        }
      }
    })
    child.on('error', (error) => sendAudioState({ status: 'error', message: error.message }))
    child.on('exit', (code) => {
      if (audioBridge === child) audioBridge = null
      if (code && code !== 0 && audioState.status !== 'error') {
        sendAudioState({ status: 'error', message: `O capturador de áudio encerrou com código ${code}.` })
      } else if (audioState.status !== 'error') {
        sendAudioState({ status: 'idle' })
      }
    })
  })

  ipcMain.handle('audio:stop', stopAudioBridge)
  ipcMain.handle('environment:get', () => ({
    platform: process.platform,
    isPackaged: app.isPackaged,
    signalingUrl: readSignalingUrl(),
  }))
  ipcMain.handle('environment:set-signaling-url', (_event, signalingUrl: string) => {
    const saved = persistSignalingUrl(signalingUrl)
    void updates.check(saved)
    return { platform: process.platform, isPackaged: app.isPackaged, signalingUrl: saved }
  })
  ipcMain.handle('update:status', () => updates.getStatus())
  ipcMain.handle('update:check', () => updates.check(readSignalingUrl()))
  ipcMain.handle('update:session-active', (_event, active: boolean) => updates.setSessionActive(active === true))
}

function registerDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
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
      audio: request.audioRequested && process.platform === 'win32' ? 'loopback' : undefined,
    })
  })
}

async function createWindow() {
  await mkdir(app.getPath('userData'), { recursive: true })
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 790,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#0b0b0c',
    title: 'Telae',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

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
    registerIpc()
    registerDisplayMediaHandler()
    await createWindow()
    void updates.check(readSignalingUrl())
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
