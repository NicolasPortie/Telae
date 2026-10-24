import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WebContents } from 'electron'
import { load } from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'
import { SignalingServerSettings } from './signaling-url.ts'
import { guardRendererNavigation, PACKAGED_RENDERER_URL, packagedRendererResponse, rendererContentSecurityPolicy, withRendererCsp } from './renderer-security.ts'

const connectSources = (policy: string) => policy.split('; ').find(value => value.startsWith('connect-src '))!.split(' ').slice(1)

describe('renderer network policy', () => {
  it('allows only the active server origin, its websocket counterpart and ICE schemes', () => {
    expect(connectSources(rendererContentSecurityPolicy('https://SERVER.example.com:8443/prefix'))).toEqual([
      "'self'", 'https://server.example.com:8443', 'wss://server.example.com:8443', 'stun:', 'stuns:', 'turn:', 'turns:',
    ])
    expect(connectSources(rendererContentSecurityPolicy('http://[::1]:5015'))).toContain('ws://[::1]:5015')
  })

  it('adds only the exact development origin and HMR websocket', () => {
    expect(connectSources(rendererContentSecurityPolicy('https://server.example.com', 'http://localhost:5173/index.html'))).toEqual([
      "'self'", 'https://server.example.com', 'wss://server.example.com', 'stun:', 'stuns:', 'turn:', 'turns:',
      'http://localhost:5173', 'ws://localhost:5173',
    ])
  })

  it('keeps the same server as REST and SignalR until restart', () => {
    const settings = new SignalingServerSettings('https://active.example.com', () => undefined)
    settings.saveForRestart('https://next.example.com')
    expect(rendererContentSecurityPolicy(settings.activeUrl)).toContain('https://active.example.com wss://active.example.com')
    expect(rendererContentSecurityPolicy(settings.activeUrl)).not.toContain('next.example.com')
  })

  it.each(['https://example.com/; connect-src *', 'https://user:pass@example.com', 'http://remote.example.com'])('rejects unsafe policy input (%s)', url => {
    if (url.includes('/;')) {
      expect(connectSources(rendererContentSecurityPolicy(url))).not.toContain('*')
    } else expect(() => rendererContentSecurityPolicy(url)).toThrow()
  })

  it('replaces differently cased response policies without losing other headers', () => {
    expect(withRendererCsp({ 'content-security-policy': ['connect-src *'], 'Content-Type': ['text/html'] }, 'connect-src https://active.example.com'))
      .toEqual({ 'Content-Type': ['text/html'], 'Content-Security-Policy': ['connect-src https://active.example.com'] })
  })
})

describe('bundled renderer protocol', () => {
  const root = path.resolve('out/renderer')
  const policy = rendererContentSecurityPolicy('https://server.example.com')

  it('serves only bundled assets with a CSP response header and their content type', async () => {
    const fetchFile = vi.fn(async () => new Response('asset', { headers: { 'Content-Type': 'text/javascript' } }))
    const response = await packagedRendererResponse(new Request('telae://app/assets/main.js'), root, fetchFile, policy)
    expect(fetchFile).toHaveBeenCalledWith(pathToFileURL(path.join(root, 'assets/main.js')).toString())
    expect(response.headers.get('Content-Type')).toBe('text/javascript')
    expect(response.headers.get('Content-Security-Policy')).toBe(policy)
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.text()).toBe('asset')
  })

  it.each(['telae://other/index.html', 'https://app/index.html', 'telae://app:123/index.html',
    'telae://app/..%2f..%2fsecret', 'telae://app/%5c..%5csecret', 'telae://app/index.html:stream', 'telae://app/%00', 'telae://app/%ZZ', 'telae://app/'])('denies untrusted paths before reading (%s)', async url => {
    const fetchFile = vi.fn()
    expect((await packagedRendererResponse(new Request(url), root, fetchFile, policy)).status).toBe(403)
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('denies writes, returns no body for HEAD and handles absent assets', async () => {
    const fetchFile = vi.fn(async () => new Response('asset'))
    expect((await packagedRendererResponse(new Request(PACKAGED_RENDERER_URL, { method: 'POST' }), root, fetchFile, policy)).status).toBe(403)
    expect(fetchFile).not.toHaveBeenCalled()
    expect(await (await packagedRendererResponse(new Request(PACKAGED_RENDERER_URL, { method: 'HEAD' }), root, fetchFile, policy)).text()).toBe('')
    expect((await packagedRendererResponse(new Request(PACKAGED_RENDERER_URL), root, async () => { throw new Error() }, policy)).status).toBe(404)
  })
})

it('blocks redirects and frame navigation alongside main navigation, webviews and popups', () => {
  const handlers = new Map<string, (event: { preventDefault: () => void }) => void>()
  const popup = vi.fn()
  guardRendererNavigation({ on: (name: string, handler: (event: { preventDefault: () => void }) => void) => handlers.set(name, handler), setWindowOpenHandler: popup } as unknown as WebContents)
  for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate', 'will-attach-webview']) {
    const preventDefault = vi.fn()
    handlers.get(name)!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
  }
  expect(popup.mock.calls[0][0]()).toEqual({ action: 'deny' })
})

it('uses fuses accepted by the installed electron-builder schema', () => {
  const config = load(readFileSync('electron-builder.yml', 'utf8')) as { electronFuses: Record<string, boolean> }
  const schema = JSON.parse(readFileSync('node_modules/app-builder-lib/scheme.json', 'utf8'))
  expect(schema.properties.electronFuses).toBeDefined()
  expect(config.electronFuses).toEqual({
    runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true,
  })
  for (const key of Object.keys(config.electronFuses)) expect(schema.definitions.FuseOptionsV1.properties[key]?.type).toBe('boolean')
})
