import { Settings } from 'lucide-react'
import { getLocale, t } from '../i18n'
import type { UpdateStatus } from '../shared/contracts'
import { UpdateNotice } from './UpdateNotice'

const CONNECTION = {
  online: { label: () => t('Conectado'), className: 'is-online' },
  connecting: { label: () => t('Conectando…'), className: 'is-connecting' },
  offline: { label: () => t('Sem conexão'), className: 'is-offline' },
} as const

/** Barra de título do app: marca à esquerda; conexão e conta à direita. Os controles da janela ficam na área reservada. */
export function AppHeader({ version, displayName, signedIn, connection, profileLocked, updateStatus, sessionActive, connectError, onOpenProfile, onRetryUpdate, onReconnect }: {
  version: string | null
  displayName: string | undefined
  /** Sem conta (tela de entrada) o cabeçalho mostra só a marca. */
  signedIn: boolean
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
      <div className="telae-header-bar flex items-center gap-3 pl-5 pr-3">
        <span aria-hidden="true" className="telae-mark" />
        <p className="telae-wordmark">Telaê</p>
        {version && <span aria-label={t('Versão instalada')} title={t('Versão instalada')} className="tnum font-mono text-[10px] text-ink-4">v{version}</span>}
        <span className="ml-auto" />
        {signedIn && <span className={`telae-connection ${CONNECTION[connection].className}`}>
          <span aria-hidden="true" className="telae-connection-dot" />
          {CONNECTION[connection].label()}
        </span>}
        {signedIn && <button
          type="button"
          onClick={onOpenProfile}
          disabled={profileLocked}
          title={profileLocked ? t('Pare de transmitir pra abrir as configurações.') : t('Configurações')}
          className="telae-press telae-profile-chip"
          aria-label={t('Abrir configurações')}
        >
          {displayName && <span aria-hidden="true" className="avatar h-6 w-6 text-[11px]">{displayName.trim().slice(0, 1).toLocaleUpperCase(getLocale())}</span>}
          {displayName && <span className="max-w-[140px] truncate">{displayName}</span>}
          <Settings size={14} aria-hidden="true" className={displayName ? 'text-ink-4' : 'ml-2'} />
        </button>}
      </div>
      <UpdateNotice status={updateStatus} sessionActive={sessionActive} onRetry={onRetryUpdate} />
      {connectError && (
        <div className="border-t border-line">
          <p role="alert" className="px-5 py-2 text-xs text-danger-soft">
            {connectError}{' '}
            <button type="button" onClick={onReconnect} className="font-medium underline underline-offset-2">{t('Reconectar')}</button>
          </p>
        </div>
      )}
    </header>
  )
}
