import { describe, expect, it } from 'vitest'
import { AUDIO_MAX_BITRATE_BPS, tuneOpusSdp } from './sdp-tuning'

const sdp = (fmtp?: string) => [
  'v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'a=rtpmap:111 opus/48000/2',
  ...(fmtp ? [`a=fmtp:111 ${fmtp}`] : []), 'a=rtpmap:63 red/48000/2', 'a=fmtp:63 111/111', '',
].join('\r\n')

describe('tuneOpusSdp', () => {
  it('enables stereo, high bitrate and FEC on the existing Opus fmtp line only', () => {
    const tuned = tuneOpusSdp(sdp('minptime=10;useinbandfec=1'))!
    const line = tuned.split('\r\n').find(item => item.startsWith('a=fmtp:111'))!
    expect(line).toContain('minptime=10')
    expect(line).toContain('stereo=1')
    expect(line).toContain('sprop-stereo=1')
    expect(line).toContain(`maxaveragebitrate=${AUDIO_MAX_BITRATE_BPS}`)
    expect(line).toContain('usedtx=0')
    expect(line.match(/useinbandfec/g)).toHaveLength(1)
    expect(tuned).toContain('a=fmtp:63 111/111')
  })

  it('adds an fmtp line directly after the rtpmap when none exists', () => {
    const lines = tuneOpusSdp(sdp())!.split('\r\n')
    expect(lines[lines.indexOf('a=rtpmap:111 opus/48000/2') + 1]).toMatch(/^a=fmtp:111 stereo=1;/)
  })

  it('preserves LF line endings and leaves SDP without Opus untouched', () => {
    expect(tuneOpusSdp(sdp().replaceAll('\r\n', '\n'))).not.toContain('\r')
    const video = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 102\r\na=rtpmap:102 H264/90000\r\n'
    expect(tuneOpusSdp(video)).toBe(video)
    expect(tuneOpusSdp(undefined)).toBeUndefined()
  })
})
