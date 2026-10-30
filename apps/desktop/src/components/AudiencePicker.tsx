import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, UserCheck, Users } from 'lucide-react'
import { t } from '../i18n'
import { audienceSummary, withModeChange, type Watcher } from '../services/audience'
import type { AudienceMode, DeviceSnapshot, ShareAudience } from '../services/types'
import { avatarInitial, avatarTone } from '../ui/avatar'

const MODES: { id: AudienceMode; label: () => string; hint: () => string; Icon: typeof Users }[] = [
  { id: 'friends', label: () => t('Todos os amigos'), hint: () => t('Quem é seu amigo vê você ao vivo.'), Icon: Users },
  { id: 'selected', label: () => t('Amigos escolhidos'), hint: () => t('Só quem você marcar vê você ao vivo.'), Icon: UserCheck },
]

/** Lista de amigos com marcação, para o modo "Amigos escolhidos". Quem está assistindo agora leva uma etiqueta. */
function FriendChecklist({ friends, selected, watching, onChange }: {
  friends: DeviceSnapshot[]
  selected: string[]
  watching: ReadonlySet<string>
  onChange: (selected: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().replace(/^@/, '').toLowerCase()
    const sorted = [...friends].sort((a, b) => a.displayName.localeCompare(b.displayName))
    return needle ? sorted.filter(friend => friend.displayName.toLowerCase().includes(needle) || friend.friendCode.includes(needle)) : sorted
  }, [friends, query])

  if (friends.length === 0) {
    return <p className="telae-audience-note">{t('Você ainda não tem amigos pra escolher. Adicione pela lista do Início.')}</p>
  }
  const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter(name => name !== code) : [...selected, code])
  return (
    <div className="telae-audience-friends">
      <div className="telae-audience-friends-head">
        <p role="status" className="tnum text-[12px] text-ink-3">{t('{count} de {total} podem ver', { count: selected.length, total: friends.length })}</p>
        <div className="flex gap-1">
          <button type="button" onClick={() => onChange(friends.map(friend => friend.friendCode))} disabled={selected.length === friends.length} className="telae-press telae-link-button">{t('Marcar todos')}</button>
          <button type="button" onClick={() => onChange([])} disabled={selected.length === 0} className="telae-press telae-link-button">{t('Limpar')}</button>
        </div>
      </div>
      {friends.length > 4 && (
        <div className="relative">
          <Search size={15} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Buscar amigo')} aria-label={t('Buscar amigo')}
            autoComplete="off" spellCheck={false} className="field h-9 pl-9 text-[13px]" />
        </div>
      )}
      <ul aria-label={t('Amigos que podem ver')} className="telae-audience-checklist">
        {filtered.map(friend => {
          const checked = selected.includes(friend.friendCode)
          const here = watching.has(friend.deviceId)
          return (
            <li key={friend.friendCode}>
              <button type="button" role="checkbox" aria-checked={checked} onClick={() => toggle(friend.friendCode)} className="telae-press telae-audience-check">
                <span aria-hidden="true" className="telae-avatar !h-7 !w-7 !text-[11px]" style={{ background: avatarTone(friend.displayName) }}>{avatarInitial(friend.displayName)}</span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[13px] font-medium leading-tight">{friend.displayName}</span>
                  <span className="block truncate text-[12px] text-ink-4">@{friend.friendCode}</span>
                </span>
                {here && <span className="telae-watching-tag">{t('Assistindo')}</span>}
                <span aria-hidden="true" className="telae-audience-box">{checked && <Check size={13} strokeWidth={2.5} />}</span>
              </button>
            </li>
          )
        })}
        {filtered.length === 0 && <li className="px-2 py-3 text-[13px] text-ink-3">{t('Ninguém com esse nome.')}</li>}
      </ul>
    </div>
  )
}

/**
 * As opções de quem pode ver: todos os amigos ou só alguns. A prévia acompanha automaticamente o público. Com `watchers` (durante a transmissão),
 * passar para "escolhidos" já marca quem está assistindo.
 */
export function AudienceOptions({ value, friends, watchers = [], onChange }: {
  value: ShareAudience
  friends: DeviceSnapshot[]
  watchers?: Watcher[]
  onChange: (value: ShareAudience) => void
}) {
  const groupId = useId()
  const watching = useMemo(() => new Set(watchers.map(watcher => watcher.deviceId)), [watchers])
  const change = (next: ShareAudience) => onChange(withModeChange(value, next, watchers, friends))
  const setMode = (mode: AudienceMode) => change({ ...value, mode })
  const move = (event: React.KeyboardEvent, index: number) => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const next = MODES[(index + 1) % MODES.length]
    setMode(next.id)
    document.getElementById(`${groupId}-${next.id}`)?.focus()
  }
  return (
    <div className="telae-audience-options">
      <div role="radiogroup" aria-label={t('Quem pode ver')} aria-describedby={`${groupId}-hint`} className="telae-segmented">
        {MODES.map(({ id, label, Icon }, index) => {
          const selected = value.mode === id
          return (
            <button key={id} id={`${groupId}-${id}`} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
              onClick={() => setMode(id)} onKeyDown={event => move(event, index)} className="telae-press telae-segment">
              <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
              {label()}
            </button>
          )
        })}
      </div>
      <p id={`${groupId}-hint`} className="telae-audience-hint">{MODES.find(mode => mode.id === value.mode)?.hint()}</p>

      {value.mode === 'selected' && (
        <FriendChecklist friends={friends} selected={value.selected} watching={watching} onChange={selected => change({ ...value, selected })} />
      )}

    </div>
  )
}

/** Resumo de quem pode ver com as opções abrindo logo abaixo; usado antes de começar a transmitir. */
export function AudiencePicker({ value, friends, onChange }: {
  value: ShareAudience
  friends: DeviceSnapshot[]
  onChange: (value: ShareAudience) => void
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const nobody = value.mode === 'selected' && value.selected.length === 0
  const ModeIcon = MODES.find(mode => mode.id === value.mode)?.Icon ?? Users

  // Fecha ao clicar fora ou com Esc: o mesmo painel que abre com um clique também fecha com um.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={open ? 'telae-audience is-open' : 'telae-audience'}>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(current => !current)} className="telae-press telae-audience-toggle">
        <ModeIcon size={15} strokeWidth={1.75} aria-hidden="true" className="telae-audience-mode-icon" />
        <span className="telae-audience-label">{t('Quem pode ver')}</span>
        <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium">{audienceSummary(value)}</span>
        <span className="telae-audience-toggle-hint">{open ? t('Fechar') : t('Editar')}</span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className="telae-audience-chevron" />
      </button>
      {nobody && <p role="status" className="mt-1.5 text-[12px] text-warn-soft">{t('Ninguém marcado: nenhum amigo vai ver você ao vivo.')}</p>}
      {open && (
        <div id={panelId} className="telae-audience-panel">
          <AudienceOptions value={value} friends={friends} onChange={onChange} />
        </div>
      )}
    </div>
  )
}
