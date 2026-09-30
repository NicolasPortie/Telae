import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureDesktopSource } from './capture'

afterEach(() => vi.unstubAllGlobals())

describe('captureDesktopSource', () => {
  it('requests system audio automatically and keeps video when the source has no audio', async () => {
    const videoTrack = { contentHint: '' }
    const videoOnly = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [],
    } as unknown as MediaStream
    const selectCaptureSource = vi.fn(async () => undefined)
    const getDisplayMedia = vi.fn()
      .mockRejectedValueOnce(new Error('Audio source unavailable'))
      .mockResolvedValueOnce(videoOnly)
    vi.stubGlobal('window', { telae: { selectCaptureSource } })
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })

    await expect(captureDesktopSource('screen:1', 'auto')).resolves.toBe(videoOnly)
    expect(selectCaptureSource).toHaveBeenCalledOnce()
    expect(getDisplayMedia).toHaveBeenNthCalledWith(1, expect.objectContaining({ audio: true }))
    expect(getDisplayMedia).toHaveBeenNthCalledWith(2, expect.objectContaining({ audio: false }))
    expect(videoTrack.contentHint).toBe('motion')
  })
})
