import { Check, Copy, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react'
import { getLocale, t } from '../i18n'
import type { FriendsState } from '../hooks/useFriends'
import type { DeviceSnapshot } from '../services/types'
import type { UpdateStatus } from '../shared/contracts'

const UPDATE_BUSY_PHASES = ['checking', 'downloading', 'ready', 'installing']

const initialOf = (name: string) => name.trim().slice(0, 1).toLocaleUpperCase(getLocale()) || '?'

/** Para contas, o identificador público do amigo (friendCode no protocolo) é o @usuário. */
const handleOf = (friend: DeviceSnapshot) => `@${friend.friendCode}`

function GroupTitle({ children, count }: { children: string; count: number }) {
  return (
    <h3 className="mb-1.5 mt-4 flex items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3 first:mt-1">
      {children}
      <span className="tnum font-mono text-ink-4">{count}</span>
    </h3>
  )
}

function FriendRow({ friend, state, canWatch, watching, onWatch }: {
  friend: DeviceSnapshot
  state: FriendsState
  canWatch: boolean
  watching: boolean
  onWatch: (friend: DeviceSnapshot) => void
}) {
  const live = friend.isSharing
  const online = friend.status === 'online'
  const confirmingRemoval = state.pendingRemove === friend.friendCode
  return (
    <li className={`group flex flex-wrap items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-active/60 ${live ? 'bg-tally/[0.06]' : ''}`}>
      <span aria-hidden="true" className={`avatar h-9 w-9 ${live ? 'avatar-live' : ''}`}>{initialOf(friend.displayName)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-none">{friend.displayName}</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs">
          {live && <span aria-hidden="true" className="tally" />}
          <span className={`whitespace-nowrap ${live ? 'font-medium text-tally-soft' : online ? 'text-ok' : 'text-ink-4'}`}>
            {live ? t('Ao vivo') : online ? t('Online') : t('Offline')}
          </span>
          <span className="truncate font-mono text-[11px] text-ink-4">{handleOf(friend)}</span>
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        {live && (
          <button type="button" onClick={() => onWatch(friend)} disabled={!canWatch} aria-busy={watching} className="telae-press btn btn-primary btn-sm">
            {watching ? t('Entrando…') : t('Assistir')}
          </button>
        )}
        {confirmingRemoval ? (
          <span role="group" aria-label={t('Confirmar remoção de {name}', { name: friend.displayName })} title={t('Vocês deixam de poder assistir um ao outro.')} className="inline-flex flex-wrap items-center gap-1.5 text-xs text-signal-soft">
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
            className="telae-press flex h-8 w-8 items-center justify-center rounded-lg text-ink-4 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger-soft focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  )
}

/** Trilho fixo à esquerda: seu @, pedidos de amizade e a lista agrupada por quem está ao vivo, online e offline. */
export function FriendsRail({ state, online, canWatch, watchingDeviceId, watchError, onWatch, updateStatus, canCheckUpdate, onCheckUpdate }: {
  state: FriendsState
  /** Conectado ao servidor de sinalização. */
  online: boolean
  /** Online e sem outra entrada em andamento. */
  canWatch: boolean
  watchingDeviceId: string | null
  watchError: string | null
  onWatch: (friend: DeviceSnapshot) => void
  updateStatus: UpdateStatus | null
  canCheckUpdate: boolean
  onCheckUpdate: () => void
}) {
  const { friends, requests } = state
  const live = friends.filter(friend => friend.isSharing)
  const idle = friends.filter(friend => !friend.isSharing && friend.status === 'online')
  const offline = friends.filter(friend => !friend.isSharing && friend.status !== 'online')
  const checking = updateStatus?.phase === 'checking'

  const rows = (list: DeviceSnapshot[]) => (
    <ul className="grid gap-0.5">
      {list.map(friend => (
        <FriendRow key={friend.friendCode} friend={friend} state={state} canWatch={canWatch} watching={watchingDeviceId === friend.deviceId} onWatch={onWatch} />
      ))}
    </ul>
  )

  return (
    <aside aria-label={t('Amigos')} className="telae-rail">
      {state.myUsername && (
        <div className="mx-3 mb-1 mt-3 flex items-center justify-between gap-3 rounded-xl border border-line-strong bg-canvas/70 px-3.5 py-2.5">
          <div className="min-w-0">
            <span className="eyebrow">{t('Seu @')}</span>
            <p data-testid="my-handle" className="mt-1 truncate font-mono text-[16px] font-semibold leading-none text-ink">@{state.myUsername}</p>
          </div>
          <button
            type="button"
            onClick={() => void state.copyMyHandle()}
            aria-label={t('Copiar seu @')}
            title={state.myHandleCopied ? t('Copiado!') : t('Copiar')}
            className="telae-press btn btn-secondary h-9 w-9 shrink-0 p-0"
          >
            {state.myHandleCopied ? <Check size={14} aria-hidden="true" className="text-ok" /> : <Copy size={14} aria-hidden="true" />}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <h2 id="friends-title" className="text-[15px] font-semibold tracking-[-0.01em]">{t('Amigos')}</h2>
          <span className="count tnum">{friends.length}</span>
        </div>
        <button type="button" onClick={() => state.setAddOpen(open => !open)} className="telae-press btn btn-ghost btn-sm">
          <UserPlus size={14} aria-hidden="true" /> {t('Adicionar')}
        </button>
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
          <button type="button" onClick={state.closeAddForm} className="telae-press btn btn-ghost btn-sm">{t('Cancelar')}</button>
          {(state.error || state.success) && (
            <p role={state.error ? 'alert' : 'status'} className={`w-full text-[13px] ${state.error ? 'text-danger-soft' : 'text-ok'}`}>{state.error ?? state.success}</p>
          )}
        </form>
      )}
      {state.error && !state.addOpen && <p role="alert" className="mx-4 mt-2 text-[13px] text-danger-soft">{state.error}</p>}
      {state.success && !state.addOpen && <p role="status" className="mx-4 mt-2 text-[13px] text-ok">{state.success}</p>}
      {watchError && <p role="alert" className="mx-4 mt-2 text-[13px] text-danger-soft">{watchError}</p>}

      <div className="telae-rail-scroll">
        {requests.length > 0 && (
          <section aria-labelledby="requests-title" className="mb-3 mt-2 rounded-xl border border-line-warm bg-warm p-3">
            <div className="flex items-center gap-2">
              <h2 id="requests-title" className="text-[13px] font-semibold">{t('Pedidos de amizade')}</h2>
              <span className="count tnum">{requests.length}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">{t('Essas pessoas te adicionaram. Adicione de volta pra assistirem um ao outro.')}</p>
            <ul className="mt-2.5 grid gap-1.5">
              {requests.map(request => (
                <li key={request.deviceId} className="flex flex-wrap items-center gap-2.5 rounded-lg bg-canvas/70 px-2.5 py-2">
                  <span aria-hidden="true" className="avatar h-8 w-8">{initialOf(request.displayName)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium leading-none">{request.displayName}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-ink-4">{handleOf(request)}</p>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => void state.add(request.friendCode)} disabled={state.busy || !online} className="telae-press btn btn-primary btn-sm">{t('Adicionar de volta')}</button>
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
            <div aria-hidden="true" className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-line-strong bg-raised text-ink-3"><Users size={18} /></div>
            <p className="mt-3 text-sm font-medium">{t('Sua lista está vazia.')}</p>
            <p className="mx-auto mt-1.5 max-w-[26ch] text-xs leading-relaxed text-ink-3">{t('Pergunte o @ de quem você quer assistir e coloque aqui.')}</p>
            <button type="button" onClick={() => state.setAddOpen(true)} className="telae-press btn btn-primary btn-sm mt-4">{t('Adicionar primeiro amigo')}</button>
          </div>
        ) : (
          <>
            {live.length > 0 && (<><GroupTitle count={live.length}>{t('Ao vivo')}</GroupTitle>{rows(live)}</>)}
            {idle.length > 0 && (<><GroupTitle count={idle.length}>{t('Online')}</GroupTitle>{rows(idle)}</>)}
            {offline.length > 0 && (<><GroupTitle count={offline.length}>{t('Offline')}</GroupTitle>{rows(offline)}</>)}
          </>
        )}
      </div>

      <div className="telae-rail-foot">
        <button
          type="button"
          onClick={onCheckUpdate}
          disabled={!canCheckUpdate || UPDATE_BUSY_PHASES.includes(updateStatus?.phase ?? '')}
          className="telae-press telae-check-update"
        >
          <RefreshCw size={13} aria-hidden="true" className={checking ? 'telae-update-spinner' : ''} />
          {checking ? t('Buscando atualização…') : t('Buscar atualização')}
        </button>
        {updateStatus?.phase === 'current' && <span className="text-xs text-ink-4">{t('Tudo em dia')}</span>}
      </div>
    </aside>
  )
}
