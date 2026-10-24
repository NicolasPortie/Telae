import { ChevronRight, Lock, Monitor, Square, Users, Volume2, VolumeX, X } from 'lucide-react'
import { t, tn } from '../i18n'
import type { ConnectionQuality, ShareSessionController } from '../services/share-session'
import type { ContentMode, QualityProfile } from '../services/types'
import { qualityContentMode } from '../services/quality-profiles'
import { avatarInitial, avatarTone } from '../ui/avatar'
import { formatElapsed, qualityOptions, transportLabel } from '../ui/format'
import { StreamStats } from './StreamStats'

type Snapshot = ReturnType<ShareSessionController['getSnapshot']>

const MAX_VIEWERS = 12

const CONNECTION_WORD: Record<ConnectionQuality, { label: () => string; tone: string }> = {
  good: { label: () => t('Boa'), tone: 'is-good' },
  degraded: { label: () => t('Instável'), tone: 'is-warn' },
  poor: { label: () => t('Fraca'), tone: 'is-bad' },
  unknown: { label: () => t('Medindo…'), tone: 'is-idle' },
}

/** Uma frase sobre o que os amigos estão recebendo agora; só afirma o que o snapshot mostra. */
function sessionHealth(snapshot: Snapshot): { tone: string; detail: string } {
  if (snapshot.state === 'reconnecting') return { tone: 'is-warn', detail: t('Sua tela volta sozinha assim que a rede deixar.') }
  if (snapshot.state !== 'live') return { tone: 'is-idle', detail: t('Quem entrar já vê sua tela.') }
  if (snapshot.connectionQuality === 'poor') return { tone: 'is-bad', detail: t('Um perfil mais leve segura melhor a imagem.') }
  if (snapshot.connectionQuality === 'degraded') return { tone: 'is-warn', detail: t('A imagem pode oscilar por alguns segundos.') }
  if (snapshot.connectionQuality === 'unknown') return { tone: 'is-idle', detail: t('Leva só alguns segundos.') }
  return {
    tone: 'is-good',
    detail: snapshot.includeAudio ? t('Seus amigos estão recebendo imagem e som.') : t('Seus amigos estão recebendo a imagem.'),
  }
}

