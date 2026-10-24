import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProcessAudioCapture } from './process-audio'
import { captureDesktopSource, getProcessAudioDiagnostics, stopMediaStream } from './capture'
import type { AudioBridgeState } from '../shared/contracts'

vi.mock('./video-scaler', () => ({
  scaleDesktopVideo: vi.fn(async (stream: MediaStream) => stream),
  stopScaledCapture: vi.fn(),
}))

const source = readFileSync(new URL('../../public/telae-pcm-processor.js', import.meta.url), 'utf8')
interface Processor {
  buffer: Float32Array
  queuedFrames: number
  droppedFrames: number
  underrunFrames: number
  port: { onmessage(event: { data: unknown }): void; postMessage: ReturnType<typeof vi.fn> }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}
function worklet(rate = 1000, channels = 2) {
  let Constructor!: new () => Processor
  class MockProcessor { port = { onmessage: () => undefined, postMessage: vi.fn() } }
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    MockProcessor, rate, (_name: string, ctor: new () => Processor) => { Constructor = ctor },
  )
  const processor = new Constructor()
  const send = (data: unknown) => processor.port.onmessage({ data })
  send({ type: 'format', channels })
  return {
    processor, send,
    push: (samples: number[] | Float32Array) => send({ type: 'chunk', samples: samples instanceof Float32Array ? samples : new Float32Array(samples) }),
    render: (frames: number, count = channels) => {
      const output = Array.from({ length: count }, () => new Float32Array(frames).fill(99))
      expect(processor.process([], [output])).toBe(true)
      return output.map(channel => [...channel])
    },
  }
}
const sequence = (start: number, frames: number) => Array.from({ length: frames }, (_, i) => start + i)
const stereo = (start: number, frames: number) => sequence(start, frames).flatMap(value => [value, -value])
const stereoOutput = (start: number, frames: number) => [sequence(start, frames), sequence(start, frames).map(value => -value)]

