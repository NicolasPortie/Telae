import { beforeEach, expect, it, vi } from 'vitest'

const hub = vi.hoisted(() => ({
  state: 'Disconnected', invoke: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
  handlers: new Map<string, (...args: unknown[]) => void>(),
  reconnected: null as (() => Promise<void>) | null,
}))

vi.mock('@microsoft/signalr', () => ({
  HubConnectionState: { Disconnected: 'Disconnected' }, LogLevel: { Warning: 1 },
  HubConnectionBuilder: class {
    withUrl() { return this }
    withAutomaticReconnect() { return this }
    configureLogging() { return this }
    build() { return {
      ...hub,
      on: (event: string, callback: (...args: unknown[]) => void) => hub.handlers.set(event, callback),
      onreconnecting: () => undefined,
      onreconnected: (callback: () => Promise<void>) => { hub.reconnected = callback },
      onclose: () => undefined,
    } }
  },
}))

import { SignalingClient } from './signaling'

beforeEach(() => { vi.clearAllMocks(); hub.handlers.clear(); hub.reconnected = null })

it('re-registers the account and reloads the friend list from the server after reconnect', async () => {
  const client = new SignalingClient('http://localhost')
  await client.connect('device', 'Ana')
  await client.getFriends()
  await hub.reconnected!()
  expect(hub.invoke).toHaveBeenCalledWith('RegisterDevice', { deviceId: 'device', displayName: 'Ana', deviceSecret: '' })
  expect(hub.invoke).toHaveBeenLastCalledWith('GetFriends', [])
})

it('adds and removes friends by username through the hub', async () => {
  const client = new SignalingClient('http://localhost')
  await client.connect('device', 'Ana')
  await client.addFriend('bia')
  expect(hub.invoke).toHaveBeenLastCalledWith('AddFriend', 'bia')
  await client.removeFriend('bia')
  expect(hub.invoke).toHaveBeenLastCalledWith('RemoveFriend', 'bia')
})

it('sends the audience with the share and calls the hide methods by name', async () => {
  const client = new SignalingClient('http://localhost')
  await client.connect('device', 'Ana')
  const audience = { mode: 'selected' as const, selected: ['bia'] }
  await client.startShare('1080p30', audience)
  expect(hub.invoke).toHaveBeenLastCalledWith('StartShare', { deviceId: 'device', qualityProfile: '1080p30', audience })
  await client.updateShareAudience(audience)
  expect(hub.invoke).toHaveBeenLastCalledWith('UpdateShareAudience', audience)
  await client.hideShares('bia')
  expect(hub.invoke).toHaveBeenLastCalledWith('HideShares', 'bia')
  await client.unhideShares('bia')
  expect(hub.invoke).toHaveBeenLastCalledWith('UnhideShares', 'bia')
})

it('forwards the preview removal event from the hub', () => {
  const client = new SignalingClient('http://localhost')
  const seen: string[] = []
  client.on('sharePreviewRemoved', deviceId => seen.push(deviceId))
  hub.handlers.get('SharePreviewRemoved')!('ana')
  expect(seen).toEqual(['ana'])
})
