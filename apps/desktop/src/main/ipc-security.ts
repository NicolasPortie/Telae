import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'
import { t } from '../i18n/index.ts'

type Check = (value: unknown) => boolean
const text = (max: number): Check => value => typeof value === 'string' && value.length <= max
const captureId: Check = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const schemas: Record<string, Check[]> = {
  'profile:get': [], 'profile:set-name': [text(128)],
  'capture:list-sources': [], 'capture:select-source': [text(256)], 'capture:resolve-window-audio': [text(256)],
  'audio:list-processes': [],
  'audio:start': [value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff, captureId],
  'audio:start-screen': [captureId], 'audio:stop': [captureId],
  'environment:get': [], 'environment:set-signaling-url': [text(2048)],
  'auth:session': [], 'auth:register': [value => object(value) && text(254)(value.email) && text(32)(value.username) && text(1024)(value.password) && ['pt-BR', 'en'].includes(value.language as string)],
  'auth:verify-email': [text(320), text(32), text(1024)], 'auth:resend-verification': [text(320)],
  'auth:login': [text(320), text(1024)], 'auth:logout': [], 'auth:forgot-password': [text(320)],
  'auth:reset-password': [text(320), text(32), text(1024)], 'auth:update-display-name': [text(128)],
  'auth:change-password': [text(1024), text(1024)], 'auth:delete-account': [text(1024)], 'auth:access-token': [],
  'settings:get': [], 'settings:update': [value => object(value) && Object.keys(value).every(key =>
    key === 'language' ? ['auto', 'pt-BR', 'en'].includes(value[key] as string)
      : ['notifyFriendLive', 'launchAtLogin'].includes(key) && typeof value[key] === 'boolean')],
  'update:status': [], 'update:check': [], 'update:session-active': [value => typeof value === 'boolean'],
}

/** Mesma origem do renderer do app. Permissões e pedidos de captura podem informar só a origem, sem o caminho. */
export function isRendererOrigin(url: string | undefined, rendererUrl: string): boolean {
  if (!url) return false
  try {
    const actual = new URL(url)
    const expected = new URL(rendererUrl)
    if (actual.protocol !== expected.protocol) return false
    // file:// não tem host: aí só vale o mesmo documento. Esquemas próprios (telae://) têm origem "null"
    // no Node, então a comparação é por esquema e host.
    if (expected.protocol === 'file:') return actual.pathname === expected.pathname
    return actual.host === expected.host
  } catch { return false }
}

export function isTrustedFrame(frame: WebFrameMain | null, contents: WebContents | null, rendererUrl: string): boolean {
  return !!contents && !contents.isDestroyed() && frame === contents.mainFrame && isRendererOrigin(frame?.url, rendererUrl)
}

export function secureIpcHandler(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
  trusted: () => { contents: WebContents | null; rendererUrl: string },
): (event: IpcMainInvokeEvent, ...args: any[]) => unknown {
  return (event, ...args) => {
    const { contents, rendererUrl } = trusted()
    const schema = schemas[channel]
    if (event.sender !== contents || !isTrustedFrame(event.senderFrame, contents, rendererUrl)
      || !schema || args.length !== schema.length || !schema.every((check, index) => check(args[index]))) {
      throw new Error(t('Essa ação não está disponível.'))
    }
    return listener(event, ...args)
  }
}

/**
 * `mediaTypes` vem do pedido de permissão `media`. A captura de tela chega como `media` sem tipos
 * (câmera e microfone trazem 'video' ou 'audio'), então só esse caso é aceito, e só com uma fonte já escolhida.
 */
export function allowsPermission(permission: string, trusted: boolean, captureSelected: boolean, mediaTypes: readonly string[] = ['video']): boolean {
  if (!trusted) return false
  return ['notifications', 'clipboard-sanitized-write', 'fullscreen', 'local-network', 'local-network-access', 'loopback-network'].includes(permission)
    || (permission === 'display-capture' && captureSelected)
    || (permission === 'media' && captureSelected && mediaTypes.length === 0)
}
