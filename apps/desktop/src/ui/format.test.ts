import { describe, expect, it } from 'vitest'
import { estimateLatencyMs, formatBitrate, qualityOptions, qualityLabel } from './format'

describe('format helpers', () => {
  it('estimates latency as half the RTT plus jitter buffer and decode, only when measured', () => {
    expect(estimateLatencyMs({ roundTripMs: 40, jitterBufferDelayMs: 30, decodeMs: 5 })).toBe(55)
    expect(estimateLatencyMs({ roundTripMs: 40, jitterBufferDelayMs: 30 })).toBe(50)
    expect(estimateLatencyMs({ roundTripMs: null, jitterBufferDelayMs: 30 })).toBeNull()
    expect(estimateLatencyMs({ roundTripMs: 40, jitterBufferDelayMs: null })).toBeNull()
  })

  it('formats bitrate in kbps below 1 Mbps and Mbps above', () => {
    expect(formatBitrate(null)).toBe('—')
    expect(formatBitrate(850)).toBe('850 kbps')
    expect(formatBitrate(12_340)).toBe('12,3 Mbps')
  })

  it('describes every quality option with resolution, fps and guidance', () => {
    expect(qualityOptions().map(option => option.value)).toEqual(['720p60', '1080p30', '1080p60', '1440p30', '1440p60'])
    for (const option of qualityOptions()) {
      expect(option.fps).toMatch(/^(30|60) FPS$/)
      expect(option.detail.length).toBeGreaterThan(20)
    }
    expect(qualityLabel('1080p60')).toBe('1080p60')
  })
})
