import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Maximize,
  Minimize,
  RefreshCw,
  Search,
  Signal,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { DiagnosticsHistory } from './services/diagnostics-history'
import { UpdateNotice } from './components/UpdateNotice'
import { SharerSession } from './components/SharerSession'
import { SourceGroup } from './components/SourceGroup'
import { ShareIllustration } from './components/ShareIllustration'
import { QUALITY_OPTIONS } from './ui/format'
import { ShareSessionController } from './services/share-session'
import { upsertFriend } from './services/friends'
import { LiveFriendsSwitch } from './components/LiveFriendsSwitch'
import type { DeviceSnapshot, QualityProfile } from './services/types'
import type { CaptureSource, LocalProfile, UpdateStatus } from './shared/contracts'

type Screen = 'boot' | 'setup' | 'home' | 'picker' | 'session' | 'profile'

export default function App() {
  const [controller] = useState(() => new ShareSessionController())
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot())
  const [screen, setScreen] = useState<Screen>('boot')
  const [profile, setProfile] = useState<LocalProfile | null>(null)

  const [sources, setSources] = useState<CaptureSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [activeSourceId, setActiveSourceId] = useState<string>('')
  const [quality, setQuality] = useState<QualityProfile>('1080p30')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [fitCover, setFitCover] = useState(false)
  const [switchingSource, setSwitchingSource] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [friends, setFriends] = useState<DeviceSnapshot[]>([])
  const [friendCodeInput, setFriendCodeInput] = useState('')
  const [friendFilter, setFriendFilter] = useState<'all' | 'live'>('all')
  const [addFriendOpen, setAddFriendOpen] = useState(false)
  const [friendActionBusy, setFriendActionBusy] = useState(false)
  const [friendError, setFriendError] = useState<string | null>(null)
  const [friendSuccess, setFriendSuccess] = useState<string | null>(null)
  const [watchingDeviceId, setWatchingDeviceId] = useState<string | null>(null)
  const [watchError, setWatchError] = useState<string | null>(null)
  const [pendingRemoveCode, setPendingRemoveCode] = useState<string | null>(null)
  const [myFriendCode, setMyFriendCode] = useState<string | null>(null)
  const [myCodeCopied, setMyCodeCopied] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const overlayTimer = useRef<number | null>(null)
  const historyRef = useRef(new DiagnosticsHistory())
  const latestSnapshot = useRef(snapshot)
  useEffect(() => { latestSnapshot.current = snapshot; historyRef.current.recordEvent(snapshot) }, [snapshot])

  const desktopApiAvailable = typeof window !== 'undefined' && typeof window.telae !== 'undefined'
  const sessionActive = snapshot.role !== null && !['idle', 'ended'].includes(snapshot.state)
  const sourcePickerForActiveShare = screen === 'picker' && switchingSource && snapshot.role === 'sharer'
  const visibleScreen: Screen = sessionActive && screen !== 'session' && !sourcePickerForActiveShare ? 'session' : screen
  const viewerLive = visibleScreen === 'session' && snapshot.role === 'viewer' && snapshot.state === 'live'

  useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller])

  useEffect(() => {
    if (!desktopApiAvailable) return
    const unsubscribe = window.telae.onUpdateStatus(setUpdateStatus)
    void window.telae.getUpdateStatus().then(setUpdateStatus)
    return unsubscribe
  }, [desktopApiAvailable])

  useEffect(() => {
    if (!desktopApiAvailable) return
    void window.telae.setSessionActive(sessionActive)
  }, [desktopApiAvailable, sessionActive])

  // Ticket 09: término inesperado do renderer interrompe captura e sinalização.
  // O servidor encerra o Share Session ao detectar a queda do socket.
  useEffect(() => {
    const onUnload = () => controller.dispose()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [controller])

  useEffect(() => () => controller.dispose(), [controller])

  const refreshFriends = useCallback(async () => {
    if (!desktopApiAvailable) return
    try {
      const local = await window.telae.getLocalProfile()
      setProfile(current => (current?.deviceId === local.deviceId && JSON.stringify(current.friendCodes) === JSON.stringify(local.friendCodes) ? current : local))
      // Meu código independe de ter amigos: precisa aparecer mesmo com a lista vazia.
      const me = controller.getMyFriendCode()
      if (me) setMyFriendCode(me)
      const current = local.friendCodes ?? []
      if (snapshot.signaling !== 'online' || current.length === 0) {
        if (current.length === 0) setFriends([])
        return
      }
      // Declara a lista ao servidor: a lista volta ordenada e a amizade passa a valer nos dois lados.
      setFriends(await controller.fetchFriends(current))
    } catch {
      // lista de amigos não bloqueia a home
    }
  }, [controller, desktopApiAvailable, snapshot.signaling])

  // Boot: perfil local + ambiente (sincroniza com o main process via IPC).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!desktopApiAvailable) {
        if (!cancelled) setScreen('setup')
        return
      }
      try {
        const [local, environment] = await Promise.all([window.telae.getLocalProfile(), window.telae.getEnvironment()])
        if (cancelled) return
        setProfile(local)
        setAppVersion(environment.version)
        setNameInput(local.displayName)
        setScreen(local.displayName ? 'home' : 'setup')
        if (local.displayName) {
          try {
            await controller.connect(local.displayName)
          } catch (error) {
            if (!cancelled) setConnectError(error instanceof Error ? error.message : 'Falha ao conectar.')
          }
        }
      } catch {
        if (!cancelled) setScreen('setup')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [controller, desktopApiAvailable])

  // Mantém lista de amigos e presença atualizada quando online (poll + push) — também durante viewer live para quick-switch
  useEffect(() => {
    if (!desktopApiAvailable || snapshot.signaling !== 'online') return
    // Sincronização com o servidor (externa ao React): a leitura inicial é assíncrona.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshFriends()
    const interval = window.setInterval(() => void refreshFriends(), 12_000)
    // A presença chega com o snapshot completo do amigo: atualiza na hora, sem nova consulta.
    const off = controller.onPresenceChanged(device => setFriends(list => upsertFriend(list, device)))
    return () => { window.clearInterval(interval); off() }
  }, [controller, desktopApiAvailable, snapshot.signaling, refreshFriends])

  const connectWithName = useCallback(
    async (name: string) => {
      setBusy(true)
      setFormError(null)
      setConnectError(null)
      try {
        const device = await controller.connect(name)
        setProfile((previous) => (previous ? { ...previous, displayName: device.displayName } : previous))
        setConnectError(null)
        setScreen('home')
      } catch (error) {
        setConnectError(error instanceof Error ? error.message : 'Não foi possível conectar ao Telae.')
      } finally {
        setBusy(false)
      }
    },
    [controller],
  )

  const saveName = useCallback(async () => {
    if (!desktopApiAvailable) {
      setFormError('Abra o aplicativo Telae para continuar.')
      return
    }

    setBusy(true)
    setFormError(null)
    try {
      const local = await window.telae.setDisplayName(nameInput)
      setProfile(local)
      setNameInput(local.displayName)

      try {
        await controller.connect(local.displayName)
        setConnectError(null)
      } catch (error) {
        setConnectError(error instanceof Error ? error.message : 'Seu nome foi salvo, mas não foi possível conectar.')
      }
      setScreen('home')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível salvar seu nome.')
    } finally {
      setBusy(false)
    }
  }, [controller, desktopApiAvailable, nameInput])

  const loadSources = useCallback(async () => {
    if (!desktopApiAvailable) {
      setSourcesError('Abra o Telae pelo Electron para listar telas e janelas.')
      return
    }
    setSourcesLoading(true)
    setSourcesError(null)
    try {
      const list = await window.telae.listCaptureSources()
      setSources(list)
      setSelectedId((previous) => {
        if (previous && list.some((item) => item.id === previous)) return previous
        return list[0]?.id ?? ''
      })
      if (list.length === 0) setSourcesError('Nenhuma tela ou janela encontrada para compartilhar.')
    } catch (error) {
      setSourcesError(error instanceof Error ? error.message : 'Não foi possível listar suas telas e janelas.')
    } finally {
      setSourcesLoading(false)
    }
  }, [desktopApiAvailable])

  const openPicker = useCallback(() => {
    if (sessionActive) {
      if (snapshot.role === 'sharer') {
        setSwitchingSource(true)
        setFormError(null)
        setSources([])
        setSourcesError(null)
        setScreen('picker')
        void loadSources()
      } else {
        setScreen('session')
      }
      return
    }
    setSwitchingSource(false)
    setFormError(null)
    setSources([])
    setSourcesError(null)
    setScreen('picker')
    void loadSources()
  }, [loadSources, sessionActive, snapshot.role])

  const openSourceSwitch = useCallback(() => {
    setSwitchingSource(true)
    setFormError(null)
    setSources([])
    setScreen('picker')
    void loadSources()
  }, [loadSources])

  const handleStartSharing = useCallback(async () => {
    if (!selectedId) {
      setFormError('Escolha uma tela ou janela antes de iniciar.')
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      if (switchingSource) await controller.switchSource(selectedId)
      else await controller.startSharing(selectedId, quality)
      setActiveSourceId(selectedId)
      if (!switchingSource) historyRef.current.reset()
      setSwitchingSource(false)
      setScreen('session')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível iniciar.')
    } finally {
      setBusy(false)
    }
  }, [controller, selectedId, quality, switchingSource])

  const handleLeave = useCallback(async () => {
    setOverlayVisible(true)
    await controller.leave()
    setScreen('home')
  }, [controller])

  const copyMyFriendCode = useCallback(async () => {
    if (!myFriendCode) return
    try {
      await navigator.clipboard.writeText(myFriendCode)
      setMyCodeCopied(true)
      window.setTimeout(() => setMyCodeCopied(false), 2000)
    } catch {
      setFriendError('Não foi possível copiar seu código.')
    }
  }, [myFriendCode])

  const handleAddFriend = useCallback(async () => {
    const code = friendCodeInput.trim().replaceAll('-', '').toUpperCase()
    if (!code || code.length !== 6) {
      setFriendError('Digite um código de 6 letras/números (ex.: ABC234).')
      return
    }
    if (!desktopApiAvailable) {
      setFriendError('Abra o aplicativo Telae para adicionar amigos.')
      return
    }
    setFriendActionBusy(true)
    setFriendError(null)
    setFriendSuccess(null)
    try {
      // Valida que o amigo existe antes de persistir
      const found = await controller.lookupFriend(code)
      if (!found) throw new Error('Amigo não encontrado. Confira o código e tente novamente.')
      if (found.friendCode === myFriendCode) throw new Error('Você não pode adicionar a si mesmo.')
      const already = friends.some(f => f.friendCode === code)
      if (already) throw new Error('Este amigo já está na sua lista.')
      const local = await window.telae.addFriendCode(code)
      setProfile(local)
      setFriendCodeInput('')
      setAddFriendOpen(false)
      setFriendSuccess(`Amigo ${found.displayName} adicionado!`)
      window.setTimeout(() => setFriendSuccess(null), 3000)
      const list = await controller.fetchFriends(local.friendCodes)
      setFriends(list)
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : 'Não foi possível adicionar o amigo.')
    } finally {
      setFriendActionBusy(false)
    }
  }, [controller, desktopApiAvailable, friendCodeInput, friends, myFriendCode])

  const handleRemoveFriend = useCallback(async (code: string) => {
    if (!desktopApiAvailable) return
    setPendingRemoveCode(null)
    setFriendActionBusy(true)
    setFriendError(null)
    try {
      const local = await window.telae.removeFriendCode(code)
      setProfile(local)
      const list = await controller.fetchFriends(local.friendCodes)
      setFriends(list)
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : 'Não foi possível remover o amigo.')
    } finally {
      setFriendActionBusy(false)
    }
  }, [controller, desktopApiAvailable])

  const handleWatchFriend = useCallback(async (friend: DeviceSnapshot) => {
    const current = latestSnapshot.current
    const viewing = current.role === 'viewer' && ['joining', 'negotiating', 'live', 'reconnecting'].includes(current.state)
    setBusy(true)
    setWatchError(null)
    setWatchingDeviceId(friend.deviceId)
    try {
      await controller.joinFriendShare(friend.friendCode)
      historyRef.current.reset()
      setScreen('session')
    } catch (error) {
      // Na troca, a transmissão atual continua e o erro aparece no player; fora dela, volta à lista.
      setWatchError(error instanceof Error ? error.message : 'Não foi possível entrar na transmissão do amigo.')
      if (!viewing) setScreen('home')
    } finally {
      setBusy(false)
      setWatchingDeviceId(null)
    }
  }, [controller])

  // Anexa o MediaStream correto ao <video> conforme o papel.
  const activeStream = snapshot.role === 'viewer' ? controller.getRemoteStream() : controller.getLocalStream()
  useEffect(() => {
    const video = videoRef.current
    if (!video || visibleScreen !== 'session') return
    video.srcObject = activeStream
    if (activeStream) void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [visibleScreen, activeStream, snapshot.hasLocalStream, snapshot.hasRemoteStream, snapshot.state])

  // Stable timer: diagnostic updates must not keep restarting the sampling clock.
  useEffect(() => {
    if (!sessionActive) return
    const timer = window.setInterval(() => {
      const current = latestSnapshot.current
      if (current.liveSinceMs !== null) setElapsed(Math.floor((Date.now() - current.liveSinceMs) / 1000))
      historyRef.current.record(current)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [sessionActive])

  useEffect(() => {
    if (snapshot.role !== 'viewer' || !activeStream || !videoRef.current) return
    const video = videoRef.current
    if (!['negotiating', 'reconnecting'].includes(snapshot.state)) return
    let cancelled = false
    const presented = () => { if (!cancelled && video.srcObject === activeStream) controller.confirmVideoPresented(activeStream) }
    const frameCallback = video.requestVideoFrameCallback(presented)
    return () => { cancelled = true; video.cancelVideoFrameCallback(frameCallback) }
  }, [activeStream, snapshot.role, snapshot.state, controller])

  const runSessionAction = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true)
    setFormError(null)
    try { await action() }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Não foi possível concluir a alteração.') }
    finally { setBusy(false) }
  }, [])

  // Overlay do Viewer: visível ao entrar no live; esconde 3s após o último
  // movimento de ponteiro (pokeOverlay é chamado pelos handlers, não por effect).
  const pokeOverlay = useCallback(() => {
    setOverlayVisible(true)
    if (overlayTimer.current !== null) window.clearTimeout(overlayTimer.current)
    overlayTimer.current = window.setTimeout(() => {
      const interacting = stageRef.current?.querySelector('.telae-viewer-controls:hover, :focus-visible, details[open]')
      if (!interacting) setOverlayVisible(false)
    }, 3000)
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === stageRef.current && stageRef.current !== null)
      pokeOverlay()
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [pokeOverlay])

  useEffect(() => {
    if (!viewerLive) return
    const frame = window.requestAnimationFrame(pokeOverlay)
    return () => {
      window.cancelAnimationFrame(frame)
      if (overlayTimer.current !== null) window.clearTimeout(overlayTimer.current)
      overlayTimer.current = null
    }
  }, [viewerLive, pokeOverlay])

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.muted = snapshot.role === 'sharer' ? true : muted
    videoRef.current.volume = volume
  }, [muted, volume, snapshot.role, visibleScreen])

  const toggleFullscreen = useCallback(() => {
    const change = document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen()
    void change?.catch(() => setFormError('Não foi possível abrir a tela cheia. Tente novamente.'))
  }, [])

  const stateLabel: Record<string, string> = {
    idle: 'Pronto',
    preparing: 'Preparando captura…',
    'waiting-for-peer': 'Aguardando seu amigo…',
    joining: 'Localizando transmissão…',
    negotiating: 'Negociando conexão…',
    live: snapshot.role === 'viewer' ? 'Assistindo' : 'Ao vivo',
    reconnecting: 'Reconectando…',
    ended: 'Transmissão terminada',
  }

  const screens = sources.filter((item) => item.kind === 'screen')
  const windowsList = sources.filter((item) => item.kind === 'window')

  return (
    <div className={`${viewerLive ? 'telae-viewer-layout' : visibleScreen === 'picker' ? 'telae-picker-layout' : 'min-h-full'} bg-[#141412] text-[#F1EFE8]`}>
      <header className="telae-header shrink-0 border-b border-[#313029] bg-[#1A1A17]">
        <div className={`mx-auto flex h-16 items-center gap-3 px-6 ${visibleScreen === 'session' ? 'telae-session-header' : 'max-w-[1120px]'}`}>
          <p className="text-[18px] font-semibold tracking-[-0.04em]">Telae<span className="text-[#D8A85C]">.</span></p>
          {appVersion && <span aria-label="Versão instalada" title="Versão instalada" className="telae-version tnum">v{appVersion}</span>}
          <button
            type="button"
            onClick={() => setScreen('profile')}
            disabled={sessionActive}
            title={sessionActive ? 'Encerre a transmissão para alterar seu nome.' : undefined}
            className="telae-press ml-4 flex min-h-[40px] items-center gap-2 rounded-md px-3 text-[13px] text-[#B8B4AA] hover:bg-[#282721] hover:text-[#F1EFE8] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Abrir perfil"
          >
            <UserRound size={16} aria-hidden="true" />
            {profile?.displayName && <span className="max-w-[140px] truncate">{profile.displayName}</span>}
          </button>
        </div>
        <UpdateNotice status={updateStatus} sessionActive={sessionActive} onRetry={() => void window.telae.checkForUpdates()} />
        {connectError && (
          <div className="border-t border-[#313029]">
            <p role="alert" className="mx-auto max-w-[1120px] px-5 py-2 text-xs text-[#FF5D5D]">
              {connectError}{' '}
              <button type="button" onClick={() => profile?.displayName && void connectWithName(profile.displayName)} className="underline">
                Reconectar
              </button>
            </p>
          </div>
        )}
      </header>

      <main id="main-content" className={viewerLive ? 'telae-viewer-main' : visibleScreen === 'picker' ? 'telae-picker-main mx-auto w-full max-w-[1120px] px-6' : `telae-main ${visibleScreen === 'session' ? 'telae-session-main' : 'max-w-[1120px]'} ${visibleScreen === 'home' ? 'telae-home-main' : ''} mx-auto w-full px-6 pb-16 pt-10`}>
        <div aria-live="polite" className="sr-only">
          {stateLabel[snapshot.state] ?? ''}
          {formError ?? snapshot.error ?? sourcesError ?? ''}
        </div>

        {visibleScreen === 'boot' && <p className="mt-10 text-sm text-[#9D9A90]">Abrindo Telae…</p>}

        {visibleScreen === 'setup' && (
          <section aria-labelledby="setup-title" className="mx-auto mt-8 max-w-[480px] rounded-2xl border border-[#313029] bg-[#1C1C19] p-8 shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
            <div aria-hidden="true" className="mb-7 flex h-12 w-12 items-center justify-center rounded-xl border border-[#D8A85C]/35 bg-[#D8A85C]/10 text-[#D8A85C]">
              <UserRound size={23} strokeWidth={1.7} />
            </div>
            <h1 id="setup-title" className="text-[28px] font-semibold leading-tight tracking-tight">
              Como podemos chamar você?
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#B8B4AA]">Seu nome aparecerá para a pessoa com quem você compartilhar a tela.</p>
            {!desktopApiAvailable && (
              <p role="alert" className="mt-4 text-sm text-[#FF5D5D]">
                Abra o aplicativo Telae para continuar.
              </p>
            )}
            <form
              className="mt-7"
              onSubmit={(event) => {
                event.preventDefault()
                void saveName()
              }}
            >
              <label htmlFor="display-name" className="mb-1 block text-xs text-[#9D9A90]">
                Seu nome
              </label>
              <input
                id="display-name"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                maxLength={32}
                autoComplete="off"
                className="h-12 w-full rounded-lg border border-[#4A473E] bg-[#141412] px-4 text-[15px] placeholder:text-[#9D9A90]/60"
                placeholder="Ex.: Nicolas"
              />
              {formError && (
                <p role="alert" className="mt-2 text-sm text-[#FF5D5D]">
                  {formError}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !desktopApiAvailable}
                className="telae-press mt-5 min-h-[48px] w-full rounded-lg bg-[#D8A85C] px-5 text-[15px] font-semibold text-[#141412] disabled:opacity-50"
              >
                {busy ? 'Salvando…' : 'Continuar'}
              </button>
            </form>
          </section>
        )}

        {visibleScreen === 'home' && (
          <section aria-labelledby="home-title" className="telae-panel-enter telae-home">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-[#B8B4AA]">Olá, {profile?.displayName?.split(' ')[0] || 'bem-vindo'}.</p>
                <h1 id="home-title" className="mt-3 max-w-[19ch] text-[clamp(34px,4.5vw,52px)] font-semibold leading-[1.08] tracking-[-0.045em]">
                  Compartilhar a tela ficou simples.
                </h1>
                <p className="mt-5 max-w-[48ch] text-[15px] leading-relaxed text-[#B8B4AA]">
                  Mostre sua tela para seus amigos ou assista a quem estiver ao vivo.
                </p>
              </div>
              {myFriendCode && (
                <div className="telae-my-code flex shrink-0 flex-col items-start gap-2 rounded-xl border border-[#38362E] bg-[#1C1C19] px-4 py-3 sm:items-end">
                  <span className="text-[11px] font-medium tracking-wide text-[#9D9A90]">Seu código de amigo</span>
                  <div className="flex items-center gap-2">
                    <span data-testid="my-friend-code" className="tnum rounded-md border border-[#4A473E] bg-[#141412] px-3 py-1.5 text-sm font-semibold tracking-[0.16em] text-[#F1EFE8]">{myFriendCode}</span>
                    <button type="button" onClick={() => void copyMyFriendCode()} aria-label="Copiar seu código de amigo" title={myCodeCopied ? 'Copiado!' : 'Copiar código'} className="telae-press flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border border-[#38362E] bg-[#282721] text-[#B8B4AA] hover:text-[#F1EFE8]">{myCodeCopied ? <span className="text-xs font-semibold text-[#7FB996]">✓</span> : <Copy size={14} aria-hidden="true" />}</button>
                  </div>
                  <span className="text-[11px] text-[#9D9A90]">Compartilhe para seus amigos te adicionarem.</span>
                </div>
              )}
            </div>

            <div className="telae-home-actions mt-10 grid gap-5 md:grid-cols-[1.35fr_1fr]">
              <section aria-labelledby="share-title" className="telae-share-card flex flex-col rounded-2xl border border-[#4A4031] bg-[#24221D] p-7">
                <ShareIllustration />
                <h2 id="share-title" className="mt-4 text-[24px] font-semibold tracking-[-0.03em]">Mostrar minha tela</h2>
                <p className="mt-2 max-w-[35ch] text-sm leading-relaxed text-[#B8B4AA]">
                  Escolha uma tela ou janela. Seus amigos verão que você está ao vivo e poderão assistir em 1 clique.
                </p>
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={snapshot.signaling !== 'online'}
                  className="telae-press telae-primary-action mt-6 flex min-h-[48px] w-fit items-center gap-3 rounded-lg bg-[#D8A85C] px-5 text-sm font-semibold text-[#141412] hover:bg-[#E8BB75] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Escolher tela <ArrowRight size={17} aria-hidden="true" />
                </button>
              </section>

              <section aria-labelledby="friends-hint-title" className="telae-join-card flex flex-col justify-center rounded-2xl border border-[#313029] bg-[#1C1C19] p-7">
                <div aria-hidden="true" className="telae-join-illustration"><div className="telae-friends-ticket"><Users size={24} strokeWidth={1.5} /><span>Amigos</span></div></div>
                <h2 id="friends-hint-title" className="mt-4 text-[24px] font-semibold tracking-[-0.03em]">Seus amigos ao vivo</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#B8B4AA]">Adicione amigos pelo código de 6 letras. Quando alguém estiver transmitindo, apareça <span className="font-semibold text-[#D8A85C]">Ao vivo</span> abaixo e assista em 1 clique — sem código.</p>
                <p className="mt-4 text-xs text-[#9D9A90]">{friends.filter(f => f.isSharing).length > 0 ? `${friends.filter(f => f.isSharing).length} amigo(s) transmitindo agora.` : 'Nenhum amigo transmitindo no momento.'}</p>
              </section>
            </div>

            <section aria-labelledby="friends-title" className="telae-friends mt-8 rounded-2xl border border-[#2B2A24] bg-[#1C1C19] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h2 id="friends-title" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]"><Users size={16} aria-hidden="true" className="text-[#9D9A90]" /> Seus amigos</h2>
                  <span className="telae-count tnum">{friends.length}</span>
                  {friends.some(f => f.isSharing) && <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D8A85C]/30 bg-[#D8A85C]/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#D8A85C]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#D8A85C]" aria-hidden="true" /> {friends.filter(f => f.isSharing).length} ao vivo</span>}
                </div>
                <div className="flex items-center gap-2">
                  <div role="group" aria-label="Filtrar amigos" className="flex rounded-lg border border-[#313029] bg-[#141412] p-1">
                    <button type="button" aria-pressed={friendFilter === 'all'} onClick={() => setFriendFilter('all')} className={`min-h-[32px] rounded-md px-3 text-xs font-medium ${friendFilter === 'all' ? 'bg-[#282721] text-[#F1EFE8]' : 'text-[#9D9A90] hover:text-[#F1EFE8]'}`}>Todos</button>
                    <button type="button" aria-pressed={friendFilter === 'live'} onClick={() => setFriendFilter('live')} className={`min-h-[32px] rounded-md px-3 text-xs font-medium ${friendFilter === 'live' ? 'bg-[#282721] text-[#F1EFE8]' : 'text-[#9D9A90] hover:text-[#F1EFE8]'}`}>Ao vivo</button>
                  </div>
                  <button type="button" onClick={() => setAddFriendOpen(v => !v)} className="telae-press inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#3A352A] bg-[#24221D] px-3 text-xs font-semibold text-[#D8A85C] hover:bg-[#2E2B22]"><UserPlus size={14} aria-hidden="true" /> Adicionar</button>
                </div>
              </div>

              {addFriendOpen && (
                <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#38362E] bg-[#141412] p-4">
                  <div className="min-w-[180px] flex-1">
                    <label htmlFor="friend-code" className="mb-1.5 block text-xs font-medium text-[#B8B4AA]">Código do amigo (6 caracteres)</label>
                    <input id="friend-code" value={friendCodeInput} onChange={event => setFriendCodeInput(event.target.value.replace(/\s/g, '').toUpperCase())} placeholder="Ex.: ABC234" maxLength={6} autoComplete="off" spellCheck={false} className="telae-code-input tnum h-10 w-full rounded-lg border border-[#4A473E] bg-[#1C1C19] px-3 text-sm tracking-[0.14em] placeholder:text-[#9D9A90]" />
                  </div>
                  <button type="button" onClick={() => void handleAddFriend()} disabled={friendActionBusy || friendCodeInput.trim().length !== 6} className="telae-press min-h-[40px] rounded-lg bg-[#D8A85C] px-5 text-sm font-semibold text-[#141412] hover:bg-[#E8BB75] disabled:opacity-50">{friendActionBusy ? 'Adicionando…' : 'Adicionar'}</button>
                  <button type="button" onClick={() => { setAddFriendOpen(false); setFriendCodeInput(''); setFriendError(null) }} className="telae-press min-h-[40px] rounded-lg border border-[#313029] px-4 text-sm text-[#B8B4AA] hover:text-[#F1EFE8]">Cancelar</button>
                  {(friendError || friendSuccess) && <p role={friendError ? 'alert' : 'status'} className={`w-full text-sm ${friendError ? 'text-[#FF7676]' : 'text-[#7FB996]'}`}>{friendError ?? friendSuccess}</p>}
                </div>
              )}
              {friendError && !addFriendOpen && <p role="alert" className="mt-3 text-sm text-[#FF7676]">{friendError}</p>}
              {friendSuccess && !addFriendOpen && <p role="status" className="mt-3 text-sm text-[#7FB996]">{friendSuccess}</p>}

              {watchError && <p role="alert" className="mt-3 text-sm text-[#FF7676]">{watchError}</p>}

              {friends.length === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed border-[#38362E] bg-[#141412] px-6 py-10 text-center">
                  <div aria-hidden="true" className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[#38362E] bg-[#1C1C19] text-[#9D9A90]"><Users size={18} /></div>
                  <p className="mt-3 text-sm font-medium text-[#F1EFE8]">Nenhum amigo ainda</p>
                  <p className="mx-auto mt-1 max-w-[32ch] text-xs leading-relaxed text-[#9D9A90]">Adicione pelo código de 6 letras que aparece no topo do app do seu amigo. Quando ele estiver transmitindo, você verá <span className="font-semibold text-[#D8A85C]">Ao vivo</span> aqui e poderá assistir em 1 clique.</p>
                  <button type="button" onClick={() => setAddFriendOpen(true)} className="telae-press mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#D8A85C] px-5 text-sm font-semibold text-[#141412]">Adicionar primeiro amigo</button>
                </div>
              ) : (
                <ul className="telae-friends-list mt-5 grid gap-2">
                  {(friendFilter === 'live' ? friends.filter(f => f.isSharing) : friends).length === 0 && friendFilter === 'live' ? (
                    <li className="rounded-xl border border-[#313029] bg-[#141412] px-4 py-8 text-center text-sm text-[#9D9A90]">Nenhum amigo transmitindo agora.</li>
                  ) : (friendFilter === 'live' ? friends.filter(f => f.isSharing) : friends).map(friend => {
                    const live = friend.isSharing
                    return (
                      <li key={friend.friendCode} className={`group flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${live ? 'border-[#4A4031] bg-[#24221D]' : 'border-[#313029] bg-[#141412]'}`}>
                        <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-xs font-semibold ${live ? 'border-[#D8A85C]/35 bg-[#D8A85C]/10 text-[#D8A85C]' : 'border-[#38362E] bg-[#1C1C19] text-[#9D9A90]'}`}>{friend.displayName.trim().slice(0, 1).toLocaleUpperCase('pt-BR') || '?'}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium leading-none">{friend.displayName}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            <span className={`inline-flex items-center gap-1.5 ${live ? 'font-semibold text-[#D8A85C]' : friend.status === 'online' ? 'text-[#7FB996]' : 'text-[#9D9A90]'}`}>
                              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${live ? 'animate-pulse bg-[#D8A85C]' : friend.status === 'online' ? 'bg-[#7FB996]' : 'bg-[#6B6860]'}`} /> {live ? 'Ao vivo' : friend.status === 'online' ? 'Online' : 'Offline'}
                            </span>
                            <span className="tnum text-[#6B6860]">· {friend.friendCode}</span>
                            {live && friend.activeQualityProfile && <span className="rounded bg-[#141412] px-1.5 py-0.5 text-[11px] text-[#9D9A90]">{friend.activeQualityProfile}</span>}
                          </p>
                        </div>
                        <div className="ml-auto flex items-center gap-1.5">
                          {live ? (
                            <button type="button" onClick={() => void handleWatchFriend(friend)} disabled={busy || snapshot.signaling !== 'online'} aria-busy={watchingDeviceId === friend.deviceId} className="telae-press inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#D8A85C] px-4 text-xs font-semibold text-[#141412] hover:bg-[#E8BB75] disabled:opacity-50">{watchingDeviceId === friend.deviceId ? 'Entrando…' : 'Assistir'}</button>
                          ) : (
                            <span className="hidden items-center gap-1 rounded-lg border border-[#313029] bg-[#1C1C19] px-3 py-1.5 text-xs text-[#6B6860] sm:inline-flex"><Search size={12} aria-hidden="true" /> Aguardando transmissão</span>
                          )}
                          {pendingRemoveCode === friend.friendCode ? (
                            <span role="group" aria-label={`Confirmar remoção de ${friend.displayName}`} title="Vocês deixam de poder assistir uma à outra." className="inline-flex flex-wrap items-center gap-1.5 text-xs text-[#E8C690]">
                              Remover {friend.displayName}?
                              <button type="button" onClick={() => void handleRemoveFriend(friend.friendCode)} disabled={friendActionBusy} className="telae-press min-h-[32px] rounded-md bg-[#FF5D5D] px-3 font-semibold text-[#141412] disabled:opacity-50">Remover</button>
                              <button type="button" onClick={() => setPendingRemoveCode(null)} className="telae-press min-h-[32px] rounded-md border border-[#313029] px-3 text-[#B8B4AA] hover:text-[#F1EFE8]">Cancelar</button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setPendingRemoveCode(friend.friendCode)} disabled={friendActionBusy} title="Remover amigo" aria-label={`Remover ${friend.displayName}`} className="telae-press flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-transparent text-[#6B6860] hover:border-[#3A2A22] hover:bg-[#251D19] hover:text-[#FF7676] disabled:opacity-50"><Trash2 size={14} aria-hidden="true" /></button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <div className="telae-home-footer">
              <p className="text-xs text-[#9D9A90]">{updateStatus?.phase === 'current' ? 'Você está na versão mais recente.' : 'As atualizações são instaladas automaticamente pelo app.'}</p>
              <button type="button" onClick={() => void window.telae.checkForUpdates()} disabled={!desktopApiAvailable || ['checking', 'downloading', 'ready', 'installing'].includes(updateStatus?.phase ?? '')} className="telae-press telae-check-update"><RefreshCw size={14} aria-hidden="true" className={updateStatus?.phase === 'checking' ? 'telae-update-spinner' : ''} />{updateStatus?.phase === 'checking' ? 'Buscando atualização…' : 'Buscar atualização'}</button>
            </div>
          </section>
        )}

        {visibleScreen === 'picker' && (
          <section aria-labelledby="picker-title" className="telae-panel-enter telae-picker-section">
            <div className="shrink-0 pb-3 pt-4">
            <button
              type="button"
              onClick={() => setScreen(switchingSource ? 'session' : 'home')}
              className="telae-press flex min-h-[40px] items-center gap-2 rounded-md px-2 text-sm text-[#9D9A90] hover:text-[#F1EFE8]"
            >
              <ArrowLeft size={16} aria-hidden="true" /> Voltar
            </button>
            <h1 id="picker-title" className="mt-2 text-[28px] font-semibold tracking-[-0.035em]">
              O que você quer compartilhar?
            </h1>
            <p className="mt-1 text-sm text-[#9D9A90]">{switchingSource ? 'A transmissão continua ativa durante a troca.' : 'A captura só começa depois da sua confirmação.'} O som de uma janela vem apenas do aplicativo escolhido.</p>
            </div>

            {sourcesLoading && <p className="mt-6 text-sm text-[#9D9A90]">Listando telas e janelas…</p>}

            {sourcesError && (
              <div className="mt-6 rounded-md border border-[#313029] bg-[#1C1C19] p-4">
                <p className="text-sm">{sourcesError}</p>
                <button
                  type="button"
                  onClick={() => void loadSources()}
                  className="telae-press mt-3 min-h-[40px] rounded-md border border-[#313029] bg-[#282721] px-4 text-sm font-semibold"
                >
                  Tentar de novo
                </button>
              </div>
            )}

            {!sourcesLoading && !sourcesError && (
              <>
                <div role="region" aria-label="Fontes disponíveis" tabIndex={0} className="telae-picker-sources min-h-0 flex-1 overflow-y-auto px-1 pb-4">
                  <SourceGroup title="Telas" sources={screens} selectedId={selectedId} onSelect={setSelectedId} />
                  <SourceGroup title="Janelas" sources={windowsList} selectedId={selectedId} onSelect={setSelectedId} />
                </div>

                <div className="telae-picker-actions shrink-0 rounded-xl border border-[#38362E] bg-[#1C1C19] p-4">
                  <p className="telae-selected-source mb-3 truncate text-sm font-medium" title={sources.find(item => item.id === selectedId)?.name}>
                    {sources.find(item => item.id === selectedId)?.name ?? 'Escolha uma tela ou janela acima'}
                  </p>
                  <div className="telae-picker-action-row">
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                    {!switchingSource && <fieldset>
                      <legend className="mb-2 text-xs font-medium text-[#9D9A90]">
                        Qualidade
                      </legend>
                      <div role="radiogroup" aria-label="Qualidade da imagem" className="flex flex-wrap gap-2">
                        {QUALITY_OPTIONS.map((option) => {
                          const active = quality === option.value
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              title={option.hint}
                              onClick={() => setQuality(option.value)}
                              className={`telae-press min-h-[40px] rounded-md border px-3 text-xs font-medium ${
                                active
                                  ? 'border-[#D8A85C] bg-[#282721] text-[#F1EFE8]'
                                  : 'border-[#313029] bg-transparent text-[#9D9A90] hover:text-[#F1EFE8]'
                              }`}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </div>
                    </fieldset>}

                  </div>

                  {formError && (
                    <p role="alert" className="mt-4 text-sm text-[#FF5D5D]">
                      {formError}
                    </p>
                  )}

                  <div className="telae-picker-submit">
                    <button
                      type="button"
                      onClick={() => void handleStartSharing()}
                      disabled={busy || !selectedId}
                      className="telae-press telae-primary-action min-h-[48px] w-full rounded-lg bg-[#D8A85C] px-5 text-sm font-semibold text-[#141412] hover:bg-[#E8BB75] disabled:opacity-50"
                    >
                      {busy ? 'Preparando…' : switchingSource ? 'Trocar fonte agora' : 'Começar a compartilhar'}
                    </button>
                  </div>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {visibleScreen === 'profile' && (
          <section aria-labelledby="profile-title" className="max-w-[520px]">
            <button
              type="button"
              onClick={() => setScreen(profile?.displayName ? 'home' : 'setup')}
              className="telae-press flex min-h-[40px] items-center gap-2 rounded-md px-2 text-sm text-[#9D9A90] hover:text-[#F1EFE8]"
            >
              <ArrowLeft size={16} aria-hidden="true" /> Voltar
            </button>
            <h1 id="profile-title" className="mt-3 text-[28px] font-semibold tracking-tight">
              Seu perfil
            </h1>
            <p className="mt-2 text-sm text-[#B8B4AA]">Esse é o nome que aparece para seus amigos.</p>
            <form
              className="mt-7 rounded-2xl border border-[#313029] bg-[#1C1C19] p-6"
              onSubmit={(event) => {
                event.preventDefault()
                void saveName()
              }}
            >
              <label htmlFor="profile-name" className="mb-2 block text-xs text-[#B8B4AA]">
                Seu nome
              </label>
              <input
                id="profile-name"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                maxLength={32}
                autoComplete="off"
                className="h-12 w-full rounded-lg border border-[#4A473E] bg-[#141412] px-4 text-[15px]"
              />
              {formError && (
                <p role="alert" className="mt-2 text-sm text-[#FF5D5D]">
                  {formError}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="telae-press mt-5 min-h-[44px] rounded-lg bg-[#D8A85C] px-6 text-[15px] font-semibold text-[#141412] disabled:opacity-50"
              >
                {busy ? 'Salvando…' : 'Salvar'}
              </button>
            </form>
          </section>
        )}

        {visibleScreen === 'session' && snapshot.role === 'sharer' && snapshot.state !== 'ended' && (
          <SharerSession
            snapshot={snapshot}
            elapsed={elapsed}
            sourceName={sources.find((item) => item.id === activeSourceId)?.name ?? null}
            videoRef={videoRef}
            onStop={() => void handleLeave()}
            onChangeSource={openSourceSwitch}
            formError={formError}
            busy={busy}
            onQuality={(value, mode) => void runSessionAction(() => controller.setQuality(value, mode))}
            onRemove={(id) => void runSessionAction(() => controller.removeViewer(id))}
          />
        )}

        {visibleScreen === 'session' && snapshot.role === 'viewer' && (
          <div
            ref={stageRef}
            onMouseMove={pokeOverlay}
            onTouchStart={pokeOverlay}
            onKeyDown={(event) => {
              pokeOverlay()
              if (event.key === 'Escape' && document.fullscreenElement) {
                event.preventDefault()
                void document.exitFullscreen().catch(() => undefined)
                return
              }
              if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
              if ((event.target as HTMLElement).closest('input, select, textarea, button, summary')) return
              if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen() }
              if (event.key.toLowerCase() === 'm') { event.preventDefault(); setMuted(previous => !previous) }
            }}
            onFocusCapture={pokeOverlay}
            onBlurCapture={pokeOverlay}
            tabIndex={0}
            aria-label="Player da transmissão. F para tela cheia, M para silenciar."
            className={`telae-panel-enter telae-viewer-stage ${viewerLive && !overlayVisible ? 'telae-viewer-idle' : ''}`}
          >
            {(snapshot.state === 'joining' || snapshot.state === 'negotiating' || snapshot.state === 'reconnecting') && (
              <div className="mx-auto max-w-[520px] py-16 text-center">
                <p className="flex items-center justify-center gap-2 text-[15px]">
                  <Signal size={18} className="text-[#D8A85C]" aria-hidden="true" />
                  {stateLabel[snapshot.state]}
                </p>
                {snapshot.error && (
                  <p role="alert" className="mt-2 text-sm text-[#FF5D5D]">
                    {snapshot.error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleLeave().then(() => setScreen('home'))}
                  className="telae-press mt-6 min-h-[44px] rounded-md border border-[#313029] bg-[#1C1C19] px-6 text-sm font-semibold"
                >
                  Cancelar
                </button>
                <div className="mt-6 flex justify-center">
                  <LiveFriendsSwitch
                    friends={friends}
                    currentSharerDeviceId={snapshot.session?.sharerDeviceId ?? null}
                    pendingDeviceId={watchingDeviceId}
                    disabled={busy || watchingDeviceId !== null}
                    error={watchError}
                    onWatch={(friend) => void handleWatchFriend(friend)}
                  />
                </div>
              </div>
            )}

            {snapshot.hasRemoteStream && (
              <div className="telae-viewer-playback relative">
                <div className="telae-video-canvas telae-viewer-canvas overflow-hidden rounded-[10px] border border-[#313029]">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={muted}
                    onDoubleClick={toggleFullscreen}
                    className={`telae-viewer-video ${fitCover ? 'object-cover' : 'object-contain'}`}
                    aria-label="Transmissão do seu amigo"
                  />
                </div>
                <div
                  aria-label="Controles da transmissão"
                  role="group"
                  onMouseEnter={pokeOverlay}
                  onMouseLeave={pokeOverlay}
                  className={`telae-viewer-controls absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 rounded-b-[10px] bg-black/70 px-4 py-3 transition-opacity duration-200 ${
                    overlayVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <LiveFriendsSwitch
                    friends={friends}
                    currentSharerDeviceId={snapshot.session?.sharerDeviceId ?? null}
                    pendingDeviceId={watchingDeviceId}
                    disabled={busy || watchingDeviceId !== null}
                    error={watchError}
                    onWatch={(friend) => void handleWatchFriend(friend)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (muted || volume === 0) {
                        if (volume === 0) setVolume(0.5)
                        setMuted(false)
                      } else {
                        setMuted(true)
                      }
                    }}
                    className="telae-press flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-[#F1EFE8]"
                    aria-label={muted || volume === 0 ? 'Ativar som' : 'Silenciar'}
                    title={muted || volume === 0 ? 'Ativar som (M)' : 'Silenciar (M)'}
                  >
                    {muted || volume === 0 ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(volume * 100)}
                    onChange={(event) => {
                      setVolume(Number(event.target.value) / 100)
                      if (muted) setMuted(false)
                    }}
                    aria-label="Volume da transmissão"
                    aria-valuetext={`${Math.round(volume * 100)}%`}
                    className="w-24 accent-[#D8A85C] sm:w-32"
                  />
                  <button
                    type="button"
                    onClick={() => setFitCover((previous) => !previous)}
                    className="telae-press min-h-[40px] rounded-md px-3 text-sm text-[#F1EFE8]"
                    aria-pressed={fitCover}
                  >
                    {fitCover ? 'Ajustar' : 'Preencher'}
                  </button>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="telae-press flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-[#F1EFE8]"
                    aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                    title={fullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia (F)'}
                  >
                    {fullscreen ? <Minimize size={18} aria-hidden="true" /> : <Maximize size={18} aria-hidden="true" />}
                  </button>
                    <button
                    type="button"
                    onClick={() => void handleLeave().then(() => setScreen('home'))}
                    className="telae-press ml-auto min-h-[40px] rounded-md bg-[#FF5D5D] px-5 text-sm font-semibold text-[#141412]"
                  >
                    Sair
                  </button>
                </div>
                {formError && <p role="alert" className="absolute left-3 top-3 rounded-md bg-[#1C1C19] px-4 py-3 text-sm text-[#FF5D5D]">{formError}</p>}
              </div>
            )}


          </div>
        )}
        {visibleScreen === 'session' && snapshot.state === 'ended' && (
          <div className="mx-auto max-w-[520px] py-16 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Transmissão terminada</h1>
            {snapshot.error && <p className="mt-2 text-sm text-[#9D9A90]">{snapshot.error}</p>}
            <button
              type="button"
              onClick={() => {
                controller.resetToIdle()
                setScreen('home')
              }}
              className="telae-press mt-6 min-h-[44px] rounded-md bg-[#D8A85C] px-6 text-[15px] font-semibold text-[#141412]"
            >
              Voltar ao início
            </button>
            <div className="mt-8 flex justify-center">
              <LiveFriendsSwitch
                friends={friends}
                currentSharerDeviceId={null}
                pendingDeviceId={watchingDeviceId}
                disabled={busy || watchingDeviceId !== null}
                error={watchError}
                onWatch={(friend) => void handleWatchFriend(friend)}
              />
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
