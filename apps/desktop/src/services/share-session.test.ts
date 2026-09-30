import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DiagnosticsSnapshot, ShareAccessResult, SignalingEnvelope } from './types'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(), release: vi.fn(), peers: [] as Array<{
    options: { onStatus(status: string): void }, close: ReturnType<typeof vi.fn>,
    restartIce: ReturnType<typeof vi.fn>, handleSignal: ReturnType<typeof vi.fn>,
    getDiagnostics: ReturnType<typeof vi.fn<() => Promise<DiagnosticsSnapshot>>>, applyQuality: ReturnType<typeof vi.fn>,
  }>,
  handlers: new Map<string, (...args: unknown[]) => void>(),
  signaling: {
    connect: vi.fn(), disconnect: vi.fn(), getActiveShare: vi.fn(), startShare: vi.fn(),
    createInvite: vi.fn(), stopShare: vi.fn(), joinWithInvite: vi.fn(), leaveShare: vi.fn(),
    getTurnCredentials: vi.fn(), sendSignal: vi.fn(),
  },
}))

vi.mock('./capture', () => ({ captureDesktopSource: mocks.capture, stopMediaStream: mocks.release }))
vi.mock('./signaling', () => ({ SignalingClient: class {
  constructor() { Object.assign(this, mocks.signaling) }
  on(event: string, callback: (...args: unknown[]) => void) {
    mocks.handlers.set(event, callback)
    return () => mocks.handlers.delete(event)
  }
} }))
vi.mock('./webrtc', () => ({ WebRtcPeer: class {
  options: { onStatus(status: string): void }
  close = vi.fn()
  restartIce = vi.fn(async () => undefined)
  createOffer = vi.fn(async () => undefined)
  handleSignal = vi.fn(async () => undefined)
  replaceLocalStream = vi.fn(async () => undefined)
  updateIceServers = vi.fn()
  applyQuality = vi.fn(async () => undefined)
  getDiagnostics = vi.fn(async (): Promise<DiagnosticsSnapshot> => ({
    bitrateKbps: 6000, roundTripMs: 30, packetLossPercent: 0, framesPerSecond: 60,
    codec: 'H264', jitterMs: null, width: 1920, height: 1080,
    availableOutgoingKbps: 20000, transportPath: 'direct', candidateType: 'host',
  }))
  constructor(options: { onStatus(status: string): void }) { this.options = options; mocks.peers.push(this) }
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
  track = Object.assign(new EventTarget(), { stop: vi.fn(), readyState: 'live' })
  stream = { getVideoTracks: () => [track], getAudioTracks: () => [], getTracks: () => [track] } as unknown as MediaStream
  mocks.capture.mockResolvedValue(stream)
  mocks.release.mockImplementation((value: MediaStream) => value.getTracks().forEach(item => item.stop()))
  mocks.signaling.connect.mockResolvedValue({ deviceId: 'sharer', displayName: 'Sharer' })
  mocks.signaling.disconnect.mockResolvedValue(undefined)
  mocks.signaling.getActiveShare.mockResolvedValue(null)
  mocks.signaling.startShare.mockResolvedValue(access)
  mocks.signaling.createInvite.mockResolvedValue({ code: 'ABCDEFGH', expiresAt: '', sessionId: 'session' })
  mocks.signaling.stopShare.mockResolvedValue(undefined)
  mocks.signaling.joinWithInvite.mockResolvedValue(access)
  mocks.signaling.leaveShare.mockResolvedValue(undefined)
  mocks.signaling.getTurnCredentials.mockResolvedValue([])
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval, telae: {
    getLocalProfile: async () => ({ deviceId: 'sharer', deviceSecret: 'a'.repeat(64), displayName: 'Sharer', friendCodes: [] }),
    getEnvironment: async () => ({ signalingUrl: 'http://localhost' }),
  } })
  controller = new ShareSessionController()
  await controller.connect()
})

afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); vi.useRealTimers() })

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

it('releases capture when invite creation fails without waiting for remote cleanup', async () => {
  mocks.signaling.createInvite.mockRejectedValue(new Error('Convite indisponível'))
  mocks.signaling.stopShare.mockReturnValue(new Promise(() => undefined))
  await expect(controller.startSharing('screen:1', 'auto')).rejects.toThrow('Convite indisponível')
  expect(track.stop).toHaveBeenCalledOnce()
  expect(controller.getSnapshot()).toMatchObject({ state: 'idle', role: null, hasLocalStream: false })
})

it('keeps an offer that arrives before the join reply', async () => {
  const request = deferred<ShareAccessResult>()
  mocks.signaling.joinWithInvite.mockReturnValue(request.promise)
  const join = controller.joinWithInvite('ABCDEFGH')
  const offer: SignalingEnvelope = { sessionId: 'session', fromDeviceId: 'sharer', payload: { kind: 'offer', sdp: 'offer' } }
  mocks.handlers.get('signalReceived')!(offer)
  request.resolve(access)
  await join
  expect(mocks.peers[0].handleSignal).toHaveBeenCalledWith(offer.payload)
})

it('bounds viewer recovery even when offers succeed without restoring media', async () => {
  await controller.joinWithInvite('ABCDEFGH')
  await vi.advanceTimersByTimeAsync(40_000)
  expect(mocks.peers[0].restartIce).toHaveBeenCalledTimes(3)
  expect(mocks.peers[0].close).toHaveBeenCalled()
  expect(mocks.signaling.leaveShare).toHaveBeenCalledOnce()
  expect(controller.getSnapshot()).toMatchObject({ state: 'ended', role: null, session: null })
  expect(vi.getTimerCount()).toBe(0)
})

it('clears a viewer recovery deadline when connected', async () => {
  await controller.joinWithInvite('ABCDEFGH')
  mocks.peers[0].options.onStatus('connected')
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
  expect(mocks.peers[0].applyQuality).toHaveBeenLastCalledWith(10_000_000, 'maintain-resolution')
  expect(mocks.peers[1].applyQuality).toHaveBeenLastCalledWith(8_000_000, 'maintain-resolution')
  expect(controller.getSnapshot().diagnostics.bitrateKbps).toBe(12000)
})

it('ends the session when the captured window ends its video track', async () => {
  await controller.startSharing('window:1', 'auto')
  track.dispatchEvent(new Event('ended'))
  expect(controller.getSnapshot()).toMatchObject({ state: 'ended', hasLocalStream: false, session: null })
  expect(mocks.signaling.stopShare).toHaveBeenCalledOnce()
})
