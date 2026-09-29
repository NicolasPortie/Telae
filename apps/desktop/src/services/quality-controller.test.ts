import { describe, expect, it } from 'vitest'
import { PROFILE_CEILINGS, QualityController } from './quality-controller'
import type { DiagnosticsSnapshot } from './types'

function stats(overrides: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot {
  return {
    bitrateKbps: 8000,
    roundTripMs: 60,
    packetLossPercent: 0,
    framesPerSecond: 60,
    codec: 'H264',
    jitterMs: 8,
    width: 1920,
    height: 1080,
    availableOutgoingKbps: 20000,
    transportPath: 'direct',
    candidateType: 'srflx',
    ...overrides,
  }
}

describe('QualityController', () => {
  it('fixed profiles use their ceiling and keep resolution', () => {
    const controller = new QualityController()
    for (const profile of ['720p60', '1080p30', '1080p60'] as const) {
      const decision = controller.decide(profile, stats())
      expect(decision.maxBitrateBps).toBe(PROFILE_CEILINGS[profile])
      expect(decision.degradationPreference).toBe('maintain-resolution')
    }
  })

  it('auto steps down on congestion before any buffering', () => {
    const controller = new QualityController()
    const first = controller.decide('auto', stats())
    const congested = controller.decide('auto', stats({ packetLossPercent: 12, roundTripMs: 450 }))
    expect(congested.effectiveCeilingKbps).toBeLessThan(first.effectiveCeilingKbps)
    expect(controller.getAutoStep()).toBeGreaterThan(0)
  })

  it('auto never drops below the floor nor above the ceiling', () => {
    const controller = new QualityController()
    for (let i = 0; i < 10; i++) controller.decide('auto', stats({ packetLossPercent: 30 }))
    const floor = controller.decide('auto', stats({ packetLossPercent: 30 }))
    expect(floor.effectiveCeilingKbps).toBe(1500)

    for (let i = 0; i < 10; i++) controller.decide('auto', stats())
    const ceiling = controller.decide('auto', stats())
    expect(ceiling.effectiveCeilingKbps).toBe(10000)
  })

  it('auto recovers one step when the path relieves', () => {
    const controller = new QualityController()
    controller.decide('auto', stats({ packetLossPercent: 12 }))
    const stepAfterCongestion = controller.getAutoStep()
    controller.decide('auto', stats())
    expect(controller.getAutoStep()).toBe(stepAfterCongestion - 1)
  })
})
