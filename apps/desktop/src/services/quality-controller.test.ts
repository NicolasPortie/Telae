import { describe, expect, it } from 'vitest'
import { MOTION_SCALE_LADDER, PROFILE_CEILINGS, QualityController } from './quality-controller'
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
  it('preserves detail when a 60 fps profile receives only 24 captured frames per second', () => {
    const controller = new QualityController()
    for (let i = 0; i < 10; i++) {
      expect(controller.decide('1080p60', stats({
        captureFramesPerSecond: 24, framesPerSecond: 24, encodeMs: 22, qualityLimitationReason: 'none',
      }), 'motion')).toMatchObject({ maxFramerate: 60, scaleResolutionDownBy: 1 })
    }
    for (let i = 0; i < 3; i++) controller.decide('1080p60', stats({
      captureFramesPerSecond: 24, framesPerSecond: 12, encodeMs: 60,
    }), 'motion')
    expect(controller.decide('1080p60', stats(), 'motion').scaleResolutionDownBy).toBe(MOTION_SCALE_LADDER[1])
  })
  it.each(['1440p30', '1440p60'] as const)('adapts %s to CPU and network pressure and recovers', (profile) => {
    const controller = new QualityController()
    const fps = profile === '1440p30' ? 30 : 60
    expect(controller.decide(profile, stats(), 'motion').maxFramerate).toBe(fps)
    for (let i = 0; i < 3; i++) controller.decide(profile, stats({ qualityLimitationReason: 'cpu' }), 'motion')
    expect(controller.decide(profile, stats(), 'motion').scaleResolutionDownBy).toBe(MOTION_SCALE_LADDER[1])
    for (let i = 0; i < 5; i++) controller.decide(profile, stats({ encodeMs: 5, qualityLimitationReason: 'none' }), 'motion')
    expect(controller.decide(profile, stats(), 'motion').scaleResolutionDownBy).toBe(1)
    for (let i = 0; i < 2; i++) controller.decide(profile, stats({ packetLossPercent: 12 }), 'motion')
    expect(controller.decide(profile, stats(), 'motion').scaleResolutionDownBy).toBe(MOTION_SCALE_LADDER[1])
    controller.reset()
    for (let i = 0; i < 3; i++) controller.decide(profile, stats({ qualityLimitationReason: 'cpu' }), 'text')
    expect(controller.decide(profile, stats(), 'text').maxFramerate).toBe(fps / 2)
  })
  it('steps motion resolution through finer rungs and never skips one', () => {
    const controller = new QualityController()
    const seen: number[] = []
    for (let i = 0; i < 12; i++) seen.push(controller.decide('1440p60', stats({ packetLossPercent: 12 }), 'motion').scaleResolutionDownBy!)
    expect([...new Set(seen)]).toEqual([...MOTION_SCALE_LADDER])
    for (let i = 0; i < 20; i++) controller.decide('1440p60', stats(), 'motion')
    expect(controller.decide('1440p60', stats(), 'motion').scaleResolutionDownBy).toBe(1)
  })
  it('caps every profile by the viewer budget, including below the auto floor', () => {
    for (const profile of ['auto', '720p60', '1080p30', '1080p60', '1440p30', '1440p60'] as const) {
      const controller = new QualityController()
      const decision = controller.decide(profile, stats(), 'text', 500_000)
      expect(decision.maxBitrateBps).toBe(500_000)
      expect(decision.effectiveCeilingKbps).toBe(500)
      expect(controller.decide(profile, stats(), 'text', NaN).maxBitrateBps).toBe(PROFILE_CEILINGS[profile])
    }
  })

  it('halves motion resolution only after sustained congestion and restores it', () => {
    const controller = new QualityController()
    const bad = stats({ packetLossPercent: 12 })
    expect(controller.decide('1080p60', bad, 'motion').scaleResolutionDownBy).toBe(1)
    const decision = controller.decide('1080p60', bad, 'motion')
    expect(decision.scaleResolutionDownBy).toBe(MOTION_SCALE_LADDER[1])
    expect(decision.maxFramerate).toBe(60)
    expect(decision.degradationPreference).toBe('maintain-framerate')
    expect(decision.maxBitrateBps).toBe(PROFILE_CEILINGS['1080p60'])
    for (let i = 0; i < 4; i++) controller.decide('1080p60', stats(), 'motion')
    expect(controller.decide('1080p60', stats(), 'motion').scaleResolutionDownBy).toBe(1)
  })

  it('reduces text fps and motion resolution on sustained CPU pressure', () => {
    for (const mode of ['text', 'motion'] as const) {
      const controller = new QualityController()
      const bad = stats({ qualityLimitationReason: 'cpu' })
      controller.decide('1080p60', bad, mode)
      expect(controller.decide('1080p60', bad, mode).scaleResolutionDownBy).toBe(1)
      const decision = controller.decide('1080p60', bad, mode)
      expect(decision.maxFramerate).toBe(mode === 'text' ? 30 : 60)
      expect(decision.scaleResolutionDownBy).toBe(mode === 'text' ? 1 : MOTION_SCALE_LADDER[1])
      expect(controller.getAutoStep()).toBe(0)
      for (let i = 0; i < 4; i++) controller.decide('1080p60', stats({ qualityLimitationReason: 'none', encodeMs: 5 }), mode)
      expect(controller.decide('1080p60', stats({ qualityLimitationReason: 'none', encodeMs: 5 }), mode).scaleResolutionDownBy).toBe(1)
      controller.reset()
      expect(controller.decide('1080p60', stats(), mode).maxFramerate).toBe(60)
    }
  })

  it('uses encode duration together with low fps and never treats static low fps alone as CPU pressure', () => {
    const controller = new QualityController()
    for (let i = 0; i < 10; i++) controller.decide('1080p30', stats({ framesPerSecond: 5 }))
    expect(controller.decide('1080p30', stats()).maxFramerate).toBe(30)
    for (let i = 0; i < 3; i++) controller.decide('1080p30', stats({ framesPerSecond: 15, encodeMs: 45 }))
    expect(controller.decide('1080p30', stats()).maxFramerate).toBe(15)
    for (let i = 0; i < 10; i++) controller.decide('1080p30', stats())
    expect(controller.decide('1080p30', stats()).maxFramerate).toBe(15)
  })

  it('recovers text fps from healthy measurements at the reduced framerate', () => {
    const controller = new QualityController()
    for (let i = 0; i < 3; i++) controller.decide('1080p60', stats({ qualityLimitationReason: 'cpu' }))
    for (let i = 0; i < 4; i++) {
      expect(controller.decide('1080p60', stats({ framesPerSecond: 30, encodeMs: 20 })).maxFramerate).toBe(30)
    }
    expect(controller.decide('1080p60', stats({ framesPerSecond: 30, encodeMs: 20 })).maxFramerate).toBe(60)
  })

  it('matches Auto text capture at 30 fps without misclassifying normal encoding as CPU pressure', () => {
    const controller = new QualityController()
    for (let i = 0; i < 20; i++) {
      expect(controller.decide('auto', stats({ framesPerSecond: 30, encodeMs: 20 }))).toMatchObject({
        maxFramerate: 30, scaleResolutionDownBy: 1,
      })
    }
    expect(controller.decide('auto', stats(), 'motion').maxFramerate).toBe(60)
    for (let i = 0; i < 3; i++) controller.decide('auto', stats({ qualityLimitationReason: 'cpu', framesPerSecond: 20 }))
    expect(controller.decide('auto', stats()).maxFramerate).toBe(15)
  })

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
    controller.decide('auto', stats({ packetLossPercent: 12, roundTripMs: 450 }))
    const congested = controller.decide('auto', stats({ packetLossPercent: 12, roundTripMs: 450 }))
    expect(congested.effectiveCeilingKbps).toBeLessThan(first.effectiveCeilingKbps)
    expect(controller.getAutoStep()).toBeGreaterThan(0)
  })

  it('auto never drops below the floor nor above the ceiling', () => {
    const controller = new QualityController()
    for (let i = 0; i < 20; i++) controller.decide('auto', stats({ packetLossPercent: 30 }))
    const floor = controller.decide('auto', stats({ packetLossPercent: 30 }))
    expect(floor.effectiveCeilingKbps).toBe(1500)

    for (let i = 0; i < 40; i++) controller.decide('auto', stats())
    const ceiling = controller.decide('auto', stats())
    expect(ceiling.effectiveCeilingKbps).toBe(16000)
  })

  it('auto recovers one step when the path relieves', () => {
    const controller = new QualityController()
    controller.decide('auto', stats({ packetLossPercent: 12 }))
    controller.decide('auto', stats({ packetLossPercent: 12 }))
    const stepAfterCongestion = controller.getAutoStep()
    for (let i = 0; i < 5; i++) controller.decide('auto', stats())
    expect(controller.getAutoStep()).toBe(stepAfterCongestion - 1)
  })

  it('does not reduce a healthy distant route or a static desktop with a low bandwidth estimate', () => {
    const controller = new QualityController()
    for (let i = 0; i < 20; i++) {
      controller.decide('auto', stats({ roundTripMs: 350, bitrateKbps: 500, availableOutgoingKbps: 4000 }))
    }
    expect(controller.getAutoStep()).toBe(0)
  })

  it('ignores an isolated loss spike and recovers despite a cap-limited bandwidth estimate', () => {
    const controller = new QualityController()
    controller.decide('auto', stats({ packetLossPercent: 12 }))
    controller.decide('auto', stats())
    expect(controller.getAutoStep()).toBe(0)
    for (let i = 0; i < 4; i++) controller.decide('auto', stats({ packetLossPercent: 12 }))
    expect(controller.getAutoStep()).toBe(2)
    for (let i = 0; i < 5; i++) controller.decide('auto', stats({ availableOutgoingKbps: 10000 }))
    expect(controller.getAutoStep()).toBe(1)
  })

  it('reduces the ceiling when sustained traffic exceeds the estimated capacity', () => {
    const controller = new QualityController()
    for (let i = 0; i < 4; i++) controller.decide('auto', stats({ bitrateKbps: 10000, availableOutgoingKbps: 4000 }))
    expect(controller.getAutoStep()).toBe(2)
  })
})
