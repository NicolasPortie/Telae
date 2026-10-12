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

export const QUALITY_OPTIONS: QualityOption[] = [
  { value: '720p60', label: '720p', resolution: '720p', fps: '60 FPS', hint: '720p60 leve',
    detail: 'Leve e fluido. Bom para PCs modestos ou conexões de upload mais fracas.' },
  { value: '1080p30', label: '1080p', resolution: '1080p', fps: '30 FPS', hint: '1080p30 filmes',
    detail: 'Equilíbrio ideal para documentos, apresentações e filmes. É o padrão recomendado.' },
  { value: '1080p60', label: '1080p60', resolution: '1080p', fps: '60 FPS', hint: 'Alta taxa de quadros',
    detail: 'Movimento fluido para jogos e vídeos rápidos. Usa mais processador, placa de vídeo e upload.' },
  { value: '1440p30', label: '2K · 1440p', resolution: '2K · 1440p', fps: '30 FPS', hint: 'Maior nitidez',
    detail: 'Máxima nitidez para texto e detalhes em telas grandes. Exige um PC e uma rede mais fortes.' },
  { value: '1440p60', label: '2K · 1440p60', resolution: '2K · 1440p', fps: '60 FPS', hint: 'Maior nitidez e fluidez',
    detail: 'Nitidez e fluidez máximas. Recomendado apenas com placa de vídeo forte e bom upload.' },
]

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
  return kbps >= 1000 ? `${(kbps / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} Mbps` : `${Math.round(kbps)} kbps`
}

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
