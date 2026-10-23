import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DiagnosticsSnapshot, ShareAccessResult, SignalingEnvelope } from './types'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(), release: vi.fn(), peers: [] as Array<{
    options: { onStatus(status: string): void; onRemoteStream?(stream: MediaStream): void }, close: ReturnType<typeof vi.fn>,
    restartIce: ReturnType<typeof vi.fn>, handleSignal: ReturnType<typeof vi.fn>,
    getDiagnostics: ReturnType<typeof vi.fn<() => Promise<DiagnosticsSnapshot>>>, applyQuality: ReturnType<typeof vi.fn>,
    setQualityProfile: ReturnType<typeof vi.fn>, replaceLocalStream: ReturnType<typeof vi.fn>,
  }>,
  handlers: new Map<string, (...args: unknown[]) => void>(),
  signaling: {
    connect: vi.fn(), disconnect: vi.fn(), getActiveShare: vi.fn(), startShare: vi.fn(),
    stopShare: vi.fn(), joinFriendShare: vi.fn(), getFriends: vi.fn(async () => []), leaveShare: vi.fn(),
    getTurnCredentials: vi.fn(), sendSignal: vi.fn(), updateShareQuality: vi.fn(), removeViewer: vi.fn(),
  },
}))

vi.mock('./capture', () => ({ captureDesktopSource: mocks.capture, stopMediaStream: mocks.release, getProcessAudioDiagnostics: () => null }))
vi.mock('./signaling', () => ({ SignalingClient: class {
  constructor() { Object.assign(this, mocks.signaling) }
  on(event: string, callback: (...args: unknown[]) => void) {
    mocks.handlers.set(event, callback)
    return () => mocks.handlers.delete(event)
  }
} }))
vi.mock('./webrtc', () => ({ WebRtcPeer: class {
  options: { onStatus(status: string): void; onRemoteStream?(stream: MediaStream): void }
  close = vi.fn()
  restartIce = vi.fn(async () => undefined)
  createOffer = vi.fn(async () => undefined)
  handleSignal = vi.fn(async () => undefined)
  replaceLocalStream = vi.fn(async () => undefined)
  updateIceServers = vi.fn()
  setQualityProfile = vi.fn(async () => undefined)
  applyQuality = vi.fn(async () => undefined)
  getDiagnostics = vi.fn(async (): Promise<DiagnosticsSnapshot> => ({
    bitrateKbps: 6000, roundTripMs: 30, packetLossPercent: 0, framesPerSecond: 60,
    codec: 'H264', jitterMs: null, width: 1920, height: 1080,
    availableOutgoingKbps: 20000, transportPath: 'direct', candidateType: 'host',
  }))
  constructor(options: { onStatus(status: string): void; onRemoteStream?(stream: MediaStream): void }) { this.options = options; mocks.peers.push(this) }
} }))

import { ShareSessionController } from './share-session'

const access: ShareAccessResult = {
  session: { sessionId: 'session', sharerDeviceId: 'sharer', sharerDisplayName: 'Sharer',
    qualityProfile: 'auto', viewerDeviceId: null, viewerDeviceIds: [], startedAt: '' },
  iceServers: [],
}
let controller: ShareSessionController
let track: EventTarget & { stop: ReturnType<typeof vi.fn>; readyState: string }
let stream: MediaStream

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.peers.length = 0
  mocks.handlers.clear()
  track = Object.assign(new EventTarget(), { stop: vi.fn(), readyState: 'live', getConstraints: () => ({}), applyConstraints: vi.fn(async () => undefined), contentHint: '' })
  stream = { getVideoTracks: () => [track], getAudioTracks: () => [], getTracks: () => [track] } as unknown as MediaStream
  mocks.capture.mockResolvedValue(stream)
  mocks.release.mockImplementation((value: MediaStream) => value.getTracks().forEach(item => item.stop()))
  mocks.signaling.connect.mockResolvedValue({ deviceId: 'sharer', displayName: 'Sharer' })
  mocks.signaling.disconnect.mockResolvedValue(undefined)
  mocks.signaling.getActiveShare.mockResolvedValue(null)
  mocks.signaling.startShare.mockResolvedValue(access)
  mocks.signaling.stopShare.mockResolvedValue(undefined)
  mocks.signaling.joinFriendShare.mockResolvedValue(access)
  mocks.signaling.leaveShare.mockResolvedValue(undefined)
  mocks.signaling.getTurnCredentials.mockResolvedValue([])
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval, telae: {
    auth: { getSession: async () => ({ id: 'sharer', username: 'sharer', displayName: 'Sharer', email: 'sharer@example.com' }) },
    getLocalProfile: async () => ({ deviceId: 'sharer', deviceSecret: 'a'.repeat(64), displayName: 'Sharer', friendCodes: [] }),
    getEnvironment: async () => ({ signalingUrl: 'http://localhost' }),
  } })
  controller = new ShareSessionController()
  await controller.connect()
})

afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); vi.useRealTimers() })

it.each(['720p60', '1080p60', '1440p60'] as const)('starts %s with consistent motion capture and sender adaptation', async profile => {
  await controller.startSharing('screen:1', profile)
  expect(controller.getSnapshot().contentMode).toBe('motion')
  expect(stream.getVideoTracks()[0].contentHint).toBe('motion')
  mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: 'viewer', displayName: 'Ana' } })
  await vi.advanceTimersByTimeAsync(0)
  mocks.peers[0].options.onStatus('connected')
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocks.peers[0].applyQuality).toHaveBeenLastCalledWith(expect.any(Number), 'maintain-framerate', {
    maxFramerate: 60, scaleResolutionDownBy: 1,
  })
})

it('restores 1080p60 immediately after a live profile change and respects the upload budget', async () => {
  await controller.startSharing('screen:1', '1080p30')
  mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: 'viewer', displayName: 'Ana' } })
  await vi.advanceTimersByTimeAsync(0)
  controller.setUploadBudget(8)
  await controller.setQuality('1080p60')
  expect(controller.getSnapshot().contentMode).toBe('motion')
  expect(stream.getVideoTracks()[0].contentHint).toBe('motion')
  expect(mocks.peers[0].applyQuality).toHaveBeenLastCalledWith(8_000_000, 'maintain-framerate', {
    maxFramerate: 60, scaleResolutionDownBy: 1,
  })
  await controller.setQuality('1080p30')
  expect(controller.getSnapshot().contentMode).toBe('text')
  expect(stream.getVideoTracks()[0].contentHint).toBe('detail')
  expect(mocks.peers[0].applyQuality).toHaveBeenLastCalledWith(8_000_000, 'maintain-resolution', {
    maxFramerate: 30, scaleResolutionDownBy: 1,
  })
})

it('stops capture and peers immediately even when the server never answers', async () => {
  await controller.startSharing('screen:1', 'auto')
  mocks.signaling.stopShare.mockReturnValue(new Promise(() => undefined))
  await controller.leave()
  expect(track.stop).toHaveBeenCalledOnce()
  expect(controller.getSnapshot()).toMatchObject({ state: 'ended', session: null, hasLocalStream: false })
})

it('cancels preparation while the active-session query is pending', async () => {
  const query = deferred<null>()
  mocks.signaling.getActiveShare.mockReturnValue(query.promise)
  const start = controller.startSharing('screen:1', 'auto')
  expect(controller.getSnapshot().state).toBe('preparing')
  await controller.leave()
  query.resolve(null)
  await start
  expect(mocks.capture).not.toHaveBeenCalled()
  expect(controller.getSnapshot().state).toBe('ended')
})

it('cleans a server session whose creation completed after cancellation', async () => {
  const request = deferred<ShareAccessResult>()
  mocks.signaling.startShare.mockReturnValue(request.promise)
  const start = controller.startSharing('screen:1', 'auto')
  await vi.advanceTimersByTimeAsync(0)
  await controller.leave()
  request.resolve(access)
  await start
  expect(mocks.signaling.stopShare).toHaveBeenCalledTimes(2)
  expect(controller.getSnapshot().session).toBeNull()
  expect(track.stop).toHaveBeenCalledOnce()
})

it('releases capture when the server refuses to start the share', async () => {
  mocks.signaling.startShare.mockRejectedValue(new Error('Servidor indisponível'))
  mocks.signaling.stopShare.mockReturnValue(new Promise(() => undefined))
  await expect(controller.startSharing('screen:1', 'auto')).rejects.toThrow('Servidor indisponível')
  expect(track.stop).toHaveBeenCalledOnce()
  expect(controller.getSnapshot()).toMatchObject({ state: 'idle', role: null, hasLocalStream: false })
})

