import type { SessionSnapshot } from './share-session'

/** Stores one hour of samples and session-wide aggregates without access credentials. */
export class DiagnosticsHistory {
  private samples: Array<{ t: number; d: SessionSnapshot['diagnostics'] }> = []
  private events: Array<{ t: number; state: string; error: string | null }> = []
  private count = 0
  private bitrateSum = 0
  private maxRtt = 0
  private lastState = ''

  reset() {
    this.samples = []
    this.events = []
    this.count = this.bitrateSum = this.maxRtt = 0
    this.lastState = ''
  }

  recordEvent(snapshot: SessionSnapshot, now = Date.now()) {
    const state = `${snapshot.state}:${snapshot.error ?? ''}`
    if (state !== this.lastState) {
      // Errors may contain remote text. Export only a category, never the raw message.
      this.events.push({ t: now, state: snapshot.state, error: snapshot.error ? 'session_error' : null })
      if (this.events.length > 200) this.events.shift()
      this.lastState = state
    }
  }

  record(snapshot: SessionSnapshot, now = Date.now()) {
    this.recordEvent(snapshot, now)
    if (snapshot.state !== 'live') return
    const d = { ...snapshot.diagnostics }
    this.samples.push({ t: now, d })
    if (this.samples.length > 3600) this.samples.shift()
    this.count++
    this.bitrateSum += d.bitrateKbps
    this.maxRtt = Math.max(this.maxRtt, d.roundTripMs ?? 0)
  }

  export(snapshot: SessionSnapshot) {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      // Explicit allowlist: no invites, identities, session identifiers, URLs or secrets.
      snapshot: {
        state: snapshot.state, role: snapshot.role, quality: snapshot.quality,
        contentMode: snapshot.contentMode, viewerCount: snapshot.viewerCount,
        signaling: snapshot.signaling, includeAudio: snapshot.includeAudio,
        diagnostics: snapshot.diagnostics,
        audioBuffer: snapshot.audioBuffer ? {
          queuedMs: snapshot.audioBuffer.queuedMs, droppedFrames: snapshot.audioBuffer.droppedFrames,
          underrunFrames: snapshot.audioBuffer.underrunFrames,
        } : null,
      },
      summary: { sampleCount: this.count, averageBitrateKbps: this.count ? Math.round(this.bitrateSum / this.count) : 0, maxRoundTripMs: this.maxRtt },
      events: [...this.events], samples: [...this.samples],
    }
  }
}
