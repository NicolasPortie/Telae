import { t } from '../i18n'
import { qualityOptions } from '../ui/format'
import type { QualityProfile } from '../services/types'

/** Perfis de qualidade como cartões: resolução e FPS sempre visíveis, e a explicação do escolhido. */
export function QualityPicker({ value, onChange }: { value: QualityProfile; onChange: (profile: QualityProfile) => void }) {
  const active = qualityOptions().find(option => option.value === value)
  return (
    <fieldset className="telae-quality">
      <legend className="telae-quality-label">{t('Qualidade')}</legend>
      <div role="radiogroup" aria-label={t('Qualidade da imagem')} aria-describedby="quality-detail" className="telae-quality-options">
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
              className="telae-press telae-quality-option"
            >
              <span className="text-[13px] font-semibold leading-none">{option.resolution}</span>
              <span className={`tnum font-mono text-[11px] leading-none ${selected ? 'text-signal' : 'text-ink-4'}`}>{option.fps}</span>
            </button>
          )
        })}
      </div>
      <p id="quality-detail" key={value} className="telae-quality-hint">{active?.detail}</p>
    </fieldset>
  )
}
