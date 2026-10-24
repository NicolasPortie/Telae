import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { allowsPermission, isRendererOrigin, isTrustedFrame, secureIpcHandler } from './ipc-security.ts'

const rendererUrl = 'file:///app/renderer/index.html'
function harness(channel: string) {
  const frame = { url: rendererUrl } as WebFrameMain
  const contents = { mainFrame: frame, isDestroyed: () => false } as unknown as WebContents
  const event = { sender: contents, senderFrame: frame } as IpcMainInvokeEvent
  const listener = vi.fn(() => 'secret')
  const handler = secureIpcHandler(channel, listener, () => ({ contents, rendererUrl }))
  return { frame, contents, event, listener, handler }
}

describe('privileged IPC boundary', () => {
  it('returns credentials only to the known main document', () => {
    const { event, handler } = harness('auth:access-token')
    expect(handler(event)).toBe('secret')
  })

  it('rejects another window, a subframe, destroyed frames and navigated documents', () => {
    const { frame, event, handler, listener } = harness('auth:access-token')
    expect(() => handler({ ...event, sender: {} } as IpcMainInvokeEvent)).toThrow()
    expect(() => handler({ ...event, senderFrame: { url: rendererUrl } } as IpcMainInvokeEvent)).toThrow()
    expect(() => handler({ ...event, senderFrame: null } as IpcMainInvokeEvent)).toThrow()
    Object.assign(frame, { url: 'https://attacker.example.com' })
    expect(() => handler(event)).toThrow()
    expect(listener).not.toHaveBeenCalled()
  })

  it.each([
    ['auth:register', [null]], ['auth:register', [{ email: 'a', username: 'b', password: 'c', language: {} }]],
    ['auth:login', [{}, 'password']], ['auth:login', ['a', 'x'.repeat(1025)]],
    ['profile:set-name', [null]], ['capture:select-source', [[]]],
    ['audio:start', [Infinity, 'id']], ['audio:start', [1, '-'.repeat(36)]],
    ['environment:set-signaling-url', ['x'.repeat(2049)]], ['settings:update', [{ launchAtLogin: 'yes' }]],
    ['settings:update', [{ unknown: true }]], ['auth:access-token', ['unexpected']], ['unknown', []],
  ] as Array<[string, unknown[]]>)('rejects malformed %s arguments before invoking privileged work', (channel, args) => {
    const { handler, event, listener } = harness(channel)
    expect(() => handler(event, ...args)).toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('capture and permission boundary', () => {
  it('denies requests without a live trusted main frame', () => {
    const { frame, contents } = harness('capture:list-sources')
    expect(isTrustedFrame(frame, contents, rendererUrl)).toBe(true)
    expect(isTrustedFrame(frame, { ...contents, isDestroyed: () => true } as WebContents, rendererUrl)).toBe(false)
    expect(isTrustedFrame(null, contents, rendererUrl)).toBe(false)
    expect(isTrustedFrame(frame, null, rendererUrl)).toBe(false)
  })

  it('denies physical camera/microphone and unrelated capabilities; display capture needs selection', () => {
    for (const permission of ['media', 'geolocation', 'hid', 'serial', 'openExternal', 'clipboard-read', 'unknown']) {
      expect(allowsPermission(permission, true, true)).toBe(false)
    }
    expect(allowsPermission('display-capture', true, false)).toBe(false)
    expect(allowsPermission('display-capture', true, true)).toBe(true)
    expect(allowsPermission('display-capture', false, true)).toBe(false)
    expect(allowsPermission('notifications', true, false)).toBe(true)
    expect(allowsPermission('loopback-network', true, false)).toBe(true)
    expect(allowsPermission('local-network', false, false)).toBe(false)
  })
})

describe('renderer origin', () => {
  it('accepts permission requests that report only the app origin and rejects other origins', () => {
    expect(isRendererOrigin('telae://app/', 'telae://app/index.html')).toBe(true)
    expect(isRendererOrigin('telae://app/index.html', 'telae://app/index.html')).toBe(true)
    expect(isRendererOrigin('telae://evil/index.html', 'telae://app/index.html')).toBe(false)
    expect(isRendererOrigin('https://attacker.example.com/', 'telae://app/index.html')).toBe(false)
    expect(isRendererOrigin('file:///other/index.html', 'file:///app/renderer/index.html')).toBe(false)
    expect(isRendererOrigin(undefined, 'telae://app/index.html')).toBe(false)
  })
})

describe('screen capture permission', () => {
  it('accepts the media request of getDisplayMedia only after a source was chosen', () => {
    expect(allowsPermission('media', true, true, [])).toBe(true)
    expect(allowsPermission('media', true, false, [])).toBe(false)
    expect(allowsPermission('media', false, true, [])).toBe(false)
  })

  it('never accepts camera or microphone requests', () => {
    expect(allowsPermission('media', true, true, ['video'])).toBe(false)
    expect(allowsPermission('media', true, true, ['audio'])).toBe(false)
    expect(allowsPermission('media', true, true, ['audio', 'video'])).toBe(false)
    expect(allowsPermission('media', true, true)).toBe(false)
  })
})
