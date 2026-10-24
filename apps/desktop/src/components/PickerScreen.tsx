import { useState } from 'react'
import { AlertTriangle, AppWindow, ArrowLeft, Monitor } from 'lucide-react'
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
  const selectedKind = sources.find(item => item.id === selectedId)?.kind
  // Abre na aba de quem já está escolhido (troca de fonte); senão, nas telas.
  const [chosenTab, setTab] = useState<'screen' | 'window' | null>(null)
  const tab = chosenTab && (chosenTab === 'screen' ? screens : windows).length > 0 ? chosenTab
    : selectedKind ?? (screens.length > 0 ? 'screen' : 'window')
  const tabs = [
    { id: 'screen' as const, label: t('Telas'), list: screens, Icon: Monitor },
    { id: 'window' as const, label: t('Janelas'), list: windows, Icon: AppWindow },
  ]
  const moveTab = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    setTab(next.id)
    document.getElementById(`picker-tab-${next.id}`)?.focus()
  }

  return (
    <section aria-labelledby="picker-title" className="telae-panel-enter telae-picker-section">
      <header className="telae-picker-heading">
        <button type="button" onClick={onBack} className="telae-press btn btn-ghost btn-sm -ml-2">
          <ArrowLeft size={16} aria-hidden="true" /> {t('Voltar')}
        </button>
        <div className="telae-picker-titlebar">
          <div className="min-w-0">
            <h1 id="picker-title" className="telae-session-title">{t('O que você quer mostrar?')}</h1>
            <p className="mt-1.5 text-sm text-ink-3">
              {switching ? t('A transmissão segue no ar durante a troca.') : t('Nada sai do seu PC até você começar a transmitir.')} {t('O som de uma janela é só o do app dela.')}
            </p>
          </div>
          {!loading && !error && (
            <div role="tablist" aria-label={t('Tipo de fonte')} className="telae-picker-tabs">
              {tabs.map(({ id, label, list, Icon }, index) => (
                <button
                  key={id}
                  id={`picker-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls="picker-panel"
                  tabIndex={tab === id ? 0 : -1}
                  disabled={list.length === 0}
                  onClick={() => setTab(id)}
                  onKeyDown={event => moveTab(event, index)}
                  className="telae-press telae-picker-tab"
                >
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  {label}
                  <span className="tnum telae-picker-tab-count">{list.length}</span>
                  {selectedKind === id && <span aria-hidden="true" className="telae-picker-tab-dot" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {loading && (
        <div role="status" aria-label={t('Procurando telas e janelas…')} className="telae-picker-sources">
          {[t('Telas'), t('Janelas')].map(title => (
            <div key={title} className="telae-source-group">
              <h2 className="telae-source-heading">{title}</h2>
              <div className="telae-source-grid">{[0, 1].map(index => <span key={index} className="skeleton telae-source-skeleton" />)}</div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="telae-picker-error">
          <AlertTriangle size={20} strokeWidth={1.75} aria-hidden="true" />
          <div>
            <p className="text-[14px] font-medium text-ink">{error}</p>
            <p className="mt-1 text-[13px] text-ink-3">{t('Isso costuma passar sozinho. Tenta de novo em alguns segundos.')}</p>
            <button type="button" onClick={onReload} className="telae-press btn btn-secondary btn-sm mt-3">{t('Tentar de novo')}</button>
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          <div role="region" aria-label={t('Fontes disponíveis')} tabIndex={0} className="telae-picker-sources">
            <div key={tab} id="picker-panel" role="tabpanel" aria-labelledby={`picker-tab-${tab}`} className="telae-picker-panel">
              <SourceGroup
                title={tab === 'screen' ? t('Telas') : t('Janelas')}
                sources={tab === 'screen' ? screens : windows}
                selectedId={selectedId}
                onSelect={onSelect}
                showHeading={false}
              />
            </div>
          </div>

          <div className={`telae-picker-footer ${switching ? 'is-switching' : ''}`}>
            <div className="telae-picker-action-row">
              <div className="min-w-0 flex-1">
                {!switching && <QualityPicker value={quality} onChange={onQuality} />}
              </div>
              {formError && <p role="alert" className="mt-4 text-sm text-danger-soft">{formError}</p>}
              <div className="telae-picker-submit">
                {switching && <button type="button" onClick={onBack} className="telae-press btn btn-ghost btn-lg">{t('Cancelar')}</button>}
                <button type="button" onClick={onStart} disabled={busy || !selectedId} className="telae-press telae-primary-action btn btn-primary btn-lg w-full">
                  {busy ? t('Preparando…') : switching ? t('Trocar fonte agora') : t('Começar a transmitir')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
