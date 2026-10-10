import type { ContentMode, QualityProfile } from './types'

const dimensions: Record<QualityProfile, [number, number]> = {
  auto: [2560, 1440],
  '720p60': [1280, 720],
  '1080p30': [1920, 1080],
  '1080p60': [1920, 1080],
  '1440p30': [2560, 1440],
  '1440p60': [2560, 1440],
}

export function qualityContentMode(profile: QualityProfile): ContentMode {
  return profile === '720p60' || profile === '1080p60' || profile === '1440p60' ? 'motion' : 'text'
}

export function qualityFramerate(profile: QualityProfile, mode: ContentMode = 'text'): number {
  return profile === '1080p30' || profile === '1440p30' || (profile === 'auto' && mode === 'text') ? 30 : 60
}

export function qualityConstraints(profile: QualityProfile, mode: ContentMode = 'text'): MediaTrackConstraints {
  const [width, height] = dimensions[profile]
  const fps = qualityFramerate(profile, mode)
  return { width: { ideal: width, max: width }, height: { ideal: height, max: height }, frameRate: { ideal: fps, max: fps } }
}
