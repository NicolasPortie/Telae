// Miniatura da tela para o início dos amigos: pequena, JPEG e espaçada pra não pesar no upload.
export const PREVIEW_WIDTH = 640
export const PREVIEW_INTERVAL_MS = 8_000
const FIRST_PREVIEW_MS = 1_500
const MAX_PREVIEW_LENGTH = 90_000

/** Desenha um quadro do vídeo num canvas e devolve um JPEG em data URL dentro do limite do servidor. */
export function encodePreview(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null
  canvas.width = PREVIEW_WIDTH
  canvas.height = Math.round(PREVIEW_WIDTH * video.videoHeight / video.videoWidth)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.62, 0.48, 0.34]) {
    const image = canvas.toDataURL('image/jpeg', quality)
    if (image.length <= MAX_PREVIEW_LENGTH) return image
  }
  return null
}

/** Publica miniaturas do stream até ser parado. Falhas de envio só esperam a próxima vez. */
export function startPreviewPublisher(stream: MediaStream, publish: (image: string) => Promise<void>): () => void {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = new MediaStream(stream.getVideoTracks())
  void video.play().catch(() => undefined)
  const canvas = document.createElement('canvas')
  let stopped = false

  const send = () => {
    if (stopped) return
    const image = encodePreview(video, canvas)
    if (image) void publish(image).catch(() => undefined)
  }
  const first = window.setTimeout(send, FIRST_PREVIEW_MS)
  const timer = window.setInterval(send, PREVIEW_INTERVAL_MS)
  return () => {
    stopped = true
    window.clearTimeout(first)
    window.clearInterval(timer)
    video.srcObject = null
  }
}
