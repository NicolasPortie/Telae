import { numberLocale, t } from '../i18n'
import type { DiagnosticsSnapshot, QualityProfile, TransportPath } from '../services/types'

export type QualityOption = {
  value: QualityProfile
  /** Nome acessível e curto; também usado nos seletores compactos. */
  label: string
  resolution: string
  fps: string
  hint: string
  /** Quando usar e o que o perfil exige da máquina e da rede. */
  detail: string
}

/** Perfis de qualidade com textos no idioma atual. */
export function qualityOptions(): QualityOption[] {
  return [
    { value: '720p60', label: '720p', resolution: '720p', fps: t('60 FPS'), hint: t('720p60 leve'),
      detail: t('Leve. Roda em PC simples e em internet fraca.') },
    { value: '1080p30', label: '1080p', resolution: '1080p', fps: t('30 FPS'), hint: t('1080p30 filmes'),
      detail: t('Bom pra filme e pra aula. É o padrão.') },
    { value: '1080p60', label: '1080p60', resolution: '1080p', fps: t('60 FPS'), hint: t('Mais fluidez'),
      detail: t('Pra jogo e vídeo rápido. Pede mais do PC e do upload.') },
    { value: '1440p30', label: '2K · 1440p', resolution: '2K · 1440p', fps: t('30 FPS'), hint: t('Maior nitidez'),
      detail: t('O mais nítido pra texto em tela grande. Exige PC e rede fortes.') },
    { value: '1440p60', label: '2K · 1440p60', resolution: '2K · 1440p', fps: t('60 FPS'), hint: t('Maior nitidez e fluidez'),
      detail: t('Nitidez e fluidez no máximo. Só com placa de vídeo boa e bom upload.') },
  ]
}

/**
 * Atraso aproximado entre o emissor e a tela do espectador: metade do RTT, o buffer de
 * jitter e o decode. Não inclui captura e encode do emissor, então é um piso, não um valor exato.
 */
export function estimateLatencyMs(d: Pick<DiagnosticsSnapshot, 'roundTripMs' | 'jitterBufferDelayMs' | 'decodeMs'>): number | null {
  if (d.roundTripMs == null || d.jitterBufferDelayMs == null) return null
  return Math.round(d.roundTripMs / 2 + d.jitterBufferDelayMs + (d.decodeMs ?? 0))
}

export function formatBitrate(kbps: number | null | undefined): string {
  if (kbps == null) return '—'
  return kbps >= 1000 ? `${(kbps / 1000).toLocaleString(numberLocale(), { maximumFractionDigits: 1 })} Mbps` : `${Math.round(kbps)} kbps`
}

export function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

export function qualityLabel(value: QualityProfile) {
  if (value === 'auto') return t('Adaptativo (versão anterior)')
  return qualityOptions().find(option => option.value === value)?.label ?? value
}

export function transportLabel(path: TransportPath) {
  return path === 'direct' ? t('Direta') : path === 'relay' ? t('Via servidor') : null
}
