import type { QualityProfile } from './types'
import { createProcessAudioCapture, type ProcessAudioCapture } from './process-audio'

const processCaptures = new WeakMap<MediaStream, ProcessAudioCapture>()

const qualityConstraints: Record<QualityProfile, MediaTrackConstraints> = {
  auto: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 } },
  '720p60': { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 60 } },
  '1080p30': { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } },
  '1080p60': { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 } },
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
      audio: !isWindow,
      video: qualityConstraints[quality],
    })
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
      throw new Error('A captura foi cancelada. Escolha novamente a tela ou janela.')
    }
    // Algumas janelas não disponibilizam loopback de áudio. Mantém o vídeo ativo.
    signal?.throwIfAborted()
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: qualityConstraints[quality],
      })
    } catch {
      throw new Error('Não foi possível capturar a tela selecionada. Tente outra tela ou janela.')
    }
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
    track.contentHint = 'motion'
    for (const audioTrack of stream.getAudioTracks()) {
      audioTrack.contentHint = 'music'
    }
    if (isWindow) {
      try {
        const processId = await window.telae.resolveWindowAudioProcess(sourceId)
        signal?.throwIfAborted()
        const processCapture = await createProcessAudioCapture(processId, signal)
        stream.addTrack(processCapture.track)
        processCaptures.set(stream, processCapture)
      } catch (error) {
        signal?.throwIfAborted()
        console.warn('Telae: áudio isolado desta janela indisponível', error)
        // Janela sem áudio compatível: o vídeo continua, sem vazar som de outros apps.
      }
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
