/** Teto do Opus para o áudio capturado do sistema. 192 kbps estéreo é transparente para jogos e música. */
export const AUDIO_MAX_BITRATE_BPS = 192_000

const OPUS_RTPMAP = /^a=rtpmap:(\d+) opus\/48000\/2\r?$/im

const OPUS_PARAMETERS: Record<string, string> = {
  stereo: '1',
  'sprop-stereo': '1',
  maxaveragebitrate: String(AUDIO_MAX_BITRATE_BPS),
  useinbandfec: '1',
  usedtx: '0',
  cbr: '0',
}

/**
 * Sem estes parâmetros o Chromium negocia Opus mono com cerca de 32 kbps, adequado para voz
 * mas inadequado para o áudio do sistema. O parâmetro precisa estar na descrição que o
 * receptor devolve (answer), pois é ela que configura o encoder remoto.
 * Devolve o SDP original quando não há payload Opus.
 */
export function tuneOpusSdp(sdp: string | undefined | null): string | undefined {
  if (!sdp) return sdp ?? undefined
  const payload = OPUS_RTPMAP.exec(sdp)?.[1]
  if (!payload) return sdp
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(newline)
  const fmtpPrefix = `a=fmtp:${payload} `
  const index = lines.findIndex(line => line.startsWith(fmtpPrefix))
  if (index === -1) {
    const rtpmap = lines.findIndex(line => line.startsWith(`a=rtpmap:${payload} `))
    lines.splice(rtpmap + 1, 0, fmtpPrefix + serialize(OPUS_PARAMETERS))
    return lines.join(newline)
  }
  const current = new Map<string, string>()
  for (const part of lines[index].slice(fmtpPrefix.length).split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key) current.set(key, value.join('='))
  }
  for (const [key, value] of Object.entries(OPUS_PARAMETERS)) current.set(key, value)
  lines[index] = fmtpPrefix + serialize(Object.fromEntries(current))
  return lines.join(newline)
}

function serialize(parameters: Record<string, string>): string {
  return Object.entries(parameters).map(([key, value]) => value === '' ? key : `${key}=${value}`).join(';')
}