it('exposes no invite code: sharing relies on friend join only', async () => {
  await controller.startSharing('screen:1', 'auto')
  expect(controller.getSnapshot()).not.toHaveProperty('inviteCode')
  expect(controller.getSnapshot().state).toBe('waiting-for-peer')
})

it('keeps an offer that arrives before the join reply', async () => {
  const request = deferred<ShareAccessResult>()
  mocks.signaling.joinFriendShare.mockReturnValue(request.promise)
  const join = controller.joinFriendShare('ABCDEF')
  const offer: SignalingEnvelope = { sessionId: 'session', fromDeviceId: 'sharer', payload: { kind: 'offer', sdp: 'offer' } }
  mocks.handlers.get('signalReceived')!(offer)
  request.resolve(access)
  await join
  expect(mocks.peers[0].handleSignal).toHaveBeenCalledWith(offer.payload)
})

it('bounds viewer recovery even when offers succeed without restoring media', async () => {
  await controller.joinFriendShare('ABCDEF')
  await vi.advanceTimersByTimeAsync(40_000)
  expect(mocks.peers[0].restartIce).toHaveBeenCalledTimes(3)
  expect(mocks.peers[0].close).toHaveBeenCalled()
  expect(mocks.signaling.leaveShare).toHaveBeenCalledOnce()
  expect(controller.getSnapshot()).toMatchObject({ state: 'ended', role: null, session: null })
  expect(vi.getTimerCount()).toBe(0)
})

it('clears a viewer recovery deadline when connected', async () => {
  await controller.joinFriendShare('ABCDEF')
  mocks.peers[0].options.onStatus('connected')
  expect(controller.getSnapshot().state).toBe('negotiating')
  mocks.peers[0].options.onRemoteStream!(stream)
  controller.confirmVideoPresented(stream)
  await vi.advanceTimersByTimeAsync(40_000)
  expect(mocks.peers[0].restartIce).not.toHaveBeenCalled()
  expect(controller.getSnapshot().state).toBe('live')
})

it('keeps healthy viewers live while a failed viewer exhausts its recovery', async () => {
  await controller.startSharing('screen:1', 'auto')
  for (const id of ['healthy', 'failed']) {
    mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: id, displayName: id } })
    await vi.advanceTimersByTimeAsync(0)
    mocks.peers.at(-1)!.options.onStatus('connected')
  }
  mocks.peers[1].options.onStatus('failed')
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.peers[1].restartIce).toHaveBeenCalledTimes(3)
  expect(mocks.peers[1].close).toHaveBeenCalledOnce()
  expect(mocks.peers[0].close).not.toHaveBeenCalled()
  expect(controller.getSnapshot()).toMatchObject({ state: 'live', viewerCount: 1, hasLocalStream: true })
})

it('adapts Auto independently for a congested and a healthy viewer', async () => {
  await controller.startSharing('screen:1', 'auto')
  for (const id of ['healthy', 'congested']) {
    mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: id, displayName: id } })
    await vi.advanceTimersByTimeAsync(0)
    mocks.peers.at(-1)!.options.onStatus('connected')
  }
  const stats = await mocks.peers[1].getDiagnostics()
  mocks.peers[1].getDiagnostics.mockResolvedValue({ ...stats, packetLossPercent: 8 })
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocks.peers[0].applyQuality).toHaveBeenLastCalledWith(16_000_000, 'maintain-resolution', expect.any(Object))
  expect(mocks.peers[1].applyQuality).toHaveBeenLastCalledWith(12_000_000, 'maintain-resolution', expect.any(Object))
  expect(controller.getSnapshot().diagnostics.bitrateKbps).toBe(12000)
})

it('ends the session when the captured window ends its video track', async () => {
  await controller.startSharing('window:1', 'auto')
  track.dispatchEvent(new Event('ended'))
  expect(controller.getSnapshot()).toMatchObject({ state: 'ended', hasLocalStream: false, session: null })
  expect(mocks.signaling.stopShare).toHaveBeenCalledOnce()
})


it('waits for a displayed frame and rejects stale stream confirmations', async () => {
  await controller.joinFriendShare('ABCDEF')
  mocks.peers[0].options.onRemoteStream!(stream)
  expect(controller.getSnapshot().state).toBe('negotiating')
  controller.confirmVideoPresented({} as MediaStream)
  expect(controller.getSnapshot().state).toBe('negotiating')
  controller.confirmVideoPresented(stream)
  expect(controller.getSnapshot().state).toBe('live')
  await controller.leave()
  controller.confirmVideoPresented(stream)
  expect(controller.getSnapshot().state).toBe('ended')
})