export function SharerSession({
  snapshot, elapsed, sourceName, videoRef,
  onStop, onChangeSource, formError, busy, onQuality, onRemove,
}: {
  snapshot: Snapshot
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
  const live = snapshot.state === 'live'
  const status = live ? t('Ao vivo')
    : snapshot.state === 'preparing' ? t('Preparando…')
    : snapshot.state === 'reconnecting' ? t('Reconectando…')
    : snapshot.state === 'negotiating' ? t('Conectando seu amigo…')
    : t('Esperando alguém entrar…')
  const d = snapshot.diagnostics
  const connection = CONNECTION_WORD[snapshot.connectionQuality]
  const health = sessionHealth(snapshot)
  const audioOut = snapshot.includeAudio && !snapshot.audioBuffer?.error

  return (
    <section aria-labelledby="sharer-title" className="telae-panel-enter telae-session">
      <header className="telae-session-heading">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h1 id="sharer-title" className="telae-session-title">
            {snapshot.state === 'preparing' ? t('Preparando a transmissão') : t('Você está transmitindo')}
          </h1>
          <p role="status" className="telae-onair" data-live={live || undefined}>
            <span aria-hidden="true" className={`telae-status-dot ${live ? 'is-live' : ''}`} />
            {status}
          </p>
          {snapshot.liveSinceMs !== null && <span aria-label={t('Tempo decorrido')} className="telae-session-clock">{formatElapsed(elapsed)}</span>}
        </div>
        <button type="button" onClick={onStop} className="telae-press telae-stop-button">
          <Square size={12} aria-hidden="true" fill="currentColor" /> {t('Parar transmissão')}
        </button>
      </header>

      <div className="telae-session-grid">
        <div className="telae-onstage">
          {snapshot.hasLocalStream ? (
            <figure className="telae-preview" data-state={snapshot.state}>
              <div className="telae-video-canvas telae-preview-canvas">
                <video ref={videoRef} muted autoPlay playsInline className="telae-preview-video" aria-label={t('Pré-visualização de {name}', { name: sourceName ?? t('sua tela') })} />
                <span aria-hidden="true" className="telae-preview-label">{t('Sua prévia')}</span>
              </div>
              <figcaption className="sr-only">{sourceName ?? t('Sua tela')}</figcaption>
            </figure>
          ) : (
            <div className="telae-preview-placeholder" role="status"><Monitor size={28} strokeWidth={1.5} aria-hidden="true" /><p>{t('Preparando sua tela…')}</p></div>
          )}

          <div className="telae-controlbar" aria-busy={busy}>
            <div className="telae-controlbar-source">
              <span aria-hidden="true" className="telae-controlbar-icon"><Monitor size={18} strokeWidth={1.75} /></span>
              <span title={sourceName ?? undefined} className="truncate">{sourceName ?? t('Sua tela')}</span>
            </div>
            <button type="button" onClick={onChangeSource} disabled={controlsDisabled} className="telae-press btn btn-secondary">{t('Trocar fonte')}</button>
            <span aria-hidden="true" className="telae-vsep" />
            <label htmlFor="stream-quality" className="sr-only">{t('Qualidade')}</label>
            <select id="stream-quality" aria-label={t('Qualidade da transmissão')} className="telae-select" value={snapshot.quality} disabled={controlsDisabled} onChange={event => {
              const profile = event.target.value as QualityProfile
              onQuality(profile, qualityContentMode(profile))
            }}>
              {qualityOptions().map(item => <option key={item.value} value={item.value}>{item.resolution} · {item.fps}</option>)}
            </select>
            <span aria-hidden="true" className="telae-vsep" />
            <p className={`telae-controlbar-audio ${audioOut ? '' : 'is-off'}`}>
              {audioOut ? <Volume2 size={18} strokeWidth={1.75} aria-hidden="true" /> : <VolumeX size={18} strokeWidth={1.75} aria-hidden="true" />}
              {audioOut ? t('Som do app') : t('Sem som')}
            </p>
          </div>

          <p role="status" aria-live="polite" className="sr-only">{busy ? t('Aplicando alterações…') : ''}</p>
          {live && (d.qualityLimitationReason === 'cpu' || d.qualityLimitationReason === 'bandwidth') && (
            <div role="status" className="notice telae-notice-action">
              <p>
                {d.qualityLimitationReason === 'cpu'
                  ? t('O Telaê baixou a qualidade pra aliviar o processador. Um perfil mais leve segura melhor a imagem.')
                  : t('O Telaê baixou a qualidade porque a rede não deu conta. Um perfil mais leve segura melhor a imagem.')}
              </p>
              {snapshot.quality !== '720p60' && (
                <button type="button" disabled={controlsDisabled} onClick={() => onQuality('720p60', qualityContentMode('720p60'))} className="telae-press btn btn-sm telae-notice-button">
                  {t('Usar 720p')}
                </button>
              )}
            </div>
          )}
          {snapshot.hasLocalStream && !snapshot.includeAudio && snapshot.state !== 'ended' && (
            <p role="status" className="notice">
              {snapshot.audioBuffer?.error ? t('O som caiu, mas sua tela continua no ar.') : t('Essa fonte está sem som.')} {t('Pra ter som, troca a fonte.')}
            </p>
          )}
          {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
          {snapshot.error && <p role="alert" className="text-sm text-danger-soft">{snapshot.error}</p>}
        </div>

        <aside className="telae-inspector" aria-label={t('Quem está assistindo')}>
          <section aria-labelledby="audience-title" className="telae-inspector-section">
            <div className="telae-inspector-head">
              <h2 id="audience-title">{t('Assistindo agora')}</h2>
              <span className="tnum text-[13px] text-ink-3">{t('{count} de {max}', { count: snapshot.viewers.length, max: MAX_VIEWERS })}</span>
            </div>
            {snapshot.viewers.length === 0 ? (
              <div className="telae-audience-empty">
                <span aria-hidden="true" className="telae-empty-icon"><Users size={20} strokeWidth={1.5} /></span>
                <p className="text-[13px] leading-relaxed text-ink-3">{t('Seus amigos veem sua tela no Início deles e entram com um clique.')}</p>
              </div>
            ) : (
              <>
                <p className="sr-only">{tn('{count} pessoa assistindo', '{count} pessoas assistindo', snapshot.viewerCount)}</p>
                <ul className={`telae-audience-list ${snapshot.viewers.length > 5 ? 'is-long' : ''}`}>
                  {snapshot.viewers.map(viewer => {
                    const watching = viewer.state === 'connected'
                    const trouble = viewer.state === 'failed' || viewer.state === 'disconnected'
                    return (
                      <li key={viewer.deviceId} className="telae-audience-person">
                        <span aria-hidden="true" className="telae-avatar" style={{ background: avatarTone(viewer.displayName) }}>{avatarInitial(viewer.displayName)}</span>
                        <div className="min-w-0 flex-1">
                          <p title={viewer.displayName} className="truncate text-[15px] font-medium leading-tight">{viewer.displayName}</p>
                          {/* Assistir é o normal da lista; só o que foge disso ganha linha de estado. */}
                          {!watching && (
                            <p className={`telae-person-state ${trouble ? 'is-warn' : 'is-idle'}`}>
                              <span aria-hidden="true" />
                              {trouble ? t('Reconectando…') : t('Entrando…')}
                            </p>
                          )}
                        </div>
                        <button type="button" disabled={busy} aria-label={t('Remover {name}', { name: viewer.displayName })} title={t('Remover {name}', { name: viewer.displayName })} onClick={() => onRemove(viewer.deviceId)} className="telae-press telae-remove-button"><X size={16} aria-hidden="true" /></button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>

          {(live || snapshot.state === 'reconnecting') && <section aria-labelledby="connection-title" className="telae-inspector-section">
            <div className="telae-inspector-head">
              <h2 id="connection-title">{t('Conexão')}</h2>
              <span className={`telae-health-word ${live ? connection.tone : health.tone}`}>
                <span aria-hidden="true" />{live ? connection.label() : snapshot.state === 'reconnecting' ? t('Reconectando…') : t('Aguardando')}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-snug text-ink-3">{health.detail}</p>
            <dl className="telae-facts">
              <div><dt>{t('Latência de rede')}</dt><dd className={(d.roundTripMs ?? 0) > 150 ? 'text-warn-soft' : ''}>{d.roundTripMs == null ? '—' : `${Math.round(d.roundTripMs)} ms`}</dd></div>
              <div><dt>{t('Rota')}</dt><dd>{transportLabel(d.transportPath) ?? '—'}</dd></div>
            </dl>
            {live && (
              <details className="telae-disclosure">
                <summary>{t('Estatísticas avançadas')}<ChevronRight size={16} aria-hidden="true" /></summary>
                <StreamStats diagnostics={d} connection={snapshot.connectionQuality} bare />
              </details>
            )}
          </section>}

          <p className="telae-inspector-foot"><Lock size={15} strokeWidth={1.75} aria-hidden="true" />{t('Só seus amigos podem assistir.')}</p>
        </aside>
      </div>

    </section>
  )
}
