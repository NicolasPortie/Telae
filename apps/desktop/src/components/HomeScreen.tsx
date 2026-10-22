import { ArrowRight } from 'lucide-react'
import { t } from '../i18n'
import type { FriendsState } from '../hooks/useFriends'
import type { DeviceSnapshot } from '../services/types'
import type { UpdateStatus } from '../shared/contracts'
import { FriendsRail } from './FriendsRail'

/** Saudação pelo horário: pequena, mas faz o app parecer ter notado que você chegou. */
function greeting(name: string, hour = new Date().getHours()): string {
  if (hour >= 5 && hour < 12) return t('Bom dia, {name}', { name })
  if (hour >= 12 && hour < 18) return t('Boa tarde, {name}', { name })
  return t('Boa noite, {name}', { name })
}

function Poster({ friend, busy, disabled, onWatch }: {
  friend: DeviceSnapshot
  busy: boolean
  disabled: boolean
  onWatch: (friend: DeviceSnapshot) => void
}) {
  return (
    <article aria-label={t('{name} está ao vivo', { name: friend.displayName })} className="telae-poster">
      <div className="flex items-start justify-between gap-3">
        <span className="badge-live"><span aria-hidden="true" className="tally" /> {t('No ar')}</span>
        {friend.activeQualityProfile && <span className="tnum font-mono text-[11px] text-ink-3">{friend.activeQualityProfile}</span>}
      </div>
      <span aria-hidden="true" className="telae-poster-initial">{friend.displayName.trim().slice(0, 1).toLocaleUpperCase() || '?'}</span>
      <div className="mt-auto flex items-end justify-between gap-3">
        <p className="display min-w-0 truncate text-[30px]">{friend.displayName}</p>
        <button type="button" onClick={() => onWatch(friend)} disabled={disabled} aria-busy={busy} aria-label={t('Assistir {name}', { name: friend.displayName })} className="telae-press btn btn-primary shrink-0">
          {busy ? t('Entrando…') : t('Assistir')}
        </button>
      </div>
    </article>
  )
}

/** Tela inicial: trilho de amigos à esquerda e, à direita, o palco: quem está em cartaz e a sua vez de transmitir. */
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
  const hasFriends = friendsState.friends.length > 0
  const headline = live.length === 0
    ? t('Ninguém ao vivo agora.')
    : live.length === 1 ? t('{name} está ao vivo', { name: live[0].displayName }) : t('{count} amigos ao vivo', { count: live.length })

  return (
    <section data-testid="home-screen" aria-labelledby="home-title" className="telae-panel-enter telae-home">
      <FriendsRail
        state={friendsState}
        online={online}
        canWatch={canWatch}
        watchingDeviceId={watchingDeviceId}
        watchError={watchError}
        onWatch={onWatch}
        updateStatus={updateStatus}
        canCheckUpdate={canCheckUpdate}
        onCheckUpdate={onCheckUpdate}
      />

      <div className="telae-stage">
        <div className="telae-stage-inner">
          <p className="eyebrow">{greeting(displayName?.split(' ')[0] || t('você'))}</p>
          <h1 id="home-title" className="display mt-3 text-[clamp(36px,4.4vw,54px)]">{headline}</h1>
          {live.length === 0 && (
            <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-ink-2">
              {hasFriends ? t('Quando alguém transmitir, o cartaz aparece aqui.') : t('Você ainda não tem amigos por aqui. Adicione o primeiro pelo @ dele.')}
            </p>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="button" onClick={onChooseScreen} disabled={!online} className="telae-press telae-primary-action btn btn-primary btn-lg">
              {t('Escolher tela')} <ArrowRight size={17} aria-hidden="true" />
            </button>
            <p className="max-w-[30ch] text-[13px] leading-snug text-ink-3">{t('Seus amigos recebem o aviso na hora.')}</p>
          </div>

          <div className="mt-10">
            {live.length > 0 ? (
              <>
                <h2 className="eyebrow mb-3">{t('Em cartaz')}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {live.map(friend => (
                    <Poster key={friend.deviceId} friend={friend} busy={watchingDeviceId === friend.deviceId} disabled={!canWatch} onWatch={onWatch} />
                  ))}
                </div>
              </>
            ) : (
              <div className="telae-darkscreen" role="img" aria-label={t('Tela apagada')}>
                <p className="display text-[30px] text-ink-3">{t('Tela apagada.')}</p>
                <p className="text-[13px] text-ink-4">{t('Nenhuma transmissão em cartaz.')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
