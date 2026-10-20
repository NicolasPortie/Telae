import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Activity, Maximize, Minimize, Signal, Volume2, VolumeX } from 'lucide-react'
import { t } from '../i18n'
import type { ShareSessionController } from '../services/share-session'
import type { DeviceSnapshot } from '../services/types'
import { LiveFriendsSwitch } from './LiveFriendsSwitch'
import { StreamStats } from './StreamStats'

const OVERLAY_IDLE_MS = 3000

type Props = {
  snapshot: ReturnType<ShareSessionController['getSnapshot']>
  videoRef: RefObject<HTMLVideoElement | null>
  friends: DeviceSnapshot[]
  stateLabel: Record<string, string>
  busy: boolean
  watchingDeviceId: string | null
  watchError: string | null
  live: boolean
  onWatch: (friend: DeviceSnapshot) => void
  onLeave: () => void
}

/** Player do espectador: vídeo, controles que somem sozinhos, volume, tela cheia e estatísticas. */
export function ViewerSession({ snapshot, videoRef, friends, stateLabel, busy, watchingDeviceId, watchError, live, onWatch, onLeave }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const overlayTimer = useRef<number | null>(null)
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [fitCover, setFitCover] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Visível ao entrar no live; esconde 3s após o último movimento de ponteiro
  // (pokeOverlay é chamado pelos handlers, não por effect).
  const pokeOverlay = useCallback(() => {
    setOverlayVisible(true)
    if (overlayTimer.current !== null) window.clearTimeout(overlayTimer.current)
    overlayTimer.current = window.setTimeout(() => {
      const interacting = stageRef.current?.querySelector('.telae-viewer-controls:hover, :focus-visible, details[open]')
      if (!interacting) setOverlayVisible(false)
    }, OVERLAY_IDLE_MS)
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
    if (!live) return
    const frame = window.requestAnimationFrame(pokeOverlay)
    return () => {
      window.cancelAnimationFrame(frame)
      if (overlayTimer.current !== null) window.clearTimeout(overlayTimer.current)
      overlayTimer.current = null
    }
  }, [live, pokeOverlay])

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.muted = muted
    videoRef.current.volume = volume
  }, [muted, volume, snapshot.hasRemoteStream, videoRef])

  const toggleFullscreen = useCallback(() => {
    const change = document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen()
    void change?.catch(() => setError(t('Não foi possível abrir a tela cheia. Tente novamente.')))
  }, [])

  return (
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
        aria-label={t('Player da transmissão. F para tela cheia, M para silenciar, I para estatísticas.')}
        className={`telae-panel-enter telae-viewer-stage ${live && !overlayVisible ? 'telae-viewer-idle' : ''}`}
      >
        {(snapshot.state === 'joining' || snapshot.state === 'negotiating' || snapshot.state === 'reconnecting') && (
          <div className="mx-auto max-w-[520px] py-16 text-center">
            <p className="flex items-center justify-center gap-2.5 text-[15px]">
              <Signal size={18} className="text-signal" aria-hidden="true" />
              {stateLabel[snapshot.state]}
            </p>
            {snapshot.error && <p role="alert" className="mt-2 text-sm text-danger-soft">{snapshot.error}</p>}
            <button type="button" onClick={onLeave} className="telae-press btn btn-secondary btn-lg mt-6">
              {t('Cancelar')}
            </button>
            <div className="mt-6 flex justify-center">
              <LiveFriendsSwitch
                friends={friends}
                currentSharerDeviceId={snapshot.session?.sharerDeviceId ?? null}
                pendingDeviceId={watchingDeviceId}
                disabled={busy || watchingDeviceId !== null}
                error={watchError}
                onWatch={onWatch}
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
                aria-label={t('Transmissão do seu amigo')}
              />
            </div>
            <div
              aria-label={t('Controles da transmissão')}
              role="group"
              onMouseEnter={pokeOverlay}
              onMouseLeave={pokeOverlay}
              className={`telae-viewer-controls absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 rounded-b-xl px-4 py-3 transition-opacity duration-200 ${
                overlayVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <LiveFriendsSwitch
                friends={friends}
                currentSharerDeviceId={snapshot.session?.sharerDeviceId ?? null}
                pendingDeviceId={watchingDeviceId}
                disabled={busy || watchingDeviceId !== null}
                error={watchError}
                onWatch={onWatch}
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
                aria-label={muted || volume === 0 ? t('Ativar som') : t('Silenciar')}
                title={muted || volume === 0 ? t('Ativar som (M)') : t('Silenciar (M)')}
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
                aria-label={t('Volume da transmissão')}
                aria-valuetext={`${Math.round(volume * 100)}%`}
                className="w-24 accent-signal sm:w-32"
              />
              <button
                type="button"
                onClick={() => setFitCover((previous) => !previous)}
                className="telae-press min-h-[40px] rounded-lg px-3 text-sm text-ink"
                aria-pressed={fitCover}
              >
                {fitCover ? t('Ajustar') : t('Preencher')}
              </button>
              <button
                type="button"
                onClick={() => setShowStats(previous => !previous)}
                className={`telae-press flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg ${showStats ? 'bg-active text-signal' : 'text-ink'}`}
                aria-pressed={showStats}
                aria-label={t('Estatísticas da transmissão')}
                title={t('Estatísticas (I)')}
              >
                <Activity size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="telae-press flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-ink"
                aria-label={fullscreen ? t('Sair da tela cheia') : t('Tela cheia')}
                title={fullscreen ? t('Sair da tela cheia (Esc)') : t('Tela cheia (F)')}
              >
                {fullscreen ? <Minimize size={18} aria-hidden="true" /> : <Maximize size={18} aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={onLeave}
                className="telae-press ml-auto min-h-[40px] rounded-lg px-5 text-sm font-semibold"
              >
                {t('Sair')}
              </button>
            </div>
            {showStats && <StreamStats diagnostics={snapshot.diagnostics} connection={snapshot.connectionQuality} className="absolute right-3 top-3 w-[300px] max-w-[calc(100%-24px)]" />}
            {error && <p role="alert" className="absolute left-3 top-3 rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm text-danger-soft">{error}</p>}
          </div>
        )}
      </div>
  )
}
