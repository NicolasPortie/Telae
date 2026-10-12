import { Check, RefreshCw } from 'lucide-react'
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
  const message = status.phase === 'checking' ? 'Verificando atualizações…'
    : downloading ? `Baixando Telae ${status.version}`
    : failed ? status.message
    : waiting ? `Telae ${status.version} pronto. Atualização automática ao encerrar a transmissão.`
    : `Atualizando para Telae ${status.version}… O aplicativo será reaberto automaticamente.`
  return (
    <div className="shrink-0 border-t border-line bg-active">
      <div className="mx-auto max-w-[1120px] px-6 py-3">
        <div className="flex items-center gap-3 text-xs text-ink">
          {waiting ? <Check size={16} aria-hidden="true" className="shrink-0 text-signal" />
            : <RefreshCw size={16} aria-hidden="true" className={`shrink-0 text-signal ${failed ? '' : 'telae-update-spinner'}`} />}
          <p role="status" className="min-w-0 flex-1">{message}</p>
          {downloading && <span aria-hidden="true" className="tnum shrink-0">{Math.round(percent)}%</span>}
          {failed && <button type="button" onClick={onRetry} className="telae-press min-h-[40px] shrink-0 rounded-md px-3 font-semibold text-signal underline">Tentar novamente</button>}
        </div>
        {downloading && <progress aria-label="Download da atualização" max={100} value={percent} className="telae-update-progress mt-2 block h-1.5 w-full" />}
      </div>
    </div>
  )
}
