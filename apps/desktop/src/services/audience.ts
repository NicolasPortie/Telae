import { t, tn } from '../i18n'
import type { DeviceSnapshot, ShareAudience } from './types'

/** Quem está assistindo agora: o necessário para cruzar com a lista de amigos. */
export type Watcher = { deviceId: string; displayName: string }

/** Uma linha que descreve quem vê a transmissão, para mostrar sem abrir as opções. */
export function audienceSummary(audience: ShareAudience): string {
  return audience.mode === 'friends'
    ? t('Todos os amigos')
    : tn('{count} amigo escolhido', '{count} amigos escolhidos', audience.selected.length)
}

/** @usuários de quem está assistindo agora, para marcar essas pessoas ao passar de "todos" para "escolhidos". */
export function watcherCodes(watchers: Watcher[], friends: DeviceSnapshot[]): string[] {
  const ids = new Set(watchers.map(watcher => watcher.deviceId))
  return friends.filter(friend => ids.has(friend.deviceId)).map(friend => friend.friendCode)
}

/**
 * Nomes de quem está assistindo e sairia se a escolha fosse aplicada: só no modo "escolhidos", só quem não está
 * marcado. O servidor aplica a mesma regra; aqui serve para avisar antes.
 */
export function leavingWatchers(draft: ShareAudience, watchers: Watcher[], friends: DeviceSnapshot[]): string[] {
  if (draft.mode !== 'selected') return []
  const codeOf = new Map(friends.map(friend => [friend.deviceId, friend.friendCode]))
  return watchers
    .filter(watcher => {
      const code = codeOf.get(watcher.deviceId)
      return code !== undefined && !draft.selected.includes(code)
    })
    .map(watcher => watcher.displayName)
}

/** Passar de "todos" para "escolhidos" parte de quem já assiste: ninguém sai sem você desmarcar. */
export function withModeChange(current: ShareAudience, next: ShareAudience, watchers: Watcher[], friends: DeviceSnapshot[]): ShareAudience {
  if (current.mode === 'friends' && next.mode === 'selected') {
    return { ...next, selected: [...new Set([...next.selected, ...watcherCodes(watchers, friends)])] }
  }
  return next
}

/** Escolhidos que não estão mais na lista de amigos não contam: o servidor também os ignora. */
export function withKnownFriends(audience: ShareAudience, friends: DeviceSnapshot[]): ShareAudience {
  if (audience.mode !== 'selected' || friends.length === 0) return audience
  const known = new Set(friends.map(friend => friend.friendCode))
  return { ...audience, selected: audience.selected.filter(name => known.has(name)) }
}
