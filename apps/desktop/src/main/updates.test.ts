import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const updaterInstances = vi.hoisted(() => [] as Array<{
  feed: { provider: string; url: string }
  emit(event: string, ...args: unknown[]): boolean
  checkForUpdates: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}>)

vi.mock('electron', () => ({ app: { getVersion: () => '0.1.5', isPackaged: true } }))
vi.mock('electron-updater', () => ({
  default: {
    NsisUpdater: class extends EventEmitter {
      readonly feed: { provider: string; url: string }
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
    vi.stubGlobal('process', { platform: 'win32' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('checks the update feed on the configured signaling server', async () => {
    const updates = new DesktopUpdates(vi.fn())
    await updates.check('http://192.0.2.10:5015/')
    expect(updaterInstances[0].feed).toEqual({
      provider: 'generic',
      url: 'http://192.0.2.10:5015/updates/windows/',
    })
    expect(updaterInstances[0].checkForUpdates).toHaveBeenCalledOnce()
  })

  it('waits for a live session to end before installing a downloaded update', async () => {
    const updates = new DesktopUpdates(vi.fn())
    await updates.check('http://localhost:5015')
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
    const updates = new DesktopUpdates(vi.fn())
    await updates.check('http://localhost:5015')
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
    const updates = new DesktopUpdates(vi.fn())
    await updates.check('https://example.com')
    updaterInstances[0].emit('update-downloaded', { version: '0.1.17' })
    expect(updates.getStatus()).toEqual({ phase: 'installing', version: '0.1.17' })
    vi.advanceTimersByTime(1499)
    expect(updaterInstances[0].quitAndInstall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(updaterInstances[0].quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true)
  })

  it('allows another check after an installation error', async () => {
    const updates = new DesktopUpdates(vi.fn())
    await updates.check('https://example.com')
    const updater = updaterInstances[0]
    updater.quitAndInstall.mockImplementationOnce(() => updater.emit('error', new Error('install failed')))
    updater.emit('update-downloaded', { version: '0.1.17' })
    vi.advanceTimersByTime(1500)
    expect(updates.getStatus().phase).toBe('error')
    await updates.check('https://example.com')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('reports invalid feed URLs without an unhandled rejection', async () => {
    const updates = new DesktopUpdates(vi.fn())
    await expect(updates.check('invalid')).resolves.toBeUndefined()
    expect(updates.getStatus().phase).toBe('error')
    await updates.check('https://example.com')
    expect(updaterInstances[0].checkForUpdates).toHaveBeenCalledOnce()
  })
})
