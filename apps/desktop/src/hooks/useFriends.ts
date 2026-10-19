import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { upsertFriend } from '../services/friends'
import type { ShareSessionController } from '../services/share-session'
import type { DeviceSnapshot } from '../services/types'
import type { LocalProfile } from '../shared/contracts'

const REFRESH_INTERVAL_MS = 12_000

export type FriendFilter = 'all' | 'live'

type Options = {
  controller: ShareSessionController
  desktopApiAvailable: boolean
  online: boolean
  setProfile: Dispatch<SetStateAction<LocalProfile | null>>
}

/** Lista de amigos, pedidos de amizade e código pessoal: estado, sincronização com o servidor e ações. */
export function useFriends({ controller, desktopApiAvailable, online, setProfile }: Options) {
  const [friends, setFriends] = useState<DeviceSnapshot[]>([])
  const [requests, setRequests] = useState<DeviceSnapshot[]>([])
  const [myFriendCode, setMyFriendCode] = useState<string | null>(null)
  const [myCodeCopied, setMyCodeCopied] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [filter, setFilter] = useState<FriendFilter>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pendingRemoveCode, setPendingRemoveCode] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!desktopApiAvailable) return
    try {
      const local = await window.telae.getLocalProfile()
      setProfile(current => (current?.deviceId === local.deviceId && JSON.stringify(current.friendCodes) === JSON.stringify(local.friendCodes) ? current : local))
      // Meu código independe de ter amigos: precisa aparecer mesmo com a lista vazia.
      const me = controller.getMyFriendCode()
      if (me) setMyFriendCode(me)
      const current = local.friendCodes ?? []
      if (!online) return
      // Pedidos recebidos (quem me adicionou sem reciprocidade): não bloqueiam a lista.
      try { setRequests(await controller.fetchFriendRequests()) } catch { /* pedidos não bloqueiam */ }
      if (current.length === 0) {
        setFriends([])
        return
      }
      // Declara a lista ao servidor: a lista volta ordenada e a amizade passa a valer nos dois lados.
      setFriends(await controller.fetchFriends(current))
    } catch {
      // lista de amigos não bloqueia a home
    }
  }, [controller, desktopApiAvailable, online, setProfile])

  // Mantém lista e presença atualizadas quando online (poll + push), inclusive durante o player.
  useEffect(() => {
    if (!desktopApiAvailable || !online) return
    // Sincronização com o servidor (externa ao React): a leitura inicial é assíncrona.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    // A presença chega com o snapshot completo do amigo: atualiza na hora, sem nova consulta.
    const offPresence = controller.onPresenceChanged(device => setFriends(list => upsertFriend(list, device)))
    // Pedido novo chega na hora; a busca confirma o estado atual no servidor.
    const offRequest = controller.onFriendRequest(() => {
      void controller.fetchFriendRequests().then(setRequests).catch(() => undefined)
    })
    return () => { window.clearInterval(interval); offPresence(); offRequest() }
  }, [controller, desktopApiAvailable, online, refresh])

  const copyMyCode = useCallback(async () => {
    if (!myFriendCode) return
    try {
      await navigator.clipboard.writeText(myFriendCode)
      setMyCodeCopied(true)
      window.setTimeout(() => setMyCodeCopied(false), 2000)
    } catch {
      setError('Não foi possível copiar seu código.')
    }
  }, [myFriendCode])

  const add = useCallback(async (codeArg?: string) => {
    const code = (codeArg ?? codeInput).trim().replaceAll('-', '').toUpperCase()
    if (!code || code.length !== 6) {
      setError('Digite um código de 6 letras/números (ex.: ABC234).')
      return
    }
    if (!desktopApiAvailable) {
      setError('Abra o aplicativo Telae para adicionar amigos.')
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      // Valida que o amigo existe antes de persistir
      const found = await controller.lookupFriend(code)
      if (!found) throw new Error('Amigo não encontrado. Confira o código e tente novamente.')
      if (found.friendCode === myFriendCode) throw new Error('Você não pode adicionar a si mesmo.')
      if (friends.some(friend => friend.friendCode === code)) throw new Error('Este amigo já está na sua lista.')
      const local = await window.telae.addFriendCode(code)
      setProfile(local)
      setCodeInput('')
      setAddOpen(false)
      setSuccess(`Amigo ${found.displayName} adicionado!`)
      window.setTimeout(() => setSuccess(null), 3000)
      setFriends(await controller.fetchFriends(local.friendCodes))
      // Aceitar um pedido o torna mútuo: ele sai da pendência.
      try { setRequests(await controller.fetchFriendRequests()) } catch { /* lista principal já atualizou */ }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível adicionar o amigo.')
    } finally {
      setBusy(false)
    }
  }, [controller, desktopApiAvailable, codeInput, friends, myFriendCode, setProfile])

  const dismissRequest = useCallback(async (code: string) => {
    if (!desktopApiAvailable) return
    setBusy(true)
    setError(null)
    try {
      await controller.dismissFriendRequest(code)
      setRequests(await controller.fetchFriendRequests())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível ignorar o pedido.')
    } finally {
      setBusy(false)
    }
  }, [controller, desktopApiAvailable])

  const remove = useCallback(async (code: string) => {
    if (!desktopApiAvailable) return
    setPendingRemoveCode(null)
    setBusy(true)
    setError(null)
    try {
      const local = await window.telae.removeFriendCode(code)
      setProfile(local)
      setFriends(await controller.fetchFriends(local.friendCodes))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível remover o amigo.')
    } finally {
      setBusy(false)
    }
  }, [controller, desktopApiAvailable, setProfile])

  const closeAddForm = useCallback(() => {
    setAddOpen(false)
    setCodeInput('')
    setError(null)
  }, [])

  return {
    friends, requests, myFriendCode, myCodeCopied,
    codeInput, setCodeInput, filter, setFilter, addOpen, setAddOpen, closeAddForm,
    busy, error, success, pendingRemoveCode, setPendingRemoveCode,
    copyMyCode, add, dismissRequest, remove,
  }
}

export type FriendsState = ReturnType<typeof useFriends>
