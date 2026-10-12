import { describe, expect, it } from 'vitest'
import { JitterTargetController, jitterTargetFor } from './jitter-target'

const lan = { transportPath: 'direct' as const, roundTripMs: 3, jitterMs: 1, packetLossPercent: 0 }

describe('jitter buffer target', () => {
  it('uses no extra buffering on a clean direct path and more on relay or unstable paths', () => {
    expect(jitterTargetFor(lan)).toBe(0)
    expect(jitterTargetFor({ ...lan, transportPath: 'relay' })).toBe(80)
    expect(jitterTargetFor({ ...lan, jitterMs: 45 })).toBe(80)
    expect(jitterTargetFor({ ...lan, roundTripMs: 90 })).toBe(30)
    expect(jitterTargetFor({ ...lan, roundTripMs: null })).toBe(30)
  })

  it('raises immediately and lowers only after sustained stability', () => {
    const controller = new JitterTargetController(3)
    expect(controller.next(lan)).toBe(0)
    expect(controller.next({ ...lan, transportPath: 'relay' })).toBe(80)
    expect(controller.next(lan)).toBe(80)
    expect(controller.next(lan)).toBe(80)
    expect(controller.next(lan)).toBe(0)
    controller.next({ ...lan, jitterMs: 50 })
    controller.next(lan)
    controller.next({ ...lan, jitterMs: 50 })
    expect(controller.current).toBe(80)
  })
})
