import type { FriendsState } from '../hooks/useFriends'
import { t } from '../i18n'

/**
 * Adicionar um amigo pelo @usuário: um campo só, com o botão dentro dele. Enter envia e Esc fecha.
 * A frase de ajuda apresenta o pedido de amizade.
 */
export function AddFriendForm({ state }: { state: FriendsState }) {
  const ready = state.usernameInput.trim().length >= 3
  return (
    <form
      aria-label={t('Adicionar amigo')}
      className="telae-add-friend"
      onSubmit={event => { event.preventDefault(); if (ready) void state.add() }}
      onKeyDown={event => { if (event.key === 'Escape') state.closeAddForm() }}
    >
      <label htmlFor="friend-username" className="sr-only">{t('@ do amigo')}</label>
      <div className="telae-add-field">
        <span aria-hidden="true" className="telae-add-at">@</span>
        <input
          id="friend-username"
          value={state.usernameInput}
          onChange={event => state.setUsernameInput(event.target.value.replace(/[\s@]/g, '').toLowerCase())}
          placeholder={t('usuario')}
          maxLength={20}
          autoComplete="off"
          autoFocus
          spellCheck={false}
          aria-describedby="friend-help"
          className="telae-add-input"
        />
        <button type="submit" disabled={state.busy || !ready} className="telae-press telae-add-submit">
          {state.busy ? t('Adicionando…') : t('Adicionar')}
        </button>
      </div>
      {state.error || state.success ? (
        <p role={state.error ? 'alert' : 'status'} className={`telae-add-feedback ${state.error ? 'is-error' : 'is-ok'}`}>{state.error ?? state.success}</p>
      ) : (
        <p id="friend-help" className="telae-add-help">{t('Envie um pedido de amizade para assistir com um amigo.')}</p>
      )}
    </form>
  )
}
