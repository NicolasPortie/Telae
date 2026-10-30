import { Check, Copy, Eye, EyeOff, Play, RefreshCw, Trash2, UserPlus, Users, X } from 'lucide-react'
import { t } from '../i18n'
import type { FriendsState } from '../hooks/useFriends'
import type { DeviceSnapshot, QualityProfile } from '../services/types'
import { avatarInitial, avatarTone } from '../ui/avatar'
import { qualityLabel } from '../ui/format'
import type { UpdateStatus } from '../shared/contracts'
import { AddFriendForm } from './AddFriendForm'
import { FriendRequests } from './FriendRequests'

const UPDATE_BUSY_PHASES = ['checking', 'downloading', 'ready', 'installing']

/** Para contas, o identificador público do amigo (friendCode no protocolo) é o @usuário. */
const handleOf = (friend: DeviceSnapshot) => `@${friend.friendCode}`

function GroupTitle({ children, count, live = false }: { children: string; count: number; live?: boolean }) {
  return (
    <h3 className="telae-rail-group">
      <span className="flex items-center gap-2">
        {live && <span aria-hidden="true" className="tally" />}
        {children}
      </span>
      <span className="tnum font-mono text-ink-4">{count}</span>
    </h3>
  )
}

/**
 * Um amigo na lista. Quem está ao vivo continua aqui (no alto, com "Assistir"); as ações de ocultar e remover
 * aparecem sobre a linha ao passar o mouse ou focar, sem empurrar o texto.
 */
