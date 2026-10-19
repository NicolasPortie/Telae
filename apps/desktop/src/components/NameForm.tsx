import { UserRound } from 'lucide-react'

type FormProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  error: string | null
}

/** Primeiro acesso: o nome que aparece para quem assiste ou transmite com você. */
export function SetupScreen({ desktopApiAvailable, value, onChange, onSubmit, busy, error }: FormProps & { desktopApiAvailable: boolean }) {
  return (
    <section aria-labelledby="setup-title" className="telae-panel-enter card mx-auto mt-10 max-w-[460px] p-8">
      <div aria-hidden="true" className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-signal/30 bg-signal/10 text-signal">
        <UserRound size={22} strokeWidth={1.7} />
      </div>
      <h1 id="setup-title" className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">Como podemos chamar você?</h1>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-2">Seu nome aparecerá para a pessoa com quem você compartilhar a tela.</p>
      {!desktopApiAvailable && <p role="alert" className="mt-4 text-sm text-danger-soft">Abra o aplicativo Telae para continuar.</p>}
      <form className="mt-7" onSubmit={event => { event.preventDefault(); onSubmit() }}>
        <label htmlFor="display-name" className="mb-1.5 block text-xs font-medium text-ink-2">Seu nome</label>
        <input id="display-name" value={value} onChange={event => onChange(event.target.value)} maxLength={32} autoComplete="off" className="field h-12" placeholder="Ex.: Nicolas" />
        {error && <p role="alert" className="mt-2 text-sm text-danger-soft">{error}</p>}
        <button type="submit" disabled={busy || !desktopApiAvailable} className="telae-press btn btn-primary btn-lg mt-5 w-full">
          {busy ? 'Salvando…' : 'Continuar'}
        </button>
      </form>
    </section>
  )
}
