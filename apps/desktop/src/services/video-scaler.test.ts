import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyVideoConstraints, getVideoConstraints, scaleDesktopVideo, stopScaledCapture } from './video-scaler'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function fixture(width = 2560, height = 1440) {
  const raw = Object.assign(new EventTarget(), {
    readyState: 'live', contentHint: 'motion', getSettings: () => ({ width, height }),
    applyConstraints: vi.fn(async (_constraints: MediaTrackConstraints) => undefined), stop: vi.fn(),
  })
  const output = Object.assign(new EventTarget(), { readyState: 'live', contentHint: '', stop: vi.fn(), requestFrame: vi.fn() })
  const source = { getVideoTracks: () => [raw], getTracks: () => [raw] } as unknown as MediaStream
  const stream = { getVideoTracks: () => [output] } as unknown as MediaStream
  const callbacks = new Map<number, (now: number) => void>()
  let id = 0
  const video = {
    style: {}, setAttribute: vi.fn(), videoWidth: width, videoHeight: height, srcObject: null,
    play: vi.fn(async () => undefined), pause: vi.fn(), remove: vi.fn(),
    requestVideoFrameCallback: (callback: (now: number) => void) => { callbacks.set(++id, callback); return id },
    cancelVideoFrameCallback: vi.fn((key: number) => callbacks.delete(key)),
  }
  const context = { drawImage: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: '' }
  const canvas = { width: 0, height: 0, getContext: () => context, captureStream: vi.fn(() => stream) }
  vi.stubGlobal('document', { body: { append: vi.fn() }, createElement: (tag: string) => tag === 'video' ? video : canvas })
  let time = 0
  function frame(now = time + 1000 / 60) {
    time = now
    const [key, callback] = [...callbacks][0]; callbacks.delete(key); callback(now)
  }
  return { raw, output, source, stream, video, canvas, context, frame, callbacks }
}
const hd = { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 } }

describe('native desktop video scaler', () => {
  it('scales native frames once, preserves aspect and applies live FPS at the source', async () => {
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame()
    const stream = await pending
    expect(f.canvas.width).toBe(1920)
    expect(f.canvas.height).toBe(1080)
    expect(f.output.requestFrame).toHaveBeenCalledTimes(1)
    expect(f.raw.applyConstraints).not.toHaveBeenCalled()
    f.frame()
    expect(f.output.requestFrame).toHaveBeenCalledTimes(2)
    const qhd = { width: { max: 2560 }, height: { max: 1440 }, frameRate: { max: 30 } }
    await applyVideoConstraints(stream, qhd)
    expect(f.raw.applyConstraints).toHaveBeenCalledWith({ frameRate: { max: 30 } })
    expect(f.canvas.width).toBe(2560)
    expect(getVideoConstraints(stream)).toEqual(qhd)
    stopScaledCapture(stream)
    stopScaledCapture(stream)
    expect(f.raw.stop).toHaveBeenCalledTimes(1)
    expect(f.output.stop).toHaveBeenCalledTimes(1)
    expect(f.video.srcObject).toBeNull()
    expect(f.callbacks.size).toBe(0)
  })

  it('keeps smaller sources at native size and forwards source ending', async () => {
    const f = fixture(1280, 720)
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame()
    const stream = await pending
    expect(f.canvas.width).toBe(1280)
    expect(f.canvas.height).toBe(720)
    const ended = vi.fn()
    stream.getVideoTracks()[0].addEventListener('ended', ended)
    f.raw.dispatchEvent(new Event('ended'))
    expect(ended).toHaveBeenCalledTimes(1)
    expect(f.video.remove).toHaveBeenCalledTimes(1)
    expect(f.callbacks.size).toBe(0)
  })

  it('keeps dimensions and constraints when a live FPS change fails', async () => {
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame()
    const stream = await pending
    f.raw.applyConstraints.mockRejectedValueOnce(new Error('unsupported'))
    await expect(applyVideoConstraints(stream, { width: 1280, height: 720, frameRate: 30 })).rejects.toThrow('unsupported')
    expect(getVideoConstraints(stream)).toEqual(hd)
    expect(f.canvas.width).toBe(1920)
    stopScaledCapture(stream)
  })

  it('releases capture when startup is cancelled', async () => {
    const f = fixture()
    const controller = new AbortController()
    const pending = scaleDesktopVideo(f.source, hd, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(f.raw.stop).toHaveBeenCalledTimes(1)
    expect(f.output.stop).toHaveBeenCalledTimes(1)
    expect(f.callbacks.size).toBe(0)
  })

  it('releases capture when no initial frame arrives', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    const rejection = expect(pending).rejects.toThrow('imagem')
    await vi.advanceTimersByTimeAsync(10_000)
    await rejection
    expect(f.raw.stop).toHaveBeenCalledTimes(1)
    expect(f.video.remove).toHaveBeenCalledTimes(1)
  })

  it('rejects when the source ends immediately after its first frame', async () => {
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame()
    f.raw.dispatchEvent(new Event('ended'))
    await expect(pending).rejects.toThrow('encerrada')
    expect(f.raw.stop).toHaveBeenCalledTimes(1)
    expect(f.callbacks.size).toBe(0)
  })

  it('fits ultrawide sources without stretching them', async () => {
    const f = fixture(2560, 1080)
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame()
    const stream = await pending
    expect(f.canvas.width).toBe(1920)
    expect(f.canvas.height).toBe(810)
    stopScaledCapture(stream)
  })

  it('limits canvas work to 60 fps even when a 200 Hz display supplies more callbacks', async () => {
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame(0)
    const stream = await pending
    for (let time = 5; time < 1000; time += 5) f.frame(time)
    expect(f.context.drawImage.mock.calls.length).toBeGreaterThanOrEqual(59)
    expect(f.context.drawImage.mock.calls.length).toBeLessThanOrEqual(61)
    await applyVideoConstraints(stream, { ...hd, frameRate: { max: 30 } })
    const before = f.context.drawImage.mock.calls.length
    for (let time = 1000; time < 2000; time += 5) f.frame(time)
    expect(f.context.drawImage.mock.calls.length - before).toBeGreaterThanOrEqual(29)
    expect(f.context.drawImage.mock.calls.length - before).toBeLessThanOrEqual(31)
    stopScaledCapture(stream)
  })

  it('resumes with a fresh frame after a stall without a catch-up burst', async () => {
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame(0)
    const stream = await pending
    f.frame(500)
    for (let time = 501; time < 516; time++) f.frame(time)
    expect(f.output.requestFrame).toHaveBeenCalledTimes(2)
    stopScaledCapture(stream)
  })
})