it('removes an authorized viewer only after the server accepts removal', async () => {
  await controller.startSharing('screen:1', 'auto')
  mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: 'viewer', displayName: 'Ana' } })
  await vi.advanceTimersByTimeAsync(0)
  mocks.peers[0].options.onStatus('connected')
  mocks.signaling.removeViewer.mockRejectedValueOnce(new Error('server error'))
  await expect(controller.removeViewer('viewer')).rejects.toThrow()
  expect(mocks.peers[0].close).not.toHaveBeenCalled()
  mocks.signaling.removeViewer.mockResolvedValue(undefined)
  await controller.removeViewer('viewer')
  expect(mocks.peers[0].close).toHaveBeenCalledOnce()
  expect(controller.getSnapshot().viewers).toEqual([])
})

it('changes profile without closing peers and rolls capture constraints back on server rejection', async () => {
  await controller.startSharing('screen:1', 'auto')
  mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: 'viewer', displayName: 'Ana' } })
  await vi.advanceTimersByTimeAsync(0)
  mocks.signaling.updateShareQuality.mockResolvedValue(undefined)
  await controller.setQuality('720p60', 'motion')
  expect(controller.getSnapshot()).toMatchObject({ quality: '720p60', contentMode: 'motion' })
  expect(mocks.peers[0].close).not.toHaveBeenCalled()
  expect(mocks.peers[0].setQualityProfile).toHaveBeenCalledWith('720p60')
  mocks.signaling.updateShareQuality.mockRejectedValueOnce(new Error('server error'))
  await expect(controller.setQuality('1080p60')).rejects.toThrow()
  expect(controller.getSnapshot().quality).toBe('720p60')
})

it.each(['1440p30', '1440p60'] as const)('changes a live stream to %s and preserves it on server rejection', async (profile) => {
  await controller.startSharing('screen:1', 'auto')
  mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: 'viewer', displayName: 'Ana' } })
  await vi.advanceTimersByTimeAsync(0)
  mocks.signaling.updateShareQuality.mockResolvedValue(undefined)
  await controller.setQuality(profile, 'motion')
  const fps = profile === '1440p30' ? 30 : 60
  expect(stream.getVideoTracks()[0].applyConstraints).toHaveBeenLastCalledWith({
    width: { ideal: 2560, max: 2560 }, height: { ideal: 1440, max: 1440 }, frameRate: { ideal: fps, max: fps },
  })
  expect(mocks.signaling.updateShareQuality).toHaveBeenLastCalledWith(profile)
  expect(mocks.peers[0].setQualityProfile).toHaveBeenLastCalledWith(profile)
  expect(mocks.peers[0].close).not.toHaveBeenCalled()
  mocks.signaling.updateShareQuality.mockRejectedValueOnce(new Error('server error'))
  await expect(controller.setQuality('1080p60')).rejects.toThrow()
  expect(controller.getSnapshot().quality).toBe(profile)
})

it('bounds recovery when transport connects but no frame is displayed', async () => {
  await controller.joinFriendShare('ABCDEF')
  mocks.peers[0].options.onStatus('connected')
  await vi.advanceTimersByTimeAsync(40_000)
  expect(mocks.peers[0].restartIce).toHaveBeenCalledTimes(3)
  expect(controller.getSnapshot().state).toBe('ended')
})

it('never renews viewer recovery merely because ICE connects again without video', async () => {
  await controller.joinFriendShare('ABCDEF')
  for (let index = 0; index < 4; index++) {
    mocks.peers[0].options.onStatus('connected')
    await vi.advanceTimersByTimeAsync(10_000)
  }
  expect(mocks.peers[0].restartIce).toHaveBeenCalledTimes(3)
  expect(controller.getSnapshot().state).toBe('ended')
})

