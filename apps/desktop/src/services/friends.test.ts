import { expect, it } from 'vitest'
import { liveFriendsExcept, sortFriends, upsertFriend } from './friends'
import type { DeviceSnapshot } from './types'

function friend(overrides: Partial<DeviceSnapshot> & Pick<DeviceSnapshot, 'deviceId' | 'displayName'>): DeviceSnapshot {
  return {
    friendCode: 'ABC234',
    status: 'offline',
    isSharing: false,
    activeQualityProfile: null,
    ...overrides,
  }
}

it('orders friends like the server: live first, then online, then name', () => {
  const sorted = sortFriends([
    friend({ deviceId: 'c', displayName: 'Caio', status: 'offline' }),
    friend({ deviceId: 'b', displayName: 'Bia', status: 'online' }),
    friend({ deviceId: 'a', displayName: 'Ana', status: 'transmitting', isSharing: true }),
    friend({ deviceId: 'd', displayName: 'Dani', status: 'online' }),
  ])
  expect(sorted.map(item => item.deviceId)).toEqual(['a', 'b', 'd', 'c'])
})

it('upserts a presence update in place and re-sorts when someone goes live', () => {
  const list = [
    friend({ deviceId: 'a', displayName: 'Ana', status: 'online' }),
    friend({ deviceId: 'b', displayName: 'Bia', status: 'online' }),
  ]
  const next = upsertFriend(list, friend({ deviceId: 'b', displayName: 'Bia', status: 'transmitting', isSharing: true }))
  expect(next.map(item => item.deviceId)).toEqual(['b', 'a'])
  expect(next[0].isSharing).toBe(true)
})

it('ignores presence for devices that are not in the friend list', () => {
  const list = [friend({ deviceId: 'a', displayName: 'Ana', status: 'online' })]
  expect(upsertFriend(list, friend({ deviceId: 'x', displayName: 'Xu', status: 'transmitting' }))).toBe(list)
})

it('never offers the sharer the viewer is already watching as a switch target', () => {
  // Regressão: a comparação antiga usava friendCode contra deviceId, então o próprio amigo aparecia.
  const list = [
    friend({ deviceId: 'ana-device', friendCode: 'ANA234', displayName: 'Ana', status: 'transmitting', isSharing: true }),
    friend({ deviceId: 'bia-device', friendCode: 'BIA234', displayName: 'Bia', status: 'transmitting', isSharing: true }),
    friend({ deviceId: 'caio-device', friendCode: 'CAI234', displayName: 'Caio', status: 'offline' }),
  ]
  expect(liveFriendsExcept(list, 'ana-device').map(item => item.displayName)).toEqual(['Bia'])
  expect(liveFriendsExcept(list, null).map(item => item.displayName)).toEqual(['Ana', 'Bia'])
})
