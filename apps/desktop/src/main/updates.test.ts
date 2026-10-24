import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const updaterInstances = vi.hoisted(() => [] as Array<{
  feed: { provider: string; url: string }
  emit(event: string, ...args: unknown[]): boolean
  checkForUpdates: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  setFeedURL: ReturnType<typeof vi.fn>
}>)

const updateConfig = vi.hoisted(() => ({ value: 'publisherName: Telae' }))
vi.mock('node:fs', () => ({ readFileSync: () => updateConfig.value }))

vi.mock('electron', () => ({ app: { getVersion: () => '0.1.5', isPackaged: true } }))
vi.mock('electron-updater', () => ({
  default: {
    NsisUpdater: class extends EventEmitter {
      autoDownload = true
      autoInstallOnAppQuit = true
      feed: { provider: string; url: string }
      setFeedURL = vi.fn((feed: { provider: string; url: string }) => { this.feed = feed })
      set updateConfigPath(_value: string) {
        // Match the real library: setting its disk config clears the constructor's provider.
        this.feed = { provider: 'generic', url: 'https://placeholder.invalid/updates/' }
      }
      checkForUpdates = vi.fn(async () => null)
      quitAndInstall = vi.fn()
      constructor(feed: { provider: string; url: string }) {
        super()
        this.feed = feed
        updaterInstances.push(this)
      }
    },
  },
}))

import { DesktopUpdates } from './updates.ts'

describe('DesktopUpdates', () => {
  beforeEach(() => {
    updaterInstances.length = 0
    vi.useFakeTimers()
    vi.stubGlobal('process', { platform: 'win32', resourcesPath: '/app/resources' })
    updateConfig.value = 'publisherName: Telae'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('checks only the build-configured HTTPS update server', async () => {
    const updates = new DesktopUpdates(vi.fn(), 'https://updates.example.com')
    await updates.check()
    expect(updaterInstances[0].feed).toEqual({
      provider: 'generic',
      url: 'https://updates.example.com/updates/windows/',
    })
    expect(updaterInstances[0].checkForUpdates).toHaveBeenCalledOnce()
    expect(updaterInstances[0].setFeedURL).toHaveBeenCalledWith(updaterInstances[0].feed)
  })

  it('waits for a live session to end before installing a downloaded update', async () => {
    const updates = new DesktopUpdates(vi.fn(), 'https://updates.example.com')
    await updates.check()
    const updater = updaterInstances[0]
    updates.setSessionActive(true)
    updater.emit('update-downloaded', { version: '0.1.6' })
    vi.advanceTimersByTime(1000)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    updates.setSessionActive(false)
    vi.advanceTimersByTime(1500)
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true)
  })

  it('cancels a scheduled restart if a session starts during the delay', async () => {
    const updates = new DesktopUpdates(vi.fn(), 'https://updates.example.com')
    await updates.check()
    const updater = updaterInstances[0]
    updater.emit('update-downloaded', { version: '0.1.12' })
    vi.advanceTimersByTime(250)
    updates.setSessionActive(true)
    vi.advanceTimersByTime(1000)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    updates.setSessionActive(false)
    vi.advanceTimersByTime(1500)
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true)
  })

  it('installs silently and relaunches automatically when idle', async () => {
    const updates = new DesktopUpdates(vi.fn(), 'https://updates.example.com')
    await updates.check()
    updaterInstances[0].emit('update-downloaded', { version: '0.1.17' })
    expect(updates.getStatus()).toEqual({ phase: 'installing', version: '0.1.17' })
    vi.advanceTimersByTime(1499)
    expect(updaterInstances[0].quitAndInstall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(updaterInstances[0].quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true)
  })

  it('allows another check after an installation error', async () => {
    const updates = new DesktopUpdates(vi.fn(), 'https://updates.example.com')
    await updates.check()
    const updater = updaterInstances[0]
    updater.quitAndInstall.mockImplementationOnce(() => updater.emit('error', new Error('install failed')))
    updater.emit('update-downloaded', { version: '0.1.17' })
    vi.advanceTimersByTime(1500)
    expect(updates.getStatus().phase).toBe('error')
    await updates.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('treats a generic build as manual, without a persistent startup error', async () => {
    const updates = new DesktopUpdates(vi.fn(), '')
    await updates.check()
    expect(updaterInstances).toHaveLength(0)
    expect(updates.getStatus().phase).toBe('unavailable')
    expect(updates.getManualDownloadUrl()).toBe('https://github.com/NicolasPortie/Telae/releases/latest')
  })

  it.each(['invalid', 'http://updates.example.com', 'http://localhost:5015'])('never starts an updater without a trusted HTTPS feed (%s)', async feed => {
    const updates = new DesktopUpdates(vi.fn(), feed)
    await expect(updates.check()).resolves.toBeUndefined()
    expect(updaterInstances).toHaveLength(0)
    expect(updates.getStatus().phase).toBe('error')
  })

  it.each(['publisherName: []', 'publisherName: ""', 'publisherName: [Telae, ""]', 'publisherName: 123'])('refuses malformed publisher configuration (%s)', async config => {
    updateConfig.value = config
    const updates = new DesktopUpdates(vi.fn(), 'https://updates.example.com')
    await updates.check()
    expect(updaterInstances).toHaveLength(0)
    expect(updates.getStatus().phase).toBe('error')
  })

  it('checks unsigned installations quietly and offers a trusted manual download only for a newer version', async () => {
    updateConfig.value = 'provider: generic'
    const updates = new DesktopUpdates(vi.fn(), 'https://updates.example.com')
    await updates.check()
    const updater = updaterInstances[0]
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    updater.emit('update-not-available')
    expect(updates.getStatus()).toEqual({ phase: 'current', version: '0.1.5' })
    expect(updates.getManualDownloadUrl()).toBeNull()
    updater.emit('update-available', { version: '0.3.2' })
    expect(updates.getStatus()).toEqual({ phase: 'manual', version: '0.3.2' })
    expect(updates.getManualDownloadUrl()).toBe('https://updates.example.com/updates/windows/Telae-Setup-0.3.2.exe')
    updater.emit('update-downloaded', { version: '0.3.2' })
    updates.setSessionActive(false)
    vi.advanceTimersByTime(5000)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not derive a download link from a malformed release version', async () => {
    updateConfig.value = ''
    const updates = new DesktopUpdates(vi.fn(), 'https://updates.example.com')
    await updates.check()
    updaterInstances[0].emit('update-available', { version: '../../attacker.exe' })
    expect(updates.getStatus().phase).toBe('error')
    expect(updates.getManualDownloadUrl()).toBeNull()
  })
})
