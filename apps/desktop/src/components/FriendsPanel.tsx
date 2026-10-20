import { Check, Copy, Trash2, UserPlus, Users } from 'lucide-react'
import { getLocale, t } from '../i18n'
import type { FriendsState } from '../hooks/useFriends'
import type { DeviceSnapshot } from '../services/types'

const initialOf = (name: string) => name.trim().slice(0, 1).toLocaleUpperCase(getLocale()) || '?'

function FriendRow({ friend, state, canWatch, watching, onWatch }: {
  friend: DeviceSnapshot
  state: FriendsState
  canWatch: boolean
  watching: boolean
  onWatch: (friend: DeviceSnapshot) => void
}) {
  const live = friend.isSharing
  const online = friend.status === 'online'
  const confirmingRemoval = state.pendingRemoveCode === friend.friendCode
  return (
    <li className={`group flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${live ? 'border-line-warm bg-warm' : 'border-line bg-canvas/60 hover:border-line-strong'}`}>
      <span aria-hidden="true" className={`avatar h-9 w-9 ${live ? 'avatar-live' : ''}`}>{initialOf(friend.displayName)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-none">{friend.displayName}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className={`inline-flex items-center gap-1.5 ${live ? 'font-semibold text-signal' : online ? 'text-ok' : 'text-ink-3'}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${live ? 'animate-pulse bg-signal' : online ? 'bg-ok' : 'bg-ink-4'}`} />
            {live ? t('Ao vivo') : online ? t('Online') : t('Offline')}
          </span>
          <span className="tnum font-mono text-[11px] text-ink-4">· {friend.friendCode}</span>
          {live && friend.activeQualityProfile && <span className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-ink-3">{friend.activeQualityProfile}</span>}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {live && (
          <button type="button" onClick={() => onWatch(friend)} disabled={!canWatch} aria-busy={watching} className="telae-press btn btn-primary btn-sm">
            {watching ? t('Entrando…') : t('Assistir')}
          </button>
        )}
        {confirmingRemoval ? (
          <span role="group" aria-label={t('Confirmar remoção de {name}', { name: friend.displayName })} title={t('Vocês deixam de poder assistir uma à outra.')} className="inline-flex flex-wrap items-center gap-1.5 text-xs text-signal-soft">
            {t('Remover {name}?', { name: friend.displayName })}
            <button type="button" onClick={() => void state.remove(friend.friendCode)} disabled={state.busy} className="telae-press btn btn-sm btn-danger">{t('Remover')}</button>
            <button type="button" onClick={() => state.setPendingRemoveCode(null)} className="telae-press btn btn-sm btn-ghost">{t('Cancelar')}</button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => state.setPendingRemoveCode(friend.friendCode)}
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

/** Painel lateral da Home: código pessoal, pedidos de amizade e a lista com presença. */
export function FriendsPanel({ state, online, canWatch, watchingDeviceId, watchError, onWatch }: {
  state: FriendsState
  /** Conectado ao servidor de sinalização. */
  online: boolean
  /** Online e sem outra entrada em andamento. */
  canWatch: boolean
  watchingDeviceId: string | null
  watchError: string | null
  onWatch: (friend: DeviceSnapshot) => void
}) {
  const { friends, requests, filter } = state
  const liveCount = friends.filter(friend => friend.isSharing).length
  const visible = filter === 'live' ? friends.filter(friend => friend.isSharing) : friends

  return (
    <section aria-labelledby="friends-title" className="telae-friends-panel card p-5">
      {state.myFriendCode && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-line-strong bg-canvas px-4 py-3">
          <div className="min-w-0">
            <span className="eyebrow">{t('Seu código de amigo')}</span>
            <p data-testid="my-friend-code" className="tnum mt-1.5 font-mono text-[18px] font-semibold leading-none tracking-[0.2em] text-ink">{state.myFriendCode}</p>
          </div>
          <button
            type="button"
            onClick={() => void state.copyMyCode()}
            aria-label={t('Copiar seu código de amigo')}
            title={state.myCodeCopied ? t('Copiado!') : t('Copiar código')}
            className="telae-press btn btn-secondary h-10 w-10 shrink-0 p-0"
          >
            {state.myCodeCopied ? <Check size={15} aria-hidden="true" className="text-ok" /> : <Copy size={15} aria-hidden="true" />}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <h2 id="friends-title" className="text-[15px] font-semibold tracking-[-0.01em]">{t('Seus amigos')}</h2>
        <span className="count tnum">{friends.length}</span>
        {liveCount > 0 && (
          <span className="badge-live"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" /> {t('{count} ao vivo', { count: liveCount })}</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div role="group" aria-label={t('Filtrar amigos')} className="flex rounded-lg border border-line bg-canvas p-0.5">
          {(['all', 'live'] as const).map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => state.setFilter(option)}
              className={`min-h-[28px] rounded-md px-3 text-xs font-medium transition-colors ${filter === option ? 'bg-active text-ink' : 'text-ink-3 hover:text-ink'}`}
            >
              {option === 'all' ? t('Todos') : t('Ao vivo')}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => state.setAddOpen(open => !open)} className="telae-press btn btn-secondary btn-sm">
          <UserPlus size={14} aria-hidden="true" /> {t('Adicionar')}
        </button>
      </div>

      {state.addOpen && (
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-line-strong bg-canvas p-4">
          <div className="min-w-[180px] flex-1">
            <label htmlFor="friend-code" className="mb-1.5 block text-xs font-medium text-ink-2">{t('Código do amigo (6 caracteres)')}</label>
            <input
              id="friend-code"
              value={state.codeInput}
              onChange={event => state.setCodeInput(event.target.value.replace(/\s/g, '').toUpperCase())}
              placeholder={t('Ex.: ABC234')}
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              className="telae-code-input field tnum h-10 bg-surface"
            />
          </div>
          <button type="button" onClick={() => void state.add()} disabled={state.busy || state.codeInput.trim().length !== 6} className="telae-press btn btn-primary">
            {state.busy ? t('Adicionando…') : t('Adicionar')}
          </button>
          <button type="button" onClick={state.closeAddForm} className="telae-press btn btn-ghost">{t('Cancelar')}</button>
          {(state.error || state.success) && (
            <p role={state.error ? 'alert' : 'status'} className={`w-full text-sm ${state.error ? 'text-danger-soft' : 'text-ok'}`}>{state.error ?? state.success}</p>
          )}
        </div>
      )}
      {state.error && !state.addOpen && <p role="alert" className="mt-3 text-sm text-danger-soft">{state.error}</p>}
      {state.success && !state.addOpen && <p role="status" className="mt-3 text-sm text-ok">{state.success}</p>}
      {watchError && <p role="alert" className="mt-3 text-sm text-danger-soft">{watchError}</p>}

      {requests.length > 0 && (
        <section aria-labelledby="requests-title" className="mt-5 rounded-xl border border-line-warm bg-warm p-4">
          <div className="flex items-center gap-2">
            <h2 id="requests-title" className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
              <UserPlus size={15} aria-hidden="true" className="text-signal" /> {t('Pedidos de amizade')}
            </h2>
            <span className="count tnum">{requests.length}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">{t('Essas pessoas te adicionaram. Aceite para assistirem uma à outra.')}</p>
          <ul className="mt-3 grid gap-2">
            {requests.map(request => (
              <li key={request.deviceId} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-canvas px-3 py-2.5">
                <span aria-hidden="true" className="avatar h-9 w-9">{initialOf(request.displayName)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-none">{request.displayName}</p>
                  <p className="tnum mt-1.5 font-mono text-[11px] text-ink-4">· {request.friendCode}</p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => void state.add(request.friendCode)} disabled={state.busy || !online} className="telae-press btn btn-primary btn-sm">{t('Adicionar de volta')}</button>
                  <button type="button" onClick={() => void state.dismissRequest(request.friendCode)} disabled={state.busy} className="telae-press btn btn-ghost btn-sm">{t('Ignorar')}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {friends.length === 0 && !online ? (
        <div role="status" className="mt-5 grid gap-2" aria-label={t('Conectando ao servidor')}>
          {[0, 1, 2].map(index => (
            <div key={index} className="flex items-center gap-3 rounded-xl border border-line bg-canvas/60 px-3 py-2.5">
              <span className="skeleton h-9 w-9 rounded-full" />
              <div className="grid flex-1 gap-2"><span className="skeleton h-3 w-24" /><span className="skeleton h-2.5 w-16" /></div>
            </div>
          ))}
          <p className="mt-1 text-center text-xs text-ink-3">{t('Conectando ao servidor…')}</p>
        </div>
      ) : friends.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-line-strong px-6 py-9 text-center">
          <div aria-hidden="true" className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line-strong bg-raised text-ink-3"><Users size={19} /></div>
          <p className="mt-3 text-sm font-medium text-ink">{t('Nenhum amigo ainda')}</p>
          <p className="mx-auto mt-1.5 max-w-[32ch] text-xs leading-relaxed text-ink-3">
            {t('Adicione pelo código de 6 letras que aparece no app do seu amigo. Quando ele estiver transmitindo, você verá')} <span className="font-semibold text-signal">{t('Ao vivo')}</span> {t('aqui e poderá assistir em 1 clique.')}
          </p>
          <button type="button" onClick={() => state.setAddOpen(true)} className="telae-press btn btn-primary mt-4">{t('Adicionar primeiro amigo')}</button>
        </div>
      ) : (
        <ul className="telae-friends-list mt-5 grid gap-2">
          {visible.length === 0 ? (
            <li className="rounded-xl border border-line bg-canvas px-4 py-8 text-center text-sm text-ink-3">{t('Nenhum amigo transmitindo agora.')}</li>
          ) : visible.map(friend => (
            <FriendRow
              key={friend.friendCode}
              friend={friend}
              state={state}
              canWatch={canWatch}
              watching={watchingDeviceId === friend.deviceId}
              onWatch={onWatch}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

