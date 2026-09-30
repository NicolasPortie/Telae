import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WebRtcPeer } from './webrtc'

type Report = { id: string; type: string; [key: string]: unknown }
let reports: Map<string, Report>
let connections: FakeConnection[]

class FakeConnection {
  ontrack: ((event: { track: { id: string; kind: string }; streams: unknown[] }) => void) | null = null
  signalingState = 'stable'
  remoteDescription: RTCSessionDescriptionInit | null = null
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable'
  })
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'
  })
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'local-offer' }))
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'local-answer' }))
  getSenders = () => []
  getStats = async () => reports
  getConfiguration = () => ({ iceServers: [] })
  setConfiguration = vi.fn()
  addIceCandidate = vi.fn(async () => undefined)
  close = vi.fn()
  constructor() { connections.push(this) }
}

beforeEach(() => {
  reports = new Map()
  connections = []
  vi.stubGlobal('RTCPeerConnection', FakeConnection)
  vi.stubGlobal('MediaStream', class {
    tracks: Array<{ id: string; kind: string }> = []
    getTracks() { return this.tracks }
    addTrack(track: { id: string; kind: string }) { this.tracks.push(track) }
    removeTrack(track: { id: string; kind: string }) { this.tracks = this.tracks.filter(item => item !== track) }
  })
})
afterEach(() => vi.unstubAllGlobals())

function peer(sharer = false) {
  const sendSignal = vi.fn(async () => undefined)
  return { sendSignal, peer: new WebRtcPeer({
    iceServers: [], qualityProfile: 'auto', sendSignal,
    ...(sharer ? { localStream: { getTracks: () => [] } as unknown as MediaStream } : {}),
    onRemoteStream: vi.fn(), onStatus: vi.fn(),
  }) }
}

function setReports(...values: Report[]) { reports = new Map(values.map(value => [value.id, value])) }

it('uses remote inbound loss for the sender and samples deltas instead of lifetime loss', async () => {
  const { peer: sender } = peer(true)
  setReports(
    { id: 'out', type: 'outbound-rtp', kind: 'video', bytesSent: 1000, timestamp: 1000, packetsSent: 100, remoteId: 'remote' },
    { id: 'remote', type: 'remote-inbound-rtp', localId: 'out', packetsLost: 10 },
  )
  expect((await sender.getDiagnostics()).packetLossPercent).toBe(10)
  setReports(
    { id: 'out', type: 'outbound-rtp', kind: 'video', bytesSent: 2000, timestamp: 2000, packetsSent: 200, remoteId: 'remote' },
    { id: 'remote', type: 'remote-inbound-rtp', localId: 'out', packetsLost: 12 },
  )
  expect((await sender.getDiagnostics()).packetLossPercent).toBe(2)
})

it('links remote loss by localId when remoteId is unavailable', async () => {
  const { peer: sender } = peer(true)
  setReports(
    { id: 'out', type: 'outbound-rtp', kind: 'video', packetsSent: 100 },
    { id: 'remote', type: 'remote-inbound-rtp', localId: 'out', packetsLost: 7 },
  )
  expect((await sender.getDiagnostics()).packetLossPercent).toBeCloseTo(7)
})

it('reports loss as unknown before the remote report arrives', async () => {
  const { peer: sender } = peer(true)
  setReports({ id: 'out', type: 'outbound-rtp', kind: 'video', packetsSent: 100 })
  expect((await sender.getDiagnostics()).packetLossPercent).toBeNull()
})

it('rolls back a viewer offer when both endpoints restart simultaneously', async () => {
  const { peer: viewer, sendSignal } = peer()
  await viewer.restartIce()
  await viewer.handleSignal({ kind: 'offer', sdp: 'sharer-offer' })
  expect(connections[0].setLocalDescription).toHaveBeenCalledWith({ type: 'rollback' })
  expect(sendSignal).toHaveBeenLastCalledWith({ kind: 'answer', sdp: 'local-answer' })
})

it('lets the sharer offer win a collision and ignores candidates for the rejected offer', async () => {
  const { peer: sharer } = peer(true)
  await sharer.restartIce()
  await sharer.handleSignal({ kind: 'offer', sdp: 'colliding' })
  await sharer.handleSignal({ kind: 'candidate', candidate: { candidate: 'ignored' } })
  expect(connections[0].setRemoteDescription).not.toHaveBeenCalled()
  expect(connections[0].addIceCandidate).not.toHaveBeenCalled()
  await sharer.handleSignal({ kind: 'answer', sdp: 'answer' })
  expect(connections[0].signalingState).toBe('stable')
})

it('serializes offer processing before its trickle candidates', async () => {
  const { peer: viewer } = peer()
  await Promise.all([
    viewer.handleSignal({ kind: 'offer', sdp: 'offer' }),
    viewer.handleSignal({ kind: 'candidate', candidate: { candidate: 'candidate:1' } }),
  ])
  expect(connections[0].createAnswer).toHaveBeenCalledOnce()
  expect(connections[0].addIceCandidate).toHaveBeenCalledOnce()
})

it('refreshes ICE servers before a later reconnection', () => {
  const { peer: viewer } = peer()
  viewer.updateIceServers([{ urls: ['turn:localhost'], username: 'fresh', credential: 'secret' }])
  expect(connections[0].setConfiguration).toHaveBeenCalledWith({
    iceServers: [{ urls: ['turn:localhost'], username: 'fresh', credential: 'secret' }],
  })
})

it('combines video and newly added audio even when their incoming stream identifiers differ', () => {
  const onRemoteStream = vi.fn()
  new WebRtcPeer({ iceServers: [], qualityProfile: 'auto', sendSignal: async () => undefined,
    onRemoteStream, onStatus: vi.fn() })
  connections[0].ontrack!({ track: { id: 'video', kind: 'video' }, streams: [{}] })
  connections[0].ontrack!({ track: { id: 'audio', kind: 'audio' }, streams: [{}] })
  const stream = onRemoteStream.mock.calls.at(-1)![0] as MediaStream
  expect(stream.getTracks().map(track => track.id)).toEqual(['video', 'audio'])
})
