import type { DiagnosticsSnapshot, QualityProfile } from './types'

/**
 * QualityController — deep module do Ticket 05.
 *
 * Traduz Quality Profile + estatísticas ao vivo em parâmetros do
 * RTCRtpSender. A UI nunca entende WebRTC; ela só escolhe o perfil.
 *
 * Tetos iniciais para ajuste em laboratório (ARCHITECTURE.md) —
 * o benchmark (Ticket 10) substitui por evidência medida.
 */
export type QualityDecision = {
  maxBitrateBps: number
  degradationPreference: RTCDegradationPreference
  effectiveCeilingKbps: number
}

export const PROFILE_CEILINGS: Record<QualityProfile, number> = {
  auto: 10_000_000,
  '720p60': 6_000_000,
  '1080p30': 8_000_000,
  '1080p60': 12_000_000,
}

/** Escada do modo Auto: reduz qualidade antes de introduzir buffer longo. */
const AUTO_LADDER_KBPS = [10_000, 8000, 6000, 4000, 2500, 1500]

export class QualityController {
  private autoStep = 0

  reset() {
    this.autoStep = 0
  }

  getAutoStep() {
    return this.autoStep
  }

  decide(profile: QualityProfile, stats: DiagnosticsSnapshot): QualityDecision {
    if (profile !== 'auto') {
      return {
        maxBitrateBps: PROFILE_CEILINGS[profile],
        degradationPreference: 'maintain-resolution',
        effectiveCeilingKbps: Math.round(PROFILE_CEILINGS[profile] / 1000),
      }
    }

    const congested =
      (stats.packetLossPercent ?? 0) > 5 ||
      (stats.roundTripMs ?? 0) > 300 ||
      (stats.availableOutgoingKbps !== null &&
        stats.availableOutgoingKbps < AUTO_LADDER_KBPS[this.autoStep] * 0.85)

    const relieved =
      (stats.packetLossPercent ?? 100) < 1 &&
      (stats.roundTripMs ?? 9999) < 120 &&
      stats.availableOutgoingKbps !== null &&
      stats.availableOutgoingKbps > AUTO_LADDER_KBPS[this.autoStep] * 1.5

    if (congested && this.autoStep < AUTO_LADDER_KBPS.length - 1) this.autoStep += 1
    else if (relieved && this.autoStep > 0) this.autoStep -= 1

    const ceilingKbps = AUTO_LADDER_KBPS[this.autoStep]
    return {
      maxBitrateBps: ceilingKbps * 1000,
      degradationPreference: 'maintain-resolution',
      effectiveCeilingKbps: ceilingKbps,
    }
  }
}
