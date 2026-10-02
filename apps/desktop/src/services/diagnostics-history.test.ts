import { expect, it } from 'vitest'
import { DiagnosticsHistory } from './diagnostics-history'
import type { SessionSnapshot } from './share-session'

it('exports bounded structured samples and aggregates without identities or invite codes', () => {
  const history = new DiagnosticsHistory()
  const snapshot = { state: 'live', role: 'sharer', inviteCode: 'SECRETINVITE',
    session: { sessionId: 'PRIVATESESSION' }, viewerName: 'PRIVATENAME',
    error: 'PRIVATEERROR', diagnostics: { bitrateKbps: 2000, roundTripMs: 30 },
  } as unknown as SessionSnapshot
  for (let i = 0; i < 4000; i++) history.record(snapshot, i)
  const result = history.export(snapshot)
  expect(result.samples).toHaveLength(3600)
  expect(result.summary).toMatchObject({ sampleCount: 4000, averageBitrateKbps: 2000 })
  for (const secret of ['SECRETINVITE', 'PRIVATESESSION', 'PRIVATENAME', 'PRIVATEERROR']) {
    expect(JSON.stringify(result)).not.toContain(secret)
  }
  history.reset()
  expect(history.export(snapshot).summary.sampleCount).toBe(0)
})
