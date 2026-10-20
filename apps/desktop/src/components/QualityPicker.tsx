import { t } from '../i18n'
import { qualityOptions } from '../ui/format'
import type { QualityProfile } from '../services/types'

/** Perfis de qualidade como cartões: resolução e FPS sempre visíveis, e a explicação do escolhido. */
export function QualityPicker({ value, onChange }: { value: QualityProfile; onChange: (profile: QualityProfile) => void }) {
  const active = qualityOptions().find(option => option.value === value)
  return (
    <fieldset className="min-w-0">
      <legend className="eyebrow mb-2.5">{t('Qualidade')}</legend>
      <div role="radiogroup" aria-label={t('Qualidade da imagem')} aria-describedby="quality-detail" className="flex flex-wrap gap-2">
        {qualityOptions().map(option => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              title={option.hint}
              onClick={() => onChange(option.value)}
              className={`telae-press flex min-h-[50px] min-w-[100px] flex-col items-start justify-center rounded-xl border px-3.5 py-2 text-left ${
                selected ? 'border-signal/60 bg-signal/10 text-ink shadow-[0_0_0_3px_rgba(224,174,94,0.12)]' : 'border-line bg-canvas/60 text-ink-3 hover:border-line-input hover:text-ink'
              }`}
            >
              <span className="text-[13px] font-semibold leading-tight">{option.resolution}</span>
              <span className={`tnum mt-0.5 font-mono text-[11px] leading-tight ${selected ? 'text-signal' : 'text-ink-4'}`}>{option.fps}</span>
            </button>
          )
        })}
      </div>
      <p id="quality-detail" className="mt-2.5 max-w-[62ch] text-xs leading-relaxed text-ink-3">{active?.detail}</p>
    </fieldset>
  )
}
