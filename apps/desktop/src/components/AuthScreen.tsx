import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Eye, EyeOff, KeyRound, MailCheck, UserRound } from 'lucide-react'
import { getLocale, t } from '../i18n'
import type { AccountInfo, AuthOutcome } from '../shared/contracts'
import { authErrorMessage } from './authErrors'

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'reset'

const RESEND_COOLDOWN_SECONDS = 60

function PasswordField({ id, label, value, onChange, autoComplete, hint }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  hint?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-2">{label}</label>
      <div className="relative">
        <input id={id} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} autoComplete={autoComplete} maxLength={128} className="field h-12 pr-12" />
        <button
          type="button"
          onClick={() => setVisible(current => !current)}
          aria-label={visible ? t('Ocultar senha') : t('Mostrar senha')}
          aria-pressed={visible}
          className="telae-press absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-md text-ink-3 hover:text-ink"
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

function Field({ id, label, value, onChange, hint, ...input }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  type?: string
  autoComplete?: string
  inputMode?: 'numeric' | 'email' | 'text'
  maxLength?: number
  placeholder?: string
  spellCheck?: boolean
  className?: string
}) {
  const { className, ...rest } = input
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-2">{label}</label>
      <input id={id} value={value} onChange={event => onChange(event.target.value)} className={`field h-12 ${className ?? ''}`} {...rest} />
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
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
    setInfo(t('Enviamos um novo código.'))
    setResendIn(RESEND_COOLDOWN_SECONDS)
  })

  const forgot = () => void run(() => window.telae.auth.forgotPassword(identifier.trim()), () => {
    setMode('reset')
    setInfo(t('Se existir uma conta com esse e-mail ou usuário, enviamos um código.'))
    setResendIn(RESEND_COOLDOWN_SECONDS)
  })

  const reset = () => void run(() => window.telae.auth.resetPassword(identifier.trim(), code.trim(), password), () => {
    setMode('login')
    setPassword('')
    setCode('')
    setInfo(t('Senha atualizada. Entre com a nova senha.'))
  })

  const submitLabel = (label: string) => (busy ? t('Aguarde…') : label)

  let icon: ReactNode = <UserRound size={22} strokeWidth={1.7} />
  let title = t('Entrar no Telae')
  let subtitle = t('Use sua conta para assistir e compartilhar com seus amigos.')
  let form: ReactNode

  if (mode === 'login') {
    form = (
      <form className="mt-7 grid gap-4" onSubmit={submit(login)}>
        <Field id="identifier" label={t('E-mail ou usuário')} value={identifier} onChange={setIdentifier} autoComplete="username" spellCheck={false} />
        <PasswordField id="password" label={t('Senha')} value={password} onChange={setPassword} autoComplete="current-password" />
        <button type="submit" disabled={busy || !identifier.trim() || !password} className="telae-press btn btn-primary btn-lg w-full">{submitLabel(t('Entrar'))}</button>
        <div className="flex items-center justify-between text-[13px]">
          <button type="button" onClick={() => go('forgot')} className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">{t('Esqueci minha senha')}</button>
          <button type="button" onClick={() => go('register')} className="font-medium text-signal underline-offset-2 hover:underline">{t('Criar conta')}</button>
        </div>
      </form>
    )
  } else if (mode === 'register') {
    title = t('Criar conta')
    subtitle = t('Leva menos de um minuto. Você confirma o e-mail com um código.')
    form = (
      <form className="mt-7 grid gap-4" onSubmit={submit(register)}>
        <Field id="email" label={t('E-mail')} value={email} onChange={setEmail} type="email" inputMode="email" autoComplete="email" spellCheck={false} maxLength={254} />
        <Field id="username" label={t('Nome de usuário')} value={username} onChange={value => setUsername(value.toLowerCase())} autoComplete="username" spellCheck={false} maxLength={20} hint={t('3 a 20 caracteres: letras minúsculas, números e _. É como seus amigos encontram você.')} />
        <PasswordField id="new-password" label={t('Senha')} value={password} onChange={setPassword} autoComplete="new-password" hint={t('Pelo menos 10 caracteres.')} />
        <button type="submit" disabled={busy || !email.trim() || username.trim().length < 3 || password.length < 10} className="telae-press btn btn-primary btn-lg w-full">{submitLabel(t('Criar conta'))}</button>
        <button type="button" onClick={() => go('login')} className="text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">{t('Já tenho uma conta')}</button>
      </form>
    )
  } else if (mode === 'verify') {
    icon = <MailCheck size={22} strokeWidth={1.7} />
    title = t('Confirme seu e-mail')
    subtitle = email ? t('Enviamos um código de 6 dígitos para {email}.', { email }) : t('Enviamos um código de 6 dígitos para o e-mail da sua conta.')
    form = (
      <form className="mt-7 grid gap-4" onSubmit={submit(verify)}>
        <Field id="code" label={t('Código')} value={code} onChange={value => setCode(value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="tnum text-center font-mono text-[22px] tracking-[0.4em]" placeholder="······" />
        <button type="submit" disabled={busy || code.length !== 6} className="telae-press btn btn-primary btn-lg w-full">{submitLabel(t('Confirmar'))}</button>
        <div className="flex items-center justify-between text-[13px]">
          <button type="button" onClick={() => go('login')} className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">{t('Voltar')}</button>
          <button type="button" onClick={resend} disabled={busy || resendIn > 0} className="font-medium text-signal underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-ink-4 disabled:no-underline">
            {resendIn > 0 ? t('Reenviar código em {seconds}s', { seconds: resendIn }) : t('Reenviar código')}
          </button>
        </div>
      </form>
    )
  } else if (mode === 'forgot') {
    icon = <KeyRound size={22} strokeWidth={1.7} />
    title = t('Recuperar senha')
    subtitle = t('Informe seu e-mail ou usuário e enviaremos um código para criar uma nova senha.')
    form = (
      <form className="mt-7 grid gap-4" onSubmit={submit(forgot)}>
        <Field id="identifier" label={t('E-mail ou usuário')} value={identifier} onChange={setIdentifier} autoComplete="username" spellCheck={false} />
        <button type="submit" disabled={busy || !identifier.trim()} className="telae-press btn btn-primary btn-lg w-full">{submitLabel(t('Enviar código'))}</button>
        <button type="button" onClick={() => go('login')} className="text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">{t('Voltar')}</button>
      </form>
    )
  } else {
    icon = <KeyRound size={22} strokeWidth={1.7} />
    title = t('Criar nova senha')
    subtitle = t('Digite o código que enviamos e escolha uma nova senha.')
    form = (
      <form className="mt-7 grid gap-4" onSubmit={submit(reset)}>
        <Field id="code" label={t('Código')} value={code} onChange={value => setCode(value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="tnum text-center font-mono text-[22px] tracking-[0.4em]" placeholder="······" />
        <PasswordField id="new-password" label={t('Nova senha')} value={password} onChange={setPassword} autoComplete="new-password" hint={t('Pelo menos 10 caracteres.')} />
        <button type="submit" disabled={busy || code.length !== 6 || password.length < 10} className="telae-press btn btn-primary btn-lg w-full">{submitLabel(t('Salvar nova senha'))}</button>
        <button type="button" onClick={() => go('login')} className="text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">{t('Voltar')}</button>
      </form>
    )
  }

  return (
    <section aria-labelledby="auth-title" className="telae-panel-enter card mx-auto mt-8 max-w-[460px] p-8">
      <div aria-hidden="true" className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-signal/30 bg-signal/10 text-signal">{icon}</div>
      <h1 id="auth-title" className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">{title}</h1>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-2">{subtitle}</p>
      {!desktopApiAvailable && <p role="alert" className="mt-4 text-sm text-danger-soft">{t('Abra o aplicativo Telae para continuar.')}</p>}
      {info && <p role="status" className="notice mt-4">{info}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-danger-soft">{error}</p>}
      {form}
    </section>
  )
}
