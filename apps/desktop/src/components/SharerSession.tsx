import { Monitor, Square, Users, X } from 'lucide-react'
import { getLocale, t, tn } from '../i18n'
import type { ShareSessionController } from '../services/share-session'
import type { ContentMode, QualityProfile } from '../services/types'
import { qualityContentMode } from '../services/quality-profiles'
import { formatElapsed, qualityOptions } from '../ui/format'
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
  const status = snapshot.state === 'live' ? t('Ao vivo')
    : snapshot.state === 'preparing' ? t('Preparando…')
    : snapshot.state === 'reconnecting' ? t('Reconectando…')
    : snapshot.state === 'negotiating' ? t('Conectando seu amigo…')
    : t('Esperando alguém entrar…')

  return (
    <section aria-labelledby="sharer-title" className="telae-panel-enter telae-session">
      <div className="telae-session-heading">
        <div>
          <p className="eyebrow">{t('No ar')}</p>
          <h1 id="sharer-title" className="display mt-2 text-[clamp(34px,4vw,48px)]">
            {snapshot.state === 'preparing' ? t('Preparando a transmissão') : t('Você está transmitindo')}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-2">
            <p role="status" className="flex items-center gap-2">
              <span aria-hidden="true" className={`telae-status-dot ${snapshot.state === 'live' ? 'is-live' : ''}`} />
              {status}
            </p>
            {snapshot.liveSinceMs !== null && <span aria-label={t('Tempo decorrido')} className="tnum border-l border-line pl-3 font-mono">{formatElapsed(elapsed)}</span>}
          </div>
        </div>
        <button type="button" onClick={onStop} className="telae-press btn btn-danger btn-lg">
          <Square size={14} aria-hidden="true" /> {t('Parar transmissão')}
        </button>
      </div>

      <div className="telae-session-grid">
        <div className="min-w-0">
          {snapshot.hasLocalStream ? (
            <figure className="telae-preview">
              <div className="telae-video-canvas telae-preview-canvas">
                <video ref={videoRef} muted autoPlay playsInline className="telae-preview-video" aria-label={t('Pré-visualização de {name}', { name: sourceName ?? t('sua tela') })} />
                <span aria-hidden="true" className="telae-preview-label">{t('Sua prévia')}</span>
              </div>
              <figcaption className="telae-preview-toolbar">
                <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <Monitor size={16} aria-hidden="true" className="shrink-0 text-ink-3" />
                  <span title={sourceName ?? undefined} className="truncate">{sourceName ?? t('Sua tela')}</span>
                </div>
                <button type="button" onClick={onChangeSource} disabled={controlsDisabled} className="telae-press telae-text-button">{t('Trocar fonte')}</button>
                <div aria-busy={busy} className="telae-quality-control">
                  <label htmlFor="stream-quality" className="text-xs text-ink-3">{t('Qualidade')}</label>
                  <select id="stream-quality" aria-label={t('Qualidade da transmissão')} value={snapshot.quality} disabled={controlsDisabled} onChange={event => {
                    const profile = event.target.value as QualityProfile
                    onQuality(profile, qualityContentMode(profile))
                  }}>
                    {qualityOptions().map(option => <option key={option.value} value={option.value}>{option.resolution} · {option.fps}</option>)}
                  </select>
                </div>
              </figcaption>
            </figure>
          ) : (
            <div className="telae-preview-placeholder" role="status"><Monitor size={32} aria-hidden="true" /><p>{t('Preparando sua tela…')}</p></div>
          )}
          <p role="status" aria-live="polite" className="mt-3 text-xs text-signal-soft">{busy ? t('Aplicando alterações…') : ''}</p>
          {snapshot.state === 'live' && (snapshot.diagnostics.qualityLimitationReason === 'cpu' || snapshot.diagnostics.qualityLimitationReason === 'bandwidth') && (
            <p role="status" className="notice mt-3">
              {snapshot.diagnostics.qualityLimitationReason === 'cpu'
                ? t('O Telae baixou a qualidade pra aliviar o processador. Um perfil mais leve segura melhor a imagem.')
                : t('O Telae baixou a qualidade porque a rede não deu conta. Um perfil mais leve segura melhor a imagem.')}
            </p>
          )}
          {snapshot.hasLocalStream && !snapshot.includeAudio && snapshot.state !== 'ended' && (
            <p role="status" className="notice mt-3">
              {snapshot.audioBuffer?.error ? t('O som caiu, mas sua tela continua no ar.') : t('Esta fonte está sem som.')} {t('Pra ter som, troque a fonte.')}
            </p>
          )}
          {formError && <p role="alert" className="mt-3 text-sm text-danger-soft">{formError}</p>}
          {snapshot.error && <p role="alert" className="mt-3 text-sm text-danger-soft">{snapshot.error}</p>}
        </div>

        <aside className="telae-session-sidebar" aria-label={t('Quem está assistindo')}>
          <section aria-label={t('Quem está assistindo')} className="telae-audience">
            <div className="flex items-center justify-between gap-2"><h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t('Quem está assistindo')}</h2><span className="count tnum">{t('{count} de {max}', { count: snapshot.viewers.length, max: 12 })}</span></div>
            {snapshot.viewers.length === 0 ? (
              <div className="telae-audience-empty">
                <span aria-hidden="true" className="telae-empty-icon"><Users size={22} strokeWidth={1.5} /></span>
                <p className="text-sm text-ink-2">{t('Ninguém entrou ainda.')}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-3">{t('Quem entrar aparece aqui.')}</p>
              </div>
            ) : (
              <>
                <p className="mt-2 text-xs text-ink-3">{tn('{count} pessoa assistindo', '{count} pessoas assistindo', snapshot.viewerCount)}</p>
                <ul className="telae-audience-list">
                  {snapshot.viewers.map(viewer => (
                    <li key={viewer.deviceId} className="telae-audience-person">
                      <span aria-hidden="true" className="avatar h-9 w-9">{viewer.displayName.trim().slice(0, 1).toLocaleUpperCase(getLocale())}</span>
                      <div className="min-w-0 flex-1"><p title={viewer.displayName} className="truncate text-sm font-medium">{viewer.displayName}</p><p className="mt-1 text-xs text-ink-3">{viewer.state === 'connected' ? t('Assistindo') : viewer.state === 'failed' || viewer.state === 'disconnected' ? t('Reconectando…') : t('Entrando…')}</p></div>
                      <button type="button" disabled={busy} aria-label={t('Remover {name}', { name: viewer.displayName })} title={t('Remover {name}', { name: viewer.displayName })} onClick={() => onRemove(viewer.deviceId)} className="telae-press telae-remove-button"><X size={16} aria-hidden="true" /></button>
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
