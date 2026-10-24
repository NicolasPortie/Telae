import { useEffect, useState, type FormEvent } from 'react'
import { t } from '../i18n'

type Feedback = { kind: 'ok' | 'error'; text: string } | null

const hostOf = (url: string) => {
  try { return new URL(url).host } catch { return url }
}

/** Servidor em uso, com troca antes de entrar: quem compila o código aberto aponta para o próprio servidor. */
export function ServerPicker({ disabled }: { disabled?: boolean }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  useEffect(() => {
    let cancelled = false
    void window.telae?.getEnvironment?.()
      .then(environment => { if (!cancelled) setCurrent(environment.signalingUrl) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  if (!current) return null

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFeedback(null)
    try {
      const environment = await window.telae.setSignalingUrl(value)
      setCurrent(environment.signalingUrl)
      setEditing(false)
      setFeedback({ kind: 'ok', text: t('Endereço salvo. Reinicia o Telaê pra usar o novo servidor.') })
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : t('Não deu pra salvar o endereço. Tenta de novo.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="telae-server-picker">
      {editing ? (
        <form onSubmit={event => void save(event)}>
          <label htmlFor="auth-server-url" className="mb-1.5 block text-xs font-medium text-ink-2">{t('Endereço do servidor')}</label>
          <input id="auth-server-url" value={value} onChange={event => { setValue(event.target.value); setFeedback(null) }} placeholder="https://telae.seudominio.com" autoComplete="off" spellCheck={false} autoFocus className="field w-full font-mono text-[13px]" />
          <p className="mt-2 text-xs text-ink-3">{t('Usa um servidor em que você confia. Quem o administra recebe os dados da conta e a senha usada nele.')}</p>
          <div className="mt-2 flex gap-2">
            <button type="submit" disabled={busy || !value.trim()} className="telae-press btn btn-secondary btn-sm">{busy ? t('Salvando…') : t('Salvar')}</button>
            <button type="button" onClick={() => { setEditing(false); setFeedback(null) }} className="telae-press btn btn-ghost btn-sm">{t('Cancelar')}</button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span>{t('Servidor')}: <span className="break-all font-mono text-xs text-ink-2">{hostOf(current)}</span></span>
          <button type="button" disabled={disabled} onClick={() => { setValue(current); setEditing(true); setFeedback(null) }} className="telae-press text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-60">{t('Alterar')}</button>
        </div>
      )}
      {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={`mt-2 ${feedback.kind === 'error' ? 'text-danger-soft' : 'text-ink-2'}`}>{feedback.text}</p>}
    </div>
  )
}
