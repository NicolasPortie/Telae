import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyVideoConstraints, getVideoConstraints, scaleDesktopVideo, stopScaledCapture } from './video-scaler'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const hd = { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 } }

function fixture(width = 2560, height = 1440) {
  let input!: ReadableStreamDefaultController<VideoFrame>
  const raw = Object.assign(new EventTarget(), {
    readyState: 'live', contentHint: 'motion', stop: vi.fn(),
    applyConstraints: vi.fn(async (_constraints: MediaTrackConstraints) => undefined),
  })
  const source = { getVideoTracks: () => [raw], getTracks: () => [raw] } as unknown as MediaStream
  const writes: VideoFrame[] = []
  const write = vi.fn(async (frame: VideoFrame) => { writes.push(frame) })
  const cancel = vi.fn()
  const abort = vi.fn()
  const options = vi.fn()
  const output = Object.assign(new EventTarget(), {
    readyState: 'live', contentHint: '', stop: vi.fn(),
    writable: new WritableStream<VideoFrame>({ write, abort }),
  })
  vi.stubGlobal('MediaStreamTrackProcessor', class {
    readable = new ReadableStream<VideoFrame>({ start(controller) { input = controller }, cancel })
    constructor(config: unknown) { options(config) }
  })
  vi.stubGlobal('MediaStreamTrackGenerator', class { constructor() { return output } })
  vi.stubGlobal('MediaStream', class {
    tracks: MediaStreamTrack[]
    constructor(tracks: MediaStreamTrack[]) { this.tracks = tracks }
    getVideoTracks() { return this.tracks }
  })
  vi.stubGlobal('VideoFrame', class {
    displayWidth: number
    displayHeight: number
    timestamp: number
    duration: number | undefined
    close = vi.fn()
    constructor(frame: VideoFrame, init: VideoFrameInit) {
      this.displayWidth = init.displayWidth!; this.displayHeight = init.displayHeight!
      this.timestamp = init.timestamp ?? frame.timestamp; this.duration = init.duration ?? frame.duration ?? undefined
    }
  })
  function frame(ms: number) {
    const value = { displayWidth: width, displayHeight: height, timestamp: ms * 1000, duration: 16667, close: vi.fn() }
    input.enqueue(value as unknown as VideoFrame)
    return value
  }
  return { raw, source, frame, output, options, writes, write, cancel, abort }
}

describe('capture frames without a compositor surface', () => {
  it('forwards native frames and timestamps without a video element or canvas copy', async () => {
    const f = fixture(1280, 720)
    const pending = scaleDesktopVideo(f.source, hd)
    const frame = f.frame(12345)
    const stream = await pending
    expect(f.options).toHaveBeenCalledWith({ track: f.raw, maxBufferSize: 1 })
    expect(f.writes).toEqual([frame])
    expect(frame.close).toHaveBeenCalledOnce()
    expect(f.output.contentHint).toBe('motion')
    stopScaledCapture(stream)
    stopScaledCapture(stream)
    await vi.waitFor(() => expect(f.abort).toHaveBeenCalledOnce())
    expect(f.cancel).toHaveBeenCalledOnce()
    expect(f.raw.stop).toHaveBeenCalledOnce()
    expect(f.output.stop).toHaveBeenCalledOnce()
  })

  it('scales ultrawide frames, preserving capture time, duration and aspect ratio', async () => {
    const f = fixture(2560, 1080)
    const pending = scaleDesktopVideo(f.source, hd)
    const frame = f.frame(500)
    const stream = await pending
    expect(f.writes[0]).toMatchObject({ displayWidth: 1920, displayHeight: 810, timestamp: 500000, duration: 16667 })
    expect(frame.close).toHaveBeenCalledOnce()
    expect(f.writes[0].close).toHaveBeenCalledOnce()
    stopScaledCapture(stream)
  })

  it('drops excess input frames before scaling and changes cadence live', async () => {
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame(0)
    const stream = await pending
    const skipped = [f.frame(5), f.frame(10)]
    f.frame(20)
    await vi.waitFor(() => expect(f.writes).toHaveLength(2))
    for (const frame of skipped) expect(frame.close).toHaveBeenCalledOnce()
    await applyVideoConstraints(stream, { ...hd, frameRate: 30 })
    f.frame(30)
    f.frame(50)
    f.frame(65)
    await vi.waitFor(() => expect(f.writes).toHaveLength(4))
    expect(f.raw.applyConstraints).toHaveBeenCalledWith({ frameRate: 30 })
    stopScaledCapture(stream)
  })

  it('retains the previous constraints when changing native FPS fails', async () => {
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame(0)
    const stream = await pending
    f.raw.applyConstraints.mockRejectedValueOnce(new Error('unsupported'))
    await expect(applyVideoConstraints(stream, { width: 1280, height: 720, frameRate: 30 })).rejects.toThrow('unsupported')
    expect(getVideoConstraints(stream)).toEqual(hd)
    stopScaledCapture(stream)
  })

  it('cancels a pending first frame and closes the reader and output', async () => {
    const f = fixture()
    const abort = new AbortController()
    const pending = scaleDesktopVideo(f.source, hd, abort.signal)
    abort.abort()
    await expect(pending).rejects.toThrow('A captura parou')
    expect(f.raw.stop).toHaveBeenCalledOnce()
    expect(f.output.stop).toHaveBeenCalledOnce()
    expect(f.cancel).toHaveBeenCalledOnce()
  })

  it('notifies the session and releases native frames on an encoder write failure', async () => {
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    f.frame(0)
    const stream = await pending
    const ended = vi.fn()
    f.output.addEventListener('ended', ended)
    f.write.mockRejectedValueOnce(new Error('encoder stopped'))
    const frame = f.frame(20)
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce())
    expect(frame.close).toHaveBeenCalledOnce()
    expect(f.raw.stop).toHaveBeenCalledOnce()
    stopScaledCapture(stream)
    expect(f.output.stop).toHaveBeenCalledOnce()
  })

  it('times out and releases a source that never delivers a frame', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const pending = scaleDesktopVideo(f.source, hd)
    const rejection = expect(pending).rejects.toThrow('imagem')
    await vi.advanceTimersByTimeAsync(10000)
    await rejection
    expect(f.cancel).toHaveBeenCalledOnce()
    expect(f.output.stop).toHaveBeenCalledOnce()
  })
})
