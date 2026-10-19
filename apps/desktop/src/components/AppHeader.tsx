import { Settings } from 'lucide-react'
import type { UpdateStatus } from '../shared/contracts'
import { UpdateNotice } from './UpdateNotice'

const CONNECTION = {
  online: { label: 'Conectado ao servidor', className: 'is-online' },
  connecting: { label: 'Conectando ao servidor…', className: 'is-connecting' },
  offline: { label: 'Sem conexão com o servidor', className: 'is-offline' },
} as const

/** Barra de título do app: marca, versão instalada e perfil. Os controles da janela ficam à direita (área reservada). */
export function AppHeader({ version, displayName, connection, profileLocked, updateStatus, sessionActive, connectError, onOpenProfile, onRetryUpdate, onReconnect }: {
  version: string | null
  displayName: string | undefined
  connection: 'online' | 'connecting' | 'offline'
  profileLocked: boolean
  updateStatus: UpdateStatus | null
  sessionActive: boolean
  connectError: string | null
  onOpenProfile: () => void
  onRetryUpdate: () => void
  onReconnect: () => void
}) {
  return (
    <header className="telae-header shrink-0">
      <div className="telae-header-bar flex h-12 items-center gap-3 pl-5 pr-3">
        <span aria-hidden="true" className="telae-mark" />
        <p className="text-[16px] font-semibold tracking-[-0.03em]">Telae</p>
        {version && <span aria-label="Versão instalada" title="Versão instalada" className="telae-version tnum">v{version}</span>}
        <span className="ml-auto" />
        <span
          role="img"
          aria-label={CONNECTION[connection].label}
          title={CONNECTION[connection].label}
          className={`telae-connection ${CONNECTION[connection].className}`}
        />
        <button
          type="button"
          onClick={onOpenProfile}
          disabled={profileLocked}
          title={profileLocked ? 'Encerre a transmissão para abrir as configurações.' : 'Configurações'}
          className="telae-press telae-profile-chip"
          aria-label="Abrir configurações"
        >
          {displayName && <span aria-hidden="true" className="avatar avatar-live h-6 w-6 text-[11px]">{displayName.trim().slice(0, 1).toLocaleUpperCase('pt-BR')}</span>}
          {displayName && <span className="max-w-[140px] truncate">{displayName}</span>}
          <Settings size={14} aria-hidden="true" className={displayName ? 'text-ink-4' : 'ml-2'} />
        </button>
      </div>
      <UpdateNotice status={updateStatus} sessionActive={sessionActive} onRetry={onRetryUpdate} />
      {connectError && (
        <div className="border-t border-line">
          <p role="alert" className="px-5 py-2 text-xs text-danger-soft">
            {connectError}{' '}
            <button type="button" onClick={onReconnect} className="font-medium underline underline-offset-2">Reconectar</button>
          </p>
        </div>
      )}
    </header>
  )
}
