/** Resize native desktop textures before the encoder maps them to CPU memory. */
type ScaledCapture = {
  constraints(): MediaTrackConstraints
  apply(constraints: MediaTrackConstraints): Promise<void>
  stop(): void
}

const scaledCaptures = new WeakMap<MediaStream, ScaledCapture>()

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
      const draw = () => {
        if (stopped) return
        try {
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
