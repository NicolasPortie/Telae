import { Check, Copy, Square } from 'lucide-react'
import type { ShareSessionController } from '../services/share-session'
import type { ContentMode, QualityProfile } from '../services/types'
import { formatElapsed, qualityLabel, QUALITY_OPTIONS } from '../ui/format'
import { DiagnosticsBody } from './DiagnosticsBody'

export function SharerSession({
  snapshot,
  elapsed,
  sourceName,
  videoRef,
  copied,
  onCopyInvite,
  onStop,
  onChangeSource,
  onExport,
  formError,
  busy, onQuality, onAudio, onUpload, onRemove,
}: {
  snapshot: ReturnType<ShareSessionController['getSnapshot']>
  elapsed: number
  sourceName: string | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  copied: boolean
  onCopyInvite: () => void
  onStop: () => void
  onChangeSource: () => void
  onExport: () => void
  formError: string | null
  busy: boolean
  onQuality: (quality: QualityProfile, mode: ContentMode) => void
  onAudio: () => void
  onUpload: (mbps: number) => void
  onRemove: (deviceId: string) => void
}) {
  const controlsDisabled = busy || !snapshot.hasLocalStream || snapshot.state === 'ended'
  const status = snapshot.state === 'live'
    ? `Ao vivo · ${qualityLabel(snapshot.quality)}`
    : snapshot.state === 'preparing' ? 'Preparando transmissão…'
    : snapshot.state === 'reconnecting' ? 'Restabelecendo conexão…'
    : snapshot.state === 'negotiating' ? 'Conectando seu amigo…'
    : 'Aguardando seu amigo…'
  return (
    <section aria-labelledby="sharer-title" className="telae-panel-enter">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 id="sharer-title" className="text-xl font-semibold tracking-tight sm:text-2xl">
          {snapshot.state === 'preparing' ? 'Preparando transmissão' : 'Você está compartilhando'}
        </h1>
        {snapshot.liveSinceMs !== null && (
          <p className="tnum text-sm text-[#9D9A90]" aria-label="Tempo decorrido">
            {formatElapsed(elapsed)}
          </p>
        )}
        <p role="status" className="flex w-full items-center gap-2 text-xs text-[#9D9A90] sm:ml-auto sm:w-auto">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#D8A85C]" />
          {status}
        </p>
      </div>

      <div className="sticky top-3 z-20 mt-4 flex flex-wrap gap-2 rounded-lg border border-[#313029] bg-[#141412]/95 p-2">
        <button
          type="button"
          onClick={onStop}
          className="telae-press flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md bg-[#FF5D5D] px-4 text-sm font-semibold text-[#141412] hover:bg-[#FF7777] disabled:cursor-wait disabled:opacity-50 sm:flex-none"
        >
          <Square size={16} aria-hidden="true" /> Parar transmissão
        </button>
        <button
          type="button"
          onClick={onChangeSource}
          disabled={controlsDisabled}
          className="telae-press min-h-[44px] flex-1 rounded-md border border-[#313029] bg-[#1C1C19] px-4 text-sm font-semibold hover:bg-[#282721] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
        >
          Trocar fonte
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-[#E8C690]">
        {busy ? 'Aplicando alterações… Aguarde para usar os controles.' : ''}
      </p>


      {snapshot.hasLocalStream && !snapshot.includeAudio && snapshot.state !== 'ended' && (
        <p role="status" className="mt-4 rounded-lg border border-[#5B5140] bg-[#282721] px-4 py-3 text-sm text-[#E8C690]">
          {snapshot.audioBuffer?.error
            ? 'O áudio desta fonte foi interrompido. A tela continua sendo compartilhada sem som. Você pode trocar a fonte.'
            : 'O Windows não disponibilizou áudio desta fonte. A tela está sendo compartilhada sem som. Você pode trocar a fonte.'}
        </p>
      )}

      <div className={`mt-4 grid min-w-0 gap-4 ${snapshot.hasLocalStream && snapshot.inviteCode ? 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]' : ''}`}>
      {snapshot.inviteCode && snapshot.state !== 'ended' && (
        <div className="min-w-0 self-start rounded-[10px] border border-[#D8A85C]/50 bg-[#1C1C19] p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#9D9A90]">
            Código de convite · até 12 espectadores
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="tnum break-all text-2xl font-semibold tracking-[0.1em] sm:text-3xl" aria-label={`Código de convite ${snapshot.inviteCode ?? ''}`}>
              {snapshot.inviteCode ?? '…'}
            </p>
            <button
              type="button"
              onClick={onCopyInvite}
              disabled={busy || !snapshot.inviteCode}
              className="telae-press flex min-h-[44px] items-center gap-2 rounded-md border border-[#313029] bg-[#282721] px-4 text-sm font-semibold hover:bg-[#313029] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="mt-2 text-[13px] text-[#9D9A90]">
            Envie o mesmo código para todos. {snapshot.viewerCount} {snapshot.viewerCount === 1 ? 'pessoa conectada' : 'pessoas conectadas'}.
          </p>
          {snapshot.error && (
            <p role="alert" className="mt-2 text-sm text-[#FF5D5D]">
              {snapshot.error}
            </p>
          )}
        </div>
      )}

      {snapshot.hasLocalStream && (
        <figure className="order-first min-w-0">
          <div className="telae-video-canvas overflow-hidden rounded-[10px] border border-[#313029]">
            <video
              ref={videoRef}
              muted
              autoPlay
              playsInline
              className="block aspect-video max-h-[280px] w-full bg-black object-contain"
              aria-label={`Pré-visualização de ${sourceName ?? 'sua tela'}`}
            />
          </div>
          <figcaption title={sourceName ?? undefined} className="mt-2 truncate text-[13px] text-[#9D9A90]">
            Compartilhando: {sourceName ?? '—'} · {snapshot.viewerCount} {snapshot.viewerCount === 1 ? 'espectador' : 'espectadores'}
          </figcaption>
        </figure>
      )}
      </div>

      {formError && (
        <p role="alert" className="mt-4 text-sm text-[#FF5D5D]">
          {formError}
        </p>
      )}

      <fieldset disabled={controlsDisabled} aria-busy={busy} className="mt-4 grid min-w-0 grid-cols-1 items-end gap-3 rounded-lg border border-[#313029] bg-[#1C1C19] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="sr-only">Controles da transmissão</legend>
        <label className="min-w-0 text-sm">Qualidade da transmissão
          <select aria-label="Qualidade da transmissão" value={snapshot.quality} disabled={controlsDisabled} onChange={event => onQuality(event.target.value as QualityProfile, snapshot.contentMode)} className="mt-2 block min-h-[44px] w-full rounded-md border border-[#4A473E] bg-[#141412] p-2 disabled:cursor-not-allowed disabled:opacity-50">
            {QUALITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm">Conteúdo da transmissão
          <select aria-label="Conteúdo da transmissão" value={snapshot.contentMode} disabled={controlsDisabled} onChange={event => onQuality(snapshot.quality, event.target.value as ContentMode)} className="mt-2 block min-h-[44px] w-full rounded-md border border-[#4A473E] bg-[#141412] p-2 disabled:cursor-not-allowed disabled:opacity-50">
            <option value="text">Texto · priorizar nitidez</option>
            <option value="motion">Movimento · priorizar fluidez</option>
          </select>
        </label>
        <label className="text-sm">Limite de vídeo (Mbps)
          <input key={snapshot.uploadBudgetMbps} aria-label="Limite de vídeo (Mbps)" type="number" min="2" max="200" defaultValue={snapshot.uploadBudgetMbps} disabled={controlsDisabled} onBlur={event => {
            const value = Number(event.target.value)
            if (!event.target.value || !event.target.validity.valid || !Number.isFinite(value)) {
              event.target.value = String(snapshot.uploadBudgetMbps)
              return
            }
            if (value !== snapshot.uploadBudgetMbps) onUpload(value)
          }} className="tnum mt-2 block min-h-[44px] w-full rounded-md border border-[#4A473E] bg-[#141412] p-2 disabled:cursor-not-allowed disabled:opacity-50" />
        </label>
        <button type="button" onClick={onAudio} disabled={controlsDisabled || !snapshot.includeAudio} aria-pressed={snapshot.audioMuted} className="telae-press min-h-[44px] rounded-md border border-[#4A473E] px-3 text-sm hover:bg-[#282721] disabled:cursor-not-allowed disabled:opacity-50">
          {snapshot.audioMuted ? 'Ativar áudio da transmissão' : 'Silenciar transmissão'}
        </button>
        <p className="text-xs leading-relaxed text-[#9D9A90] sm:col-span-2 lg:col-span-4">O limite de vídeo é dividido entre os espectadores; áudio e tráfego de conexão são adicionais. Mais pessoas exigem mais capacidade do computador.</p>
      </fieldset>
      {!snapshot.relayAvailable && <p role="status" className="mt-3 text-sm text-[#E8C690]">Conexão direta disponível. Redes restritivas podem exigir o serviço de retransmissão do servidor.</p>}
      <section aria-label="Espectadores" className="mt-4 rounded-lg border border-[#313029] p-4">
        <h2 className="text-sm font-semibold">Espectadores ({snapshot.viewers.length})</h2>
        {snapshot.viewers.length === 0 && <p className="mt-2 text-sm text-[#9D9A90]">Aguardando alguém entrar com seu convite.</p>}
        <ul className="mt-2 max-h-[180px] space-y-2 overflow-y-auto">
          {snapshot.viewers.map(viewer => <li key={viewer.deviceId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md bg-[#1C1C19] px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <span title={viewer.displayName} className="min-w-0 truncate">{viewer.displayName}</span>
            <span className="col-start-1 row-start-2 text-xs text-[#9D9A90] sm:col-auto sm:row-auto">{viewer.state === 'connected' ? 'Conectado' : viewer.state === 'failed' || viewer.state === 'disconnected' ? 'Reconectando' : 'Conectando'}</span>
            <button type="button" disabled={busy} aria-label={`Remover ${viewer.displayName}`} onClick={() => onRemove(viewer.deviceId)} className="telae-press col-start-2 row-span-2 row-start-1 min-h-[44px] rounded-md border border-[#4A473E] px-3 hover:bg-[#282721] disabled:cursor-not-allowed disabled:opacity-50 sm:col-auto sm:row-auto">Remover</button>
          </li>)}
        </ul>
      </section>


      <details className="mt-4 rounded-md border border-[#313029] bg-[#1C1C19]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#9D9A90]">Detalhes da conexão</summary>
        <DiagnosticsBody snapshot={snapshot} onExport={onExport} />
      </details>
    </section>
  )
}
