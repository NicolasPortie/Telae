import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getLocale, resolveLocale, setLocale, subscribeLocale, t } from './i18n'
import { DiagnosticsHistory } from './services/diagnostics-history'
import { AppHeader } from './components/AppHeader'
import { FriendsPanel } from './components/FriendsPanel'
import { HomeScreen } from './components/HomeScreen'
import { LiveFriendsSwitch } from './components/LiveFriendsSwitch'
import { SetupScreen } from './components/NameForm'
import { SettingsScreen } from './components/SettingsScreen'
import { PickerScreen } from './components/PickerScreen'
import { SharerSession } from './components/SharerSession'
import { ViewerSession } from './components/ViewerSession'
import { useFriends } from './hooks/useFriends'
import { ShareSessionController } from './services/share-session'
import type { DeviceSnapshot, QualityProfile } from './services/types'
import type { CaptureSource, LocalProfile, UpdateStatus } from './shared/contracts'

type Screen = 'boot' | 'setup' | 'home' | 'picker' | 'session' | 'profile'

export default function App() {
  const [controller] = useState(() => new ShareSessionController())
  // Fica depois do controller porque os testes E2E localizam o App pelo primeiro hook.
  // Re-renderiza a árvore quando o idioma muda; os componentes leem o texto com t().
  const locale = useSyncExternalStore(subscribeLocale, getLocale)
  useEffect(() => { document.documentElement.lang = locale }, [locale])
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
  const [switchingSource, setSwitchingSource] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [watchingDeviceId, setWatchingDeviceId] = useState<string | null>(null)
  const [watchError, setWatchError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
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

  // Idioma salvo (ou o do Windows) antes de desenhar a primeira tela.
  useEffect(() => {
    if (!desktopApiAvailable) return
    void window.telae.getSettings().then(settings => setLocale(resolveLocale(settings.language, navigator.language))).catch(() => undefined)
  }, [desktopApiAvailable])

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
            if (!cancelled) setConnectError(error instanceof Error ? error.message : t('Falha ao conectar.'))
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
        setConnectError(error instanceof Error ? error.message : t('Não foi possível conectar ao Telae.'))
      } finally {
        setBusy(false)
      }
    },
    [controller],
  )

  const saveName = useCallback(async () => {
    if (!desktopApiAvailable) {
      setFormError(t('Abra o aplicativo Telae para continuar.'))
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
        setConnectError(error instanceof Error ? error.message : t('Seu nome foi salvo, mas não foi possível conectar.'))
      }
      setScreen('home')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Não foi possível salvar seu nome.'))
    } finally {
      setBusy(false)
    }
  }, [controller, desktopApiAvailable, nameInput])

  const loadSources = useCallback(async () => {
    if (!desktopApiAvailable) {
      setSourcesError(t('Abra o Telae pelo Electron para listar telas e janelas.'))
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
      if (list.length === 0) setSourcesError(t('Nenhuma tela ou janela encontrada para compartilhar.'))
    } catch (error) {
      setSourcesError(error instanceof Error ? error.message : t('Não foi possível listar suas telas e janelas.'))
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
      setFormError(t('Escolha uma tela ou janela antes de iniciar.'))
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
      setFormError(error instanceof Error ? error.message : t('Não foi possível iniciar.'))
    } finally {
      setBusy(false)
    }
  }, [controller, selectedId, quality, switchingSource])

  const handleLeave = useCallback(async () => {
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
      setWatchError(error instanceof Error ? error.message : t('Não foi possível entrar na transmissão do amigo.'))
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
    catch (error) { setFormError(error instanceof Error ? error.message : t('Não foi possível concluir a alteração.')) }
    finally { setBusy(false) }
  }, [])

  const stateLabel: Record<string, string> = {
    idle: t('Pronto'),
    preparing: t('Preparando captura…'),
    'waiting-for-peer': t('Aguardando seu amigo…'),
    joining: t('Localizando transmissão…'),
    negotiating: t('Negociando conexão…'),
    live: snapshot.role === 'viewer' ? t('Assistindo') : t('Ao vivo'),
    reconnecting: t('Reconectando…'),
    ended: t('Transmissão terminada'),
  }

  return (
    <div className={`telae-shell ${viewerLive ? 'telae-viewer-layout' : visibleScreen === 'picker' ? 'telae-picker-layout' : 'min-h-full'} text-ink`}>
      <AppHeader
        version={appVersion}
        displayName={profile?.displayName}
        connection={snapshot.signaling === 'online' ? 'online' : snapshot.signaling === 'offline' ? 'offline' : 'connecting'}
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

        {visibleScreen === 'boot' && <p className="mt-10 text-sm text-ink-3">{t('Abrindo Telae…')}</p>}

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
          <SettingsScreen
            name={nameInput}
            onNameChange={setNameInput}
            onSaveName={() => void saveName()}
            nameBusy={busy}
            nameError={formError}
            version={appVersion}
            deviceId={profile?.deviceId}
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
          <ViewerSession
            snapshot={snapshot}
            videoRef={videoRef}
            friends={friendsState.friends}
            stateLabel={stateLabel}
            busy={busy}
            watchingDeviceId={watchingDeviceId}
            watchError={watchError}
            live={viewerLive}
            onWatch={friend => void handleWatchFriend(friend)}
            onLeave={() => void handleLeave()}
          />
        )}

        {visibleScreen === 'session' && snapshot.state === 'ended' && (
          <div className="telae-panel-enter mx-auto max-w-[520px] py-16 text-center">
            <h1 className="text-[26px] font-semibold tracking-[-0.03em]">{t('Transmissão terminada')}</h1>
            {snapshot.error && <p className="mt-2 text-sm text-ink-3">{snapshot.error}</p>}
            <button
              type="button"
              onClick={() => {
                controller.resetToIdle()
                setScreen('home')
              }}
              className="telae-press btn btn-primary btn-lg mt-6"
            >
              {t('Voltar ao início')}
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
