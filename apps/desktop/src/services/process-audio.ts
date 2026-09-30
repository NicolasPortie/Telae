import type { AudioBridgeState } from '../shared/contracts'

function audioWorkletUrl(): string {
  return new URL('telae-pcm-processor.js', window.location.href).toString()
}

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
    await context.audioWorklet.addModule(audioWorkletUrl())

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
        await window.telae.stopAudioCapture(processId)
      },
    }
  } catch (error) {
    disposeChunk()
    if (context && context.state !== 'closed') await context.close()
    await window.telae.stopAudioCapture(processId)
    throw error
  }
}
