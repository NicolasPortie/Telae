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

it('re-registers the account and restores only the latest friend subscriptions after reconnect', async () => {
  const client = new SignalingClient('http://localhost')
  await client.connect('device', 'Ana')
  await client.getFriends(['ABCDEF'])
  await client.getFriends(['UVWXYZ'])
  await hub.reconnected!()
  expect(hub.invoke).toHaveBeenCalledWith('RegisterDevice', { deviceId: 'device', displayName: 'Ana', deviceSecret: '' })
  expect(hub.invoke).toHaveBeenLastCalledWith('GetFriends', ['UVWXYZ'])
})

it('sends an empty subscription list to revoke old groups, including after reconnect', async () => {
  const client = new SignalingClient('http://localhost')
  await client.connect('device', 'Ana')
  await client.getFriends(['ABCDEF'])
  await client.getFriends([])
  expect(hub.invoke).toHaveBeenLastCalledWith('GetFriends', [])
  await hub.reconnected!()
  expect(hub.invoke).toHaveBeenLastCalledWith('GetFriends', [])
})
