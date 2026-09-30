import type { AudioBridgeState } from '../shared/contracts'
import { PcmDecoder } from './pcm-decoder'

function audioWorkletUrl(): string {
  return new URL('telae-pcm-processor.js', window.location.href).toString()
}

export type ProcessAudioCapture = {
  track: MediaStreamTrack
  stop(): Promise<void>
}

export async function createProcessAudioCapture(processId: number, signal?: AbortSignal): Promise<ProcessAudioCapture> {
  signal?.throwIfAborted()
  const captureId = crypto.randomUUID()
  let disposeChunk: () => void = () => undefined
  let disposeState: () => void = () => undefined
  let context: AudioContext | null = null
  let node: AudioWorkletNode | null = null
  let destination: MediaStreamAudioDestinationNode | null = null
  let disposeAbort: () => void = () => undefined

  try {
    const metadata = await new Promise<{ sampleRate: number; channels: number }>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        disposeState()
        reject(new Error('O áudio do aplicativo demorou demais para iniciar.'))
      }, 8000)

      disposeState = window.telae.onAudioState((state: AudioBridgeState) => {
        if (state.captureId !== captureId) return
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

      const onAbort = () => {
        window.clearTimeout(timeout)
        disposeState()
        reject(new Error('A captura de áudio foi cancelada.'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      disposeAbort = () => signal?.removeEventListener('abort', onAbort)

      window.telae.startAudioCapture(processId, captureId).catch((error: unknown) => {
        window.clearTimeout(timeout)
        disposeState()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
    disposeAbort()
    signal?.throwIfAborted()

    const decoder = new PcmDecoder(metadata.channels)
    context = new AudioContext({ sampleRate: metadata.sampleRate, latencyHint: 'interactive' })
    await context.audioWorklet.addModule(audioWorkletUrl())
    signal?.throwIfAborted()

    node = new AudioWorkletNode(context, 'telae-pcm-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [metadata.channels],
    })
    destination = context.createMediaStreamDestination()
    node.connect(destination)
    node.port.postMessage({ type: 'format', channels: metadata.channels })

    disposeChunk = window.telae.onAudioChunk((chunk) => {
      if (!node || chunk.captureId !== captureId) return
      const samples = decoder.push(chunk.data)
      if (!samples.length) return
      node.port.postMessage({ type: 'chunk', samples }, [samples.buffer])
    })

    if (context.state === 'suspended') await context.resume()
    signal?.throwIfAborted()
    const track = destination.stream.getAudioTracks()[0]
    if (!track) throw new Error('Não foi possível criar a faixa de áudio do aplicativo.')
    track.contentHint = 'music'

    let stopped = false
    return {
      track,
      async stop() {
        if (stopped) return
        stopped = true
        disposeChunk()
        node?.port.postMessage({ type: 'reset' })
        node?.disconnect()
        track.stop()
        try {
          if (context && context.state !== 'closed') await context.close()
        } finally {
          await window.telae.stopAudioCapture(captureId)
        }
      },
    }
  } catch (error) {
    disposeAbort()
    disposeState()
    disposeChunk()
    try {
      if (context && context.state !== 'closed') await context.close()
    } finally {
      await window.telae.stopAudioCapture(captureId).catch(() => undefined)
    }
    throw error
  }
}
