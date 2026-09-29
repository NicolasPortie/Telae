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

  async start(sourceId: string, quality: QualityProfile, includeSystemAudio: boolean): Promise<MediaStream> {
    if (!sourceId.trim()) throw new Error('Escolha uma Capture Source antes de iniciar.')
    const token = ++this.startToken
    this.teardownStream()
    this.setState('preparing')

    try {
      const stream = await this.deps.capture(sourceId, quality, includeSystemAudio)
      if (token !== this.startToken) {
        this.deps.release(stream)
        throw new Error('Captura substituída por uma nova seleção.')
      }
      this.stream = stream
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

  stop() {
    this.startToken += 1
    this.teardownStream()
    this.setState('ended')
  }

  reset() {
    this.startToken += 1
    this.teardownStream()
    this.setState('idle')
  }

  private teardownStream() {
    const active = this.stream
    this.stream = null
    if (active) this.deps.release(active)
  }
}
