import { t } from '../i18n'

type Row = { name: string; handle: string; state: 'live' | 'online' | 'offline' }

const ROWS: Row[] = [
  { name: 'Ana Souza', handle: 'ana', state: 'live' },
  { name: 'Bruno Lima', handle: 'bruno', state: 'online' },
  { name: 'Carol', handle: 'carol', state: 'offline' },
]

/**
 * Amostra do próprio produto (lista de amigos e cartaz "no ar") para a tela de entrada.
 * É só ilustração: aria-hidden, sem foco e sem interação.
 */
export function AuthShowcase() {
  return (
    <div aria-hidden="true" className="relative w-full max-w-[400px] select-none">
      <div className="rounded-2xl border border-line-strong bg-surface/80 p-3 shadow-card backdrop-blur">
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <span className="text-[13px] font-semibold">{t('Amigos')}</span>
          <span className="count tnum">3</span>
        </div>
        <ul className="grid gap-0.5">
          {ROWS.map(row => (
            <li key={row.handle} className={`flex items-center gap-3 rounded-xl px-2 py-2 ${row.state === 'live' ? 'bg-tally/[0.07]' : ''}`}>
              <span className={`avatar h-9 w-9 ${row.state === 'live' ? 'avatar-live' : ''}`}>{row.name.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-none">{row.name}</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                  {row.state === 'live' && <span className="tally" />}
                  <span className={row.state === 'live' ? 'font-medium text-tally-soft' : row.state === 'online' ? 'text-ok' : 'text-ink-4'}>
                    {row.state === 'live' ? t('Ao vivo') : row.state === 'online' ? t('Online') : t('Offline')}
                  </span>
                  <span className="font-mono text-[11px] text-ink-4">@{row.handle}</span>
                </p>
              </div>
              {row.state === 'live' && <span className="btn btn-primary btn-sm pointer-events-none">{t('Assistir')}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="telae-poster absolute -bottom-14 -right-8 w-[230px] rotate-[2.5deg] !min-h-0 !gap-3 !p-4">
        <span className="badge-live w-fit"><span className="tally" /> {t('No ar')}</span>
        <div className="flex items-end justify-between gap-2">
          <p className="truncate text-[20px] font-bold tracking-[-0.04em]">Ana Souza</p>
          <span className="tnum font-mono text-[11px] text-ink-3">1080p60</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full w-2/5 rounded-full bg-signal" /></div>
      </div>
    </div>
  )
}
