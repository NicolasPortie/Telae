import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WebContents } from 'electron'
import { normalizeSignalingUrl } from './signaling-url.ts'

export const PACKAGED_RENDERER_URL = 'telae://app/index.html'

export function rendererContentSecurityPolicy(signalingUrl: string, developmentUrl?: string): string {
  const server = new URL(normalizeSignalingUrl(signalingUrl))
  const connections = new Set(["'self'", server.origin, websocketOrigin(server), 'stun:', 'stuns:', 'turn:', 'turns:'])
  if (developmentUrl) {
    const development = new URL(developmentUrl)
    if (development.protocol !== 'http:' && development.protocol !== 'https:') throw new Error('Origem de desenvolvimento inválida.')
    connections.add(development.origin)
    connections.add(websocketOrigin(development))
  }
  return [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "media-src 'self' blob:", `connect-src ${[...connections].join(' ')}`, "worker-src 'self' blob:",
    "frame-src 'none'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join('; ')
}

function websocketOrigin(url: URL): string {
  const websocket = new URL(url.origin)
  websocket.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return websocket.origin
}

export function withRendererCsp(headers: Record<string, string[]> = {}, policy: string): Record<string, string[]> {
  const preserved = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'content-security-policy'))
  return { ...preserved, 'Content-Security-Policy': [policy] }
}

export async function packagedRendererResponse(
  request: Request,
  root: string,
  fetchFile: (url: string) => Promise<Response>,
  policy: string,
): Promise<Response> {
  const url = new URL(request.url)
  if (url.protocol !== 'telae:' || url.host !== 'app' || url.username || url.password || !['GET', 'HEAD'].includes(request.method))
    return new Response(null, { status: 403 })
  let file: string
  try {
    const pathname = decodeURIComponent(url.pathname)
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':')) throw new Error()
    file = path.resolve(root, '.' + pathname)
    const relative = path.relative(root, file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error()
  } catch {
    return new Response(null, { status: 403 })
  }
  try {
    const response = await fetchFile(pathToFileURL(file).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', policy)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers })
  } catch {
    return new Response(null, { status: 404 })
  }
}

export function guardRendererNavigation(contents: WebContents): void {
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('will-redirect', event => event.preventDefault())
  contents.on('will-frame-navigate', event => event.preventDefault())
  contents.on('will-attach-webview', event => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