describe('bounded PCM worklet', () => {
  it.each([44100, 48000, 96000])('caps queue memory at 120ms at %i Hz', rate => {
    const { processor, push } = worklet(rate)
    push(new Float32Array(rate * 2))
    const max = Math.floor(rate * 0.12)
    expect(processor.queuedFrames).toBe(max)
    expect(processor.droppedFrames).toBe(rate - max)
    expect(processor.buffer.byteLength).toBe(max * 2 * 4)
  })
  it('trims oldest complete frames after partial consumption and ring wrap', () => {
    const { processor, push, render } = worklet()
    push(stereo(1, 100))
    expect(render(30)).toEqual(stereoOutput(1, 30))
    push(stereo(101, 100))
    expect(processor.queuedFrames).toBe(120)
    expect(processor.droppedFrames).toBe(50)
    expect(render(120)).toEqual(stereoOutput(81, 120))
  })
  it('copies only the newest complete frames from a huge chunk without retaining it', () => {
    const { processor, push, render } = worklet()
    push(stereo(1, 10))
    const huge = new Float32Array([...stereo(11, 10000), 777])
    push(huge)
    expect(processor.queuedFrames).toBe(120)
    expect(processor.droppedFrames).toBe(9890)
    expect(processor.buffer.length).toBe(240)
    huge.fill(999)
    expect(render(120)).toEqual(stereoOutput(9891, 120))
  })
  it('bounds thousands of tiny chunks and keeps the latest samples', () => {
    const { processor, push, render } = worklet()
    for (let i = 1; i <= 10000; i++) push([i, -i])
    expect(processor.queuedFrames).toBe(120)
    expect(processor.droppedFrames).toBe(9880)
    expect(processor.buffer.length).toBe(240)
    expect(render(1)).toEqual([[9881], [-9881]])
  })
  it('preserves multichannel samples across chunk boundaries and zeroes underruns', () => {
    const { push, render } = worklet(1000, 3)
    push([1, 2, 3, 4, 5, 6])
    expect(render(1)).toEqual([[1], [2], [3]])
    push([7, 8, 9])
    expect(render(3)).toEqual([[4, 7, 0], [5, 8, 0], [6, 9, 0]])
  })
  it('duplicates mono to additional output channels', () => {
    const { push, render } = worklet(1000, 1)
    push([0.5, -0.5])
    expect(render(3, 2)).toEqual([[0.5, -0.5, 0], [0.5, -0.5, 0]])
  })
  it('reports overflow and underrun totals once per 250ms of rendered audio', () => {
    const { processor, push, render } = worklet()
    push(stereo(1, 130))
    render(125)
    expect(processor.port.postMessage).not.toHaveBeenCalled()
    render(125)
    expect(processor.port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'diagnostics', sampleRate: 1000, maxQueueFrames: 120,
      queuedFrames: 0, droppedFrames: 10, underrunFrames: 130,
    })
  })
  it('recovers from underrun and resets counters and stale samples', () => {
    const { processor, push, render, send } = worklet()
    push([0.5, -0.5])
    expect(render(3)).toEqual([[0.5, 0, 0], [-0.5, 0, 0]])
    expect(processor.underrunFrames).toBe(2)
    push([0.25, -0.25])
    expect(render(1)).toEqual([[0.25], [-0.25]])
    push(stereo(1, 130))
    send({ type: 'reset' })
    expect(processor.port.postMessage).toHaveBeenLastCalledWith({
      type: 'diagnostics', sampleRate: 1000, maxQueueFrames: 120,
      queuedFrames: 0, droppedFrames: 0, underrunFrames: 0,
    })
    expect(render(2)).toEqual([[0, 0], [0, 0]])
  })
  it('clears backlog on format changes and rejects invalid channel counts', () => {
    const { processor, send, push, render } = worklet()
    push(stereo(1, 5))
    send({ type: 'format', channels: 3 })
    expect(processor.queuedFrames).toBe(0)
    expect(processor.buffer.length).toBe(360)
    for (const channels of [0, -1, 1.5, 33, Infinity]) send({ type: 'format', channels })
    push([1, 2, 3])
    expect(render(1, 3)).toEqual([[1], [2], [3]])
  })
  it('returns to live audio after a burst instead of retaining its delay indefinitely', () => {
    const { processor, push, render } = worklet(48000)
    // An IPC stall delivers 120 ms together. Subsequent packets arrive normally
    // every 20 ms, so consuming at exactly the input rate cannot drain the delay.
    push(new Float32Array(5760 * 2).fill(0.1))
    for (let packet = 0; packet < 30; packet++) {
      for (let quantum = 0; quantum < 8; quantum++) render(120)
      push(new Float32Array(960 * 2).fill(0.2))
    }
    expect(processor.queuedFrames).toBeLessThanOrEqual(1920)
    expect(processor.droppedFrames).toBeGreaterThan(0)
  })
  it('does not trim regular 20 ms delivery or a brief delivery burst', () => {
    const { processor, push, render } = worklet(48000)
    for (let packet = 0; packet < 30; packet++) {
      push(new Float32Array(960 * 2))
      for (let quantum = 0; quantum < 8; quantum++) render(120)
    }
    expect(processor.droppedFrames).toBe(0)
    push(new Float32Array(2880 * 2))
    for (let quantum = 0; quantum < 24; quantum++) render(120)
    expect(processor.droppedFrames).toBe(0)
    expect(processor.queuedFrames).toBe(0)
  })
})

