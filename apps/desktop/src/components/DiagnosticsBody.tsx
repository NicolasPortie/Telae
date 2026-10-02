import { Download } from 'lucide-react'
import type { ShareSessionController } from '../services/share-session'
import { qualityLabel, transportLabel, SESSION_STATE_LABELS } from '../ui/format'

export function DiagnosticsBody({
  snapshot,
  onExport,
}: {
  snapshot: ReturnType<ShareSessionController['getSnapshot']>
  onExport: () => void
}) {
  const d = snapshot.diagnostics
  const rows: [string, string][] = [
    ['Estado', SESSION_STATE_LABELS[snapshot.state] ?? '—'],
    ['Conexão', transportLabel(snapshot.transportPath) ?? '—'],
    ['Qualidade', qualityLabel(snapshot.quality)],
    ['Resolução', d.width && d.height ? `${d.width}×${d.height}` : '—'],
    ['Quadros/s', d.framesPerSecond !== null ? String(Math.round(d.framesPerSecond)) : '—'],
    ['Bitrate', `${d.bitrateKbps} kbps`],
    ['RTT', d.roundTripMs !== null ? `${d.roundTripMs} ms` : '—'],
    ['Perda', d.packetLossPercent !== null ? `${d.packetLossPercent.toFixed(1)}%` : '—'],
    ['Jitter', d.jitterMs !== null ? `${d.jitterMs} ms` : '—'],
    ['Codec', d.codec ?? '—'],
    ['Candidato', d.candidateType ?? '—'],
    ['Áudio', !snapshot.includeAudio ? 'indisponível' : snapshot.audioMuted ? 'silenciado' : snapshot.role === 'viewer' ? d.audioReceiving ? 'recebendo' : 'aguardando dados' : 'incluído'],
    ['Nível de áudio', d.audioLevel == null ? '—' : `${Math.round(d.audioLevel * 100)}%`],
    ['Codificação', d.encodeMs !== undefined && d.encodeMs !== null ? `${d.encodeMs.toFixed(1)} ms/quadro` : '—'],
    ['Fila de áudio', snapshot.audioBuffer ? `${Math.round(snapshot.audioBuffer.queuedMs)} ms` : '—'],
  ]
  return (
    <div className="border-t border-[#313029] px-4 py-3">
      <dl className="tnum grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt className="text-[#9D9A90]">{term}</dt>
            <dd className="truncate">{value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={onExport}
        className="telae-press mt-3 flex min-h-[40px] items-center gap-2 rounded-md border border-[#313029] bg-[#282721] px-4 text-sm font-semibold"
      >
        <Download size={15} aria-hidden="true" /> Exportar diagnóstico (JSON)
      </button>
    </div>
  )
}
