/**
 * StatusTab — aba "Status" da RecordingsPage. Mostra:
 *   - Card por câmera com estado LIVE/IDLE/STOPPED
 *   - Cobertura últimas 24h, MB ingeridos, segmentos hoje
 *   - Origem (BOX / CLOUD_FFMPEG)
 *   - Feed de logs em tempo real (auto-refresh 3s)
 *
 * Pensado pra dev solo + operador identificar rapidamente:
 *   1. Câmera tem dado entrando? (LIVE)
 *   2. Quantos minutos de gravação nas últimas 24h?
 *   3. Está dando dedup ou erro? (feed colorido)
 */
import { useMemo } from 'react'
import { Activity, AlertCircle, Camera as CameraIcon, Clock,
         Database, RefreshCw, Server } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { useRecordingStats, useRecordingUploadLogs,
         type RecordingUploadLog } from '../../api/client'
import { cn } from '../../lib/utils'

interface CameraLite {
  id:    string
  name:  string
  status?: string
  deploymentMode?: string
  recordEnabled?: boolean
  site?: { name?: string }
}

export function StatusTab({ cameras }: { cameras: CameraLite[] }) {
  const recordable = useMemo(
    () => cameras.filter(c => c.recordEnabled !== false),
    [cameras],
  )

  return (
    <div className="space-y-3">
      <GlassCard className="p-3">
        <div className="flex items-start gap-2">
          <Activity className="w-4 h-4 text-cyan-500 dark:text-cyan-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-600 dark:text-slate-400">
            <p className="font-medium text-slate-800 dark:text-slate-200">
              Monitoramento de gravações
            </p>
            <p className="mt-0.5 leading-relaxed">
              Atualiza a cada 5s. <strong>LIVE</strong> = último segmento &lt; 30s ·{' '}
              <strong>IDLE</strong> = &lt; 1h · <strong>STOPPED</strong> = sem gravação recente.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Grid de cards de câmera */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {recordable.map(cam => (
          <CameraStatusCard key={cam.id} camera={cam} />
        ))}
        {recordable.length === 0 && (
          <GlassCard className="p-6 col-span-full text-center text-xs text-slate-500">
            Nenhuma câmera com gravação habilitada.
          </GlassCard>
        )}
      </div>

      {/* Feed de logs (todas câmeras) */}
      <UploadLogsFeed />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Card individual por câmera
// ─────────────────────────────────────────────────────────────────────────
function CameraStatusCard({ camera }: { camera: CameraLite }) {
  const { data: stats, isLoading } = useRecordingStats(camera.id, '24h')

  const stateColor =
    !stats || stats.recordingState === 'STOPPED' ? 'rose' :
    stats.recordingState === 'IDLE' ? 'amber' : 'emerald'
  const stateLabel =
    !stats ? '—' : stats.recordingState

  const stateBgClass = stateColor === 'emerald'
    ? 'bg-emerald-500/15 text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-500/30'
    : stateColor === 'amber'
    ? 'bg-amber-500/15 text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-500/30'
    : 'bg-rose-500/15 text-rose-700 border-rose-300 dark:text-rose-400 dark:border-rose-500/30'

  const liveAnimClass = stats?.recordingState === 'LIVE' ? 'animate-pulse' : ''

  return (
    <GlassCard className="p-3">
      <div className="flex items-start gap-2 mb-2">
        <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0">
          <CameraIcon className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
            {camera.name}
          </p>
          <p className="text-[10px] text-slate-500 truncate">
            {camera.site?.name ?? '—'} · {camera.deploymentMode ?? '—'}
          </p>
        </div>
        <span className={cn(
          'px-2 py-0.5 rounded-full text-[10px] font-bold border',
          stateBgClass, liveAnimClass,
        )}>
          {stateLabel}
        </span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-10 rounded bg-slate-100 dark:bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : !stats ? (
        <p className="text-[10px] text-slate-500 italic">Sem dados.</p>
      ) : (
        <>
          {/* 3 KPIs */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Kpi
              icon={<Clock className="w-3 h-3" />}
              label="Último seg."
              value={
                stats.lastSegmentAgeSec === null
                  ? '—'
                  : stats.lastSegmentAgeSec < 60
                    ? `${stats.lastSegmentAgeSec}s atrás`
                    : stats.lastSegmentAgeSec < 3600
                      ? `${Math.round(stats.lastSegmentAgeSec / 60)}m`
                      : `${Math.round(stats.lastSegmentAgeSec / 3600)}h`
              }
            />
            <Kpi
              icon={<Database className="w-3 h-3" />}
              label="Hoje"
              value={`${stats.totalSegments}`}
              sub={formatBytes(BigInt(stats.totalBytes))}
            />
            <Kpi
              icon={<Server className="w-3 h-3" />}
              label="Cobertura"
              value={`${stats.coverageMinutes}m`}
              sub={formatUptimePct(stats.uptimePct)}
            />
          </div>

          {/* Barra de uptime */}
          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
            <div
              className={cn(
                'h-full transition-all',
                stateColor === 'emerald' ? 'bg-emerald-500' :
                stateColor === 'amber'   ? 'bg-amber-500' : 'bg-rose-500',
              )}
              style={{ width: `${Math.min(100, stats.uptimePct)}%` }}
            />
          </div>

          {/* Footer: status do upload pra cloud (R2/S3) */}
          {stats.uploadStatus && (
            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-white/5 flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Cloud:</span>
                <span className={cn(
                  'font-bold',
                  (stats.cloudUploadedPct ?? 0) >= 99 ? 'text-emerald-600 dark:text-emerald-400' :
                  (stats.cloudUploadedPct ?? 0) >= 80 ? 'text-amber-600 dark:text-amber-400' :
                                                       'text-rose-600 dark:text-rose-400',
                )}>
                  {(stats.cloudUploadedPct ?? 0).toFixed(1)}%
                </span>
                {(stats.uploadStatus.PENDING ?? 0) > 0 && (
                  <span className="text-amber-500" title="Pendentes de upload">
                    · {stats.uploadStatus.PENDING}⏳
                  </span>
                )}
                {(stats.uploadStatus.FAILED ?? 0) > 0 && (
                  <span className="text-rose-500" title="Falharam após retries">
                    · {stats.uploadStatus.FAILED}✗
                  </span>
                )}
              </div>
              <div className="text-slate-500" title="Última ingestão confirmada no R2/S3">
                {stats.lastUploadAgeSec === null || stats.lastUploadAgeSec === undefined
                  ? 'sem ingest'
                  : stats.lastUploadAgeSec < 60
                    ? `↑ ${stats.lastUploadAgeSec}s`
                    : stats.lastUploadAgeSec < 3600
                      ? `↑ ${Math.round(stats.lastUploadAgeSec / 60)}m`
                      : `↑ ${Math.round(stats.lastUploadAgeSec / 3600)}h`}
              </div>
            </div>
          )}
        </>
      )}
    </GlassCard>
  )
}

function Kpi({ icon, label, value, sub }: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-md bg-slate-50 dark:bg-white/5 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] text-slate-500 mb-0.5">
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
      {sub && <p className="text-[9px] text-slate-500 tabular-nums">{sub}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Feed de logs — todos os ingest events recentes
// ─────────────────────────────────────────────────────────────────────────
function UploadLogsFeed() {
  const { data, isLoading, mutate } = useRecordingUploadLogs(null, 50)

  return (
    <GlassCard className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
          <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
            Logs de ingest (tempo real)
          </h3>
          <span className="text-[10px] text-slate-500">auto-refresh 3s</span>
        </div>
        <button
          onClick={() => mutate()}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10 text-slate-500"
          title="Atualizar agora"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="max-h-[40vh] overflow-y-auto">
        {isLoading ? (
          <p className="text-[10px] text-slate-500 text-center py-4">Carregando…</p>
        ) : !data || data.logs.length === 0 ? (
          <div className="text-center py-6 text-slate-500">
            <AlertCircle className="w-5 h-5 mx-auto mb-1 opacity-50" />
            <p className="text-[11px] font-medium">Sem ingest recente</p>
            <p className="text-[10px] mt-0.5 opacity-75">
              Edge box ainda não enviou segments. Veja `scripts/edge-segment-simulator.ts`
              para gerar dados de teste.
            </p>
          </div>
        ) : (
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-[10px] text-slate-500 uppercase tracking-wide border-b border-slate-200 dark:border-white/10">
              <tr>
                <th className="text-left py-1 pr-2">Hora</th>
                <th className="text-left py-1 pr-2">Câmera</th>
                <th className="text-left py-1 pr-2">Evento</th>
                <th className="text-right py-1 pr-2">Tam.</th>
                <th className="text-right py-1">Dur.</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map(l => <LogRow key={l.id} log={l} />)}
            </tbody>
          </table>
        )}
      </div>
    </GlassCard>
  )
}

function LogRow({ log }: { log: RecordingUploadLog }) {
  const levelColor =
    log.level === 'ERROR' ? 'text-rose-600 dark:text-rose-400' :
    log.level === 'WARN'  ? 'text-amber-600 dark:text-amber-400' :
    /* INFO */              'text-emerald-600 dark:text-emerald-400'

  const details = log.details ?? {}
  const sizeBytes = (details as any)?.sizeBytes
  const durationSec = (details as any)?.durationSec
  const source = (details as any)?.source ?? '—'

  const time = new Date(log.at).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <tr className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
      <td className="py-1 pr-2 text-slate-600 dark:text-slate-400">{time}</td>
      <td className="py-1 pr-2 text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
        {log.cameraName ?? log.cameraId.slice(0, 8)}
      </td>
      <td className={cn('py-1 pr-2 font-medium truncate max-w-[260px]', levelColor)}>
        {log.message}
        <span className="ml-1 text-[9px] text-slate-500 font-normal">({source})</span>
      </td>
      <td className="py-1 pr-2 text-right text-slate-600 dark:text-slate-400">
        {typeof sizeBytes === 'number' ? formatBytes(BigInt(sizeBytes)) : '—'}
      </td>
      <td className="py-1 text-right text-slate-600 dark:text-slate-400">
        {typeof durationSec === 'number' ? `${durationSec.toFixed(1)}s` : '—'}
      </td>
    </tr>
  )
}

function formatBytes(bytes: bigint | number): string {
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Mostra uptime de forma proporcional ao valor:
 *   100%, 12.3%, 0.5%, 0.05%, <0.01% (truncado pra leitura).
 * Evita mostrar "0%" quando há apenas alguns segundos de cobertura
 * dentro de uma janela de 24h.
 */
function formatUptimePct(pct: number): string {
  if (pct === 0) return '0%'
  if (pct >= 10)  return `${pct.toFixed(0)}%`
  if (pct >= 1)   return `${pct.toFixed(1)}%`
  if (pct >= 0.1) return `${pct.toFixed(2)}%`
  if (pct >= 0.01) return `${pct.toFixed(3)}%`
  return '<0.01%'
}
