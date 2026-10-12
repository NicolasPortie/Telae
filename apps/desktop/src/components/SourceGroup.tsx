import { useRef } from 'react'
import { Check } from 'lucide-react'
import type { CaptureSource } from '../shared/contracts'

export function SourceGroup({
  title,
  sources,
  selectedId,
  onSelect,
}: {
  title: string
  sources: CaptureSource[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const tabStopId = sources.some(source => source.id === selectedId) ? selectedId : sources[0]?.id
  if (sources.length === 0) return null
  return (
    <div className="mt-6">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-2">{title}<span aria-hidden="true" className="telae-count tnum">{sources.length}</span></h2>
      <ul role="radiogroup" aria-label={title} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sources.map((source, index) => {
          const active = source.id === selectedId
          return (
            <li key={source.id}>
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
                className={`telae-press telae-source-card relative block w-full overflow-hidden rounded-xl border bg-canvas text-left ${
                  active ? 'border-signal ring-1 ring-signal/40' : 'border-line hover:border-ink-3'
                }`}
              >
                {source.thumbnailDataUrl ? (
                  <img src={source.thumbnailDataUrl} alt="" aria-hidden="true" draggable={false} className="aspect-video w-full object-contain" />
                ) : (
                  <span aria-hidden="true" className="block aspect-video w-full bg-surface" />
                )}
                {active && (
                  <span aria-hidden="true" className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-signal/50 bg-canvas/95 px-2 py-1 text-[11px] font-semibold text-signal-soft">
                    <Check size={12} /> Selecionada
                  </span>
                )}
                <span
                  className={`block truncate border-t px-3 py-3 text-[13px] ${
                    active ? 'border-signal bg-active font-semibold text-ink' : 'border-line text-ink-3'
                  }`}
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
