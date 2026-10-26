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
  private automaticInstall = false
  private verifiedInstaller: { version: string; filename: string } | null = null
  private downloadAttempt = 0
  private installAttempt = 0
  private installTimer: ReturnType<typeof setTimeout> | null = null
  private status: UpdateStatus = { phase: 'idle', version: app.getVersion() }
  private readonly onStatus: StatusListener
  private readonly trustedServerUrl: string
  private readonly verifyInstaller?: (version: string, filename: string) => Promise<void>

  constructor(onStatus: StatusListener, trustedServerUrl: string, verifyInstaller?: (version: string, filename: string) => Promise<void>) {
    this.onStatus = onStatus
    this.trustedServerUrl = trustedServerUrl
    this.verifyInstaller = verifyInstaller
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  getManualDownloadUrl(): string | null {
    if (this.status.phase === 'unavailable') return 'https://github.com/NicolasPortie/Telae/releases/latest'
    if (this.status.phase !== 'manual' || !this.feedUrl) return null
    return new URL(`Telae-Setup-${this.status.version}.exe`, this.feedUrl).toString()
  }

  setSessionActive(active: boolean): void {
    this.sessionActive = active
    if (active && (this.installTimer !== null || this.installing)) {
      this.installAttempt++
      if (this.installTimer !== null) clearTimeout(this.installTimer)
      this.installTimer = null
      this.installing = false
      if (this.status.phase === 'installing') this.publish({ phase: 'ready', version: this.status.version })
    }
    if (!active && this.status.phase === 'ready') this.install()
  }

  async check(): Promise<void> {
    if (!app.isPackaged || process.platform !== 'win32' || this.checking || this.installing) return
    if (this.status.phase === 'downloading' || this.status.phase === 'ready') return

    // A generic build has no trusted feed. This is a capability, not a startup error.
    if (!this.trustedServerUrl) {
      this.publish({ phase: 'unavailable', version: app.getVersion() })
      return
    }

    this.checking = true
    this.publish({ phase: 'checking', version: app.getVersion() })
    try {
      const server = new URL(this.trustedServerUrl)
      if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash) throw new Error('invalid_update_feed')
      const configPath = path.join(process.resourcesPath, 'app-update.yml')
      const config = load(readFileSync(configPath, 'utf8')) as { publisherName?: unknown } | null
      const names = typeof config?.publisherName === 'string' ? [config.publisherName] : config?.publisherName
      if (names !== undefined && (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !name.trim()))) {
        throw new Error('invalid_update_publisher')
      }
      this.automaticInstall = !!this.verifyInstaller || Array.isArray(names)
      const feedUrl = new URL('updates/windows/', `${server.toString().replace(/\/+$/, '')}/`).toString()
      if (this.feedUrl !== feedUrl) this.configure(feedUrl, configPath)
      const updater = this.updater
      if (!updater) return
      await updater.checkForUpdates()
    } catch (error) {
      this.publish({
        phase: 'error',
        version: app.getVersion(),
        message: this.errorMessage(error),
      })
    } finally {
      this.checking = false
    }
  }

  private configure(feedUrl: string, configPath: string): void {
    this.feedUrl = feedUrl
    const updater = new NsisUpdater({ provider: 'generic', url: feedUrl })
    updater.updateConfigPath = configPath
    // updateConfigPath resets electron-updater's provider; restore the pinned feed afterwards.
    updater.setFeedURL({ provider: 'generic', url: feedUrl })
    updater.disableWebInstaller = true
    // Unsigned builds may check metadata, but never download or execute it automatically.
    updater.autoDownload = this.automaticInstall
    // The detached-signature path must never let the library install on quit before our verification.
    updater.autoInstallOnAppQuit = this.automaticInstall && !this.verifyInstaller
    updater.allowDowngrade = false
    updater.on('update-available', (info) => {
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(info.version)) {
        this.publish({ phase: 'error', version: app.getVersion(), message: this.errorMessage(new Error('invalid_version')) })
        return
      }
      this.publish(this.automaticInstall
        ? { phase: 'downloading', version: info.version, percent: 0 }
        : { phase: 'manual', version: info.version })
    })
    updater.on('update-not-available', () => {
      this.publish({ phase: 'current', version: app.getVersion() })
    })
    updater.on('download-progress', (progress) => {
      const version = this.status.phase === 'downloading' ? this.status.version : app.getVersion()
      this.publish({ phase: 'downloading', version, percent: Math.round(progress.percent) })
    })
    updater.on('update-downloaded', (info) => {
      if (!this.automaticInstall) return
      if (this.verifyInstaller) {
        const attempt = ++this.downloadAttempt
        this.verifiedInstaller = null
        void (async () => {
          if (typeof info.downloadedFile !== 'string' || !info.downloadedFile) throw new Error('invalid_update_file')
          await this.verifyInstaller!(info.version, info.downloadedFile)
          if (attempt !== this.downloadAttempt) return
          this.verifiedInstaller = { version: info.version, filename: info.downloadedFile }
          this.publish({ phase: 'ready', version: info.version })
          if (!this.sessionActive) this.install()
        })().catch(error => { if (attempt === this.downloadAttempt) this.fail(error) })
      } else {
        this.publish({ phase: 'ready', version: info.version })
        if (!this.sessionActive) this.install()
      }
    })
    updater.on('error', (error) => {
      this.fail(error)
    })
    this.updater = updater
  }

  private install(): void {
    if (!this.automaticInstall || this.installing || this.sessionActive || this.status.phase !== 'ready') return
    this.installing = true
    const attempt = ++this.installAttempt
    this.publish({ phase: 'installing', version: this.status.version })
    // Deixa o aviso de reinício chegar à janela antes de encerrá-la.
    this.installTimer = setTimeout(() => {
      this.installTimer = null
      if (this.sessionActive || this.status.phase !== 'installing') {
        this.installing = false
        return
      }
      // Silent NSIS update; relaunch the app without opening the setup wizard.
      if (this.verifyInstaller) {
        const installer = this.verifiedInstaller
        if (!installer || installer.version !== this.status.version) { this.fail(new Error('unverified_update')); return }
        void this.verifyInstaller(installer.version, installer.filename).then(() => {
          if (attempt === this.installAttempt && !this.sessionActive && this.status.phase === 'installing' && this.verifiedInstaller === installer) this.updater?.quitAndInstall(true, true)
        }).catch(error => { if (attempt === this.installAttempt) this.fail(error) })
      } else this.updater?.quitAndInstall(true, true)
    }, 1500)
  }

  private publish(status: UpdateStatus): void {
    this.status = status
    this.onStatus(status)
  }

  private fail(error: unknown): void {
    this.downloadAttempt++
    this.installAttempt++
    this.verifiedInstaller = null
    if (this.installTimer !== null) clearTimeout(this.installTimer)
    this.installTimer = null
    this.installing = false
    this.publish({ phase: 'error', version: app.getVersion(), message: this.errorMessage(error) })
  }

  private errorMessage(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error)
    if (/invalid_update_(signature|size|hash)|unverified_update/.test(detail)) return t('Essa atualização não passou na verificação de segurança. Tenta de novo mais tarde.')
    if (/404|ENOENT/i.test(detail)) return t('O servidor ainda não tem essa atualização. Tenta de novo mais tarde.')
    return t('Não deu pra baixar a atualização. Confere a conexão com o servidor.')
  }
}
