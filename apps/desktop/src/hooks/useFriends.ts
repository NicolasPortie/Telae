import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { startedSharing, upsertFriend } from '../services/friends'
import { normalizeUsername, type ShareSessionController } from '../services/share-session'
import type { DeviceSnapshot, SharePreviewEvent } from '../services/types'

const REFRESH_INTERVAL_MS = 12_000

/** Aviso do Windows quando um amigo começa a transmitir e o app não está em foco. */
function notifyFriendLive(friend: DeviceSnapshot) {
  if (document.hasFocus() || typeof Notification === 'undefined') return
  void window.telae.getSettings().then(settings => {
    if (!settings.notifyFriendLive) return
    const notification = new Notification(t('{name} está ao vivo', { name: friend.displayName }), {
      body: t('Clique pra entrar.'),
      silent: true,
    })
    notification.onclick = () => window.focus()
  }).catch(() => undefined)
}

type Options = {
  controller: ShareSessionController
  desktopApiAvailable: boolean
  online: boolean
}

/** Lista de amigos, pedidos de amizade e o seu @: estado, sincronização com o servidor e ações. */
export function useFriends({ controller, desktopApiAvailable, online }: Options) {
  const [friends, setFriends] = useState<DeviceSnapshot[]>([])
  const [requests, setRequests] = useState<DeviceSnapshot[]>([])
  // Miniatura mais recente de cada amigo que está transmitindo, por deviceId.
  const [previews, setPreviews] = useState<Record<string, SharePreviewEvent>>({})
  const [myUsername, setMyUsername] = useState<string | null>(null)
  const [myHandleCopied, setMyHandleCopied] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const friendsRef = useRef(friends)
  useEffect(() => { friendsRef.current = friends }, [friends])

  const refresh = useCallback(async () => {
    if (!desktopApiAvailable || !online) return
    const me = controller.getMyUsername()
    if (me) setMyUsername(me)
    try {
      // Pedidos recebidos (quem me adicionou sem reciprocidade): não bloqueiam a lista.
      try { setRequests(await controller.fetchFriendRequests()) } catch { /* pedidos não bloqueiam */ }
      setFriends(await controller.fetchFriends())
      try {
        const list = await controller.fetchFriendPreviews()
        setPreviews(Object.fromEntries(list.map(preview => [preview.deviceId, preview])))
      } catch { /* miniaturas são enfeite: a lista funciona sem elas */ }
    } catch {
      // a lista de amigos não bloqueia a home
    }
  }, [controller, desktopApiAvailable, online])

  // Mantém lista e presença atualizadas quando online (poll + push), inclusive durante o player.
  useEffect(() => {
    if (!desktopApiAvailable || !online) return
    // Sincronização com o servidor (externa ao React): a leitura inicial é assíncrona.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    // A presença chega com o snapshot completo do amigo: atualiza na hora, sem nova consulta.
    const offPresence = controller.onPresenceChanged(device => {
      if (startedSharing(friendsRef.current, device)) notifyFriendLive(device)
      setFriends(list => upsertFriend(list, device))
    })
    // Pedido novo chega na hora; a busca confirma o estado atual no servidor.
    const offRequest = controller.onFriendRequest(() => {
      void controller.fetchFriendRequests().then(setRequests).catch(() => undefined)
    })
    const offPreview = controller.onSharePreview(preview => setPreviews(current => ({ ...current, [preview.deviceId]: preview })))
    return () => { window.clearInterval(interval); offPresence(); offRequest(); offPreview() }
  }, [controller, desktopApiAvailable, online, refresh])

  const copyMyHandle = useCallback(async () => {
    if (!myUsername) return
    try {
      await navigator.clipboard.writeText(`@${myUsername}`)
      setMyHandleCopied(true)
      window.setTimeout(() => setMyHandleCopied(false), 2000)
    } catch {
      setError(t('Não deu pra copiar seu @. Tenta de novo.'))
    }
  }, [myUsername])

  const add = useCallback(async (usernameArg?: string) => {
    const username = normalizeUsername(usernameArg ?? usernameInput)
    if (!username) {
      setError(t('Esse @ não parece certo. Usa de 3 a 20 letras, números ou _.'))
      return
    }
    if (!desktopApiAvailable) {
      setError(t('Abre o app Telaê pra adicionar amigos.'))
      return
    }
    if (username === myUsername) {
      setError(t('Você não pode se adicionar.'))
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const added = await controller.addFriend(username)
      setUsernameInput('')
      setAddOpen(false)
      setSuccess(t('{name} adicionado.', { name: added.displayName }))
      window.setTimeout(() => setSuccess(null), 3000)
      setFriends(await controller.fetchFriends())
      // Adicionar de volta torna a amizade mútua: o pedido some.
      try { setRequests(await controller.fetchFriendRequests()) } catch { /* a lista principal já atualizou */ }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Não deu pra adicionar o amigo. Tenta de novo.'))
    } finally {
      setBusy(false)
    }
  }, [controller, desktopApiAvailable, usernameInput, myUsername])

  const dismissRequest = useCallback(async (username: string) => {
    if (!desktopApiAvailable) return
    setBusy(true)
    setError(null)
    try {
      await controller.dismissFriendRequest(username)
      setRequests(await controller.fetchFriendRequests())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Não deu pra ignorar o pedido. Tenta de novo.'))
    } finally {
      setBusy(false)
    }
  }, [controller, desktopApiAvailable])

  const remove = useCallback(async (username: string) => {
    if (!desktopApiAvailable) return
    setPendingRemove(null)
    setBusy(true)
    setError(null)
    try {
      await controller.removeFriend(username)
      setFriends(await controller.fetchFriends())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Não deu pra remover o amigo. Tenta de novo.'))
    } finally {
      setBusy(false)
    }
  }, [controller, desktopApiAvailable])

  const closeAddForm = useCallback(() => {
    setAddOpen(false)
    setUsernameInput('')
    setError(null)
  }, [])

  return {
    friends, requests, previews, myUsername, myHandleCopied,
    usernameInput, setUsernameInput, addOpen, setAddOpen, closeAddForm,
    busy, error, success, pendingRemove, setPendingRemove,
    copyMyHandle, add, dismissRequest, remove,
  }
}

export type FriendsState = ReturnType<typeof useFriends>
