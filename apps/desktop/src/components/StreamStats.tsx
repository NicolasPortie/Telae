import type { ConnectionQuality } from '../services/share-session'
import type { DiagnosticsSnapshot } from '../services/types'
import { numberLocale, t } from '../i18n'
import { estimateLatencyMs, formatBitrate, transportLabel } from '../ui/format'

const QUALITY_BADGE: Record<ConnectionQuality, { label: () => string; dot: string }> = {
  good: { label: () => t('Conexão boa'), dot: 'bg-ok' },
  degraded: { label: () => t('Conexão instável'), dot: 'bg-signal' },
  poor: { label: () => t('Conexão fraca'), dot: 'bg-danger' },
  unknown: { label: () => t('Medindo conexão…'), dot: 'bg-ink-4' },
}

/** Selo compacto com a saúde da conexão; usado sozinho em áreas onde o painel completo não cabe. */
export function ConnectionBadge({ quality }: { quality: ConnectionQuality }) {
  const badge = QUALITY_BADGE[quality]
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} /> {badge.label()}
    </span>
  )
}

function Row({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-ink-3">{label}</dt>
      <dd className={`tnum text-right font-mono text-[11px] ${warn ? 'text-signal-soft' : 'text-ink'}`}>{value}</dd>
    </div>
  )
}

const ms = (value: number | null | undefined) => (value == null ? '—' : `${Math.round(value)} ms`)

/** Estatísticas do vídeo em tempo real. Mostra só o que a telemetria realmente mediu. */
export function StreamStats({ diagnostics: d, connection, className = '' }: {
  diagnostics: DiagnosticsSnapshot
  connection: ConnectionQuality
  className?: string
}) {
  const latency = estimateLatencyMs(d)
  const resolution = d.width && d.height ? `${d.width}×${d.height}${d.framesPerSecond != null ? ` · ${Math.round(d.framesPerSecond)} fps` : ''}` : '—'
  const loss = d.packetLossPercent == null ? '—' : `${d.packetLossPercent.toLocaleString(numberLocale(), { maximumFractionDigits: 1 })}%`
  const frozen = (d.freezeCount ?? 0) > 0
  return (
    <section aria-label={t('Estatísticas da transmissão')} className={`rounded-2xl border border-line-strong bg-canvas/90 p-4 text-xs shadow-card backdrop-blur ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-6">
        <h2 className="eyebrow">{t('Estatísticas')}</h2>
        <ConnectionBadge quality={connection} />
      </div>
      <dl className="grid gap-1.5">
        <Row label={t('Imagem')} value={resolution} />
        <Row label={t('Codec')} value={d.codec ?? '—'} />
        <Row label={t('Vídeo')} value={formatBitrate(d.bitrateKbps || null)} />
        {d.audioBitrateKbps != null && <Row label={t('Áudio')} value={formatBitrate(d.audioBitrateKbps)} />}
        <Row label={t('Latência estimada')} value={latency == null ? '—' : `≥ ${latency} ms`} warn={latency != null && latency > 150} />
        <Row label={t('Latência de rede (RTT)')} value={ms(d.roundTripMs)} warn={(d.roundTripMs ?? 0) > 150} />
        <Row label={t('Perda de pacotes')} value={loss} warn={(d.packetLossPercent ?? 0) > 2} />
        <Row label={t('Jitter')} value={ms(d.jitterMs)} warn={(d.jitterMs ?? 0) > 30} />
        {d.decodeMs != null && <Row label={t('Decodificação')} value={`${d.decodeMs.toFixed(1)} ms`} />}
        {d.encodeMs != null && <Row label={t('Codificação')} value={`${d.encodeMs.toFixed(1)} ms`} warn={d.qualityLimitationReason === 'cpu'} />}
        {d.freezeCount != null && <Row label={t('Travadas')} value={frozen ? `${d.freezeCount} (${((d.freezeDurationMs ?? 0) / 1000).toFixed(1)} s)` : t('Nenhuma')} warn={frozen} />}
        <Row label={t('Rota')} value={transportLabel(d.transportPath) ?? '—'} />
      </dl>
    </section>
  )
}
