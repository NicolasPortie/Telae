import { captureDesktopSource, stopMediaStream } from './capture'
import type { QualityProfile } from './types'

export type StreamState = 'idle' | 'preparing' | 'live' | 'ended'

export type StreamSnapshot = {
  state: StreamState
  error: string | null
  hasStream: boolean
}

type ControllerDeps = {
  capture: typeof captureDesktopSource
  release: typeof stopMediaStream
}

const defaultDeps: ControllerDeps = {
  capture: captureDesktopSource,
  release: stopMediaStream,
}

/**
 * StreamController — deep module do Ticket 01.
 *
 * Interface pequena: start / stop / subscribe / getSnapshot.
 * A UI nunca toca em tracks do MediaStream; ela só recebe o stream
 * pronto para anexar ao <video> e observa o state model.
 */
export class StreamController {
  private state: StreamState = 'idle'
  private error: string | null = null
  private stream: MediaStream | null = null
  private readonly listeners = new Set<() => void>()
  private startToken = 0
  private detachEnded: (() => void) | null = null
  private readonly pendingCaptures = new Set<AbortController>()
  private readonly preparedStreams = new Set<MediaStream>()

  private readonly deps: ControllerDeps

  constructor(deps: ControllerDeps = defaultDeps) {
    this.deps = deps
  }

  getSnapshot(): StreamSnapshot {
    return { state: this.state, error: this.error, hasStream: this.stream !== null }
  }

  getMediaStream(): MediaStream | null {
    return this.stream
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  private setState(state: StreamState, error: string | null = null) {
    this.state = state
    this.error = error
    this.emit()
  }

  async start(sourceId: string, quality: QualityProfile): Promise<MediaStream> {
    if (!sourceId.trim()) throw new Error('Escolha uma tela ou janela antes de iniciar.')
    const token = ++this.startToken
    this.cancelPendingCaptures()
    this.teardownStream()
    this.setState('preparing')

    try {
      const stream = await this.captureSource(sourceId, quality)
      if (token !== this.startToken) {
        this.deps.release(stream)
        throw new Error('Captura substituída por uma nova seleção.')
      }
      this.stream = stream
      this.observeEnded(stream)
      if (token !== this.startToken) throw new Error('A fonte escolhida foi encerrada.')
      this.setState('live')
      return stream
    } catch (error) {
      if (token !== this.startToken) throw error instanceof Error ? error : new Error(String(error))
      this.teardownStream()
      const message = error instanceof Error ? error.message : 'Não foi possível iniciar a captura.'
      this.setState('idle', message)
      throw new Error(message)
    }
  }

  async prepareSwitch(sourceId: string, quality: QualityProfile) {
    if (!this.stream) throw new Error('Inicie a transmissão antes de trocar a fonte.')
    const token = this.startToken
    const previous = this.stream
    const current = await this.captureSource(sourceId, quality)
    if (token !== this.startToken || this.stream !== previous) {
      this.deps.release(current)
      throw new Error('A transmissão foi encerrada durante a troca de fonte.')
    }
    this.preparedStreams.add(current)
    const rollback = () => {
      if (this.preparedStreams.delete(current)) this.deps.release(current)
    }
    return {
      previous, current, rollback,
      commit: () => {
        if (token !== this.startToken || this.stream !== previous || !this.preparedStreams.has(current) || current.getVideoTracks?.()[0]?.readyState === 'ended') {
          rollback()
          throw new Error('A fonte ou a transmissão foi encerrada durante a troca.')
        }
        this.preparedStreams.delete(current)
        this.stream = current
        this.observeEnded(current)
        this.deps.release(previous)
        this.emit()
      },
    }
  }

  release(stream: MediaStream) {
    this.deps.release(stream)
  }

  stop() {
    this.startToken += 1
    this.cancelPendingCaptures()
    this.teardownStream()
    this.setState('ended')
  }

  reset() {
    this.startToken += 1
    this.cancelPendingCaptures()
    this.teardownStream()
    this.setState('idle')
  }

  private teardownStream() {
    for (const stream of this.preparedStreams) this.deps.release(stream)
    this.preparedStreams.clear()
    this.detachEnded?.()
    this.detachEnded = null
    const active = this.stream
    this.stream = null
    if (active) this.deps.release(active)
  }

  private observeEnded(stream: MediaStream) {
    this.detachEnded?.()
    const track = stream.getVideoTracks?.()[0]
    if (!track?.addEventListener) return
    const onEnded = () => { if (this.stream === stream) this.stop() }
    track.addEventListener('ended', onEnded, { once: true })
    this.detachEnded = () => track.removeEventListener('ended', onEnded)
    if (track.readyState === 'ended') onEnded()
  }

  private async captureSource(sourceId: string, quality: QualityProfile) {
    const request = new AbortController()
    this.pendingCaptures.add(request)
    try { return await this.deps.capture(sourceId, quality, request.signal) }
    finally { this.pendingCaptures.delete(request) }
  }

  private cancelPendingCaptures() {
    for (const request of this.pendingCaptures) request.abort()
    this.pendingCaptures.clear()
  }
}
