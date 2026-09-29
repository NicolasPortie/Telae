import type { TelaeDesktopApi } from './contracts'

declare global {
  interface Window {
    telae: TelaeDesktopApi
  }
}

export {}
