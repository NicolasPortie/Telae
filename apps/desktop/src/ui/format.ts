import type { QualityProfile, TransportPath } from '../services/types'

export const QUALITY_OPTIONS: { value: QualityProfile; label: string; hint: string }[] = [
  { value: '720p60', label: '720p', hint: '720p60 leve' },
  { value: '1080p30', label: '1080p', hint: '1080p30 filmes' },
  { value: '1080p60', label: '1080p60', hint: 'Alta taxa de quadros' },
  { value: '1440p30', label: '2K · 1440p', hint: '2560 × 1440 a 30 fps · até 20 Mbps por espectador' },
  { value: '1440p60', label: '2K · 1440p60', hint: '2560 × 1440 a 60 fps · até 32 Mbps por espectador' },
]

export function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

export function qualityLabel(value: QualityProfile) {
  if (value === 'auto') return 'Adaptativo (versão anterior)'
  return QUALITY_OPTIONS.find(option => option.value === value)?.label ?? value
}

export function transportLabel(path: TransportPath) {
  return path === 'direct' ? 'Direta' : path === 'relay' ? 'Via servidor' : null
}

export const SESSION_STATE_LABELS: Record<string, string> = {
  idle: 'Pronto', preparing: 'Preparando captura…', 'waiting-for-peer': 'Aguardando espectadores…',
  joining: 'Localizando transmissão…', negotiating: 'Conectando vídeo…',
  live: 'Ao vivo', reconnecting: 'Reconectando…', ended: 'Transmissão terminada',
}
