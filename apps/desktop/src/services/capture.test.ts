import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureDesktopSource } from './capture'
import { createProcessAudioCapture, createScreenAudioCapture } from './process-audio'
import { scaleDesktopVideo } from './video-scaler'

vi.mock('./process-audio', () => ({ createProcessAudioCapture: vi.fn(), createScreenAudioCapture: vi.fn() }))
vi.mock('./video-scaler', () => ({ scaleDesktopVideo: vi.fn(async stream => stream), stopScaledCapture: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

describe('captureDesktopSource', () => {
  it.each(['1440p30', '1440p60'] as const)('captures %s with QHD bounds and its requested framerate', async (profile) => {
    const track = { contentHint: '' }
    const stream = { getVideoTracks: () => [track], getAudioTracks: () => [], addTrack: vi.fn() }
    vi.mocked(createScreenAudioCapture).mockResolvedValue({ track: {} as MediaStreamTrack, stop: vi.fn() })
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal('window', { telae: { selectCaptureSource: vi.fn() } })
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    await captureDesktopSource('screen:1', profile)
    const fps = profile === '1440p30' ? 30 : 60
    expect(getDisplayMedia).toHaveBeenCalledWith({ audio: false, video: {
      frameRate: { ideal: fps, max: fps },
    } })
    expect(scaleDesktopVideo).toHaveBeenCalledWith(stream, {
      width: { ideal: 2560, max: 2560 }, height: { ideal: 1440, max: 1440 },
      frameRate: { ideal: fps, max: fps },
    }, undefined)
    expect(track.contentHint).toBe(fps === 30 ? 'detail' : 'motion')
    expect(createScreenAudioCapture).toHaveBeenCalledWith(undefined)
    expect(stream.addTrack).toHaveBeenCalledOnce()
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

  it('keeps video without unfiltered loopback when Discord filtering fails', async () => {
    const videoTrack = { contentHint: '' }
    const videoOnly = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [],
    } as unknown as MediaStream
    const selectCaptureSource = vi.fn(async () => undefined)
    const getDisplayMedia = vi.fn().mockResolvedValue(videoOnly)
    vi.mocked(createScreenAudioCapture).mockRejectedValueOnce(new Error('Discord filter unavailable'))
    vi.stubGlobal('window', { telae: { selectCaptureSource } })
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })

    await expect(captureDesktopSource('screen:1', 'auto')).resolves.toBe(videoOnly)
    expect(selectCaptureSource).toHaveBeenCalledOnce()
    expect(getDisplayMedia).toHaveBeenCalledOnce()
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }))
    expect(videoTrack.contentHint).toBe('detail')
    expect(getDisplayMedia).toHaveBeenLastCalledWith(expect.objectContaining({
      video: expect.objectContaining({ frameRate: { ideal: 30, max: 30 } }),
    }))
  })
})
