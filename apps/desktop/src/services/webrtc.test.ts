import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WebRtcPeer } from './webrtc'

type Report = { id: string; type: string; [key: string]: unknown }
let reports: Map<string, Report>
let connections: FakeConnection[]

class FakeConnection {
  senders: RTCRtpSender[] = []
  addTrack = vi.fn((track: MediaStreamTrack, _stream: MediaStream) => {
    const sender = {
      track: track as MediaStreamTrack | null,
      replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => { sender.track = next }),
      getParameters: () => ({ encodings: [{}] }),
      setParameters: vi.fn(async () => undefined),
    }
    this.senders.push(sender as unknown as RTCRtpSender)
    return sender as unknown as RTCRtpSender
  })
  removeTrack = vi.fn((sender: RTCRtpSender) => { this.senders = this.senders.filter(item => item !== sender) })
  getTransceivers = () => []
  ontrack: ((event: { track: { id: string; kind: string }; streams: unknown[]; receiver?: { jitterBufferTarget: number | null } }) => void) | null = null
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
  getSenders = (): RTCRtpSender[] => this.senders
  getStats = async () => reports
  getConfiguration = () => this.configuration
  setConfiguration = vi.fn()
  addIceCandidate = vi.fn(async () => undefined)
  close = vi.fn()
  configuration: RTCConfiguration
  constructor(configuration: RTCConfiguration = { iceServers: [] }) {
    this.configuration = configuration
    connections.push(this)
  }
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
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

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

it('requests minimal receiver buffering for both audio and video', () => {
  peer()
  for (const kind of ['video', 'audio']) {
    const receiver = { jitterBufferTarget: null as number | null }
    connections[0].ontrack!({ track: { id: kind, kind }, streams: [], receiver })
    expect(receiver.jitterBufferTarget).toBe(0)
  }
})

function installSender() {
  let parameters: RTCRtpSendParameters = { encodings: [{}], codecs: [], headerExtensions: [], rtcp: {}, transactionId: 'test' }
  const sender = {
    track: { kind: 'video' },
    getParameters: () => structuredClone(parameters),
    setParameters: vi.fn(async (next: RTCRtpSendParameters) => { parameters = structuredClone(next) }),
  }
  connections[0].getSenders = () => [sender as unknown as RTCRtpSender]
  return sender
}

it.each(['1080p30', '1080p60'] as const)('configures %s cadence on the first offer before diagnostics start', async profile => {
  const sharer = new WebRtcPeer({
    iceServers: [], qualityProfile: profile,
    localStream: { getTracks: () => [{ kind: 'video', contentHint: profile === '1080p60' ? 'motion' : 'detail' }] } as unknown as MediaStream,
    sendSignal: vi.fn(async () => undefined), onRemoteStream: vi.fn(), onStatus: vi.fn(),
  })
  const sender = installSender()
  await sharer.createOffer()
  expect(sender.getParameters()).toMatchObject({
    degradationPreference: profile === '1080p60' ? 'maintain-framerate' : 'maintain-resolution',
    encodings: [{ maxFramerate: profile === '1080p60' ? 60 : 30, scaleResolutionDownBy: 1 }],
  })
})

it('applies fps and scale, skips identical parameters, and allows restoration', async () => {
  const { peer: sharer } = peer(true)
  const sender = installSender()
  await sharer.applyQuality(2_000_000, 'maintain-framerate', { maxFramerate: 60, scaleResolutionDownBy: 2 })
  await sharer.applyQuality(2_000_000, 'maintain-framerate', { maxFramerate: 60, scaleResolutionDownBy: 2 })
  expect(sender.setParameters).toHaveBeenCalledOnce()
  expect(sender.getParameters().encodings[0]).toMatchObject({ maxBitrate: 2_000_000, maxFramerate: 60, scaleResolutionDownBy: 2 })
  await sharer.applyQuality(2_000_000, 'maintain-resolution', { maxFramerate: 30, scaleResolutionDownBy: 1 })
  expect(sender.setParameters).toHaveBeenCalledTimes(2)
  sharer.close()
  await sharer.applyQuality(1_000_000, 'maintain-resolution')
  expect(sender.setParameters).toHaveBeenCalledTimes(2)
})

