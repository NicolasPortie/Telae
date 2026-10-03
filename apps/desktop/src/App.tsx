import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  LogIn,
  Maximize,
  Minimize,
  MonitorUp,
  RefreshCw,
  Signal,
  UserRound,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { DiagnosticsHistory } from './services/diagnostics-history'
import { UpdateNotice } from './components/UpdateNotice'
import { SharerSession } from './components/SharerSession'
import { SourceGroup } from './components/SourceGroup'
import { ShareIllustration } from './components/ShareIllustration'
import { QUALITY_OPTIONS, formatElapsed } from './ui/format'
import { ShareSessionController } from './services/share-session'
import type { QualityProfile } from './services/types'
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
  const [inviteCode, setInviteCode] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [copied, setCopied] = useState(false)
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

  const handleJoin = useCallback(async () => {
    setBusy(true)
    setFormError(null)
    try {
      await controller.joinWithInvite(inviteCode)
      historyRef.current.reset()
      setScreen('session')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível entrar.')
    } finally {
      setBusy(false)
    }
  }, [controller, inviteCode])

  const handleLeave = useCallback(async () => {
    setOverlayVisible(true)
    await controller.leave()
    setScreen('home')
  }, [controller])

  const copyInvite = useCallback(async () => {
    if (!snapshot.inviteCode) return
    try {
      await navigator.clipboard.writeText(snapshot.inviteCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setFormError('Não foi possível copiar. Anote o código manualmente.')
    }
  }, [snapshot.inviteCode])

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
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-6">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#D8A85C]/35 bg-[#D8A85C]/10 text-[#D8A85C]">
            <MonitorUp size={17} strokeWidth={1.8} />
          </span>
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
          <p className="tnum ml-auto flex items-center gap-2 text-xs text-[#B8B4AA]">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${snapshot.signaling === 'online' ? 'bg-[#7FB996]' : 'bg-[#D8A85C]'}`} />
            {snapshot.state === 'live' && snapshot.liveSinceMs !== null
              ? `Ao vivo · ${formatElapsed(elapsed)}`
              : snapshot.signaling === 'connecting' || snapshot.signaling === 'reconnecting'
                ? 'Conectando…'
                : snapshot.signaling === 'offline' && profile?.displayName
                  ? 'Sem conexão'
                  : (stateLabel[snapshot.state] ?? 'Pronto')}
          </p>
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

      <main id="main-content" className={viewerLive ? 'telae-viewer-main' : visibleScreen === 'picker' ? 'telae-picker-main mx-auto w-full max-w-[1120px] px-6' : `telae-main ${visibleScreen === 'home' ? 'telae-home-main' : ''} mx-auto w-full max-w-[1120px] px-6 pb-16 pt-10`}>
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
            <p className="text-sm text-[#B8B4AA]">Olá, {profile?.displayName?.split(' ')[0] || 'bem-vindo'}.</p>
            <h1 id="home-title" className="mt-3 max-w-[19ch] text-[clamp(34px,4.5vw,52px)] font-semibold leading-[1.08] tracking-[-0.045em]">
              Compartilhar a tela ficou simples.
            </h1>
            <p className="mt-5 max-w-[48ch] text-[15px] leading-relaxed text-[#B8B4AA]">
              Mostre sua tela ou entre com um convite para assistir.
            </p>

            <div className="telae-home-actions mt-10 grid gap-5 md:grid-cols-[1.35fr_1fr]">
              <section aria-labelledby="share-title" className="telae-share-card flex flex-col rounded-2xl border border-[#4A4031] bg-[#24221D] p-7">
                <ShareIllustration />
                <h2 id="share-title" className="mt-4 text-[24px] font-semibold tracking-[-0.03em]">Mostrar minha tela</h2>
                <p className="mt-2 max-w-[35ch] text-sm leading-relaxed text-[#B8B4AA]">
                  Escolha uma tela ou janela e envie o código de convite para quem vai assistir.
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

              <form
                className="telae-join-card flex flex-col rounded-2xl border border-[#313029] bg-[#1C1C19] p-7"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleJoin()
                }}
              >
                <div aria-hidden="true" className="telae-join-illustration"><div className="telae-invite-ticket"><LogIn size={24} strokeWidth={1.5} /><span>•••• ••••</span></div></div>
                <h2 className="mt-4 text-[24px] font-semibold tracking-[-0.03em]">Assistir a um amigo</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#B8B4AA]">Digite o código recebido para entrar na transmissão.</p>
                <label htmlFor="invite-code" className="mb-3 mt-5 block text-xs font-medium text-[#B8B4AA]">
                  Código de convite
                </label>
                <div className="flex gap-2">
                  <input
                    id="invite-code"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value.replace(/\s/g, '').toUpperCase())}
                    placeholder="Ex.: K7Q2XAP9"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="invite-code-hint"
                    maxLength={8}
                    className="telae-code-input tnum h-12 min-w-0 flex-1 rounded-lg border border-[#4A473E] bg-[#141412] px-3 text-sm tracking-[0.12em] placeholder:text-[#9D9A90]"
                  />
                  <button
                    type="submit"
                    disabled={busy || snapshot.signaling !== 'online' || inviteCode.length !== 8}
                    className="telae-press h-12 shrink-0 rounded-lg border border-[#5B5140] px-5 text-sm font-semibold text-[#F1EFE8] hover:bg-[#282721] disabled:opacity-50"
                  >
                    {busy ? 'Entrando…' : 'Entrar'}
                  </button>
                </div>
                <p id="invite-code-hint" className="mt-3 text-xs text-[#9D9A90]">O convite tem 8 caracteres. Você pode colar o código aqui.</p>
                {formError && <p role="alert" className="mt-3 text-sm text-[#FF7676]">{formError}</p>}
              </form>
            </div>
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
            <p className="mt-1 text-sm text-[#9D9A90]">{switchingSource ? 'A transmissão e o código continuam ativos durante a troca.' : 'A captura só começa depois da sua confirmação.'} O som de uma janela vem apenas do aplicativo escolhido.</p>
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
                      {busy ? 'Preparando…' : switchingSource ? 'Trocar fonte agora' : 'Compartilhar e gerar convite'}
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
            copied={copied}
            onCopyInvite={copyInvite}
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
          </div>
        )}

      </main>
    </div>
  )
}