it('keeps the prior capture alive when one peer refuses a source swap', async () => {
  await controller.startSharing('screen:1', 'auto')
  mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: 'viewer', displayName: 'Ana' } })
  await vi.advanceTimersByTimeAsync(0)
  const nextTrack = Object.assign(new EventTarget(), { stop: vi.fn(), readyState: 'live' })
  const next = { getVideoTracks: () => [nextTrack], getAudioTracks: () => [], getTracks: () => [nextTrack] } as unknown as MediaStream
  mocks.capture.mockResolvedValueOnce(next)
  mocks.peers[0].replaceLocalStream.mockRejectedValueOnce(new Error('sender refused'))
  await expect(controller.switchSource('screen:2')).rejects.toThrow('sender refused')
  expect(track.stop).not.toHaveBeenCalled()
  expect(nextTrack.stop).toHaveBeenCalledOnce()
  expect(controller.getLocalStream()).toBe(stream)
  expect(mocks.peers[0].replaceLocalStream).toHaveBeenLastCalledWith(stream)
})

it('transitions viewers arriving during the source swap before releasing the old capture', async () => {
  await controller.startSharing('screen:1', 'auto')
  mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: 'first', displayName: 'Ana' } })
  await vi.advanceTimersByTimeAsync(0)
  const pending = deferred<void>()
  mocks.peers[0].replaceLocalStream.mockReturnValueOnce(pending.promise)
  const nextTrack = Object.assign(new EventTarget(), { stop: vi.fn(), readyState: 'live' })
  const next = { getVideoTracks: () => [nextTrack], getAudioTracks: () => [], getTracks: () => [nextTrack] } as unknown as MediaStream
  mocks.capture.mockResolvedValueOnce(next)
  const swapping = controller.switchSource('screen:2')
  await vi.advanceTimersByTimeAsync(0)
  mocks.handlers.get('viewerJoined')!({ sessionId: 'session', viewer: { deviceId: 'second', displayName: 'Bia' } })
  await vi.advanceTimersByTimeAsync(0)
  expect(track.stop).not.toHaveBeenCalled()
  pending.resolve()
  await swapping
  expect(mocks.peers[1].replaceLocalStream).toHaveBeenCalledWith(next)
  expect(controller.getLocalStream()).toBe(next)
  expect(track.stop).toHaveBeenCalledOnce()
})

const friendAccess: ShareAccessResult = {
  session: { sessionId: 'session-b', sharerDeviceId: 'friend-b', sharerDisplayName: 'Bia',
    qualityProfile: '1080p30', viewerDeviceId: null, viewerDeviceIds: [], startedAt: '' },
  iceServers: [],
}

it('keeps the current friend stream when the server refuses the switch', async () => {
  await controller.joinFriendShare('ABCDEF')
  mocks.signaling.joinFriendShare.mockRejectedValueOnce(new Error('Seu amigo não está transmitindo agora.'))
  await expect(controller.joinFriendShare('BBBBBB')).rejects.toThrow('Seu amigo não está transmitindo agora.')
  expect(mocks.peers[0].close).not.toHaveBeenCalled()
  expect(mocks.signaling.leaveShare).not.toHaveBeenCalled()
  expect(controller.getSnapshot()).toMatchObject({ role: 'viewer', session: access.session })
  expect(controller.getSnapshot().state).not.toBe('idle')
})

it('switches friends without passing through idle and releases the previous peer', async () => {
  await controller.joinFriendShare('ABCDEF')
  const states: string[] = []
  controller.subscribe(() => states.push(controller.getSnapshot().state))
  mocks.signaling.joinFriendShare.mockResolvedValueOnce(friendAccess)
  await controller.joinFriendShare('BBBBBB')
  expect(states).not.toContain('idle')
  expect(mocks.peers[0].close).toHaveBeenCalledOnce()
  expect(mocks.peers).toHaveLength(2)
  // O servidor já trocou o espectador de transmissão: nada de LeaveShare separado.
  expect(mocks.signaling.leaveShare).not.toHaveBeenCalled()
  expect(controller.getSnapshot()).toMatchObject({ role: 'viewer', state: 'negotiating', session: friendAccess.session })
})

it('buffers the new friend offer that arrives before the switch is confirmed', async () => {
  await controller.joinFriendShare('ABCDEF')
  const request = deferred<ShareAccessResult>()
  mocks.signaling.joinFriendShare.mockReturnValueOnce(request.promise)
  const switching = controller.joinFriendShare('BBBBBB')
  const offer: SignalingEnvelope = { sessionId: 'session-b', fromDeviceId: 'friend-b', payload: { kind: 'offer', sdp: 'offer-b' } }
  mocks.handlers.get('signalReceived')!(offer)
  request.resolve(friendAccess)
  await switching
  expect(mocks.peers.at(-1)!.handleSignal).toHaveBeenCalledWith(offer.payload)
})