it('retries failed updates without breaking the loop and bounds warnings', async () => {
  const { peer: sharer } = peer(true)
  const sender = installSender()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  sender.setParameters.mockRejectedValue(new Error('encoder unavailable'))
  for (let i = 0; i < 10; i++) await expect(sharer.applyQuality(1000, 'maintain-resolution')).resolves.toBeUndefined()
  expect(warn).toHaveBeenCalledTimes(3)
  expect(sender.setParameters).toHaveBeenCalledTimes(10)
})

it('uses the updated profile for future offers', async () => {
  const { peer: sharer } = peer(true)
  const sender = installSender()
  await sharer.setQualityProfile('720p60')
  expect(sender.getParameters().encodings[0].maxBitrate).toBe(6_000_000)
  await sharer.createOffer()
  expect(sender.getParameters().encodings[0].maxBitrate).toBe(6_000_000)
})

it.each(['1440p30', '1440p60'] as const)('applies %s bitrate and framerate after a live profile change', async (profile) => {
  const { peer: sharer } = peer(true)
  const sender = installSender()
  const fps = profile === '1440p30' ? 30 : 60
  const ceiling = profile === '1440p30' ? 20_000_000 : 32_000_000
  await sharer.applyQuality(6_000_000, 'maintain-framerate', { maxFramerate: 60, scaleResolutionDownBy: 2 })
  await sharer.setQualityProfile(profile)
  await sharer.applyQuality(ceiling, 'maintain-resolution', { maxFramerate: fps, scaleResolutionDownBy: 1 })
  expect(sender.getParameters().encodings[0]).toMatchObject({ maxBitrate: ceiling, maxFramerate: fps, scaleResolutionDownBy: 1 })
  await sharer.createOffer()
  expect(sender.getParameters().encodings[0]).toMatchObject({ maxBitrate: ceiling, maxFramerate: fps })
  await sharer.applyQuality(100_000_000, 'maintain-resolution')
  expect(sender.getParameters().encodings[0].maxBitrate).toBe(ceiling)
  await sharer.applyQuality(8_000_000, 'maintain-resolution')
  expect(sender.getParameters().encodings[0].maxBitrate).toBe(8_000_000)
})

it('preserves relay-only policy when updating ICE servers', () => {
  const viewer = new WebRtcPeer({ iceServers: [], qualityProfile: 'auto', iceTransportPolicy: 'relay',
    sendSignal: async () => undefined, onRemoteStream: vi.fn(), onStatus: vi.fn() })
  expect(connections[0].configuration.iceTransportPolicy).toBe('relay')
  viewer.updateIceServers([{ urls: ['turn:localhost'] }])
  expect(connections[0].setConfiguration.mock.calls[0][0].iceTransportPolicy).toBe('relay')
})

it('distinguishes receiving silent audio from a stalled stream and resets changed reports', async () => {
  const { peer: viewer } = peer()
  const audio = { id: 'audio', type: 'inbound-rtp', kind: 'audio', bytesReceived: 100, audioLevel: 0 }
  setReports(audio)
  expect(await viewer.getDiagnostics()).toMatchObject({ audioReceiving: null, audioLevel: 0 })
  setReports({ ...audio, bytesReceived: 200 })
  expect(await viewer.getDiagnostics()).toMatchObject({ audioReceiving: true, audioLevel: 0 })
  expect((await viewer.getDiagnostics()).audioReceiving).toBe(false)
  setReports({ ...audio, id: 'new-audio', bytesReceived: 300, audioLevel: 0.5 })
  expect(await viewer.getDiagnostics()).toMatchObject({ audioReceiving: null, audioLevel: 0.5 })
  setReports()
  expect((await viewer.getDiagnostics()).audioReceiving).toBeNull()
})

