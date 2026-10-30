import { X } from 'lucide-react'
import type { FriendsState } from '../hooks/useFriends'
import { t } from '../i18n'
import type { DeviceSnapshot } from '../services/types'
import { avatarInitial, avatarTone } from '../ui/avatar'

/**
 * Quem te adicionou e espera resposta. Fica no alto da lista, uma linha por pessoa: Aceitar adiciona de volta
 * (e vocês passam a assistir um ao outro); o X ignora o pedido sem avisar ninguém.
 */
export function FriendRequests({ requests, state, online }: {
  requests: DeviceSnapshot[]
  state: FriendsState
  /** Conectado ao servidor: aceitar precisa dele. */
  online: boolean
}) {
  if (requests.length === 0) return null
  return (
    <section aria-labelledby="requests-title" className="telae-requests">
      <h3 id="requests-title" className="telae-requests-title">
        {t('Pedidos de amizade')}
        <span className="count tnum">{requests.length}</span>
      </h3>
      <ul>
        {requests.map(request => (
          <li key={request.deviceId} className="telae-request">
            <span aria-hidden="true" className="telae-avatar telae-request-avatar" style={{ background: avatarTone(request.displayName) }}>{avatarInitial(request.displayName)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium leading-tight">{request.displayName}</p>
              <p className="mt-0.5 truncate text-[12px] text-ink-4">@{request.friendCode}</p>
            </div>
            <button
              type="button"
              onClick={() => void state.add(request.friendCode)}
              disabled={state.busy || !online}
              title={t('Adicionar {name} de volta', { name: request.displayName })}
              className="telae-press telae-accent-chip"
            >
              {t('Aceitar')}
            </button>
            <button
              type="button"
              onClick={() => void state.dismissRequest(request.friendCode)}
              disabled={state.busy}
              title={t('Ignorar')}
              aria-label={t('Ignorar {name}', { name: request.displayName })}
              className="telae-press telae-icon-button !h-8 !w-8 !border-0"
            >
              <X size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
