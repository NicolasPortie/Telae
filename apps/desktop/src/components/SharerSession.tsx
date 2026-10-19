import { Monitor, Square, Users, X } from 'lucide-react'
import type { ShareSessionController } from '../services/share-session'
import type { ContentMode, QualityProfile } from '../services/types'
import { qualityContentMode } from '../services/quality-profiles'
import { formatElapsed, QUALITY_OPTIONS } from '../ui/format'
import { StreamStats } from './StreamStats'

export function SharerSession({
  snapshot, elapsed, sourceName, videoRef,
  onStop, onChangeSource, formError, busy, onQuality, onRemove,
}: {
  snapshot: ReturnType<ShareSessionController['getSnapshot']>
  elapsed: number
  sourceName: string | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  onStop: () => void
  onChangeSource: () => void
  formError: string | null
  busy: boolean
  onQuality: (quality: QualityProfile, mode: ContentMode) => void
  onRemove: (deviceId: string) => void
}) {
  const controlsDisabled = busy || !snapshot.hasLocalStream || snapshot.state === 'ended'
  const status = snapshot.state === 'live' ? 'Ao vivo'
    : snapshot.state === 'preparing' ? 'Preparando transmissão…'
    : snapshot.state === 'reconnecting' ? 'Restabelecendo conexão…'
    : snapshot.state === 'negotiating' ? 'Conectando seu amigo…'
    : 'Aguardando seu amigo…'

  return (
    <section aria-labelledby="sharer-title" className="telae-panel-enter telae-session">
      <div className="telae-session-heading">
        <div>
          <p className="eyebrow">Sua transmissão</p>
          <h1 id="sharer-title" className="mt-2.5 text-[clamp(24px,3vw,32px)] font-semibold leading-tight tracking-[-0.04em]">
            {snapshot.state === 'preparing' ? 'Preparando transmissão' : 'Você está compartilhando'}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-2">
            <p role="status" className="flex items-center gap-2">
              <span aria-hidden="true" className={`telae-status-dot ${snapshot.state === 'live' ? 'is-live' : ''}`} />
              {status}
            </p>
            {snapshot.liveSinceMs !== null && <span aria-label="Tempo decorrido" className="tnum border-l border-line pl-3 font-mono">{formatElapsed(elapsed)}</span>}
          </div>
        </div>
        <button type="button" onClick={onStop} className="telae-press btn btn-danger btn-lg">
          <Square size={14} aria-hidden="true" /> Parar transmissão
        </button>
      </div>

      <div className="telae-session-grid">
        <div className="min-w-0">
          {snapshot.hasLocalStream ? (
            <figure className="telae-preview">
              <div className="telae-video-canvas telae-preview-canvas">
                <video ref={videoRef} muted autoPlay playsInline className="telae-preview-video" aria-label={`Pré-visualização de ${sourceName ?? 'sua tela'}`} />
                <span aria-hidden="true" className="telae-preview-label">Sua prévia</span>
              </div>
              <figcaption className="telae-preview-toolbar">
                <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <Monitor size={16} aria-hidden="true" className="shrink-0 text-ink-3" />
                  <span title={sourceName ?? undefined} className="truncate">{sourceName ?? 'Sua tela'}</span>
                </div>
                <button type="button" onClick={onChangeSource} disabled={controlsDisabled} className="telae-press telae-text-button">Trocar fonte</button>
                <div aria-busy={busy} className="telae-quality-control">
                  <label htmlFor="stream-quality" className="text-xs text-ink-3">Qualidade</label>
                  <select id="stream-quality" aria-label="Qualidade da transmissão" value={snapshot.quality} disabled={controlsDisabled} onChange={event => {
                    const profile = event.target.value as QualityProfile
                    onQuality(profile, qualityContentMode(profile))
                  }}>
                    {QUALITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.resolution} · {option.fps}</option>)}
                  </select>
                </div>
              </figcaption>
            </figure>
          ) : (
            <div className="telae-preview-placeholder" role="status"><Monitor size={32} aria-hidden="true" /><p>Preparando sua tela…</p></div>
          )}
          <p role="status" aria-live="polite" className="mt-3 text-xs text-signal-soft">{busy ? 'Aplicando alterações…' : ''}</p>
          {snapshot.state === 'live' && (snapshot.diagnostics.qualityLimitationReason === 'cpu' || snapshot.diagnostics.qualityLimitationReason === 'bandwidth') && (
            <p role="status" className="notice mt-3">
              {snapshot.diagnostics.qualityLimitationReason === 'cpu'
                ? 'A qualidade foi reduzida automaticamente para aliviar o processador. Um perfil mais leve pode manter a imagem mais estável.'
                : 'A qualidade foi reduzida automaticamente pela capacidade da rede. Um perfil mais leve pode manter a imagem mais estável.'}
            </p>
          )}
          {snapshot.hasLocalStream && !snapshot.includeAudio && snapshot.state !== 'ended' && (
            <p role="status" className="notice mt-3">
              {snapshot.audioBuffer?.error ? 'O som foi interrompido. Sua tela continua sendo compartilhada.' : 'Esta fonte está sendo compartilhada sem som.'} Para compartilhar com som, troque a fonte.
            </p>
          )}
          {formError && <p role="alert" className="mt-3 text-sm text-danger-soft">{formError}</p>}
          {snapshot.error && <p role="alert" className="mt-3 text-sm text-danger-soft">{snapshot.error}</p>}
        </div>

        <aside className="telae-session-sidebar" aria-label="Espectadores">
          {snapshot.state !== 'ended' && (
            <section className="telae-live-card" aria-labelledby="live-title">
              <div className="flex items-center gap-2 text-signal">
                <Users size={16} aria-hidden="true" /><h2 id="live-title" className="text-sm font-semibold">Ao vivo para seus amigos</h2>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">Seus amigos veem <span className="font-semibold text-signal">Ao vivo</span> na lista e entram em 1 clique — sem código.</p>
              <p className="mt-3 text-center text-xs text-ink-3">Até 12 amigos ao mesmo tempo</p>
            </section>
          )}

          <section aria-label="Espectadores" className="telae-audience">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-medium">Espectadores</h2><span className="count tnum">{snapshot.viewers.length}</span></div>
            {snapshot.viewers.length === 0 ? (
              <div className="telae-audience-empty">
                <span aria-hidden="true" className="telae-empty-icon"><Users size={22} strokeWidth={1.5} /></span>
                <p className="text-sm text-ink-2">Tudo pronto para receber.</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-3">Seus amigos aparecem aqui quando entrarem.</p>
              </div>
            ) : (
              <>
                <p className="mt-2 text-xs text-ink-3">{snapshot.viewerCount} {snapshot.viewerCount === 1 ? 'pessoa conectada' : 'pessoas conectadas'}</p>
                <ul className="telae-audience-list">
                  {snapshot.viewers.map(viewer => (
                    <li key={viewer.deviceId} className="telae-audience-person">
                      <span aria-hidden="true" className="avatar h-9 w-9">{viewer.displayName.trim().slice(0, 1).toLocaleUpperCase('pt-BR')}</span>
                      <div className="min-w-0 flex-1"><p title={viewer.displayName} className="truncate text-sm font-medium">{viewer.displayName}</p><p className="mt-1 text-xs text-ink-3">{viewer.state === 'connected' ? 'Assistindo' : viewer.state === 'failed' || viewer.state === 'disconnected' ? 'Reconectando…' : 'Entrando…'}</p></div>
                      <button type="button" disabled={busy} aria-label={`Remover ${viewer.displayName}`} title={`Remover ${viewer.displayName}`} onClick={() => onRemove(viewer.deviceId)} className="telae-press telae-remove-button"><X size={16} aria-hidden="true" /></button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          {snapshot.state === 'live' && <StreamStats diagnostics={snapshot.diagnostics} connection={snapshot.connectionQuality} className="telae-stats-card" />}
        </aside>
      </div>
    </section>
  )
}
