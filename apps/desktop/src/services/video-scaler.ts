/** Keep desktop textures on the native frame path with bounded output dimensions. */
type ScaledCapture = {
  constraints(): MediaTrackConstraints
  apply(constraints: MediaTrackConstraints): Promise<void>
  stop(): void
}

const scaledCaptures = new WeakMap<MediaStream, ScaledCapture>()

type VideoGenerator = MediaStreamTrack & { writable: WritableStream<VideoFrame> }
const frameApi = globalThis as typeof globalThis & {
  MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack; maxBufferSize: number }) => { readable: ReadableStream<VideoFrame> }
  MediaStreamTrackGenerator?: new (options: { kind: 'video' }) => VideoGenerator
}

function bound(value: ConstrainULong | undefined): number {
  if (typeof value === 'number') return value
  return value?.max ?? value?.exact ?? value?.ideal ?? Infinity
}

export function getVideoConstraints(stream: MediaStream): MediaTrackConstraints {
  return scaledCaptures.get(stream)?.constraints() ?? stream.getVideoTracks()[0].getConstraints()
}

export async function applyVideoConstraints(stream: MediaStream, constraints: MediaTrackConstraints): Promise<void> {
  const capture = scaledCaptures.get(stream)
  if (capture) await capture.apply(constraints)
  else await stream.getVideoTracks()[0].applyConstraints(constraints)
}

export function stopScaledCapture(stream: MediaStream): void {
  scaledCaptures.get(stream)?.stop()
}

export async function scaleDesktopVideo(source: MediaStream, initialConstraints: MediaTrackConstraints, signal?: AbortSignal): Promise<MediaStream> {
  if (frameApi.MediaStreamTrackProcessor && frameApi.MediaStreamTrackGenerator && typeof VideoFrame !== 'undefined') {
    return scaleVideoFrames(source, initialConstraints, signal)
  }
  const sourceTrack = source.getVideoTracks()[0]
  const video = document.createElement('video')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context || !canvas.captureStream || !video.requestVideoFrameCallback) {
    await sourceTrack.applyConstraints(initialConstraints)
    return source
  }
  video.muted = true
  video.playsInline = true
  video.srcObject = source
  // Keep a compositor surface for frame callbacks while the sharing window is hidden.
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;pointer-events:none'
  video.setAttribute('aria-hidden', 'true')
  document.body.append(video)
  let constraints = initialConstraints
  let stopped = false
  let callbackId = 0
  let nextFrameAt: number | null = null
  let capture: MediaStream | null = null
  let outputTrack: CanvasCaptureMediaStreamTrack | null = null
  let rejectFirst: ((error: Error) => void) | null = null
  const resize = () => {
    const settings = sourceTrack.getSettings()
    const width = video.videoWidth || settings.width || 2
    const height = video.videoHeight || settings.height || 2
    const scale = Math.min(1, bound(constraints.width) / width, bound(constraints.height) / height)
    const outputWidth = Math.max(2, Math.floor(width * scale / 2) * 2)
    const outputHeight = Math.max(2, Math.floor(height * scale / 2) * 2)
    if (canvas.width !== outputWidth) canvas.width = outputWidth
    if (canvas.height !== outputHeight) canvas.height = outputHeight
  }
  const stop = (ended = false) => {
    if (stopped) return
    stopped = true
    sourceTrack.removeEventListener('ended', onEnded)
    signal?.removeEventListener('abort', onAbort)
    video.cancelVideoFrameCallback(callbackId)
    video.pause()
    video.srcObject = null
    video.remove()
    for (const track of source.getTracks()) track.stop()
    outputTrack?.stop()
    if (capture) scaledCaptures.delete(capture)
    rejectFirst?.(new Error('A captura foi encerrada antes do primeiro quadro.'))
    rejectFirst = null
    if (ended) outputTrack?.dispatchEvent(new Event('ended'))
  }
  const onEnded = () => stop(true)
  const onAbort = () => stop()
  sourceTrack.addEventListener('ended', onEnded, { once: true })
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    signal?.throwIfAborted()
    if (sourceTrack.readyState === 'ended') throw new Error('A fonte escolhida foi encerrada.')
    resize()
    capture = canvas.captureStream(0)
    outputTrack = capture.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    outputTrack.contentHint = sourceTrack.contentHint
    const firstFrame = new Promise<void>((resolve, reject) => {
      rejectFirst = reject
      const draw = (now: number) => {
        if (stopped) return
        try {
          // A high refresh display may deliver callbacks faster than the capture
          // constraint. Bound GPU copies here, before the encoder drops frames.
          const fps = bound(constraints.frameRate)
          const interval = Number.isFinite(fps) && fps > 0 ? 1000 / fps : 0
          if (nextFrameAt !== null && now < nextFrameAt - 0.5) {
            callbackId = video.requestVideoFrameCallback(draw)
            return
          }
          nextFrameAt = interval === 0 ? null
            : nextFrameAt === null || now - nextFrameAt >= interval ? now + interval : nextFrameAt + interval
          resize()
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = 'high'
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          outputTrack!.requestFrame()
          rejectFirst = null
          resolve()
          callbackId = video.requestVideoFrameCallback(draw)
        } catch (error) {
          reject(error)
          stop(true)
        }
      }
      callbackId = video.requestVideoFrameCallback(draw)
    })
    const timeout = setTimeout(() => rejectFirst?.(new Error('A fonte não entregou quadros de vídeo.')), 10_000)
    try { await Promise.all([video.play(), firstFrame]) }
    finally { clearTimeout(timeout) }
    signal?.throwIfAborted()
    if (stopped || outputTrack.readyState === 'ended') throw new Error('A captura foi encerrada.')
    scaledCaptures.set(capture, {
      constraints: () => structuredClone(constraints),
      apply: async next => {
        if (stopped) throw new Error('A captura foi encerrada.')
        await sourceTrack.applyConstraints({ frameRate: next.frameRate })
        if (stopped) throw new Error('A captura foi encerrada.')
        constraints = structuredClone(next)
        nextFrameAt = null
        resize()
      },
      stop,
    })
    return capture
  } catch (error) {
    stop()
    throw error
  } finally { signal?.removeEventListener('abort', onAbort) }
}

