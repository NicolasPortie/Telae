import { t } from '../i18n/index.ts'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { load } from 'js-yaml'
import type { UpdateStatus } from '../shared/contracts.ts'

const { NsisUpdater } = electronUpdater

type StatusListener = (status: UpdateStatus) => void

export class DesktopUpdates {
  private updater: InstanceType<typeof NsisUpdater> | null = null
  private feedUrl: string | null = null
  private checking = false
  private sessionActive = false
  private installing = false
  private installTimer: ReturnType<typeof setTimeout> | null = null
  private status: UpdateStatus = { phase: 'idle', version: app.getVersion() }
  private readonly onStatus: StatusListener
  private readonly trustedServerUrl: string

  constructor(onStatus: StatusListener, trustedServerUrl: string) {
    this.onStatus = onStatus
    this.trustedServerUrl = trustedServerUrl
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  setSessionActive(active: boolean): void {
    this.sessionActive = active
    if (active && this.installTimer !== null) {
      clearTimeout(this.installTimer)
      this.installTimer = null
      this.installing = false
      if (this.status.phase === 'installing') this.publish({ phase: 'ready', version: this.status.version })
    }
    if (!active && this.status.phase === 'ready') this.install()
  }

  async check(): Promise<void> {
    if (!app.isPackaged || process.platform !== 'win32' || this.checking || this.installing) return
    if (this.status.phase === 'downloading' || this.status.phase === 'ready') return

    this.checking = true
    this.publish({ phase: 'checking', version: app.getVersion() })
    try {
      const server = new URL(this.trustedServerUrl)
      if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash) throw new Error('manual_update')
      const configPath = path.join(process.resourcesPath, 'app-update.yml')
      const config = load(readFileSync(configPath, 'utf8')) as { publisherName?: unknown } | null
      const names = typeof config?.publisherName === 'string' ? [config.publisherName] : config?.publisherName
      if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !name.trim())) {
        throw new Error('manual_update')
      }
      const feedUrl = new URL('updates/windows/', `${server.toString().replace(/\/+$/, '')}/`).toString()
      if (this.feedUrl !== feedUrl) this.configure(feedUrl, configPath)
      const updater = this.updater
      if (!updater) return
      await updater.checkForUpdates()
    } catch (error) {
      this.publish({
        phase: 'error',
        version: app.getVersion(),
        message: !this.updater ? t('Essa instalação não atualiza sozinha. Baixa o instalador mais novo na página do projeto.') : this.errorMessage(error),
      })
    } finally {
      this.checking = false
    }
  }

  private configure(feedUrl: string, configPath: string): void {
    this.feedUrl = feedUrl
    const updater = new NsisUpdater({ provider: 'generic', url: feedUrl })
    updater.updateConfigPath = configPath
    updater.disableWebInstaller = true
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('update-available', (info) => {
      this.publish({ phase: 'downloading', version: info.version, percent: 0 })
    })
    updater.on('update-not-available', () => {
      this.publish({ phase: 'current', version: app.getVersion() })
    })
    updater.on('download-progress', (progress) => {
      const version = this.status.phase === 'downloading' ? this.status.version : app.getVersion()
      this.publish({ phase: 'downloading', version, percent: Math.round(progress.percent) })
    })
    updater.on('update-downloaded', (info) => {
      this.publish({ phase: 'ready', version: info.version })
      if (!this.sessionActive) this.install()
    })
    updater.on('error', (error) => {
      if (this.installTimer !== null) clearTimeout(this.installTimer)
      this.installTimer = null
      this.installing = false
      this.publish({ phase: 'error', version: app.getVersion(), message: this.errorMessage(error) })
    })
    this.updater = updater
  }

  private install(): void {
    if (this.installing || this.sessionActive || this.status.phase !== 'ready') return
    this.installing = true
    this.publish({ phase: 'installing', version: this.status.version })
    // Deixa o aviso de reinício chegar à janela antes de encerrá-la.
    this.installTimer = setTimeout(() => {
      this.installTimer = null
      if (this.sessionActive || this.status.phase !== 'installing') {
        this.installing = false
        return
      }
      // Silent NSIS update; relaunch the app without opening the setup wizard.
      this.updater?.quitAndInstall(true, true)
    }, 1500)
  }

  private publish(status: UpdateStatus): void {
    this.status = status
    this.onStatus(status)
  }

  private errorMessage(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error)
    if (/404|ENOENT/i.test(detail)) return t('O servidor ainda não tem essa atualização. Tenta de novo mais tarde.')
    return t('Não deu pra baixar a atualização. Confere a conexão com o servidor.')
  }
}
