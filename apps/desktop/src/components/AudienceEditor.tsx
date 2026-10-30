import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import { numberLocale, t } from '../i18n'
import { audienceSummary, leavingWatchers, type Watcher } from '../services/audience'
import type { DeviceSnapshot, ShareAudience } from '../services/types'
import { AudienceOptions } from './AudiencePicker'

/** "Caio", "Caio e Duda", "Caio, Duda e Bia": nomes em lista, no idioma da interface. */
function joinNames(names: string[]): string {
  return new Intl.ListFormat(numberLocale(), { style: 'long', type: 'conjunction' }).format(names)
}

/**
 * Quem pode ver, durante a transmissão. Mudar para "escolhidos" já marca quem está assistindo; as mudanças ficam
 * num rascunho até "Aplicar", e antes disso o aviso diz pelo nome quem sairia. Marcar alguém que não está
 * assistindo só libera a transmissão para a pessoa: ela entra se quiser.
 */
export function AudienceEditor({ audience, friends, watchers, busy, onApply }: {
  audience: ShareAudience
  friends: DeviceSnapshot[]
  /** Quem está assistindo agora. */
  watchers: Watcher[]
  busy: boolean
  onApply: (audience: ShareAudience) => Promise<void>
}) {
  const [draft, setDraft] = useState<ShareAudience | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const leaving = useMemo(() => (draft ? leavingWatchers(draft, watchers, friends) : []), [draft, watchers, friends])

  if (!draft) {
    return (
      <div className="telae-inspector-foot telae-audience-foot">
        <Lock size={15} strokeWidth={1.75} aria-hidden="true" />
        <p title={audienceSummary(audience)} className="min-w-0 flex-1"><span className="sr-only">{t('Quem pode ver')}: </span>{audienceSummary(audience)}</p>
        <button type="button" disabled={busy} onClick={() => { setDraft(audience); setError(null) }} className="telae-press btn btn-ghost btn-sm -mr-2">{t('Alterar')}</button>
      </div>
    )
  }

  const apply = async () => {
    if (busy || applying) return
    setApplying(true)
    setError(null)
    try {
      await onApply(draft)
      setDraft(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Não deu pra mudar quem pode ver. Tenta de novo.'))
    } finally {
      setApplying(false)
    }
  }

  return (
    <section aria-labelledby="audience-edit-title" className="telae-inspector-section telae-audience-edit">
      <h2 id="audience-edit-title" className="text-[15px] font-semibold tracking-[-0.01em]">{t('Quem pode ver')}</h2>
      <fieldset disabled={busy || applying} className="mt-3">
        <AudienceOptions value={draft} friends={friends} watchers={watchers} onChange={setDraft} />
      </fieldset>
      {leaving.length > 0 && (
        <p role="status" className="notice mt-3">
          {leaving.length === 1
            ? t('{names} sai da transmissão ao aplicar.', { names: joinNames(leaving) })
            : t('{names} saem da transmissão ao aplicar.', { names: joinNames(leaving) })}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] text-danger-soft">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" disabled={applying} onClick={() => setDraft(null)} className="telae-press btn btn-ghost btn-sm">{t('Cancelar')}</button>
        <button type="button" disabled={busy || applying} onClick={() => void apply()} className="telae-press btn btn-primary btn-sm">{t('Aplicar')}</button>
      </div>
    </section>
  )
}
