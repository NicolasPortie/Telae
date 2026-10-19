import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Maximize, Minimize, Signal, Volume2, VolumeX } from 'lucide-react'
import { DiagnosticsHistory } from './services/diagnostics-history'
import { AppHeader } from './components/AppHeader'
import { FriendsPanel } from './components/FriendsPanel'
import { HomeScreen } from './components/HomeScreen'
import { LiveFriendsSwitch } from './components/LiveFriendsSwitch'
import { ProfileScreen, SetupScreen } from './components/NameForm'
import { PickerScreen } from './components/PickerScreen'
import { SharerSession } from './components/SharerSession'
import { StreamStats } from './components/StreamStats'
import { useFriends } from './hooks/useFriends'
import { ShareSessionController } from './services/share-session'
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
  const [showStats, setShowStats] = useState(false)
  const [switchingSource, setSwitchingSource] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [watchingDeviceId, setWatchingDeviceId] = useState<string | null>(null)
  const [watchError, setWatchError] = useState<string | null>(null)

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

  const online = snapshot.signaling === 'online'
  const friendsState = useFriends({ controller, desktopApiAvailable, online, setProfile })

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

  // Término inesperado do renderer interrompe captura e sinalização.
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

  const handleLeave = useCallback(async () => {
    setOverlayVisible(true)
    await controller.leave()
    setScreen('home')
  }, [controller])

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

  return (
    <div className={`telae-shell ${viewerLive ? 'telae-viewer-layout' : visibleScreen === 'picker' ? 'telae-picker-layout' : 'min-h-full'} text-ink`}>
      <AppHeader
        version={appVersion}
        displayName={profile?.displayName}
        profileLocked={sessionActive}
        updateStatus={updateStatus}
        sessionActive={sessionActive}
        connectError={connectError}
        onOpenProfile={() => setScreen('profile')}
        onRetryUpdate={() => void window.telae.checkForUpdates()}
        onReconnect={() => profile?.displayName && void connectWithName(profile.displayName)}
      />

      <main id="main-content" className={viewerLive ? 'telae-viewer-main' : visibleScreen === 'picker' ? 'telae-picker-main mx-auto w-full max-w-[1120px] px-6' : `telae-main ${visibleScreen === 'session' ? 'telae-session-main' : 'max-w-[1120px]'} ${visibleScreen === 'home' ? 'telae-home-main' : ''} mx-auto w-full px-6 pb-16 pt-10`}>
        <div aria-live="polite" className="sr-only">
          {stateLabel[snapshot.state] ?? ''}
          {formError ?? snapshot.error ?? sourcesError ?? ''}
        </div>

        {visibleScreen === 'boot' && <p className="mt-10 text-sm text-ink-3">Abrindo Telae…</p>}

        {visibleScreen === 'setup' && (
          <SetupScreen value={nameInput} onChange={setNameInput} onSubmit={() => void saveName()} busy={busy} error={formError} desktopApiAvailable={desktopApiAvailable} />
        )}

        {visibleScreen === 'home' && (
          <HomeScreen
            displayName={profile?.displayName}
            canShare={online}
            onChooseScreen={openPicker}
            updateStatus={updateStatus}
            canCheckUpdate={desktopApiAvailable}
            onCheckUpdate={() => void window.telae.checkForUpdates()}
            aside={
              <FriendsPanel
                state={friendsState}
                online={online}
                canWatch={!busy && online}
                watchingDeviceId={watchingDeviceId}
                watchError={watchError}
                onWatch={friend => void handleWatchFriend(friend)}
              />
            }
          />
        )}

        {visibleScreen === 'picker' && (
          <PickerScreen
            sources={sources}
            loading={sourcesLoading}
            error={sourcesError}
            selectedId={selectedId}
            onSelect={setSelectedId}
            quality={quality}
            onQuality={setQuality}
            switching={switchingSource}
            busy={busy}
            formError={formError}
            onBack={() => setScreen(switchingSource ? 'session' : 'home')}
            onReload={() => void loadSources()}
            onStart={() => void handleStartSharing()}
          />
        )}

        {visibleScreen === 'profile' && (
          <ProfileScreen
            value={nameInput}
            onChange={setNameInput}
            onSubmit={() => void saveName()}
            busy={busy}
            error={formError}
            onBack={() => setScreen(profile?.displayName ? 'home' : 'setup')}
          />
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
              if (event.key.toLowerCase() === 'i') { event.preventDefault(); setShowStats(previous => !previous) }
            }}
            onFocusCapture={pokeOverlay}
            onBlurCapture={pokeOverlay}
            tabIndex={0}
            aria-label="Player da transmissão. F para tela cheia, M para silenciar, I para estatísticas."
            className={`telae-panel-enter telae-viewer-stage ${viewerLive && !overlayVisible ? 'telae-viewer-idle' : ''}`}
          >
            {(snapshot.state === 'joining' || snapshot.state === 'negotiating' || snapshot.state === 'reconnecting') && (
              <div className="mx-auto max-w-[520px] py-16 text-center">
                <p className="flex items-center justify-center gap-2.5 text-[15px]">
                  <Signal size={18} className="text-signal" aria-hidden="true" />
                  {stateLabel[snapshot.state]}
                </p>
                {snapshot.error && <p role="alert" className="mt-2 text-sm text-danger-soft">{snapshot.error}</p>}
                <button type="button" onClick={() => void handleLeave().then(() => setScreen('home'))} className="telae-press btn btn-secondary btn-lg mt-6">
                  Cancelar
                </button>
                <div className="mt-6 flex justify-center">
                  <LiveFriendsSwitch
                    friends={friendsState.friends}
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
                <div className="telae-video-canvas telae-viewer-canvas overflow-hidden rounded-xl border border-line">
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
                  className={`telae-viewer-controls absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 rounded-b-xl px-4 py-3 transition-opacity duration-200 ${
                    overlayVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <LiveFriendsSwitch
                    friends={friendsState.friends}
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
                    className="telae-press flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-ink"
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
                    className="w-24 accent-signal sm:w-32"
                  />
                  <button
                    type="button"
                    onClick={() => setFitCover((previous) => !previous)}
                    className="telae-press min-h-[40px] rounded-lg px-3 text-sm text-ink"
                    aria-pressed={fitCover}
                  >
                    {fitCover ? 'Ajustar' : 'Preencher'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowStats(previous => !previous)}
                    className={`telae-press flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg ${showStats ? 'bg-active text-signal' : 'text-ink'}`}
                    aria-pressed={showStats}
                    aria-label="Estatísticas da transmissão"
                    title="Estatísticas (I)"
                  >
                    <Activity size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="telae-press flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-ink"
                    aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                    title={fullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia (F)'}
                  >
                    {fullscreen ? <Minimize size={18} aria-hidden="true" /> : <Maximize size={18} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleLeave().then(() => setScreen('home'))}
                    className="telae-press ml-auto min-h-[40px] rounded-lg px-5 text-sm font-semibold"
                  >
                    Sair
                  </button>
                </div>
                {showStats && <StreamStats diagnostics={snapshot.diagnostics} connection={snapshot.connectionQuality} className="absolute right-3 top-3 w-[300px] max-w-[calc(100%-24px)]" />}
                {formError && <p role="alert" className="absolute left-3 top-3 rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm text-danger-soft">{formError}</p>}
              </div>
            )}
          </div>
        )}

        {visibleScreen === 'session' && snapshot.state === 'ended' && (
          <div className="telae-panel-enter mx-auto max-w-[520px] py-16 text-center">
            <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Transmissão terminada</h1>
            {snapshot.error && <p className="mt-2 text-sm text-ink-3">{snapshot.error}</p>}
            <button
              type="button"
              onClick={() => {
                controller.resetToIdle()
                setScreen('home')
              }}
              className="telae-press btn btn-primary btn-lg mt-6"
            >
              Voltar ao início
            </button>
            <div className="mt-8 flex justify-center">
              <LiveFriendsSwitch
                friends={friendsState.friends}
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
