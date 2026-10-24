import { expect, test, _electron as electron } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Servidor de teste indisponível.')
  return `http://127.0.0.1:${address.port}`
}

test('a CSP do renderer empacotado limita fetch, redirects e WebSocket à origem ativa', async () => {
  const requests: string[] = []
  const origins: string[] = []
  const denied = createServer((_request, response) => {
    requests.push('denied-http')
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.end('denied')
  })
  denied.on('upgrade', (_request, socket) => { requests.push('denied-ws'); socket.destroy() })
  const deniedOrigin = await listen(denied)
  const allowed = createServer((request, response) => {
    origins.push(request.headers.origin ?? '')
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: deniedOrigin, 'Access-Control-Allow-Origin': '*' })
      response.end()
      return
    }
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.end('allowed')
  })
  allowed.on('upgrade', (request, socket) => {
    requests.push('allowed-ws')
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.on('data', () => socket.destroy())
  })
  const allowedOrigin = await listen(allowed)
  const userData = await mkdtemp(path.join(os.tmpdir(), 'telae-csp-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) as Record<string, string>
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    args: [path.resolve(import.meta.dirname, '..'), '--hidden', `--user-data-dir=${userData}`],
    env: { ...env, TELAE_SIGNALING_URL: allowedOrigin },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('#root')).not.toBeEmpty()
    expect(page.url()).toBe('telae://app/index.html')
    const environment = await page.evaluate(() => window.telae.getEnvironment())
    expect(environment.signalingUrl).toBe(allowedOrigin)
    const results = await page.evaluate(async ({ allowedOrigin, deniedOrigin }) => {
      const fetches: Record<string, string> = {}
      for (const [label, url] of Object.entries({ allowed: allowedOrigin, denied: deniedOrigin, redirect: allowedOrigin + '/redirect' })) {
        try { fetches[label] = await (await fetch(url)).text() } catch { fetches[label] = 'blocked' }
      }
      const websocket = (origin: string) => new Promise<string>(resolve => {
        const socket = new WebSocket(origin.replace('http:', 'ws:'))
        socket.onopen = () => { socket.close(); resolve('allowed') }
        socket.onerror = () => resolve('blocked')
      })
      return { fetches, allowedSocket: await websocket(allowedOrigin), deniedSocket: await websocket(deniedOrigin) }
    }, { allowedOrigin, deniedOrigin })
    expect(results).toEqual({ fetches: { allowed: 'allowed', denied: 'blocked', redirect: 'blocked' }, allowedSocket: 'allowed', deniedSocket: 'blocked' })
    expect(requests).toEqual(['allowed-ws'])
    expect(origins).toContain('telae://app')
  } finally {
    await app.close()
    allowed.closeAllConnections()
    denied.closeAllConnections()
    await Promise.all([new Promise<void>(resolve => allowed.close(() => resolve())), new Promise<void>(resolve => denied.close(() => resolve()))])
    if (path.dirname(userData) === path.resolve(os.tmpdir()) && path.basename(userData).startsWith('telae-csp-'))
      await rm(userData, { recursive: true, force: true })
  }
})
