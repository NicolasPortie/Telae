import { MonitorOff } from 'lucide-react'
import { t } from '../i18n'
import type { DeviceSnapshot } from '../services/types'
import { LiveFriendsSwitch } from './LiveFriendsSwitch'

/** Encerramento com retorno ao início e troca para outro amigo. */
export function EndedSession({ error, friends, watchingDeviceId, busy, watchError, onHome, onWatch }: {
  error: string | null
  friends: DeviceSnapshot[]
  watchingDeviceId: string | null
  busy: boolean
  watchError: string | null
  onHome: () => void
  onWatch: (friend: DeviceSnapshot) => void
}) {
  return (
    <section aria-labelledby="ended-title" className="telae-panel-enter telae-ended">
      <div className="telae-ended-message">
        <span className="telae-empty-icon" aria-hidden="true"><MonitorOff size={24} strokeWidth={1.75} /></span>
        <h1 id="ended-title" className="telae-session-title">{t('A transmissão acabou.')}</h1>
        {error && <p className="mt-3 text-sm leading-relaxed text-ink-3">{error}</p>}
        <button type="button" onClick={onHome} className="telae-press btn btn-primary mt-6">{t('Voltar ao início')}</button>
      </div>
      <div className="telae-ended-friends">
        <LiveFriendsSwitch friends={friends} currentSharerDeviceId={null} pendingDeviceId={watchingDeviceId}
          disabled={busy || watchingDeviceId !== null} error={watchError} onWatch={onWatch} />
      </div>
    </section>
  )
}
