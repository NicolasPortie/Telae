import { ArrowRight, Play } from 'lucide-react'
import { t } from '../i18n'
import type { FriendsState } from '../hooks/useFriends'
import type { DeviceSnapshot, QualityProfile, SharePreviewEvent } from '../services/types'
import type { UpdateStatus } from '../shared/contracts'
import { avatarInitial, avatarTone } from '../ui/avatar'
import { qualityLabel } from '../ui/format'
import { BrandMark } from './BrandMark'
import { FriendsRail } from './FriendsRail'
import { IdleSignal } from './IdleSignal'

/** Saudação pelo horário: pequena, mas faz o app parecer ter notado que você chegou. */
function greeting(name: string, hour = new Date().getHours()): string {
  if (hour >= 5 && hour < 12) return t('Bom dia, {name}', { name })
  if (hour >= 12 && hour < 18) return t('Boa tarde, {name}', { name })
  return t('Boa noite, {name}', { name })
}

/**
 * Quem está no ar: a miniatura da tela dele com tudo por cima (nome, qualidade e um Assistir pequeno).
 * Todos têm o mesmo tamanho compacto; a lista cresce em grade em vez de um cartão gigante.
 */
function LiveCard({ friend, preview, order, busy, disabled, onWatch }: {
  friend: DeviceSnapshot
  /** Posição na lista, para escalonar a entrada. */
  order: number
  preview: SharePreviewEvent | undefined
  busy: boolean
  disabled: boolean
  onWatch: (friend: DeviceSnapshot) => void
}) {
  return (
    <article aria-label={t('{name} está ao vivo', { name: friend.displayName })} className="telae-live-card" data-disabled={disabled || undefined} style={{ '--i': order } as React.CSSProperties}>
      {/* Atalho de mouse: o botão Assistir é o caminho do teclado. */}
      <div aria-hidden="true" className="telae-live-card-screen" onClick={() => { if (!disabled) onWatch(friend) }}>
        {preview ? (
          <img key={preview.capturedAt} src={preview.image} alt="" draggable={false} />
        ) : (
          <span className="telae-live-card-wait">
            <span className="telae-avatar" style={{ background: avatarTone(friend.displayName) }}>{avatarInitial(friend.displayName)}</span>
          </span>
        )}
        <span className="telae-live-card-play"><Play size={18} fill="currentColor" strokeWidth={0} /></span>
      </div>
      <span className="telae-live-card-badge"><span className="tally" /> {t('Ao vivo')}</span>
      <div className="telae-live-card-meta">
        <span aria-hidden="true" className="telae-avatar" style={{ background: avatarTone(friend.displayName) }}>{avatarInitial(friend.displayName)}</span>
        <div className="min-w-0 flex-1">
          <p className="telae-live-card-name">{friend.displayName}</p>
          {friend.activeQualityProfile && <p className="telae-live-card-quality tnum">{qualityLabel(friend.activeQualityProfile as QualityProfile)}</p>}
        </div>
        <button type="button" onClick={() => onWatch(friend)} disabled={disabled} aria-busy={busy} aria-label={t('Assistir {name}', { name: friend.displayName })} className="telae-press telae-live-card-watch">
          {busy ? t('Entrando…') : t('Assistir')}
        </button>
      </div>
    </article>
  )
}

/** Tela inicial: amigos à esquerda; no palco, quem está ao vivo (cartões compactos) e a sua vez de transmitir. */
export function HomeScreen({ displayName, friendsState, online, canWatch, watchingDeviceId, watchError, onWatch, onChooseScreen, updateStatus, canCheckUpdate, onCheckUpdate }: {
  displayName: string | undefined
  friendsState: FriendsState
  online: boolean
  canWatch: boolean
  watchingDeviceId: string | null
  watchError: string | null
  onWatch: (friend: DeviceSnapshot) => void
  onChooseScreen: () => void
  updateStatus: UpdateStatus | null
  canCheckUpdate: boolean
  onCheckUpdate: () => void
}) {
  const live = friendsState.friends.filter(friend => friend.isSharing)
  const onlineCount = friendsState.friends.filter(friend => !friend.isSharing && friend.status === 'online').length

  return (
    <section data-testid="home-screen" aria-labelledby="home-title" className="telae-panel-enter telae-home">
      <FriendsRail
        state={friendsState}
        online={online}
        updateStatus={updateStatus}
        canCheckUpdate={canCheckUpdate}
        onCheckUpdate={onCheckUpdate}
      />

      <div className="telae-stage">
        <div className="telae-stage-inner">
          <header className="telae-home-heading">
            <h1 id="home-title" className="telae-session-title">{greeting(displayName?.split(' ')[0] || t('você'))}</h1>
            {onlineCount > 0 && <p className="mt-2 text-sm text-ink-3">{t('{count} online', { count: onlineCount })}</p>}
          </header>

          {watchError && <p role="alert" className="mb-4 text-[13px] text-danger-soft">{watchError}</p>}

          <div className="telae-home-grid">
            <div className="telae-home-main-col">
              {live.length > 0 ? (
                <section aria-labelledby="live-title">
                  <h2 id="live-title" className="telae-home-section">
                    <span aria-hidden="true" className="tally" /> {t('Ao vivo agora')}
                    <span className="tnum telae-home-section-count">{live.length}</span>
                  </h2>
                  <div className="telae-live-grid">
                    {live.map((friend, index) => (
                      <LiveCard key={friend.deviceId} friend={friend} preview={friendsState.previews[friend.deviceId]} order={index}
                        busy={watchingDeviceId === friend.deviceId} disabled={!canWatch} onWatch={onWatch} />
                    ))}
                  </div>
                </section>
              ) : (
                <div className="telae-idle-stage">
                  <IdleSignal />
                  <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.025em]">{t('Ninguém transmitindo agora')}</h2>
                  <p className="mt-2 max-w-[40ch] text-[14px] leading-relaxed text-ink-3">
                    {friendsState.friends.length > 0 ? t('Quando um amigo entrar no ar, a tela dele aparece aqui.') : t('Adicione amigos pela lista ao lado. Quando eles entrarem no ar, a tela deles aparece aqui.')}
                  </p>
                </div>
              )}
            </div>

            <aside aria-labelledby="share-title" className="telae-share-card">
              <BrandMark size={40} className="telae-share-mark" />
              <h2 id="share-title" className="telae-share-title">{t('Sua vez')}</h2>
              <p className="telae-share-text">{t('Escolha uma tela ou janela. Seus amigos recebem o aviso na hora.')}</p>
              <button type="button" onClick={onChooseScreen} disabled={!online} className="telae-press telae-primary-action btn btn-primary btn-lg">
                {t('Escolher tela')} <ArrowRight size={17} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </aside>
          </div>
        </div>
      </div>
    </section>
  )
}
