import { Check, RefreshCw } from 'lucide-react'
import { t } from '../i18n'
import type { UpdateStatus } from '../shared/contracts'

export function UpdateNotice({ status, sessionActive, onRetry }: {
  status: UpdateStatus | null
  sessionActive: boolean
  onRetry: () => void
}) {
  if (!status || status.phase === 'idle' || status.phase === 'current') return null
  const downloading = status.phase === 'downloading'
  const waiting = status.phase === 'ready' && sessionActive
  const failed = status.phase === 'error'
  const percent = downloading ? Math.max(0, Math.min(100, Number.isFinite(status.percent) ? status.percent : 0)) : 0
  const message = status.phase === 'checking' ? t('Verificando atualizações…')
    : downloading ? t('Baixando a versão {version}', { version: status.version })
    : failed ? status.message
    : waiting ? t('A versão {version} está pronta. Instalo quando você parar de transmitir.', { version: status.version })
    : t('Instalando a versão {version}. O Telae reabre sozinho.', { version: status.version })
  return (
    <div className="shrink-0 border-t border-line bg-warm">
      <div className="px-5 py-2.5">
        <div className="flex items-center gap-3 text-xs text-ink">
          {waiting ? <Check size={16} aria-hidden="true" className="shrink-0 text-signal" />
            : <RefreshCw size={16} aria-hidden="true" className={`shrink-0 text-signal ${failed ? '' : 'telae-update-spinner'}`} />}
          <p role="status" className="min-w-0 flex-1">{message}</p>
          {downloading && <span aria-hidden="true" className="tnum shrink-0 font-mono">{Math.round(percent)}%</span>}
          {failed && <button type="button" onClick={onRetry} className="telae-press btn btn-ghost btn-sm shrink-0 text-signal">{t('Tentar novamente')}</button>}
        </div>
        {downloading && <progress aria-label={t('Download da atualização')} max={100} value={percent} className="telae-update-progress mt-2 block h-1 w-full" />}
      </div>
    </div>
  )
}
