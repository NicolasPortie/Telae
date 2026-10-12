import { QUALITY_OPTIONS } from '../ui/format'
import type { QualityProfile } from '../services/types'

/** Perfis de qualidade como cartões: resolução e FPS sempre visíveis, e a explicação do escolhido. */
export function QualityPicker({ value, onChange }: { value: QualityProfile; onChange: (profile: QualityProfile) => void }) {
  const active = QUALITY_OPTIONS.find(option => option.value === value)
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-medium text-ink-3">Qualidade</legend>
      <div role="radiogroup" aria-label="Qualidade da imagem" aria-describedby="quality-detail" className="flex flex-wrap gap-2">
        {QUALITY_OPTIONS.map(option => {
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
              className={`telae-press flex min-h-[48px] min-w-[96px] flex-col items-start justify-center rounded-lg border px-3 py-1.5 text-left ${
                selected ? 'border-signal bg-active text-ink' : 'border-line bg-transparent text-ink-3 hover:border-line-strong hover:text-ink'
              }`}
            >
              <span className="text-[13px] font-semibold leading-tight">{option.resolution}</span>
              <span className={`tnum text-[11px] leading-tight ${selected ? 'text-signal' : 'text-ink-4'}`}>{option.fps}</span>
            </button>
          )
        })}
      </div>
      <p id="quality-detail" className="mt-2.5 max-w-[62ch] text-xs leading-relaxed text-ink-3">{active?.detail}</p>
    </fieldset>
  )
}
