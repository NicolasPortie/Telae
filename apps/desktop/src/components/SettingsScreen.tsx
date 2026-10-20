import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { LANGUAGES, resolveLocale, setLocale, t } from '../i18n'
import type { AppSettings } from '../shared/contracts'

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

/** Perfil, idioma, avisos, servidor de sinalização e informações da instalação. */
export function SettingsScreen({ name, onNameChange, onSaveName, nameBusy, nameError, version, deviceId, onBack }: {
  name: string
  onNameChange: (value: string) => void
  onSaveName: () => void
  nameBusy: boolean
  nameError: string | null
  version: string | null
  deviceId: string | undefined
  onBack: () => void
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [savedServerUrl, setSavedServerUrl] = useState('')
  const [serverMessage, setServerMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
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
        <Section title={t('Perfil')} description={t('Esse é o nome que aparece para seus amigos.')}>
          <form onSubmit={event => { event.preventDefault(); onSaveName() }}>
            <label htmlFor="profile-name" className="mb-1.5 block text-xs font-medium text-ink-2">{t('Seu nome')}</label>
            <div className="flex flex-wrap gap-2">
              <input id="profile-name" value={name} onChange={event => onNameChange(event.target.value)} maxLength={32} autoComplete="off" className="field min-w-[200px] flex-1" />
              <button type="submit" disabled={nameBusy} className="telae-press btn btn-primary h-11">{nameBusy ? t('Salvando…') : t('Salvar')}</button>
            </div>
            {nameError && <p role="alert" className="mt-2 text-sm text-danger-soft">{nameError}</p>}
          </form>
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

        <Section title={t('Servidor de sinalização')} description={t('Coordena quem está online e inicia as conexões. O vídeo e o áudio não passam por ele. Para hospedar o seu próprio, veja a seção Self-hosting do README.')}>
          <form onSubmit={event => { event.preventDefault(); void saveServer() }}>
            <label htmlFor="server-url" className="mb-1.5 block text-xs font-medium text-ink-2">{t('Endereço')}</label>
            <div className="flex flex-wrap gap-2">
              <input id="server-url" value={serverUrl} onChange={event => { setServerUrl(event.target.value); setServerMessage(null) }} autoComplete="off" spellCheck={false} className="field min-w-[200px] flex-1 font-mono text-[13px]" />
              <button type="submit" disabled={serverBusy || serverUrl.trim() === savedServerUrl} className="telae-press btn btn-secondary h-11">{serverBusy ? t('Salvando…') : t('Salvar')}</button>
            </div>
            {serverMessage && <p role={serverMessage.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${serverMessage.kind === 'error' ? 'text-danger-soft' : 'text-ok'}`}>{serverMessage.text}</p>}
          </form>
        </Section>

        <Section title={t('Sobre')}>
          <dl className="grid gap-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-6"><dt className="text-ink-3">{t('Versão')}</dt><dd className="tnum font-mono text-[13px]">{version ? `v${version}` : '—'}</dd></div>
            <div className="flex items-baseline justify-between gap-6"><dt className="text-ink-3">{t('Identificador deste dispositivo')}</dt><dd className="tnum font-mono text-[13px]" title={t('Seu perfil é guardado neste computador. Não há conta nem senha.')}>{deviceId ? `${deviceId.slice(0, 8)}…` : '—'}</dd></div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-ink-3">{t('Não existe conta nem senha: o Telae cria uma identidade segura e a guarda somente neste computador. Seus amigos e seu código ficam vinculados a ela.')}</p>
        </Section>
      </div>
    </section>
  )
}