/** Consume capture frames directly: hidden/minimized video elements are compositor-throttled. */
async function scaleVideoFrames(source: MediaStream, initialConstraints: MediaTrackConstraints, signal?: AbortSignal): Promise<MediaStream> {
  signal?.throwIfAborted()
  const sourceTrack = source.getVideoTracks()[0]
  if (sourceTrack.readyState === 'ended') throw new Error('A fonte escolhida foi encerrada.')
  const processor = new frameApi.MediaStreamTrackProcessor!({ track: sourceTrack, maxBufferSize: 1 })
  const outputTrack = new frameApi.MediaStreamTrackGenerator!({ kind: 'video' })
  outputTrack.contentHint = sourceTrack.contentHint
  const capture = new MediaStream([outputTrack])
  const reader = processor.readable.getReader()
  const writer = outputTrack.writable.getWriter()
  let constraints = structuredClone(initialConstraints)
  let nextFrameAt: number | null = null
  let stopped = false
  let rejectFirst: (error: Error) => void = () => undefined
  let resolveFirst: () => void = () => undefined
  const firstFrame = new Promise<void>((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject })
  const stop = (ended = false) => {
    if (stopped) return
    stopped = true
    sourceTrack.removeEventListener('ended', onEnded)
    signal?.removeEventListener('abort', onAbort)
    void reader.cancel().catch(() => undefined)
    void writer.abort().catch(() => undefined)
    for (const track of source.getTracks()) track.stop()
    outputTrack.stop()
    scaledCaptures.delete(capture)
    rejectFirst(new Error('A captura foi encerrada antes do primeiro quadro.'))
    if (ended) outputTrack.dispatchEvent(new Event('ended'))
  }
  const onEnded = () => stop(true)
  const onAbort = () => stop()
  sourceTrack.addEventListener('ended', onEnded, { once: true })
  signal?.addEventListener('abort', onAbort, { once: true })
  // Only one pending source frame and one encoder write. No timer or compositor
  // queue can duplicate frames, accumulate latency or freeze a minimized sender.
  void (async () => {
    try {
      while (!stopped) {
        await writer.ready
        if (stopped) break
        const { value: frame, done } = await reader.read()
        if (done) { stop(true); break }
        let scaled: VideoFrame | null = null
        try {
          if (stopped) break
          const now = frame.timestamp / 1000
          const fps = bound(constraints.frameRate)
          const interval = Number.isFinite(fps) && fps > 0 ? 1000 / fps : 0
          if (nextFrameAt !== null && now < nextFrameAt - 0.5) continue
          nextFrameAt = interval === 0 ? null
            : nextFrameAt === null || now - nextFrameAt >= interval ? now + interval : nextFrameAt + interval
          const scale = Math.min(1, bound(constraints.width) / frame.displayWidth, bound(constraints.height) / frame.displayHeight)
          const width = Math.max(2, Math.floor(frame.displayWidth * scale / 2) * 2)
          const height = Math.max(2, Math.floor(frame.displayHeight * scale / 2) * 2)
          if (width !== frame.displayWidth || height !== frame.displayHeight) {
            // Declare output dimensions on the native texture without a canvas
            // snapshot, preserving the frame's capture clock and aspect ratio.
            scaled = new VideoFrame(frame, { displayWidth: width, displayHeight: height })
          }
          await writer.write(scaled ?? frame)
          resolveFirst()
        } finally {
          scaled?.close()
          frame.close()
        }
      }
    } catch (error) {
      rejectFirst(error instanceof Error ? error : new Error(String(error)))
      stop(true)
    }
  })()
  const timeout = setTimeout(() => rejectFirst(new Error('A fonte não entregou quadros de vídeo.')), 10_000)
  try {
    await firstFrame
    signal?.throwIfAborted()
    if (stopped || outputTrack.readyState === 'ended') throw new Error('A captura foi encerrada.')
    scaledCaptures.set(capture, {
      constraints: () => structuredClone(constraints),
      apply: async next => {
        if (stopped) throw new Error('A captura foi encerrada.')
        await sourceTrack.applyConstraints({ frameRate: next.frameRate })
        if (stopped) throw new Error('A captura foi encerrada.')
        constraints = structuredClone(next)
        nextFrameAt = null
      },
      stop,
    })
    return capture
  } catch (error) {
    stop()
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}