it('measures interval encode time rather than lifetime average and handles counter resets', async () => {
  const { peer: sharer } = peer(true)
  const video = { id: 'video', type: 'outbound-rtp', kind: 'video', qualityLimitationReason: 'cpu', totalEncodeTime: 10, framesEncoded: 100 }
  setReports(video)
  expect((await sharer.getDiagnostics()).encodeMs).toBeNull()
  setReports({ ...video, totalEncodeTime: 10.2, framesEncoded: 110 })
  expect((await sharer.getDiagnostics()).encodeMs).toBeCloseTo(20)
  expect((await sharer.getDiagnostics()).qualityLimitationReason).toBe('cpu')
  setReports({ ...video, totalEncodeTime: 0, framesEncoded: 0 })
  expect((await sharer.getDiagnostics()).encodeMs).toBeNull()
})

it('reports the capture cadence linked to the outbound video source', async () => {
  const { peer: sharer } = peer(true)
  setReports(
    { id: 'video', type: 'outbound-rtp', kind: 'video', mediaSourceId: 'capture', framesPerSecond: 24 },
    { id: 'capture', type: 'media-source', kind: 'video', framesPerSecond: 24 },
    { id: 'other-source', type: 'media-source', kind: 'video', framesPerSecond: 60 },
  )
  expect((await sharer.getDiagnostics()).captureFramesPerSecond).toBe(24)
  setReports({ id: 'video', type: 'outbound-rtp', kind: 'video' })
  expect((await sharer.getDiagnostics()).captureFramesPerSecond).toBeNull()
})

it('prefers the video transport selected pair over a stale nominated pair', async () => {
  const { peer: viewer } = peer()
  setReports(
    { id: 'video', type: 'inbound-rtp', kind: 'video', transportId: 'transport', framesDecoded: 42 },
    { id: 'transport', type: 'transport', selectedCandidatePairId: 'active' },
    { id: 'active', type: 'candidate-pair', localCandidateId: 'relay', currentRoundTripTime: 0.04 },
    { id: 'stale', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'host', currentRoundTripTime: 0.9 },
    { id: 'relay', type: 'local-candidate', candidateType: 'relay' },
    { id: 'host', type: 'local-candidate', candidateType: 'host' },
  )
  expect(await viewer.getDiagnostics()).toMatchObject({ framesDecoded: 42, transportPath: 'relay', roundTripMs: 40 })
  reports.delete('transport')
  expect(await viewer.getDiagnostics()).toMatchObject({ transportPath: 'direct', roundTripMs: 900 })
})

it('serializes overlapping parameter writes and reads fresh parameters after the previous write', async () => {
  const { peer: sharer } = peer(true)
  const sender = installSender()
  const originalWrite = sender.setParameters.getMockImplementation()!
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  sender.setParameters.mockImplementationOnce(async parameters => {
    await gate
    await originalWrite({ ...parameters, encodings: [{ ...parameters.encodings[0], active: true }] })
  })
  const read = vi.spyOn(sender, 'getParameters')
  const first = sharer.applyQuality(1_000_000, 'maintain-framerate', { maxFramerate: 60, scaleResolutionDownBy: 2 })
  const second = sharer.applyQuality(2_000_000, 'maintain-framerate')
  await vi.waitFor(() => expect(sender.setParameters).toHaveBeenCalledTimes(1))
  expect(read).toHaveBeenCalledTimes(1)
  release()
  await Promise.all([first, second])
  expect(sender.getParameters().encodings[0]).toMatchObject({ maxBitrate: 2_000_000, maxFramerate: 60, scaleResolutionDownBy: 2, active: true })
  expect(sender.setParameters).toHaveBeenCalledTimes(2)
})

