import type { ContentMode, DiagnosticsSnapshot, QualityProfile } from './types'

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
  maxFramerate?: number
  scaleResolutionDownBy?: number
}

export const PROFILE_CEILINGS: Record<QualityProfile, number> = {
  auto: 16_000_000,
  '720p60': 6_000_000,
  '1080p30': 12_000_000,
  '1080p60': 20_000_000,
}

/** Escada do modo Auto: reduz qualidade antes de introduzir buffer longo. */
const AUTO_LADDER_KBPS = [16_000, 12_000, 10_000, 8000, 6000, 4000, 2500, 1500]

export class QualityController {
  private autoStep = 0
  private congestedSamples = 0
  private healthySamples = 0
  private cpuSamples = 0
  private cpuHealthySamples = 0
  private cpuStep = 0
  private motionStep = 0

  reset() {
    this.autoStep = 0
    this.congestedSamples = 0
    this.healthySamples = 0
    this.cpuSamples = 0
    this.cpuHealthySamples = 0
    this.cpuStep = 0
    this.motionStep = 0
  }

  getAutoStep() {
    return this.autoStep
  }

  decide(profile: QualityProfile, stats: DiagnosticsSnapshot, mode: ContentMode = 'text', uploadBudgetBps?: number): QualityDecision {
    const targetFps = profile === '1080p30' || (profile === 'auto' && mode === 'text') ? 30 : 60
    const currentFps = mode === 'text' ? Math.max(10, targetFps / 2 ** this.cpuStep) : targetFps
    const cpuLimited = stats.qualityLimitationReason === 'cpu' ||
      ((stats.encodeMs ?? 0) > 1000 / currentFps &&
        stats.framesPerSecond !== null && stats.framesPerSecond < currentFps * 0.8)
    this.cpuSamples = cpuLimited ? this.cpuSamples + 1 : 0
    // Unknown telemetry must not undo a measured CPU limitation.
    const cpuHealthy = !cpuLimited && (stats.encodeMs != null || stats.qualityLimitationReason != null) &&
      stats.framesPerSecond !== null &&
      stats.framesPerSecond >= currentFps * 0.8 && (stats.encodeMs ?? 0) <= 1000 / currentFps
    this.cpuHealthySamples = cpuHealthy ? this.cpuHealthySamples + 1 : 0
    if (this.cpuSamples >= 3) {
      this.cpuStep = Math.min(2, this.cpuStep + 1)
      this.cpuSamples = 0
    } else if (this.cpuHealthySamples >= 5) {
      this.cpuStep = Math.max(0, this.cpuStep - 1)
      this.cpuHealthySamples = 0
    }
    const budget = uploadBudgetBps !== undefined && Number.isFinite(uploadBudgetBps) && uploadBudgetBps > 0
      ? uploadBudgetBps : Infinity
    const currentCeilingKbps = Math.min(profile === 'auto' ? AUTO_LADDER_KBPS[this.autoStep] : PROFILE_CEILINGS[profile] / 1000, budget / 1000)
    const congested =
      stats.qualityLimitationReason === 'bandwidth' ||
      (stats.packetLossPercent ?? 0) > 5 ||
      ((stats.roundTripMs ?? 0) > 300 && (stats.jitterMs ?? 0) > 50) ||
      (stats.availableOutgoingKbps !== null &&
        stats.availableOutgoingKbps < currentCeilingKbps * 0.75 &&
        stats.bitrateKbps > stats.availableOutgoingKbps * 0.9)

    const relieved =
      !congested &&
      stats.packetLossPercent !== null && stats.packetLossPercent < 2 &&
      stats.roundTripMs !== null &&
      (stats.jitterMs ?? 0) < 30

    this.congestedSamples = congested ? this.congestedSamples + 1 : 0
    this.healthySamples = relieved ? this.healthySamples + 1 : 0
    // Two bad samples filter transient spikes. Five healthy samples probe one higher
    // ceiling even when the bandwidth estimate is limited by our own current cap.
    if (this.congestedSamples >= 2) {
      if (profile === 'auto') this.autoStep = Math.min(AUTO_LADDER_KBPS.length - 1, this.autoStep + 1)
      this.motionStep = Math.min(2, this.motionStep + 1)
      this.congestedSamples = 0
      this.healthySamples = 0
    } else if (this.healthySamples >= 5) {
      if (profile === 'auto') this.autoStep = Math.max(0, this.autoStep - 1)
      this.motionStep = Math.max(0, this.motionStep - 1)
      this.healthySamples = 0
    }

    const maxBitrateBps = Math.min(profile === 'auto' ? AUTO_LADDER_KBPS[this.autoStep] * 1000 : PROFILE_CEILINGS[profile], budget)
    return {
      maxBitrateBps,
      degradationPreference: mode === 'motion' ? 'maintain-framerate' : 'maintain-resolution',
      effectiveCeilingKbps: Math.round(maxBitrateBps / 1000),
      maxFramerate: mode === 'text' ? Math.max(10, targetFps / 2 ** this.cpuStep) : targetFps,
      scaleResolutionDownBy: mode === 'motion' ? 2 ** Math.max(this.cpuStep, this.motionStep) : 1,
    }
  }
}