function FriendRow({ friend, state, order, canWatch, watching, onWatch }: {
  friend: DeviceSnapshot
  state: FriendsState
  /** Posição na lista, para escalonar a entrada. */
  order: number
  canWatch: boolean
  /** Entrando na transmissão deste amigo agora. */
  watching: boolean
  onWatch: (friend: DeviceSnapshot) => void
}) {
  const live = friend.isSharing
  const online = friend.status === 'online'
  const confirmingRemoval = state.pendingRemove === friend.friendCode
  const hidden = state.hidden.some(person => person.deviceId === friend.deviceId)
  const tone = live ? 'is-live' : online ? 'is-online' : 'is-offline'
  return (
    <li className={`telae-friend ${tone}`} style={{ '--i': Math.min(order, 14) } as React.CSSProperties}>
      <span aria-hidden="true" className="telae-rail-avatar">
        <span className="telae-avatar" style={{ background: avatarTone(friend.displayName) }}>{avatarInitial(friend.displayName)}</span>
        {online && <span className="telae-presence" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium leading-tight">{friend.displayName}</p>
        <p className="mt-1 flex items-center gap-2 text-xs">
          {live ? (
            <span className="telae-friend-live truncate">
              {t('Ao vivo')}{friend.activeQualityProfile ? <span className="tnum"> · {qualityLabel(friend.activeQualityProfile as QualityProfile)}</span> : null}
            </span>
          ) : (
            <span className="truncate text-ink-4">{handleOf(friend)}</span>
          )}
          {hidden && (
            <span title={t('Não vê suas transmissões')} className="telae-hidden-tag">
              <EyeOff size={12} strokeWidth={1.75} aria-hidden="true" />{t('oculto')}
            </span>
          )}
        </p>
      </div>

      <div className="telae-friend-controls">
        {live && !confirmingRemoval && (
          <button
            type="button"
            onClick={() => onWatch(friend)}
            disabled={!canWatch}
            aria-busy={watching}
            aria-label={t('Assistir {name}', { name: friend.displayName })}
            className="telae-press telae-accent-chip"
          >
            <Play size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />{watching ? t('Entrando…') : t('Assistir')}
          </button>
        )}

        {confirmingRemoval ? (
          <span role="group" aria-label={t('Confirmar remoção de {name}', { name: friend.displayName })} title={t('Vocês deixam de poder assistir um ao outro.')} className="telae-friend-confirm">
            {t('Remover {name}?', { name: friend.displayName })}
            <button type="button" onClick={() => void state.remove(friend.friendCode)} disabled={state.busy} className="telae-press btn btn-sm btn-danger">{t('Remover')}</button>
            <button type="button" onClick={() => state.setPendingRemove(null)} className="telae-press btn btn-sm btn-ghost">{t('Cancelar')}</button>
          </span>
        ) : (
          <div className="telae-friend-actions">
            <button
              type="button"
              onClick={() => void state.setShareHidden(friend.friendCode, !hidden)}
              disabled={state.busy}
              title={hidden ? t('Mostrar minhas transmissões') : t('Ocultar minhas transmissões')}
              aria-label={hidden ? t('Mostrar minhas transmissões pra {name}', { name: friend.displayName }) : t('Ocultar minhas transmissões de {name}', { name: friend.displayName })}
              className="telae-press telae-friend-action"
            >
              {hidden ? <Eye size={14} strokeWidth={1.75} aria-hidden="true" /> : <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => state.setPendingRemove(friend.friendCode)}
              disabled={state.busy}
              title={t('Remover amigo')}
              aria-label={t('Remover {name}', { name: friend.displayName })}
              className="telae-press telae-friend-action is-danger"
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

/** Trilho fixo à esquerda: adicionar amigo, pedidos de amizade e todos os amigos agrupados em ao vivo, online e offline. */
export function FriendsRail({ state, online, updateStatus, canCheckUpdate, onCheckUpdate, canWatch = false, watchingDeviceId = null, onWatch = () => undefined }: {
  state: FriendsState
  /** Conectado ao servidor de sinalização. */
  online: boolean
  updateStatus: UpdateStatus | null
  canCheckUpdate: boolean
  onCheckUpdate: () => void
  canWatch?: boolean
  watchingDeviceId?: string | null
  onWatch?: (friend: DeviceSnapshot) => void
}) {
  const { friends, requests } = state
  // Todos os amigos aparecem aqui, uma vez só: o contador do alto bate com as linhas.
  const live = friends.filter(friend => friend.isSharing)
  const available = friends.filter(friend => !friend.isSharing && friend.status === 'online')
  const offline = friends.filter(friend => !friend.isSharing && friend.status !== 'online')
  const checking = updateStatus?.phase === 'checking'
  const manual = updateStatus?.phase === 'manual' || updateStatus?.phase === 'unavailable'

  const rows = (list: DeviceSnapshot[]) => (
    <ul className="grid gap-0.5">
      {list.map((friend, index) => (
        <FriendRow key={friend.friendCode} friend={friend} state={state} order={index} canWatch={canWatch}
          watching={watchingDeviceId === friend.deviceId} onWatch={onWatch} />
      ))}
    </ul>
  )

  return (
    <aside aria-label={t('Amigos')} className="telae-rail">
      <div className="telae-rail-head">
        <div className="flex items-center gap-2">
          <h2 id="friends-title" className="text-[15px] font-semibold tracking-[-0.02em]">{t('Amigos')}</h2>
          <span className="tnum text-[13px] text-ink-4">{friends.length}</span>
        </div>
        {state.addOpen ? (
          <button type="button" onClick={state.closeAddForm} aria-label={t('Fechar')} title={t('Fechar')} className="telae-press telae-icon-button !h-8 !w-8 !border-0">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" onClick={() => state.setAddOpen(true)} className="telae-press telae-rail-add">
            <UserPlus size={15} strokeWidth={1.75} aria-hidden="true" /> {t('Adicionar')}
          </button>
        )}
      </div>

      {state.addOpen && <AddFriendForm state={state} />}
      {state.error && !state.addOpen && <p role="alert" className="mx-5 mt-2 text-[13px] text-danger-soft">{state.error}</p>}
      {state.success && !state.addOpen && <p role="status" className="mx-5 mt-2 text-[13px] text-ok">{state.success}</p>}

      <div className="telae-rail-scroll">
        <FriendRequests requests={requests} state={state} online={online} />

        {friends.length === 0 && !online ? (
          <div role="status" className="mt-3 grid gap-1" aria-label={t('Conectando ao servidor')}>
            {[0, 1, 2].map(index => (
              <div key={index} className="flex items-center gap-3 px-2 py-2">
                <span className="skeleton h-9 w-9 rounded-full" />
                <div className="grid flex-1 gap-2"><span className="skeleton h-3 w-24" /><span className="skeleton h-2.5 w-14" /></div>
              </div>
            ))}
          </div>
        ) : friends.length === 0 ? (
          <div className="mx-1 mt-4 rounded-xl border border-dashed border-line-strong px-5 py-8 text-center">
            <div aria-hidden="true" className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-line-strong bg-raised text-ink-3"><Users size={18} strokeWidth={1.75} /></div>
            <p className="mt-3 text-sm font-medium">{t('Sua lista está vazia.')}</p>
            <p className="mx-auto mt-1.5 max-w-[26ch] text-xs leading-relaxed text-ink-3">{t('Pergunta o @ de quem você quer assistir e coloca aqui.')}</p>
            <button type="button" onClick={() => state.setAddOpen(true)} className="telae-press btn btn-primary btn-sm mt-4">{t('Adicionar primeiro amigo')}</button>
          </div>
        ) : (
          <>
            {live.length > 0 && (<><GroupTitle count={live.length} live>{t('Ao vivo')}</GroupTitle>{rows(live)}</>)}
            {available.length > 0 && (<><GroupTitle count={available.length}>{t('Online')}</GroupTitle>{rows(available)}</>)}
            {offline.length > 0 && (<><GroupTitle count={offline.length}>{t('Offline')}</GroupTitle>{rows(offline)}</>)}
          </>
        )}
      </div>

      <div className="telae-rail-foot">
        {state.myUsername && (
          <div className="flex min-w-0 items-center gap-2">
            <span data-testid="my-handle" className="truncate text-[13px] font-medium text-ink-2">@{state.myUsername}</span>
            <button
              type="button"
              onClick={() => void state.copyMyHandle()}
              aria-label={t('Copiar seu @')}
              title={state.myHandleCopied ? t('Copiado') : t('Copiar')}
              className="telae-press telae-icon-button !h-7 !w-7 !border-0"
            >
              {state.myHandleCopied ? <Check size={14} strokeWidth={1.75} aria-hidden="true" className="text-ok" /> : <Copy size={14} strokeWidth={1.75} aria-hidden="true" />}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onCheckUpdate}
          disabled={!canCheckUpdate || UPDATE_BUSY_PHASES.includes(updateStatus?.phase ?? '')}
          aria-label={checking ? t('Buscando atualização…') : manual ? t('Baixar atualização') : t('Buscar atualização')}
          title={updateStatus?.phase === 'current' ? t('Tudo em dia') : manual ? t('Baixar atualização') : t('Buscar atualização')}
          className="telae-press telae-icon-button !h-7 !w-7 !border-0"
        >
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" className={checking ? 'telae-update-spinner' : ''} />
        </button>
      </div>
    </aside>
  )
}