it('retains adaptive motion settings across offers, ICE restarts and profile ceiling changes', async () => {
  const { peer: sharer } = peer(true)
  const sender = installSender()
  await sharer.applyQuality(8_000_000, 'maintain-framerate', { maxFramerate: 45, scaleResolutionDownBy: 2 })
  await sharer.createOffer()
  await sharer.restartIce()
  expect(sender.setParameters).toHaveBeenCalledOnce()
  await sharer.setQualityProfile('720p60')
  await sharer.setQualityProfile('1080p60')
  await sharer.createOffer()
  expect(sender.getParameters()).toMatchObject({ degradationPreference: 'maintain-framerate',
    encodings: [{ maxBitrate: 6_000_000, maxFramerate: 45, scaleResolutionDownBy: 2 }] })
  await sharer.applyQuality(10_000_000, 'maintain-framerate', { maxFramerate: 60, scaleResolutionDownBy: 1 })
  expect(sender.getParameters().encodings[0].maxBitrate).toBe(10_000_000)
})

function sourcePeer(audio = true) {
  const video = { kind: 'video', id: 'old-video' } as MediaStreamTrack
  const oldAudio = { kind: 'audio', id: 'old-audio' } as MediaStreamTrack
  const stream = { getTracks: () => audio ? [video, oldAudio] : [video] } as unknown as MediaStream
  const sendSignal = vi.fn(async () => undefined)
  const sharer = new WebRtcPeer({ iceServers: [], qualityProfile: 'auto', localStream: stream,
    sendSignal, onRemoteStream: vi.fn(), onStatus: vi.fn() })
  const next = { getTracks: () => [
    { kind: 'video', id: 'new-video' }, { kind: 'audio', id: 'new-audio' },
  ] } as unknown as MediaStream
  return { sharer, next, video, oldAudio, sendSignal }
}

it('restores all prior tracks when a later track replacement fails', async () => {
  const { sharer, next, video, oldAudio } = sourcePeer()
  const [videoSender, audioSender] = connections[0].senders
  vi.mocked(audioSender.replaceTrack).mockRejectedValueOnce(new Error('replace failed'))
  await expect(sharer.replaceLocalStream(next)).rejects.toThrow('replace failed')
  expect(videoSender.track).toBe(video)
  expect(audioSender.track).toBe(oldAudio)
  expect(connections[0].createOffer).not.toHaveBeenCalled()
  expect(connections[0].close).not.toHaveBeenCalled()
  await sharer.replaceLocalStream(next)
  expect(videoSender.track?.id).toBe('new-video')
})

it('rolls back SDP, restores tracks and removes added audio when offer signaling fails', async () => {
  const { sharer, next, video, sendSignal } = sourcePeer(false)
  sendSignal.mockRejectedValueOnce(new Error('signaling failed'))
  await expect(sharer.replaceLocalStream(next)).rejects.toThrow('signaling failed')
  expect(connections[0].setLocalDescription).toHaveBeenLastCalledWith({ type: 'rollback' })
  expect(connections[0].senders).toHaveLength(1)
  expect(connections[0].senders[0].track).toBe(video)
  expect(connections[0].removeTrack).toHaveBeenCalledOnce()
  await sharer.replaceLocalStream(next)
  expect(connections[0].senders.map(sender => sender.track?.id)).toEqual(['new-video', 'new-audio'])
})

it('closes the peer when restoring a prior track fails', async () => {
  const { sharer, next } = sourcePeer()
  const [videoSender, audioSender] = connections[0].senders
  vi.mocked(videoSender.replaceTrack).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('rollback failed'))
  vi.mocked(audioSender.replaceTrack).mockRejectedValueOnce(new Error('replace failed'))
  await expect(sharer.replaceLocalStream(next)).rejects.toThrow('replace failed')
  expect(connections[0].close).toHaveBeenCalledOnce()
})

