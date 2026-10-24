import { useRef } from 'react'
import { Check, Monitor, AppWindow } from 'lucide-react'
import { t } from '../i18n'
import type { CaptureSource } from '../shared/contracts'

export function SourceGroup({
  title,
  sources,
  selectedId,
  onSelect,
  showHeading = true,
}: {
  title: string
  /** Falso quando o título já aparece numa aba. O nome acessível do grupo continua o mesmo. */
  showHeading?: boolean
  sources: CaptureSource[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const tabStopId = sources.some(source => source.id === selectedId) ? selectedId : sources[0]?.id
  if (sources.length === 0) return null
  return (
    <div className="telae-source-group">
      {showHeading && <h2 className="telae-source-heading">{title}<span aria-hidden="true" className="tnum text-xs text-ink-4">{sources.length}</span></h2>}
      <ul role="radiogroup" aria-label={title} className="telae-source-grid">
        {sources.map((source, index) => {
          const active = source.id === selectedId
          return (
            <li key={source.id} className="min-w-0 telae-source-item" style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
              <button
                type="button"
                role="radio"
                ref={button => {
                  if (button) buttons.current.set(source.id, button)
                  else buttons.current.delete(source.id)
                }}
                tabIndex={source.id === tabStopId ? 0 : -1}
                title={source.name}
                aria-label={source.name}
                aria-checked={active}
                onClick={() => onSelect(source.id)}
                onKeyDown={event => {
                  let nextIndex: number
                  switch (event.key) {
                    case 'ArrowRight':
                    case 'ArrowDown': nextIndex = (index + 1) % sources.length; break
                    case 'ArrowLeft':
                    case 'ArrowUp': nextIndex = (index - 1 + sources.length) % sources.length; break
                    case 'Home': nextIndex = 0; break
                    case 'End': nextIndex = sources.length - 1; break
                    default: return
                  }
                  event.preventDefault()
                  const next = sources[nextIndex]
                  onSelect(next.id)
                  buttons.current.get(next.id)?.focus()
                }}
                className="telae-press telae-source-card"
              >
                {source.thumbnailDataUrl ? (
                  <img src={source.thumbnailDataUrl} alt="" aria-hidden="true" draggable={false} className="aspect-video w-full object-contain" />
                ) : (
                  <span aria-hidden="true" className="telae-source-placeholder">{source.kind === 'screen' ? <Monitor size={28} strokeWidth={1.75} /> : <AppWindow size={28} strokeWidth={1.75} />}</span>
                )}
                {active && (
                  <span aria-hidden="true" className="telae-source-selected">
                    <Check size={12} strokeWidth={1.75} /> {t('Escolhida')}
                  </span>
                )}
                <span
                  className="telae-source-name"
                >
                  {source.name}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
