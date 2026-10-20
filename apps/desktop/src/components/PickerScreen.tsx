import { ArrowLeft } from 'lucide-react'
import { t } from '../i18n'
import type { CaptureSource } from '../shared/contracts'
import type { QualityProfile } from '../services/types'
import { QualityPicker } from './QualityPicker'
import { SourceGroup } from './SourceGroup'

/** Escolha da tela ou janela e da qualidade antes de começar (ou de trocar a fonte durante a transmissão). */
export function PickerScreen({
  sources, loading, error, selectedId, onSelect, quality, onQuality,
  switching, busy, formError, onBack, onReload, onStart,
}: {
  sources: CaptureSource[]
  loading: boolean
  error: string | null
  selectedId: string
  onSelect: (id: string) => void
  quality: QualityProfile
  onQuality: (quality: QualityProfile) => void
  /** Troca de fonte com a transmissão ativa: a qualidade não muda. */
  switching: boolean
  busy: boolean
  formError: string | null
  onBack: () => void
  onReload: () => void
  onStart: () => void
}) {
  const screens = sources.filter(item => item.kind === 'screen')
  const windows = sources.filter(item => item.kind === 'window')
  const selectedName = sources.find(item => item.id === selectedId)?.name

  return (
    <section aria-labelledby="picker-title" className="telae-panel-enter telae-picker-section">
      <div className="shrink-0 pb-3 pt-4">
        <button type="button" onClick={onBack} className="telae-press btn btn-ghost btn-sm -ml-2">
          <ArrowLeft size={16} aria-hidden="true" /> {t('Voltar')}
        </button>
        <h1 id="picker-title" className="mt-3 text-[28px] font-semibold tracking-[-0.035em]">{t('O que você quer compartilhar?')}</h1>
        <p className="mt-1.5 text-sm text-ink-3">
          {switching ? t('A transmissão continua ativa durante a troca.') : t('A captura só começa depois da sua confirmação.')} {t('O som de uma janela vem apenas do aplicativo escolhido.')}
        </p>
      </div>

      {loading && <p className="mt-6 text-sm text-ink-3">{t('Listando telas e janelas…')}</p>}

      {error && (
        <div className="card mt-6 p-4">
          <p className="text-sm">{error}</p>
          <button type="button" onClick={onReload} className="telae-press btn btn-secondary mt-3">{t('Tentar de novo')}</button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div role="region" aria-label={t('Fontes disponíveis')} tabIndex={0} className="telae-picker-sources min-h-0 flex-1 overflow-y-auto px-1 pb-4">
            <SourceGroup title={t('Telas')} sources={screens} selectedId={selectedId} onSelect={onSelect} />
            <SourceGroup title={t('Janelas')} sources={windows} selectedId={selectedId} onSelect={onSelect} />
          </div>

          <div className="card shrink-0 p-4">
            <p className="mb-3 truncate text-sm font-medium" title={selectedName}>{selectedName ?? t('Escolha uma tela ou janela acima')}</p>
            <div className="telae-picker-action-row">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                {!switching && <QualityPicker value={quality} onChange={onQuality} />}
              </div>
              {formError && <p role="alert" className="mt-4 text-sm text-danger-soft">{formError}</p>}
              <div className="telae-picker-submit">
                <button type="button" onClick={onStart} disabled={busy || !selectedId} className="telae-press telae-primary-action btn btn-primary btn-lg w-full">
                  {busy ? t('Preparando…') : switching ? t('Trocar fonte agora') : t('Começar a compartilhar')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
