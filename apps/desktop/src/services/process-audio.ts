import { t } from '../i18n'
import type { AudioBridgeState } from '../shared/contracts'
import { PcmDecoder } from './pcm-decoder'

function audioWorkletUrl(): string {
  return new URL('telae-pcm-processor.js', window.location.href).toString()
}

export type ProcessAudioDiagnostics = {
  sampleRate: number
  maxQueueFrames: number
  queuedFrames: number
  queuedMs: number
  droppedFrames: number
  underrunFrames: number
  error: string | null
}

export type ProcessAudioCapture = {
  track: MediaStreamTrack
  readonly diagnostics?: ProcessAudioDiagnostics
  stop(): Promise<void>
}

export async function createProcessAudioCapture(processId: number, signal?: AbortSignal): Promise<ProcessAudioCapture> {
  return createAudioCapture(id => window.telae.startAudioCapture(processId, id), signal)
}

export async function createScreenAudioCapture(signal?: AbortSignal): Promise<ProcessAudioCapture> {
  return createAudioCapture(id => window.telae.startScreenAudioCapture(id), signal)
}

async function createAudioCapture(start: (captureId: string) => Promise<void>, signal?: AbortSignal): Promise<ProcessAudioCapture> {
  signal?.throwIfAborted()
  const captureId = crypto.randomUUID()
  let disposeChunk: () => void = () => undefined
  let disposeState: () => void = () => undefined
  let context: AudioContext | null = null
  let node: AudioWorkletNode | null = null
  let destination: MediaStreamAudioDestinationNode | null = null
  let disposeAbort: () => void = () => undefined
  let bridgeFailure: string | null = null
  let failCapture: (() => void) | null = null

  try {
    const metadata = await new Promise<{ sampleRate: number; channels: number }>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        disposeState()
        reject(new Error(t('O áudio do aplicativo demorou demais para iniciar.')))
      }, 8000)

      let started = false
      disposeState = window.telae.onAudioState((state: AudioBridgeState) => {
        if (state.captureId !== captureId) return
        if (started) {
          if (state.status === 'idle' || state.status === 'error') {
            bridgeFailure = state.status === 'error' ? state.message : t('A captura de áudio foi interrompida.')
            failCapture?.()
          }
          return
        }
        if (state.status === 'capturing') {
          started = true
          window.clearTimeout(timeout)
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
        reject(new Error(t('A captura de áudio foi cancelada.')))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      disposeAbort = () => signal?.removeEventListener('abort', onAbort)

      start(captureId).catch((error: unknown) => {
        if (started) {
          bridgeFailure = error instanceof Error ? error.message : String(error)
          failCapture?.()
          return
        }
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
    if (!track) throw new Error(t('Não foi possível criar a faixa de áudio do aplicativo.'))
    track.contentHint = 'music'
    if (bridgeFailure) throw new Error(bridgeFailure)

    let diagnostics: ProcessAudioDiagnostics = {
      sampleRate: context.sampleRate,
      maxQueueFrames: Math.max(1, Math.floor(context.sampleRate * 0.12)),
      queuedFrames: 0, queuedMs: 0, droppedFrames: 0, underrunFrames: 0, error: null,
    }
    node.port.onmessage = ({ data }) => {
      if (data?.type !== 'diagnostics') return
      diagnostics = {
        sampleRate: data.sampleRate, maxQueueFrames: data.maxQueueFrames,
        queuedFrames: data.queuedFrames, queuedMs: data.queuedFrames * 1000 / data.sampleRate,
        droppedFrames: data.droppedFrames, underrunFrames: data.underrunFrames,
        error: diagnostics.error,
      }
    }

    let stopped = false
    const capture: ProcessAudioCapture = {
      track,
      get diagnostics() { return { ...diagnostics } },
      async stop() {
        if (stopped) return
        stopped = true
        disposeState()
        disposeChunk()
        if (node) node.port.onmessage = null
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
    failCapture = () => {
      if (stopped) return
      diagnostics = { ...diagnostics, error: bridgeFailure }
      // stop() does not emit ended; notify listeners of unexpected bridge failure.
      void capture.stop().catch(() => undefined)
      track.dispatchEvent(new Event('ended'))
    }
    return capture
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
