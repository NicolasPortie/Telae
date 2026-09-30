import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AudioBridgeState, AudioChunk } from '../shared/contracts'
import { createProcessAudioCapture } from './process-audio'

let activeCapture: string | null
let emitMetadata: boolean
const stateListeners = new Set<(state: AudioBridgeState) => void>()
const chunkListeners = new Set<(chunk: AudioChunk) => void>()
const stop = vi.fn(async (captureId: string) => { if (activeCapture === captureId) activeCapture = null })
const messages: Array<{ type: string; samples?: Float32Array }> = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  activeCapture = null
  emitMetadata = true
  stateListeners.clear()
  chunkListeners.clear()
  messages.length = 0
  vi.stubGlobal('window', { location: { href: 'http://localhost/' }, setTimeout, clearTimeout, telae: {
    onAudioState: (listener: (state: AudioBridgeState) => void) => {
      stateListeners.add(listener); return () => stateListeners.delete(listener)
    },
    onAudioChunk: (listener: (chunk: AudioChunk) => void) => {
      chunkListeners.add(listener); return () => chunkListeners.delete(listener)
    },
    startAudioCapture: async (processId: number, captureId: string) => {
      activeCapture = captureId
      if (emitMetadata) for (const listener of [...stateListeners]) listener({
        status: 'capturing', captureId, metadata: { processId, sampleRate: 48000, channels: 2, sampleFormat: 'f32le' },
      })
    },
    stopAudioCapture: stop,
  } })
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    audioWorklet = { addModule: async () => undefined }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{ stop: vi.fn(), contentHint: '' }] } } }
    async close() { this.state = 'closed' }
  })
  vi.stubGlobal('AudioWorkletNode', class {
    port = { postMessage: (message: typeof messages[number]) => messages.push(message) }
    connect() {}
    disconnect() {}
  })
})

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('stopping a replaced window capture cannot stop a new capture of the same process', async () => {
  const previous = await createProcessAudioCapture(1234)
  const previousId = activeCapture
  const current = await createProcessAudioCapture(1234)
  const currentId = activeCapture
  await previous.stop()
  expect(previousId).not.toBe(currentId)
  expect(activeCapture).toBe(currentId)
  await current.stop()
  expect(activeCapture).toBeNull()
})

it('stops the bridge and removes listeners if metadata times out', async () => {
  emitMetadata = false
  const request = createProcessAudioCapture(1234).catch(error => error)
  await vi.advanceTimersByTimeAsync(8000)
  expect(await request).toBeInstanceOf(Error)
  expect(activeCapture).toBeNull()
  expect(stop).toHaveBeenCalledOnce()
  expect(stateListeners.size).toBe(0)
})

it('cancels an audio initialization immediately instead of waiting for the metadata timeout', async () => {
  emitMetadata = false
  const abort = new AbortController()
  const request = createProcessAudioCapture(1234, abort.signal).catch(error => error)
  abort.abort()
  expect(await request).toBeInstanceOf(Error)
  expect(activeCapture).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('ignores other capture chunks and assembles fragmented stereo frames', async () => {
  const capture = await createProcessAudioCapture(1234)
  const samples = new Float32Array([0.25, -0.5])
  const data = new Uint8Array(samples.buffer)
  const listener = [...chunkListeners][0]
  listener({ captureId: 'old', data })
  listener({ captureId: activeCapture!, data: data.slice(0, 3) })
  expect(messages.filter(message => message.type === 'chunk')).toHaveLength(0)
  listener({ captureId: activeCapture!, data: data.slice(3) })
  expect(messages.find(message => message.type === 'chunk')?.samples).toEqual(samples)
  await capture.stop()
  await capture.stop()
  expect(stop).toHaveBeenCalledOnce()
  expect(chunkListeners.size).toBe(0)
})
