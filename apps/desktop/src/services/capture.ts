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
  includeSystemAudio = false,
): Promise<MediaStream> {
  let stream: MediaStream
  try {
    await window.telae.selectCaptureSource(sourceId)
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: includeSystemAudio,
      video: qualityConstraints[quality],
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const prefix = includeSystemAudio
      ? 'Não foi possível iniciar a captura com áudio do sistema.'
      : 'Não foi possível iniciar a captura.'
    throw new Error(reason ? `${prefix} ${reason}` : prefix)
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
