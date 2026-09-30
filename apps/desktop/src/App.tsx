import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Check,
  Download,
  LogIn,
  Maximize,
  MonitorUp,
  Signal,
  UserRound,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { ShareSessionController } from './services/share-session'
import type { QualityProfile } from './services/types'
import type { CaptureSource, LocalProfile, UpdateStatus } from './shared/contracts'

type Screen = 'boot' | 'setup' | 'home' | 'picker' | 'session' | 'profile'

const QUALITY_OPTIONS: { value: QualityProfile; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Adapta à rede' },
  { value: '720p60', label: '720p', hint: '720p60 leve' },
  { value: '1080p30', label: '1080p', hint: '1080p30 filmes' },
  { value: '1080p60', label: '1080p60', hint: 'Alta taxa de quadros' },
]

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function qualityLabel(value: QualityProfile): string {
  return QUALITY_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function transportLabel(path: 'direct' | 'relay' | null): string | null {
  if (path === 'direct') return 'Direct'
  if (path === 'relay') return 'Relay'
  return null
}

export default function App() {
  const [controller] = useState(() => new ShareSessionController())
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot())
  const [screen, setScreen] = useState<Screen>('boot')
  const [profile, setProfile] = useState<LocalProfile | null>(null)

  const [sources, setSources] = useState<CaptureSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [quality, setQuality] = useState<QualityProfile>('auto')
  const [includeAudio, setIncludeAudio] = useState(true)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [muted, setMuted] = useState(false)
  const [fitCover, setFitCover] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const overlayTimer = useRef<number | null>(null)
  const samplesRef = useRef<string[]>([])

  const desktopApiAvailable = typeof window !== 'undefined' && typeof window.telae !== 'undefined'

  useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller])

  useEffect(() => {
    if (!desktopApiAvailable) return
    const unsubscribe = window.telae.onUpdateStatus(setUpdateStatus)
    void window.telae.getUpdateStatus().then(setUpdateStatus)
    return unsubscribe
  }, [desktopApiAvailable])

  useEffect(() => {
    if (!desktopApiAvailable) return
    const active = snapshot.role !== null && !['idle', 'ended'].includes(snapshot.state)
    void window.telae.setSessionActive(active)
  }, [desktopApiAvailable, snapshot.role, snapshot.state])

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
        const local = await window.telae.getLocalProfile()
        if (cancelled) return
        setProfile(local)
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
    controller.resetToIdle()
    setFormError(null)
    setSources([])
    setSourcesError(null)
    setScreen('picker')
    void loadSources()
  }, [controller, loadSources])

  const handleStartSharing = useCallback(async () => {
    if (!selectedId) {
      setFormError('Escolha uma tela ou janela antes de iniciar.')
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      await controller.startSharing(selectedId, quality, includeAudio)
      samplesRef.current = []
      setScreen('session')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível iniciar.')
    } finally {
      setBusy(false)
    }
  }, [controller, selectedId, quality, includeAudio])

  const handleJoin = useCallback(async () => {
    setBusy(true)
    setFormError(null)
    try {
      await controller.joinWithInvite(inviteCode)
      samplesRef.current = []
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

  const exportDiagnostics = useCallback(() => {
    const payload = JSON.stringify(
      { exportedAt: new Date().toISOString(), snapshot, samples: samplesRef.current },
      null,
      2,
    )
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `telae-diagnostics-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [snapshot])

  // Anexa o MediaStream correto ao <video> conforme o papel.
  const activeStream = snapshot.role === 'viewer' ? controller.getRemoteStream() : controller.getLocalStream()
  useEffect(() => {
    const video = videoRef.current
    if (!video || screen !== 'session') return
    video.srcObject = activeStream
    if (activeStream) void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [screen, activeStream, snapshot.hasLocalStream, snapshot.hasRemoteStream])

  // Elapsed + amostragem de diagnóstico (1s, Ticket 10).
  useEffect(() => {
    if (screen !== 'session' || snapshot.liveSinceMs === null) {
      return
    }
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - (snapshot.liveSinceMs ?? Date.now())) / 1000))
      if (snapshot.state === 'live') {
        samplesRef.current.push(JSON.stringify({ t: Date.now(), d: snapshot.diagnostics }))
        if (samplesRef.current.length > 300) samplesRef.current.shift()
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [screen, snapshot.liveSinceMs, snapshot.state, snapshot.diagnostics])

  // Overlay do Viewer: visível ao entrar no live; esconde 3s após o último
  // movimento de ponteiro (pokeOverlay é chamado pelos handlers, não por effect).
  const pokeOverlay = useCallback(() => {
    setOverlayVisible(true)
    if (overlayTimer.current !== null) window.clearTimeout(overlayTimer.current)
    overlayTimer.current = window.setTimeout(() => setOverlayVisible(false), 3000)
  }, [])

  // Escape encerra a sessão.
  useEffect(() => {
    if (screen !== 'session') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void handleLeave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, handleLeave])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = snapshot.role === 'sharer' ? true : muted
  }, [muted, snapshot.role, screen])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stageRef.current?.requestFullscreen().catch(() => undefined)
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

  const selectedSource = sources.find((item) => item.id === selectedId) ?? null
  const screens = sources.filter((item) => item.kind === 'screen')
  const windowsList = sources.filter((item) => item.kind === 'window')

  return (
    <div className="min-h-full bg-[#141412] text-[#F1EFE8]">
      <header className="border-b border-[#313029] bg-[#1A1A17]">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-6">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#D8A85C]/35 bg-[#D8A85C]/10 text-[#D8A85C]">
            <MonitorUp size={17} strokeWidth={1.8} />
          </span>
          <p className="text-[16px] font-semibold tracking-tight">Telae</p>
          <button
            type="button"
            onClick={() => setScreen('profile')}
            disabled={screen === 'session'}
            title={screen === 'session' ? 'Encerre a transmissão para alterar seu nome.' : undefined}
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
        {updateStatus && ['downloading', 'ready'].includes(updateStatus.phase) && (
          <div className="border-t border-[#313029] bg-[#282721]">
            <div role="status" className="mx-auto flex max-w-[1120px] items-center gap-3 px-5 py-2 text-xs text-[#F1EFE8]">
              <span>
                {updateStatus.phase === 'downloading' && `Baixando Telae ${updateStatus.version}: ${updateStatus.percent}%`}
                {updateStatus.phase === 'ready' && `Telae ${updateStatus.version} pronto. A instalação começa ao encerrar a transmissão.`}
              </span>
            </div>
          </div>
        )}
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

      <main className="mx-auto w-full max-w-[1040px] px-6 pb-16 pt-10">
        <div aria-live="polite" className="sr-only">
          {stateLabel[snapshot.state] ?? ''}
          {formError ?? snapshot.error ?? sourcesError ?? ''}
        </div>

        {screen === 'boot' && <p className="mt-10 text-sm text-[#9D9A90]">Abrindo Telae…</p>}

        {screen === 'setup' && (
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

        {screen === 'home' && (
          <section aria-labelledby="home-title" className="telae-panel-enter">
            <p className="text-sm text-[#B8B4AA]">Olá, {profile?.displayName?.split(' ')[0] || 'bem-vindo'}.</p>
            <h1 id="home-title" className="mt-2 max-w-[20ch] text-[clamp(30px,4vw,42px)] font-semibold leading-[1.12] tracking-tight">
              Compartilhar a tela ficou simples.
            </h1>
            <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-[#B8B4AA]">
              Mostre sua tela a um amigo ou entre com o código que ele enviou.
            </p>

            <div className="mt-9 grid gap-5 md:grid-cols-[1.25fr_1fr]">
              <section aria-labelledby="share-title" className="flex min-h-[280px] flex-col rounded-2xl border border-[#4A4031] bg-[#24221D] p-7">
                <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#D8A85C]/15 text-[#D8A85C]">
                  <MonitorUp size={25} strokeWidth={1.7} />
                </span>
                <h2 id="share-title" className="mt-7 text-[22px] font-semibold tracking-tight">Mostrar minha tela</h2>
                <p className="mt-2 max-w-[35ch] text-sm leading-relaxed text-[#B8B4AA]">
                  Escolha uma tela ou janela e envie o código de convite para quem vai assistir.
                </p>
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={snapshot.signaling !== 'online'}
                  className="telae-press mt-auto flex min-h-[48px] w-fit items-center gap-3 rounded-lg bg-[#D8A85C] px-5 text-sm font-semibold text-[#141412] hover:bg-[#E8BB75] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Escolher tela <ArrowRight size={17} aria-hidden="true" />
                </button>
              </section>

              <form
                className="flex min-h-[280px] flex-col rounded-2xl border border-[#313029] bg-[#1C1C19] p-7"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleJoin()
                }}
              >
                <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#3C3A33] text-[#B8B4AA]">
                  <LogIn size={24} strokeWidth={1.7} />
                </span>
                <h2 className="mt-7 text-[22px] font-semibold tracking-tight">Assistir a um amigo</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#B8B4AA]">Digite o código recebido para entrar na transmissão.</p>
                <label htmlFor="invite-code" className="mb-2 mt-5 block text-xs font-medium text-[#B8B4AA]">
                  Código de convite
                </label>
                <div className="flex gap-2">
                  <input
                    id="invite-code"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                    placeholder="Ex.: K7Q2XAP9"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-12 min-w-0 flex-1 rounded-lg border border-[#4A473E] bg-[#141412] px-3 text-sm tracking-[0.12em] placeholder:text-[#77746C]"
                  />
                  <button
                    type="submit"
                    disabled={busy || snapshot.signaling !== 'online' || !inviteCode.trim()}
                    className="telae-press h-12 shrink-0 rounded-lg border border-[#5B5140] px-5 text-sm font-semibold text-[#F1EFE8] hover:bg-[#282721] disabled:opacity-50"
                  >
                    {busy ? 'Entrando…' : 'Entrar'}
                  </button>
                </div>
                {formError && <p role="alert" className="mt-3 text-sm text-[#FF7676]">{formError}</p>}
              </form>
            </div>
          </section>
        )}

        {screen === 'picker' && (
          <section aria-labelledby="picker-title" className="telae-panel-enter">
            <button
              type="button"
              onClick={() => setScreen('home')}
              className="telae-press flex min-h-[40px] items-center gap-2 rounded-md px-2 text-sm text-[#9D9A90] hover:text-[#F1EFE8]"
            >
              <ArrowLeft size={16} aria-hidden="true" /> Voltar
            </button>
            <h1 id="picker-title" className="mt-2 text-2xl font-semibold tracking-tight">
              O que você quer compartilhar?
            </h1>
            <p className="mt-1 text-sm text-[#9D9A90]">A captura só começa depois da sua confirmação. Nada é transmitido em silêncio.</p>

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
                <SourceGroup title="Telas" sources={screens} selectedId={selectedId} onSelect={setSelectedId} />
                <SourceGroup title="Janelas" sources={windowsList} selectedId={selectedId} onSelect={setSelectedId} />

                <div className="mt-6 rounded-[10px] border border-[#313029] bg-[#1C1C19] p-4">
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                    <fieldset>
                      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#9D9A90]">
                        Qualidade da imagem
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
                              className={`telae-press min-h-[40px] rounded-md border px-4 text-sm font-semibold ${
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
                    </fieldset>

                    <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={includeAudio}
                        onChange={(event) => setIncludeAudio(event.target.checked)}
                        className="h-4 w-4 accent-[#D8A85C]"
                      />
                      <span>
                        Incluir áudio do sistema
                        <span className="block text-xs text-[#9D9A90]">Quando suportado pela fonte</span>
                      </span>
                    </label>
                  </div>

                  {formError && (
                    <p role="alert" className="mt-4 text-sm text-[#FF5D5D]">
                      {formError}
                    </p>
                  )}

                  <div className="mt-4 border-t border-[#313029] pt-4">
                    <button
                      type="button"
                      onClick={() => void handleStartSharing()}
                      disabled={busy || !selectedId}
                      className="telae-press min-h-[44px] w-full rounded-md bg-[#D8A85C] px-5 text-[15px] font-semibold text-[#141412] disabled:opacity-50"
                    >
                      {busy ? 'Iniciando…' : 'Compartilhar e gerar convite'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {screen === 'profile' && (
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
            {updateStatus?.phase === 'error' && (
              <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-[#4A4031] bg-[#24221D] px-5 py-4 text-sm">
                <p>Não foi possível verificar atualizações agora.</p>
                <button type="button" className="shrink-0 font-semibold text-[#D8A85C] underline" onClick={() => void window.telae.checkForUpdates()}>
                  Tentar novamente
                </button>
              </div>
            )}
          </section>
        )}

        {screen === 'session' && snapshot.role === 'sharer' && (
          <SharerSession
            snapshot={snapshot}
            elapsed={elapsed}
            sourceName={selectedSource?.name ?? null}
            videoRef={videoRef}
            copied={copied}
            onCopyInvite={copyInvite}
            onStop={() => void handleLeave()}
            onChangeSource={() => {
              void handleLeave().then(openPicker)
            }}
            onExport={exportDiagnostics}
            formError={formError}
          />
        )}

        {screen === 'session' && snapshot.role === 'viewer' && (
          <div
            ref={stageRef}
            onMouseMove={pokeOverlay}
            onTouchStart={pokeOverlay}
            className="telae-panel-enter"
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

            {snapshot.state === 'live' && (
              <div className="relative">
                <div className="telae-video-canvas overflow-hidden rounded-[10px] border border-[#313029]">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={muted}
                    className={`h-[calc(100vh-240px)] min-h-[320px] w-full ${fitCover ? 'object-cover' : 'object-contain'}`}
                    aria-label="Transmissão do seu amigo"
                  />
                </div>
                <div
                  className={`absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 rounded-b-[10px] bg-black/70 px-4 py-3 transition-opacity duration-200 ${
                    overlayVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setMuted((previous) => !previous)}
                    className="telae-press flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-[#F1EFE8]"
                    aria-label={muted ? 'Ativar som' : 'Silenciar'}
                  >
                    {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
                  </button>
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
                    aria-label="Tela cheia"
                  >
                    <Maximize size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleLeave().then(() => setScreen('home'))}
                    className="telae-press ml-auto min-h-[40px] rounded-md bg-[#FF5D5D] px-5 text-sm font-semibold text-[#141412]"
                  >
                    Sair
                  </button>
                </div>
              </div>
            )}

            {snapshot.state === 'ended' && (
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
          </div>
        )}
      </main>
    </div>
  )
}

function SharerSession({
  snapshot,
  elapsed,
  sourceName,
  videoRef,
  copied,
  onCopyInvite,
  onStop,
  onChangeSource,
  onExport,
  formError,
}: {
  snapshot: ReturnType<ShareSessionController['getSnapshot']>
  elapsed: number
  sourceName: string | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  copied: boolean
  onCopyInvite: () => void
  onStop: () => void
  onChangeSource: () => void
  onExport: () => void
  formError: string | null
}) {
  return (
    <section aria-labelledby="sharer-title" className="telae-panel-enter">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 id="sharer-title" className="text-2xl font-semibold tracking-tight">
          {snapshot.state === 'live' ? 'Você está compartilhando' : 'Preparando transmissão'}
        </h1>
        {snapshot.liveSinceMs !== null && (
          <p className="tnum text-sm text-[#9D9A90]" aria-label="Tempo decorrido">
            {formatElapsed(elapsed)}
          </p>
        )}
        <p className="ml-auto flex items-center gap-2 text-xs text-[#9D9A90]">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#D8A85C]" />
          {snapshot.state === 'live'
            ? `Ao vivo · ${qualityLabel(snapshot.quality)}`
            : 'Aguardando seu amigo…'}
        </p>
      </div>

      {(snapshot.state === 'waiting-for-peer' || snapshot.state === 'negotiating' || snapshot.state === 'reconnecting') && (
        <div className="mt-4 rounded-[10px] border border-[#D8A85C]/50 bg-[#1C1C19] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#9D9A90]">
            Código de convite {snapshot.inviteExpiresAt && '(expira em ~10 min)'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="tnum text-3xl font-semibold tracking-[0.14em]" aria-label={`Código de convite ${snapshot.inviteCode ?? ''}`}>
              {snapshot.inviteCode ?? '…'}
            </p>
            <button
              type="button"
              onClick={onCopyInvite}
              disabled={!snapshot.inviteCode}
              className="telae-press flex min-h-[40px] items-center gap-2 rounded-md border border-[#313029] bg-[#282721] px-4 text-sm font-semibold disabled:opacity-50"
            >
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="mt-2 text-[13px] text-[#9D9A90]">
            {snapshot.viewerPresence === 'gone'
              ? 'Seu amigo saiu. Encerre esta transmissão para gerar um novo código.'
              : 'Envie este código para a pessoa que vai assistir.'}
          </p>
          {snapshot.error && (
            <p role="alert" className="mt-2 text-sm text-[#FF5D5D]">
              {snapshot.error}
            </p>
          )}
        </div>
      )}

      {snapshot.state === 'live' && (
        <>
          <div className="telae-video-canvas mt-4 overflow-hidden rounded-[10px] border border-[#313029]">
            <video
              ref={videoRef}
              muted
              autoPlay
              playsInline
              className="aspect-video w-full object-contain"
              aria-label={`Pré-visualização de ${sourceName ?? 'sua tela'}`}
            />
          </div>
          <p className="mt-2 truncate text-[13px] text-[#9D9A90]">
            Compartilhando: {sourceName ?? '—'} · Assistindo: {snapshot.viewerName ?? '—'}
          </p>
        </>
      )}

      {formError && (
        <p role="alert" className="mt-4 text-sm text-[#FF5D5D]">
          {formError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onStop}
          className="telae-press flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-md bg-[#FF5D5D] px-6 text-[15px] font-semibold text-[#141412]"
        >
          <Square size={16} aria-hidden="true" /> Parar transmissão
        </button>
        <button
          type="button"
          onClick={onChangeSource}
          className="telae-press min-h-[48px] rounded-md border border-[#313029] bg-[#1C1C19] px-6 text-sm font-semibold"
        >
          Trocar fonte
        </button>
      </div>

      <details className="mt-4 rounded-md border border-[#313029] bg-[#1C1C19]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#9D9A90]">Detalhes da conexão</summary>
        <DiagnosticsBody snapshot={snapshot} onExport={onExport} />
      </details>
    </section>
  )
}

function DiagnosticsBody({
  snapshot,
  onExport,
}: {
  snapshot: ReturnType<ShareSessionController['getSnapshot']>
  onExport: () => void
}) {
  const d = snapshot.diagnostics
  const rows: [string, string][] = [
    ['State', snapshot.state],
    ['Transport Path', transportLabel(snapshot.transportPath) ?? '—'],
    ['Quality Profile', qualityLabel(snapshot.quality)],
    ['Resolução', d.width && d.height ? `${d.width}×${d.height}` : '—'],
    ['Quadros/s', d.framesPerSecond !== null ? String(Math.round(d.framesPerSecond)) : '—'],
    ['Bitrate', `${d.bitrateKbps} kbps`],
    ['RTT', d.roundTripMs !== null ? `${d.roundTripMs} ms` : '—'],
    ['Perda', d.packetLossPercent !== null ? `${d.packetLossPercent.toFixed(1)}%` : '—'],
    ['Jitter', d.jitterMs !== null ? `${d.jitterMs} ms` : '—'],
    ['Codec', d.codec ?? '—'],
    ['Candidato', d.candidateType ?? '—'],
    ['Áudio', snapshot.includeAudio ? 'incluído' : 'desligado'],
  ]
  return (
    <div className="border-t border-[#313029] px-4 py-3">
      <dl className="tnum grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt className="text-[#9D9A90]">{term}</dt>
            <dd className="truncate">{value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={onExport}
        className="telae-press mt-3 flex min-h-[40px] items-center gap-2 rounded-md border border-[#313029] bg-[#282721] px-4 text-sm font-semibold"
      >
        <Download size={15} aria-hidden="true" /> Exportar diagnóstico (JSON)
      </button>
    </div>
  )
}

function SourceGroup({
  title,
  sources,
  selectedId,
  onSelect,
}: {
  title: string
  sources: CaptureSource[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  if (sources.length === 0) return null
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#9D9A90]">{title}</h2>
      <ul role="radiogroup" aria-label={title} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sources.map((source) => {
          const active = source.id === selectedId
          return (
            <li key={source.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(source.id)}
                className={`telae-press block w-full overflow-hidden rounded-[10px] border bg-[#000000] text-left ${
                  active ? 'border-[#D8A85C]' : 'border-[#313029] hover:border-[#9D9A90]'
                }`}
              >
                {source.thumbnailDataUrl ? (
                  <img src={source.thumbnailDataUrl} alt="" aria-hidden="true" draggable={false} className="aspect-video w-full object-cover" />
                ) : (
                  <span aria-hidden="true" className="block aspect-video w-full bg-[#1C1C19]" />
                )}
                <span
                  className={`block truncate border-t px-3 py-2 text-[13px] ${
                    active ? 'border-[#D8A85C] bg-[#282721] font-semibold text-[#F1EFE8]' : 'border-[#313029] text-[#9D9A90]'
                  }`}
                >
                  {source.name}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
