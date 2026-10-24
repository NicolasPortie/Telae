import type { TelaeDesktopApi } from './contracts'

declare global {
  interface Window {
    telae: TelaeDesktopApi
  }
  /** Servidor padrão embutido na compilação (string vazia no código aberto). */
  const __TELAE_DEFAULT_SERVER_URL__: string
  const __TELAE_PREVIOUS_SERVER_URL__: string
}

export {}
