import type { QualityProfile } from './types'

type DesktopVideoConstraint = MediaTrackConstraints & {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
    maxWidth?: number
    maxHeight?: number
    maxFrameRate?: number
  }
}

const qualityConstraints: Record<QualityProfile, Partial<DesktopVideoConstraint['mandatory']>> = {
  auto: { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60 },
  '720p60': { maxWidth: 1280, maxHeight: 720, maxFrameRate: 60 },
  '1080p30': { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 },
  '1080p60': { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60 },
}

type DesktopAudioConstraint = MediaTrackConstraints & {
  mandatory: {
    chromeMediaSource: 'desktop'
  }
}

export async function captureDesktopSource(
  sourceId: string,
  quality: QualityProfile,
  includeSystemAudio = false,
): Promise<MediaStream> {
  const video: DesktopVideoConstraint = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      ...qualityConstraints[quality],
    },
  }

  const audio: boolean | DesktopAudioConstraint = includeSystemAudio
    ? {
        mandatory: { chromeMediaSource: 'desktop' },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    : false

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio,
      video: video as unknown as MediaTrackConstraints,
    })
  } catch (error) {
    if (includeSystemAudio) {
      throw new Error('A fonte não ofereceu áudio do sistema. Tente sem áudio ou escolha outra Capture Source.')
    }
    throw error instanceof Error ? error : new Error('Não foi possível iniciar a captura.')
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
