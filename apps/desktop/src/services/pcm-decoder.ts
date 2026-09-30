/** Pipes podem dividir tanto uma amostra quanto um quadro multicanal. */
export class PcmDecoder {
  private remainder = new Uint8Array(0)
  private readonly channels: number

  constructor(channels: number) {
    if (!Number.isInteger(channels) || channels < 1 || channels > 8) throw new Error('Formato de áudio inválido.')
    this.channels = channels
  }

  push(chunk: Uint8Array): Float32Array {
    const bytes = new Uint8Array(this.remainder.length + chunk.length)
    bytes.set(this.remainder)
    bytes.set(chunk, this.remainder.length)
    const frameBytes = this.channels * 4
    const completeBytes = bytes.length - bytes.length % frameBytes
    this.remainder = bytes.slice(completeBytes)
    const samples = new Float32Array(completeBytes / 4)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < samples.length; index++) samples[index] = view.getFloat32(index * 4, true)
    return samples
  }
}
