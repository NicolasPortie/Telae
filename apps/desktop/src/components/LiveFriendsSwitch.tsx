import { t } from '../i18n'
import { liveFriendsExcept } from '../services/friends'
import type { DeviceSnapshot } from '../services/types'

/**
 * Amigos ao vivo para trocar de transmissão sem voltar à lista. O amigo que já está sendo
 * assistido não aparece. Erros de troca são mostrados aqui, sem interromper a transmissão atual.
 */
export function LiveFriendsSwitch({ friends, currentSharerDeviceId, pendingDeviceId, disabled, error, onWatch }: {
  friends: DeviceSnapshot[]
  currentSharerDeviceId: string | null
  pendingDeviceId: string | null
  disabled: boolean
  error: string | null
  onWatch: (friend: DeviceSnapshot) => void
}) {
  const options = liveFriendsExcept(friends, currentSharerDeviceId)
  if (options.length === 0 && !error) return null
  return (
    <div className="telae-live-switch">
      {options.length > 0 && (
        <>
          <span className="telae-live-switch-label">{t('Em cartaz')}</span>
          <ul className="telae-live-switch-list" aria-label={t('Amigos ao vivo')}>
            {options.map(friend => (
              <li key={friend.deviceId}>
                <button
                  type="button"
                  onClick={() => onWatch(friend)}
                  disabled={disabled}
                  aria-busy={pendingDeviceId === friend.deviceId}
                  className="telae-press telae-live-chip"
                >
                  <span aria-hidden="true" className="telae-live-dot" />
                  {pendingDeviceId === friend.deviceId ? t('Entrando…') : friend.displayName}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p role="alert" className="telae-live-switch-error">{error}</p>}
    </div>
  )
}
