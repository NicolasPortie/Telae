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
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[#B8B4AA]">{title}<span aria-hidden="true" className="telae-count tnum">{sources.length}</span></h2>
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
                className={`telae-press telae-source-card relative block w-full overflow-hidden rounded-xl border bg-[#141412] text-left ${
                  active ? 'border-[#D8A85C] ring-1 ring-[#D8A85C]/40' : 'border-[#313029] hover:border-[#9D9A90]'
                }`}
              >
                {source.thumbnailDataUrl ? (
                  <img src={source.thumbnailDataUrl} alt="" aria-hidden="true" draggable={false} className="aspect-video w-full object-contain" />
                ) : (
                  <span aria-hidden="true" className="block aspect-video w-full bg-[#1C1C19]" />
                )}
                {active && (
                  <span aria-hidden="true" className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-[#D8A85C]/50 bg-[#141412]/95 px-2 py-1 text-[11px] font-semibold text-[#E8C690]">
                    <Check size={12} /> Selecionada
                  </span>
                )}
                <span
                  className={`block truncate border-t px-3 py-3 text-[13px] ${
                    active ? 'border-[#D8A85C] bg-[#282721] font-semibold text-[#F1EFE8]' : 'border-[#313029] text-[#9D9A90]'
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
