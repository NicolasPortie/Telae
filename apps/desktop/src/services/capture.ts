import type { QualityProfile } from './types'
import { qualityConstraints } from './quality-profiles'
import { createProcessAudioCapture, createScreenAudioCapture, type ProcessAudioCapture, type ProcessAudioDiagnostics } from './process-audio'

const processCaptures = new WeakMap<MediaStream, ProcessAudioCapture>()

export function getProcessAudioDiagnostics(stream: MediaStream | null): ProcessAudioDiagnostics | null {
  return stream ? processCaptures.get(stream)?.diagnostics ?? null : null
}

export async function captureDesktopSource(
  sourceId: string,
  quality: QualityProfile,
  signal?: AbortSignal,
): Promise<MediaStream> {
  signal?.throwIfAborted()
  try {
    await window.telae.selectCaptureSource(sourceId)
  } catch {
    throw new Error('A tela ou janela escolhida não está mais disponível.')
  }

  const isWindow = sourceId.startsWith('window:')
  signal?.throwIfAborted()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: qualityConstraints(quality),
    })
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
      throw new Error('A captura foi cancelada. Escolha novamente a tela ou janela.')
    }
    throw new Error('Não foi possível capturar a tela selecionada. Tente outra tela ou janela.')
  }

  const onAbort = () => stopMediaStream(stream)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    signal?.throwIfAborted()
    const track = stream.getVideoTracks()[0]
    if (!track) {
      stopMediaStream(stream)
      throw new Error('A fonte escolhida não retornou vídeo.')
    }
    track.contentHint = quality === 'auto' || quality === '1080p30' || quality === '1440p30' ? 'detail' : 'motion'
    try {
      const processId = isWindow ? await window.telae.resolveWindowAudioProcess(sourceId) : null
      signal?.throwIfAborted()
      const processCapture = processId !== null
        ? await createProcessAudioCapture(processId, signal)
        : await createScreenAudioCapture(signal)
      processCapture.track.contentHint = 'music'
      stream.addTrack(processCapture.track)
      processCaptures.set(stream, processCapture)
    } catch (error) {
      signal?.throwIfAborted()
      console.warn('Telae: captura de áudio filtrado indisponível', error)
      // Keep video running without falling back to unfiltered system audio.
    }
    signal?.throwIfAborted()
    return stream
  } catch (error) {
    stopMediaStream(stream)
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return
  const processCapture = processCaptures.get(stream)
  if (processCapture) {
    processCaptures.delete(stream)
    void processCapture.stop().catch(() => undefined)
  }
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {
      // Track já encerrada — encerrar captura deve ser idempotente.
    }
  }
}
