import type { DeviceSnapshot } from './types'

const STATUS_RANK: Record<DeviceSnapshot['status'], number> = { transmitting: 0, online: 1, offline: 2 }

/** Mesma ordem do servidor: transmitindo, online, depois nome. */
export function sortFriends(list: DeviceSnapshot[]): DeviceSnapshot[] {
  return [...list].sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.displayName.localeCompare(b.displayName, 'pt-BR'))
}

/** Atualiza um amigo a partir de PresenceChanged. Ignora dispositivos que não estão na lista. */
export function upsertFriend(list: DeviceSnapshot[], device: DeviceSnapshot): DeviceSnapshot[] {
  if (!list.some(friend => friend.deviceId === device.deviceId)) return list
  return sortFriends(list.map(friend => (friend.deviceId === device.deviceId ? device : friend)))
}

/**
 * Amigos ao vivo que o Viewer pode trocar. Compara por deviceId: o amigo que o Viewer já
 * assiste nunca aparece como opção de troca.
 */
export function liveFriendsExcept(list: DeviceSnapshot[], currentSharerDeviceId: string | null): DeviceSnapshot[] {
  return list.filter(friend => friend.isSharing && friend.deviceId !== currentSharerDeviceId)
}

/**
 * O amigo acabou de começar a transmitir? Só vale quando ele já estava na lista e não transmitia;
 * a primeira leitura da lista (sem estado anterior) nunca dispara aviso.
 */
export function startedSharing(previous: DeviceSnapshot[], device: DeviceSnapshot): boolean {
  const before = previous.find(friend => friend.deviceId === device.deviceId)
  return before !== undefined && !before.isSharing && device.isSharing
}
