import type { AudioBridgeState } from '../shared/contracts'

const processorSource = `
class TelaePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.channels = 2;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'format') this.channels = event.data.channels || 2;
      if (event.data?.type === 'chunk') this.queue.push(event.data.samples);
      if (event.data?.type === 'reset') { this.queue = []; this.offset = 0; }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    const frameCount = output[0].length;
    let frame = 0;
    while (frame < frameCount && this.queue.length) {
      const samples = this.queue[0];
      const availableFrames = Math.floor((samples.length - this.offset) / this.channels);
      if (availableFrames <= 0) { this.queue.shift(); this.offset = 0; continue; }
      const copyFrames = Math.min(frameCount - frame, availableFrames);
      for (let i = 0; i < copyFrames; i++) {
        for (let channel = 0; channel < output.length; channel++) {
          const sourceChannel = Math.min(channel, this.channels - 1);
          output[channel][frame + i] = samples[this.offset + (i * this.channels) + sourceChannel] || 0;
        }
      }
      this.offset += copyFrames * this.channels;
      frame += copyFrames;
      if (this.offset >= samples.length) { this.queue.shift(); this.offset = 0; }
    }
    return true;
  }
}
registerProcessor('telae-pcm-processor', TelaePcmProcessor);
`

export type ProcessAudioCapture = {
  track: MediaStreamTrack
  stop(): Promise<void>
}

export async function createProcessAudioCapture(processId: number): Promise<ProcessAudioCapture> {
  let disposeChunk: () => void = () => undefined
  let disposeState: () => void = () => undefined
  let context: AudioContext | null = null
  let node: AudioWorkletNode | null = null
  let destination: MediaStreamAudioDestinationNode | null = null

  const metadata = await new Promise<{ sampleRate: number; channels: number }>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      disposeState()
      reject(new Error('O áudio do aplicativo demorou demais para iniciar.'))
    }, 8000)

    disposeState = window.telae.onAudioState((state: AudioBridgeState) => {
      if (state.status === 'capturing') {
        window.clearTimeout(timeout)
        disposeState()
        resolve(state.metadata)
      } else if (state.status === 'error') {
        window.clearTimeout(timeout)
        disposeState()
        reject(new Error(state.message))
      }
    })

    window.telae.startAudioCapture(processId).catch((error: unknown) => {
      window.clearTimeout(timeout)
      disposeState()
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })

  try {
    context = new AudioContext({ sampleRate: metadata.sampleRate, latencyHint: 'interactive' })
    const blob = new Blob([processorSource], { type: 'text/javascript' })
    const moduleUrl = URL.createObjectURL(blob)
    try {
      await context.audioWorklet.addModule(moduleUrl)
    } finally {
      URL.revokeObjectURL(moduleUrl)
    }

    node = new AudioWorkletNode(context, 'telae-pcm-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [metadata.channels],
    })
    destination = context.createMediaStreamDestination()
    node.connect(destination)
    node.port.postMessage({ type: 'format', channels: metadata.channels })

    disposeChunk = window.telae.onAudioChunk((chunk) => {
      if (!node) return
      const bytes = new Uint8Array(chunk.byteLength)
      bytes.set(chunk)
      const samples = new Float32Array(bytes.buffer)
      node.port.postMessage({ type: 'chunk', samples }, [samples.buffer])
    })

    if (context.state === 'suspended') await context.resume()
    const track = destination.stream.getAudioTracks()[0]
    if (!track) throw new Error('Não foi possível criar a faixa de áudio do aplicativo.')
    track.contentHint = 'music'

    return {
      track,
      async stop() {
        disposeChunk()
        node?.port.postMessage({ type: 'reset' })
        node?.disconnect()
        track.stop()
        if (context && context.state !== 'closed') await context.close()
        await window.telae.stopAudioCapture()
      },
    }
  } catch (error) {
    disposeChunk()
    if (context && context.state !== 'closed') await context.close()
    await window.telae.stopAudioCapture()
    throw error
  }
}
