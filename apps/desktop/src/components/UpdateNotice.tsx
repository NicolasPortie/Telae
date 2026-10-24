import { Check, RefreshCw } from 'lucide-react'
import { t } from '../i18n'
import type { UpdateStatus } from '../shared/contracts'

export function UpdateNotice({ status, sessionActive, onRetry }: {
  status: UpdateStatus | null
  sessionActive: boolean
  onRetry: () => void
}) {
  if (!status || status.phase === 'idle' || status.phase === 'current' || status.phase === 'unavailable') return null
  const manual = status.phase === 'manual'
  const downloading = status.phase === 'downloading'
  const waiting = status.phase === 'ready' && sessionActive
  const failed = status.phase === 'error'
  const percent = downloading ? Math.max(0, Math.min(100, Number.isFinite(status.percent) ? status.percent : 0)) : 0
  const message = status.phase === 'checking' ? t('Buscando atualização…')
    : downloading ? t('Baixando a versão {version}', { version: status.version })
    : failed ? status.message
    : manual ? t('A versão {version} está disponível.', { version: status.version })
    : waiting ? t('A versão {version} está pronta. Instalamos quando você parar de transmitir.', { version: status.version })
    : t('Instalando a versão {version}. O Telaê reabre sozinho.', { version: status.version })
  return (
    <div className="telae-update-notice">
      <div className="px-5 py-3">
        <div className="flex items-center gap-3 text-xs text-ink">
          {waiting ? <Check size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ok" />
            : <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" className={`shrink-0 ${failed ? 'text-warn' : manual ? 'text-ink-3' : 'text-ink-3 telae-update-spinner'}`} />}
          <p role="status" className="min-w-0 flex-1">{message}</p>
          {downloading && <span aria-hidden="true" className="tnum shrink-0 font-mono">{Math.round(percent)}%</span>}
          {failed && <button type="button" onClick={onRetry} className="telae-press btn btn-ghost btn-sm shrink-0 text-ink">{t('Tentar de novo')}</button>}
          {manual && <button type="button" onClick={onRetry} className="telae-press btn btn-ghost btn-sm shrink-0 text-ink">{t('Baixar atualização')}</button>}
        </div>
        {downloading && <progress aria-label={t('Download da atualização')} max={100} value={percent} className="telae-update-progress mt-2 block h-1 w-full" />}
      </div>
    </div>
  )
}
