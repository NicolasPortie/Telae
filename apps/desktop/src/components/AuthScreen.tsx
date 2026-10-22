import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, AtSign, CircleAlert, Eye, EyeOff, Lock, Mail, type LucideIcon } from 'lucide-react'
import { getLocale, t } from '../i18n'
import type { AccountInfo, AuthOutcome } from '../shared/contracts'
import { passwordStrength } from '../ui/password-strength'
import { AuthShowcase } from './AuthShowcase'
import { authErrorMessage } from './authErrors'
import { CodeInput } from './CodeInput'

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'reset'

const RESEND_COOLDOWN_SECONDS = 60

function Field({ id, label, icon: Icon, value, onChange, hint, trailing, ...input }: {
  id: string
  label: string
  icon: LucideIcon
  value: string
  onChange: (value: string) => void
  hint?: string
  trailing?: ReactNode
  type?: string
  autoComplete?: string
  inputMode?: 'email' | 'text'
  maxLength?: number
  spellCheck?: boolean
  autoFocus?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-2">{label}</label>
      <div className="relative">
        <Icon size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" />
        <input id={id} value={value} onChange={event => onChange(event.target.value)} className={`field h-12 pl-10 ${trailing ? 'pr-12' : ''}`} {...input} />
        {trailing}
      </div>
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete, hint, username }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  hint?: string
  /** Quando informado, mostra o medidor de força (cadastro e troca de senha). */
  username?: string
}) {
  const [visible, setVisible] = useState(false)
  const showMeter = username !== undefined && value.length > 0
  const { score } = passwordStrength(value, username)
  const labels = [t('Curta demais'), t('Fraca'), t('Boa'), t('Forte')]
  return (
    <div>
      <Field
        id={id}
        label={label}
        icon={Lock}
        value={value}
        onChange={onChange}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        maxLength={128}
        trailing={(
          <button
            type="button"
            onClick={() => setVisible(current => !current)}
            aria-label={visible ? t('Ocultar senha') : t('Mostrar senha')}
            aria-pressed={visible}
            className="telae-press absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-md text-ink-3 hover:text-ink"
          >
            {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        )}
      />
      {showMeter ? (
        <div className="mt-2.5 flex items-center gap-3" role="status" aria-label={t('Força da senha: {level}', { level: labels[score] })}>
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {[1, 2, 3].map(step => (
              <span key={step} className={`h-1 flex-1 rounded-full transition-colors ${score >= step ? (score === 3 ? 'bg-ok' : score === 2 ? 'bg-signal' : 'bg-danger') : 'bg-line-strong'}`} />
            ))}
          </div>
          <span className="w-[84px] text-right text-xs text-ink-3">{labels[score]}</span>
        </div>
      ) : hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

/** Entrar, criar conta, confirmar e-mail e recuperar senha. */
export function AuthScreen({ desktopApiAvailable, initialIdentifier = '', notice, onAuthenticated }: {
  desktopApiAvailable: boolean
  /** Preenche o campo de entrada (por exemplo ao voltar depois de sair). */
  initialIdentifier?: string
  /** Mensagem informativa exibida no topo (sessão expirada, por exemplo). */
  notice?: string | null
  onAuthenticated: (account: AccountInfo) => void
}) {
  const [mode, setMode] = useState<Mode>('login')
  const [identifier, setIdentifier] = useState(initialIdentifier)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(notice ?? null)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn(seconds => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  const go = (next: Mode) => {
    setMode(next)
    setError(null)
    setInfo(null)
    setCode('')
    setPassword('')
  }

  async function run<T>(action: () => Promise<AuthOutcome<T>>, onSuccess: (data: T) => void) {
    if (!desktopApiAvailable) {
      setError(t('Abra o aplicativo Telae para continuar.'))
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const outcome = await action()
      if (outcome.ok) onSuccess(outcome.data)
      else setError(authErrorMessage(outcome.code))
      return outcome
    } finally {
      setBusy(false)
    }
  }

  const submit = (handler: () => void) => (event: FormEvent) => { event.preventDefault(); handler() }

  const login = () => void run(() => window.telae.auth.login(identifier.trim(), password), onAuthenticated).then(outcome => {
    if (outcome && !outcome.ok && outcome.code === 'email_not_verified') {
      setEmail(identifier.includes('@') ? identifier.trim() : '')
      setMode('verify')
      setError(null)
      setResendIn(RESEND_COOLDOWN_SECONDS)
    }
  })

  const register = () => void run(
    () => window.telae.auth.register({ email: email.trim(), username: username.trim(), password, language: getLocale() }),
    result => {
      if (result.account) { onAuthenticated(result.account); return }
      setIdentifier(email.trim())
      setPassword('')
      setMode('verify')
      setResendIn(RESEND_COOLDOWN_SECONDS)
    },
  )

  const verify = () => void run(() => window.telae.auth.verifyEmail(identifier.trim(), code.trim()), onAuthenticated)

  const resend = () => void run(() => window.telae.auth.resendVerification(identifier.trim()), () => {
    setInfo(t('Mandei outro código.'))
    setResendIn(RESEND_COOLDOWN_SECONDS)
  })

  const forgot = () => void run(() => window.telae.auth.forgotPassword(identifier.trim()), () => {
    setMode('reset')
    setInfo(t('Se essa conta existir, o código já está a caminho.'))
    setResendIn(RESEND_COOLDOWN_SECONDS)
  })

  const reset = () => void run(() => window.telae.auth.resetPassword(identifier.trim(), code.trim(), password), () => {
    setMode('login')
    setPassword('')
    setCode('')
    setInfo(t('Senha trocada. Entra com a nova.'))
  })

  const submitLabel = (label: string) => (busy ? t('Aguarde…') : label)
  const tabbed = mode === 'login' || mode === 'register'

  let title = t('Bem-vindo de volta')
  let subtitle: string | null = t('Entre pra ver quem está ao vivo.')
  let form: ReactNode

  if (mode === 'login') {
    form = (
      <form className="mt-7 grid gap-4" onSubmit={submit(login)}>
        <Field id="identifier" label={t('E-mail ou @usuário')} icon={Mail} value={identifier} onChange={setIdentifier} autoComplete="username" spellCheck={false} autoFocus />
        <PasswordField id="password" label={t('Senha')} value={password} onChange={setPassword} autoComplete="current-password" />
        <button type="submit" disabled={busy || !identifier.trim() || !password} className="telae-press btn btn-primary btn-lg mt-1 w-full">{submitLabel(t('Entrar'))}</button>
        <button type="button" onClick={() => go('forgot')} className="justify-self-center text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">{t('Esqueci minha senha')}</button>
      </form>
    )
  } else if (mode === 'register') {
    title = t('Crie sua conta')
    subtitle = t('Seu @ é como os amigos te acham.')
    form = (
      <form className="mt-7 grid gap-4" onSubmit={submit(register)}>
        <Field id="email" label={t('E-mail')} icon={Mail} value={email} onChange={setEmail} type="email" inputMode="email" autoComplete="email" spellCheck={false} maxLength={254} hint={t('Só serve pra entrar e recuperar a senha. Ninguém mais vê.')} autoFocus />
        <Field id="username" label={t('Nome de usuário')} icon={AtSign} value={username} onChange={value => setUsername(value.replace(/[\s@]/g, '').toLowerCase())} autoComplete="username" spellCheck={false} maxLength={20} hint={t('De 3 a 20 caracteres: letras minúsculas, números e _.')} />
        <PasswordField id="new-password" label={t('Senha')} value={password} onChange={setPassword} autoComplete="new-password" hint={t('Pelo menos 10 caracteres.')} username={username} />
        <button type="submit" disabled={busy || !email.trim() || username.trim().length < 3 || password.length < 10} className="telae-press btn btn-primary btn-lg mt-1 w-full">{submitLabel(t('Criar conta'))}</button>
      </form>
    )
  } else if (mode === 'verify') {
    title = t('Olha seu e-mail')
    subtitle = email ? t('Mandamos um código de 6 dígitos pra {email}.', { email }) : t('Mandamos um código de 6 dígitos pro e-mail da sua conta.')
    form = (
      <form className="mt-7 grid gap-5" onSubmit={submit(verify)}>
        <CodeInput value={code} onChange={setCode} disabled={busy} />
        <button type="submit" disabled={busy || code.length !== 6} className="telae-press btn btn-primary btn-lg w-full">{submitLabel(t('Confirmar'))}</button>
        <button type="button" onClick={resend} disabled={busy || resendIn > 0} className="justify-self-center text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60">
          {resendIn > 0 ? t('Reenviar código em {seconds}s', { seconds: resendIn }) : t('Reenviar código')}
        </button>
      </form>
    )
  } else if (mode === 'forgot') {
    title = t('Esqueceu a senha?')
    subtitle = t('Diz seu e-mail ou @ e a gente manda um código pra você criar outra.')
    form = (
      <form className="mt-7 grid gap-4" onSubmit={submit(forgot)}>
        <Field id="identifier" label={t('E-mail ou @usuário')} icon={Mail} value={identifier} onChange={setIdentifier} autoComplete="username" spellCheck={false} autoFocus />
        <button type="submit" disabled={busy || !identifier.trim()} className="telae-press btn btn-primary btn-lg mt-1 w-full">{submitLabel(t('Enviar código'))}</button>
      </form>
    )
  } else {
    title = t('Senha nova')
    subtitle = t('Cola o código que mandamos e escolhe a nova senha.')
    form = (
      <form className="mt-7 grid gap-5" onSubmit={submit(reset)}>
        <CodeInput value={code} onChange={setCode} disabled={busy} />
        <PasswordField id="new-password" label={t('Nova senha')} value={password} onChange={setPassword} autoComplete="new-password" hint={t('Pelo menos 10 caracteres.')} username="" />
        <button type="submit" disabled={busy || code.length !== 6 || password.length < 10} className="telae-press btn btn-primary btn-lg w-full">{submitLabel(t('Salvar nova senha'))}</button>
      </form>
    )
  }

  return (
    <section aria-labelledby="auth-title" className="telae-panel-enter telae-auth">
      <div className="telae-auth-brand" aria-hidden="true">
        <div className="telae-beam" />
        <div className="relative">
          <p className="display max-w-[11ch] text-[clamp(38px,4.6vw,60px)]">{t('Passa a tela pros amigos.')}</p>
          <p className="mt-4 max-w-[36ch] text-[15px] leading-relaxed text-ink-2">{t('Imagem nítida e som junto, sem criar sala nem mandar link.')}</p>
        </div>
        <div className="relative mt-auto pb-16 pt-12"><AuthShowcase /></div>
      </div>

      <div className="telae-auth-form">
        <div className="mx-auto w-full max-w-[400px]">
          {tabbed ? (
            <div role="tablist" aria-label={t('Entrar ou criar conta')} className="mb-8 grid grid-cols-2 rounded-xl border border-line-strong bg-canvas p-1">
              {(['login', 'register'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={mode === option}
                  onClick={() => go(option)}
                  className={`telae-press min-h-[38px] rounded-lg text-[13px] font-medium transition-colors ${mode === option ? 'bg-active text-ink shadow-card' : 'text-ink-3 hover:text-ink'}`}
                >
                  {option === 'login' ? t('Entrar') : t('Criar conta')}
                </button>
              ))}
            </div>
          ) : (
            <button type="button" onClick={() => go('login')} className="telae-press btn btn-ghost btn-sm -ml-2 mb-6">
              <ArrowLeft size={16} aria-hidden="true" /> {t('Voltar')}
            </button>
          )}

          <h1 id="auth-title" className="display text-[34px]">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-ink-2">{subtitle}</p>}
          {!desktopApiAvailable && <p role="alert" className="mt-4 text-sm text-danger-soft">{t('Abra o aplicativo Telae para continuar.')}</p>}
          {info && <p role="status" className="notice mt-5">{info}</p>}
          {error && <p role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-danger-soft"><CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0" />{error}</p>}
          <div role={tabbed ? 'tabpanel' : undefined}>{form}</div>
        </div>
      </div>
    </section>
  )
}
