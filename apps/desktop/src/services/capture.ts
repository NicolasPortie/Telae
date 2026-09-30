import type { QualityProfile } from './types'

const qualityConstraints: Record<QualityProfile, MediaTrackConstraints> = {
  auto: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 } },
  '720p60': { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 60 } },
  '1080p30': { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } },
  '1080p60': { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 } },
}

export async function captureDesktopSource(
  sourceId: string,
  quality: QualityProfile,
): Promise<MediaStream> {
  try {
    await window.telae.selectCaptureSource(sourceId)
  } catch {
    throw new Error('A tela ou janela escolhida não está mais disponível.')
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: qualityConstraints[quality],
    })
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
      throw new Error('A captura foi cancelada. Escolha novamente a tela ou janela.')
    }
    // Algumas janelas não disponibilizam loopback de áudio. Mantém o vídeo ativo.
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: qualityConstraints[quality],
      })
    } catch {
      throw new Error('Não foi possível capturar a tela selecionada. Tente outra tela ou janela.')
    }
  }

  const track = stream.getVideoTracks()[0]
  if (!track) {
    stopMediaStream(stream)
    throw new Error('A fonte escolhida não retornou vídeo.')
  }
  track.contentHint = 'motion'
  for (const audioTrack of stream.getAudioTracks()) {
    audioTrack.contentHint = 'music'
  }
  return stream
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {
      // Track já encerrada — encerrar captura deve ser idempotente.
    }
  }
}
