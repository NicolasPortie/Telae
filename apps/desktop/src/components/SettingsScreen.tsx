import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { LANGUAGES, resolveLocale, setLocale, t } from '../i18n'
import type { AccountInfo, AppSettings } from '../shared/contracts'
import { authErrorMessage } from './authErrors'

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="card p-6">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="switch shrink-0">
        <span aria-hidden="true" className="switch-thumb" />
      </button>
    </div>
  )
}

type Feedback = { kind: 'ok' | 'error'; text: string } | null

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null
  return <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${feedback.kind === 'error' ? 'text-danger-soft' : 'text-ok'}`}>{feedback.text}</p>
}

/** Troca de senha e exclusão da conta; ambas confirmam a senha atual no servidor. */
function AccountSecurity() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null)
  const [deleting, setDeleting] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteFeedback, setDeleteFeedback] = useState<Feedback>(null)

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    setPasswordBusy(true)
    setPasswordFeedback(null)
    try {
      const outcome = await window.telae.auth.changePassword(current, next)
      if (outcome.ok) {
        setCurrent('')
        setNext('')
        setPasswordFeedback({ kind: 'ok', text: t('Senha alterada. Os outros dispositivos foram desconectados.') })
      } else setPasswordFeedback({ kind: 'error', text: authErrorMessage(outcome.code) })
    } finally {
      setPasswordBusy(false)
    }
  }

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault()
    setDeleteBusy(true)
    setDeleteFeedback(null)
    try {
      const outcome = await window.telae.auth.deleteAccount(deletePassword)
      // Em caso de sucesso o app volta para a tela de entrada pelo evento de sessão.
      if (!outcome.ok) setDeleteFeedback({ kind: 'error', text: authErrorMessage(outcome.code) })
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <>
      <Section title={t('Senha')}>
        <form onSubmit={event => void changePassword(event)} className="grid gap-3">
          <div>
            <label htmlFor="current-password" className="mb-1.5 block text-xs font-medium text-ink-2">{t('Senha atual')}</label>
            <input id="current-password" type="password" value={current} onChange={event => setCurrent(event.target.value)} autoComplete="current-password" maxLength={128} className="field" />
          </div>
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-xs font-medium text-ink-2">{t('Nova senha')}</label>
            <input id="new-password" type="password" value={next} onChange={event => setNext(event.target.value)} autoComplete="new-password" maxLength={128} className="field" />
            <p className="mt-1.5 text-xs text-ink-3">{t('Pelo menos 10 caracteres.')}</p>
          </div>
          <div>
            <button type="submit" disabled={passwordBusy || !current || next.length < 10} className="telae-press btn btn-secondary">{passwordBusy ? t('Salvando…') : t('Alterar senha')}</button>
            <FeedbackLine feedback={passwordFeedback} />
          </div>
        </form>
      </Section>

      <Section title={t('Excluir conta')} description={t('Remove sua conta e encerra todas as sessões. Essa ação não pode ser desfeita.')}>
        {!deleting ? (
          <button type="button" onClick={() => setDeleting(true)} className="telae-press btn btn-danger">{t('Excluir minha conta')}</button>
        ) : (
          <form onSubmit={event => void deleteAccount(event)} className="grid gap-3">
            <div>
              <label htmlFor="delete-password" className="mb-1.5 block text-xs font-medium text-ink-2">{t('Confirme com sua senha')}</label>
              <input id="delete-password" type="password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} autoComplete="current-password" maxLength={128} className="field" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={deleteBusy || !deletePassword} className="telae-press btn btn-danger">{deleteBusy ? t('Excluindo…') : t('Excluir definitivamente')}</button>
              <button type="button" onClick={() => { setDeleting(false); setDeletePassword(''); setDeleteFeedback(null) }} className="telae-press btn btn-ghost">{t('Cancelar')}</button>
            </div>
            <FeedbackLine feedback={deleteFeedback} />
          </form>
        )}
      </Section>
    </>
  )
}

/** Conta, idioma, avisos, servidor de sinalização e informações da instalação. */
export function SettingsScreen({ name, onNameChange, onSaveName, nameBusy, nameError, version, account, onSignOut, onBack }: {
  name: string
  onNameChange: (value: string) => void
  onSaveName: () => void
  nameBusy: boolean
  nameError: string | null
  version: string | null
  account: AccountInfo | null
  onSignOut: () => void
  onBack: () => void
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [savedServerUrl, setSavedServerUrl] = useState('')
  const [serverMessage, setServerMessage] = useState<Feedback>(null)
  const [serverBusy, setServerBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.telae.getSettings(), window.telae.getEnvironment()]).then(([loaded, environment]) => {
      if (cancelled) return
      setSettings(loaded)
      setServerUrl(environment.signalingUrl)
      setSavedServerUrl(environment.signalingUrl)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const updateSetting = (patch: Partial<AppSettings>) => {
    setSettings(current => (current ? { ...current, ...patch } : current))
    void window.telae.updateSettings(patch).then(setSettings).catch(() => undefined)
    if (patch.language) setLocale(resolveLocale(patch.language, navigator.language))
  }

  const saveServer = async () => {
    setServerBusy(true)
    setServerMessage(null)
    try {
      const environment = await window.telae.setSignalingUrl(serverUrl)
      setServerUrl(environment.signalingUrl)
      setSavedServerUrl(environment.signalingUrl)
      setServerMessage({ kind: 'ok', text: t('Endereço salvo. Reinicie o Telae para conectar ao novo servidor.') })
    } catch (error) {
      setServerMessage({ kind: 'error', text: error instanceof Error ? error.message : t('Não foi possível salvar o endereço.') })
    } finally {
      setServerBusy(false)
    }
  }

  return (
    <section aria-labelledby="settings-title" className="telae-panel-enter max-w-[640px]">
      <button type="button" onClick={onBack} className="telae-press btn btn-ghost btn-sm -ml-2">
        <ArrowLeft size={16} aria-hidden="true" /> {t('Voltar')}
      </button>
      <h1 id="settings-title" className="mt-4 text-[28px] font-semibold tracking-[-0.03em]">{t('Configurações')}</h1>

      <div className="mt-7 grid gap-4">
        <Section title={t('Conta')} description={account ? t('Você entrou como @{username}.', { username: account.username }) : undefined}>
          <form onSubmit={event => { event.preventDefault(); onSaveName() }}>
            <label htmlFor="profile-name" className="mb-1.5 block text-xs font-medium text-ink-2">{t('Nome de exibição')}</label>
            <div className="flex flex-wrap gap-2">
              <input id="profile-name" value={name} onChange={event => onNameChange(event.target.value)} maxLength={32} autoComplete="off" className="field min-w-[200px] flex-1" />
              <button type="submit" disabled={nameBusy} className="telae-press btn btn-primary h-11">{nameBusy ? t('Salvando…') : t('Salvar')}</button>
            </div>
            <p className="mt-1.5 text-xs text-ink-3">{t('É o nome que seus amigos veem.')}</p>
            {nameError && <p role="alert" className="mt-2 text-sm text-danger-soft">{nameError}</p>}
          </form>
          {account && (
            <dl className="mt-5 grid gap-2.5 border-t border-line pt-5 text-sm">
              <div className="flex items-baseline justify-between gap-6"><dt className="text-ink-3">{t('E-mail')}</dt><dd className="font-mono text-[13px]">{account.email}</dd></div>
              <div className="flex items-baseline justify-between gap-6"><dt className="text-ink-3">{t('Nome de usuário')}</dt><dd className="font-mono text-[13px]">@{account.username}</dd></div>
            </dl>
          )}
          <div className="mt-5">
            <button type="button" onClick={onSignOut} className="telae-press btn btn-secondary">{t('Sair da conta')}</button>
          </div>
        </Section>

        <Section title={t('Geral')}>
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between gap-6 pb-3">
              <label htmlFor="language" className="text-sm font-medium">{t('Idioma')}</label>
              <select id="language" value={settings?.language ?? 'auto'} disabled={!settings} onChange={event => updateSetting({ language: event.target.value as AppSettings['language'] })} className="field h-10 w-auto min-w-[200px] text-[13px]">
                {LANGUAGES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <Toggle label={t('Avisar quando um amigo ficar ao vivo')} hint={t('Notificação do Windows quando o Telae não estiver em foco.')} checked={settings?.notifyFriendLive ?? true} disabled={!settings} onChange={value => updateSetting({ notifyFriendLive: value })} />
            <Toggle label={t('Abrir com o Windows')} hint={t('Inicia o Telae minimizado ao entrar no Windows.')} checked={settings?.launchAtLogin ?? false} disabled={!settings} onChange={value => updateSetting({ launchAtLogin: value })} />
          </div>
        </Section>

        {account && <AccountSecurity />}

        <Section title={t('Servidor de sinalização')} description={t('Coordena quem está online e inicia as conexões. O vídeo e o áudio não passam por ele. Para hospedar o seu próprio, veja a seção Self-hosting do README.')}>
          <form onSubmit={event => { event.preventDefault(); void saveServer() }}>
            <label htmlFor="server-url" className="mb-1.5 block text-xs font-medium text-ink-2">{t('Endereço')}</label>
            <div className="flex flex-wrap gap-2">
              <input id="server-url" value={serverUrl} onChange={event => { setServerUrl(event.target.value); setServerMessage(null) }} autoComplete="off" spellCheck={false} className="field min-w-[200px] flex-1 font-mono text-[13px]" />
              <button type="submit" disabled={serverBusy || serverUrl.trim() === savedServerUrl} className="telae-press btn btn-secondary h-11">{serverBusy ? t('Salvando…') : t('Salvar')}</button>
            </div>
            <FeedbackLine feedback={serverMessage} />
          </form>
        </Section>

        <Section title={t('Sobre')}>
          <dl className="grid gap-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-6"><dt className="text-ink-3">{t('Versão')}</dt><dd className="tnum font-mono text-[13px]">{version ? `v${version}` : '—'}</dd></div>
          </dl>
        </Section>
      </div>
    </section>
  )
}
