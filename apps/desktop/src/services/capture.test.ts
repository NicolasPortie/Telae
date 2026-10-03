import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureDesktopSource } from './capture'
import { createProcessAudioCapture } from './process-audio'

vi.mock('./process-audio', () => ({ createProcessAudioCapture: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

describe('captureDesktopSource', () => {
  it.each(['1440p30', '1440p60'] as const)('captures %s with QHD bounds and its requested framerate', async (profile) => {
    const track = { contentHint: '' }
    const stream = { getVideoTracks: () => [track], getAudioTracks: () => [] }
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal('window', { telae: { selectCaptureSource: vi.fn() } })
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    await captureDesktopSource('screen:1', profile)
    const fps = profile === '1440p30' ? 30 : 60
    expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: {
      width: { ideal: 2560, max: 2560 }, height: { ideal: 1440, max: 1440 }, frameRate: { ideal: fps, max: fps },
    } })
    expect(track.contentHint).toBe(fps === 30 ? 'detail' : 'motion')
  })
  it('captures a window without system loopback and adds only its process audio', async () => {
    const audioTrack = { contentHint: '' } as MediaStreamTrack
    const audioTracks: MediaStreamTrack[] = []
    const stream = {
      getVideoTracks: () => [{ contentHint: '' }],
      getAudioTracks: () => audioTracks,
      addTrack: (track: MediaStreamTrack) => audioTracks.push(track),
    } as unknown as MediaStream
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    const resolveWindowAudioProcess = vi.fn().mockResolvedValue(1234)
    vi.mocked(createProcessAudioCapture).mockResolvedValue({ track: audioTrack, stop: vi.fn() })
    vi.stubGlobal('window', { telae: { selectCaptureSource: vi.fn(), resolveWindowAudioProcess } })
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })

    await expect(captureDesktopSource('window:100:0', 'auto')).resolves.toBe(stream)
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }))
    expect(resolveWindowAudioProcess).toHaveBeenCalledWith('window:100:0')
    expect(createProcessAudioCapture).toHaveBeenCalledWith(1234, undefined)
    expect(stream.getAudioTracks()).toEqual([audioTrack])
  })

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
    expect(videoTrack.contentHint).toBe('detail')
    expect(getDisplayMedia).toHaveBeenLastCalledWith(expect.objectContaining({
      video: expect.objectContaining({ width: { ideal: 2560, max: 2560 }, frameRate: { ideal: 30, max: 30 } }),
    }))
  })
})