function audioBridge() {
  let listener!: (state: AudioBridgeState) => void
  let captureId = ''
  const track = Object.assign(new EventTarget(), { readyState: 'live', stop: vi.fn(), contentHint: '' })
  track.stop.mockImplementation(() => { track.readyState = 'ended' })
  const port = { postMessage: vi.fn(), onmessage: null as null | ((event: { data: unknown }) => void) }
  const disposeState = vi.fn()
  const disposeChunk = vi.fn()
  const close = vi.fn(async () => undefined)
  const stopAudioCapture = vi.fn(async () => undefined)
  const addModule = vi.fn(async () => undefined)
  vi.stubGlobal('window', {
    location: { href: 'http://localhost/' }, setTimeout, clearTimeout,
    telae: {
      onAudioState: (callback: typeof listener) => { listener = callback; return disposeState },
      onAudioChunk: () => disposeChunk,
      startAudioCapture: vi.fn(async (_pid: number, id: string) => {
        captureId = id
        listener({ captureId, status: 'capturing', metadata: { sampleRate: 48000, channels: 2, processId: 123, sampleFormat: 'f32le' } })
      }), stopAudioCapture,
    },
  })
  vi.stubGlobal('AudioContext', class {
    sampleRate = 48000
    state = 'running'
    audioWorklet = { addModule }
    close = close
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [track] } } }
  })
  vi.stubGlobal('AudioWorkletNode', class { port = port; connect = vi.fn(); disconnect = vi.fn() })
  return { track, port, disposeState, disposeChunk, close, stopAudioCapture, addModule,
    state: (status: 'idle' | 'error', id = captureId) => listener(status === 'idle'
      ? { captureId: id, status } : { captureId: id, status, message: 'bridge failed' }),
  }
}
afterEach(() => vi.unstubAllGlobals())
describe('process audio diagnostics and lifecycle', () => {
  it('returns null for absent captures and exposes diagnostics for a captured window', async () => {
    audioBridge()
    expect(getProcessAudioDiagnostics(null)).toBeNull()
    expect(getProcessAudioDiagnostics({} as MediaStream)).toBeNull()
    const tracks: MediaStreamTrack[] = []
    const stream = {
      getVideoTracks: () => [{ contentHint: '', stop: vi.fn() }],
      getAudioTracks: () => tracks,
      getTracks: () => tracks,
      addTrack: (track: MediaStreamTrack) => tracks.push(track),
    } as unknown as MediaStream
    window.telae.selectCaptureSource = vi.fn(async () => undefined)
    window.telae.resolveWindowAudioProcess = vi.fn(async () => 123)
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn(async () => stream) } })
    await captureDesktopSource('window:123:0', 'auto')
    expect(getProcessAudioDiagnostics(stream)?.maxQueueFrames).toBe(5760)
    stopMediaStream(stream)
    expect(getProcessAudioDiagnostics(stream)).toBeNull()
  })
  it('exposes queue snapshots and releases resources on normal stop', async () => {
    const bridge = audioBridge()
    const capture = await createProcessAudioCapture(123)
    bridge.port.onmessage?.({ data: { type: 'diagnostics', sampleRate: 48000, maxQueueFrames: 5760,
      queuedFrames: 2400, droppedFrames: 400, underrunFrames: 128 } })
    expect(capture.diagnostics).toEqual({ sampleRate: 48000, maxQueueFrames: 5760,
      queuedFrames: 2400, queuedMs: 50, droppedFrames: 400, underrunFrames: 128, error: null })
    capture.diagnostics!.queuedFrames = 999
    expect(capture.diagnostics!.queuedFrames).toBe(2400)
    const ended = vi.fn()
    bridge.track.addEventListener('ended', ended)
    await capture.stop()
    await capture.stop()
    expect(ended).not.toHaveBeenCalled()
    expect(bridge.disposeState).toHaveBeenCalledOnce()
    expect(bridge.disposeChunk).toHaveBeenCalledOnce()
    expect(bridge.stopAudioCapture).toHaveBeenCalledOnce()
  })
  it.each(['idle', 'error'] as const)('ends audio and cleans up on unexpected %s', async status => {
    const bridge = audioBridge()
    const capture = await createProcessAudioCapture(123)
    const ended = vi.fn()
    bridge.track.addEventListener('ended', ended)
    bridge.state(status, 'other-capture')
    expect(ended).not.toHaveBeenCalled()
    bridge.state(status)
    expect(ended).toHaveBeenCalledOnce()
    expect(bridge.track.readyState).toBe('ended')
    expect(capture.diagnostics!.error).toBe(status === 'error' ? 'bridge failed' : 'A captura do som foi interrompida.')
    await vi.waitFor(() => expect(bridge.stopAudioCapture).toHaveBeenCalledOnce())
    expect(bridge.close).toHaveBeenCalledOnce()
    expect(bridge.disposeState).toHaveBeenCalledOnce()
  })
  it('rejects bridge failure while loading the worklet', async () => {
    const bridge = audioBridge()
    bridge.addModule.mockImplementationOnce(async () => { bridge.state('error') })
    await expect(createProcessAudioCapture(123)).rejects.toThrow('bridge failed')
    expect(bridge.close).toHaveBeenCalledOnce()
    expect(bridge.disposeState).toHaveBeenCalledOnce()
    expect(bridge.disposeChunk).toHaveBeenCalledOnce()
    expect(bridge.stopAudioCapture).toHaveBeenCalledOnce()
  })
})
