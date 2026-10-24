import { Check, Copy, RefreshCw, Trash2, UserPlus, Users, X } from 'lucide-react'
import { t } from '../i18n'
import type { FriendsState } from '../hooks/useFriends'
import type { DeviceSnapshot } from '../services/types'
import { avatarInitial, avatarTone } from '../ui/avatar'
import type { UpdateStatus } from '../shared/contracts'

const UPDATE_BUSY_PHASES = ['checking', 'downloading', 'ready', 'installing']

/** Para contas, o identificador público do amigo (friendCode no protocolo) é o @usuário. */
const handleOf = (friend: DeviceSnapshot) => `@${friend.friendCode}`

function GroupTitle({ children, count }: { children: string; count: number }) {
  return (
    <h3 className="telae-rail-group">
      {children}
      <span className="tnum font-mono text-ink-4">{count}</span>
    </h3>
  )
}

function FriendRow({ friend, state, order }: {
  friend: DeviceSnapshot
  state: FriendsState
  /** Posição na lista, para escalonar a entrada. */
  order: number
}) {
  const online = friend.status === 'online'
  const confirmingRemoval = state.pendingRemove === friend.friendCode
  return (
    <li className={`group telae-rail-person ${online ? 'is-online' : 'is-offline'}`} style={{ '--i': Math.min(order, 14) } as React.CSSProperties}>
      <span aria-hidden="true" className="telae-rail-avatar">
        <span className="telae-avatar" style={{ background: avatarTone(friend.displayName) }}>{avatarInitial(friend.displayName)}</span>
        {online && <span className="telae-presence" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium leading-tight">{friend.displayName}</p>
        <p className="mt-1 flex items-center gap-2 text-xs">
          <span className="truncate text-ink-4">{handleOf(friend)}</span>
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        {confirmingRemoval ? (
          <span role="group" aria-label={t('Confirmar remoção de {name}', { name: friend.displayName })} title={t('Vocês deixam de poder assistir um ao outro.')} className="inline-flex flex-wrap items-center gap-1.5 text-xs text-warn-soft">
            {t('Remover {name}?', { name: friend.displayName })}
            <button type="button" onClick={() => void state.remove(friend.friendCode)} disabled={state.busy} className="telae-press btn btn-sm btn-danger">{t('Remover')}</button>
            <button type="button" onClick={() => state.setPendingRemove(null)} className="telae-press btn btn-sm btn-ghost">{t('Cancelar')}</button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => state.setPendingRemove(friend.friendCode)}
            disabled={state.busy}
            title={t('Remover amigo')}
            aria-label={t('Remover {name}', { name: friend.displayName })}
            className="telae-press flex h-8 w-0 items-center justify-center overflow-hidden rounded-lg text-ink-4 opacity-0 transition-[width,opacity] hover:bg-danger/10 hover:text-danger-soft focus-visible:w-8 focus-visible:opacity-100 group-hover:w-8 group-hover:opacity-100 disabled:opacity-50"
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  )
}

/** Trilho fixo à esquerda: seu @, pedidos de amizade e a lista agrupada por quem está ao vivo, online e offline. */
export function FriendsRail({ state, online, updateStatus, canCheckUpdate, onCheckUpdate }: {
  state: FriendsState
  /** Conectado ao servidor de sinalização. */
  online: boolean
  updateStatus: UpdateStatus | null
  canCheckUpdate: boolean
  onCheckUpdate: () => void
}) {
  const { friends, requests } = state
  // Quem está no ar aparece no palco do início; aqui ficam os demais.
  const available = friends.filter(friend => !friend.isSharing && friend.status === 'online')
  const offline = friends.filter(friend => !friend.isSharing && friend.status !== 'online')
  const checking = updateStatus?.phase === 'checking'
  const manual = updateStatus?.phase === 'manual' || updateStatus?.phase === 'unavailable'

  const rows = (list: DeviceSnapshot[]) => (
    <ul className="grid gap-0.5">
      {list.map((friend, index) => (
        <FriendRow key={friend.friendCode} friend={friend} state={state} order={index} />
      ))}
    </ul>
  )

  return (
    <aside aria-label={t('Amigos')} className="telae-rail">
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-5">
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

      {state.addOpen && (
        <form
          className="mx-3 mb-2 mt-1 flex flex-wrap items-end gap-2 rounded-xl border border-line-strong bg-canvas p-3"
          onSubmit={event => { event.preventDefault(); void state.add() }}
        >
          <div className="min-w-0 flex-1 basis-full">
            <label htmlFor="friend-username" className="mb-1.5 block text-xs font-medium text-ink-2">{t('@ do amigo')}</label>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-ink-4">@</span>
              <input
                id="friend-username"
                value={state.usernameInput}
                onChange={event => state.setUsernameInput(event.target.value.replace(/[\s@]/g, '').toLowerCase())}
                placeholder={t('usuario')}
                maxLength={20}
                autoComplete="off"
                autoFocus
                spellCheck={false}
                className="field h-10 bg-surface pl-7 font-mono text-[13px]"
              />
            </div>
          </div>
          <button type="submit" disabled={state.busy || state.usernameInput.trim().length < 3} className="telae-press btn btn-primary btn-sm">
            {state.busy ? t('Adicionando…') : t('Adicionar')}
          </button>
          {(state.error || state.success) && (
            <p role={state.error ? 'alert' : 'status'} className={`w-full text-[13px] ${state.error ? 'text-danger-soft' : 'text-ok'}`}>{state.error ?? state.success}</p>
          )}
        </form>
      )}
      {state.error && !state.addOpen && <p role="alert" className="mx-4 mt-2 text-[13px] text-danger-soft">{state.error}</p>}
      {state.success && !state.addOpen && <p role="status" className="mx-4 mt-2 text-[13px] text-ok">{state.success}</p>}

      <div className="telae-rail-scroll">
        {requests.length > 0 && (
          <section aria-labelledby="requests-title" className="mb-3 mt-2 rounded-xl border border-line-strong bg-raised p-3">
            <div className="flex items-center gap-2">
              <h2 id="requests-title" className="text-[13px] font-semibold">{t('Pedidos de amizade')}</h2>
              <span className="count tnum">{requests.length}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">{t('Essas pessoas te adicionaram. Adiciona de volta pra vocês assistirem um ao outro.')}</p>
            <ul className="mt-2.5 grid gap-1.5">
              {requests.map(request => (
                <li key={request.deviceId} className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg bg-canvas/70 px-2.5 py-2.5">
                  <span aria-hidden="true" className="telae-avatar !h-8 !w-8 !text-xs" style={{ background: avatarTone(request.displayName) }}>{avatarInitial(request.displayName)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium leading-none">{request.displayName}</p>
                    <p className="mt-1 truncate text-[12px] text-ink-4">{handleOf(request)}</p>
                  </div>
                  <div className="flex basis-full flex-wrap gap-1.5">
                    <button type="button" onClick={() => void state.add(request.friendCode)} disabled={state.busy || !online} className="telae-press telae-accent-chip">{t('Adicionar de volta')}</button>
                    <button type="button" onClick={() => void state.dismissRequest(request.friendCode)} disabled={state.busy} className="telae-press btn btn-ghost btn-sm">{t('Ignorar')}</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

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
