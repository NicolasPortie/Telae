import { t } from '../i18n/index.ts'

export function normalizeSignalingUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(t('Escreve o endereço do servidor.'))
  let parsed: URL
  try {
    if (value.length > 2048) throw new Error()
    parsed = new URL(value.trim())
  } catch {
    throw new Error(t('Esse endereço não parece válido. Usa algo como https://telae.seudominio.com.'))
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(t('O endereço precisa começar com http:// ou https://.'))
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(t('Usa só o endereço do servidor, sem usuário nem senha.'))
  }
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error(t('Usa https:// pra proteger sua conta. O http:// só funciona neste PC.'))
  }
  return parsed.toString().replace(/\/+$/, '')
}

export class SignalingServerSettings {
  readonly activeUrl: string
  private readonly persist: (url: string) => void

  constructor(initialUrl: string, persist: (url: string) => void) {
    this.activeUrl = normalizeSignalingUrl(initialUrl)
    this.persist = persist
  }

  saveForRestart(value: unknown): string {
    const url = normalizeSignalingUrl(value)
    this.persist(url)
    return url
  }
}