it('closes the peer when SDP rollback fails after an unsuccessful offer', async () => {
  const { sharer, next, sendSignal } = sourcePeer()
  sendSignal.mockRejectedValueOnce(new Error('signaling failed'))
  const localDescription = connections[0].setLocalDescription.getMockImplementation()!
  connections[0].setLocalDescription.mockImplementation(async description => {
    if (description.type === 'rollback') throw new Error('SDP rollback failed')
    await localDescription(description)
  })
  await expect(sharer.replaceLocalStream(next)).rejects.toThrow('signaling failed')
  expect(connections[0].close).toHaveBeenCalledOnce()
})

it('restores removed audio when offer creation fails before a local description exists', async () => {
  const { sharer, next, video, oldAudio } = sourcePeer()
  const videoOnly = { getTracks: () => next.getTracks().filter(track => track.kind === 'video') } as unknown as MediaStream
  connections[0].createOffer.mockRejectedValueOnce(new Error('offer failed'))
  await expect(sharer.replaceLocalStream(videoOnly)).rejects.toThrow('offer failed')
  expect(connections[0].senders.map(sender => sender.track)).toEqual([video, oldAudio])
  expect(connections[0].close).not.toHaveBeenCalled()
})

it('serializes source replacement with ICE restart without nesting the negotiation queue', async () => {
  const { sharer, next } = sourcePeer()
  const videoSender = connections[0].senders[0]
  let release!: () => void
  vi.mocked(videoSender.replaceTrack).mockImplementationOnce(async track => {
    await new Promise<void>(resolve => { release = resolve })
    Object.assign(videoSender, { track })
  })
  const replacing = sharer.replaceLocalStream(next)
  const restarting = sharer.restartIce()
  await vi.waitFor(() => expect(videoSender.replaceTrack).toHaveBeenCalledOnce())
  expect(connections[0].createOffer).not.toHaveBeenCalled()
  release()
  await Promise.all([replacing, restarting])
  expect(connections[0].createOffer).toHaveBeenCalledTimes(2)
  expect(connections[0].createOffer).toHaveBeenLastCalledWith({ iceRestart: true })
})

it('rejects source replacement on an already closed peer while offers retain their no-op semantics', async () => {
  const { sharer, next } = sourcePeer()
  sharer.close()
  await expect(sharer.replaceLocalStream(next)).rejects.toThrow('closed before source replacement')
  await expect(sharer.createOffer()).resolves.toBeUndefined()
  expect(connections[0].createOffer).not.toHaveBeenCalled()
  for (const sender of connections[0].senders) expect(sender.replaceTrack).not.toHaveBeenCalled()
})

it('rejects a previously queued replacement if the peer closes before that operation starts', async () => {
  const { sharer, next, sendSignal } = sourcePeer()
  let release!: () => void
  sendSignal.mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve })
  })
  const offering = sharer.createOffer()
  await vi.waitFor(() => expect(sendSignal).toHaveBeenCalledOnce())
  const replacement = sharer.replaceLocalStream(next)
  const rejected = expect(replacement).rejects.toThrow('closed before source replacement')
  sharer.close()
  release()
  await offering
  await rejected
  for (const sender of connections[0].senders) expect(sender.replaceTrack).not.toHaveBeenCalled()
  expect(connections[0].createOffer).toHaveBeenCalledOnce()
})

it('rejects parent rollback after native replacement rollback closes the peer', async () => {
  const { sharer, next, video, oldAudio } = sourcePeer()
  const [videoSender, audioSender] = connections[0].senders
  vi.mocked(videoSender.replaceTrack).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('rollback failed'))
  vi.mocked(audioSender.replaceTrack).mockRejectedValueOnce(new Error('replace failed'))
  await expect(sharer.replaceLocalStream(next)).rejects.toThrow('replace failed')
  const previous = { getTracks: () => [video, oldAudio] } as unknown as MediaStream
  await expect(sharer.replaceLocalStream(previous)).rejects.toThrow('closed before source replacement')
  expect(connections[0].close).toHaveBeenCalledOnce()
})
