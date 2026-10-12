import type { DiagnosticsSnapshot } from './types'

/** Alvo do jitter buffer (ms) para o estado de rede observado. */
export function jitterTargetFor(stats: Pick<DiagnosticsSnapshot, 'transportPath' | 'roundTripMs' | 'jitterMs' | 'packetLossPercent'>): number {
  const rtt = stats.roundTripMs
  const jitter = stats.jitterMs ?? 0
  const loss = stats.packetLossPercent ?? 0
  if (stats.transportPath === 'relay' || (rtt ?? 0) > 150 || jitter > 30 || loss > 2) return 80
  if (stats.transportPath === 'direct' && rtt !== null && rtt <= 50 && jitter <= 10 && loss < 0.5) return 0
  return 30
}

/**
 * Sobe o buffer imediatamente quando a rede piora e só o reduz depois de amostras estáveis,
 * evitando oscilações audíveis. Começa em 0 para manter a menor latência em LAN.
 */
export class JitterTargetController {
  private value = 0
  private lowerSamples = 0

  private readonly lowerAfter: number

  constructor(lowerAfter = 10) {
    this.lowerAfter = lowerAfter
  }

  get current(): number {
    return this.value
  }

  next(stats: Parameters<typeof jitterTargetFor>[0]): number {
    const wanted = jitterTargetFor(stats)
    if (wanted > this.value) {
      this.value = wanted
      this.lowerSamples = 0
    } else if (wanted < this.value) {
      if (++this.lowerSamples >= this.lowerAfter) {
        this.value = wanted
        this.lowerSamples = 0
      }
    } else this.lowerSamples = 0
    return this.value
  }
}
