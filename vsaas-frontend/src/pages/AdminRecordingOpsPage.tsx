/**
 * AdminRecordingOpsPage — cockpit operacional do pipeline de gravação.
 *
 * Consolida indicadores de saúde que hoje só estavam expostos via curl:
 *   - /api/health                  → tmpfs (paused/used/pct)
 *   - /api/recordings/storage/health → uploads (UPLOADED/PENDING/FAILED) +
 *                                      stuck + tenancyMisconfigured
 *
 * Ações:
 *   - "Retry uploads agora": POST /recordings/storage/retry-now
 *   - Auto-refresh 15s (toggle)
 *
 * Permissão: SUPER_ADMIN / ADMIN_GLOBAL.
 */
import { useEffect, useState, useCallback } from 'react'
import { Navigate, Link } from 'react-router-dom'
import {
  Loader2, AlertTriangle, CheckCircle2, RefreshCw, Activity, HardDrive,
  Server, Zap, Database, AlertCircle, Pause,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api, formatApiError } from '../api/client'
import { cn } from '../lib/utils'

const role = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const isSuperAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'

interface HealthResponse {
  status: string
  tmpfs?: {
    paused?:     boolean
    usedBytes?:  number
    totalBytes?: number
    pct?:        number
  } | null
}

interface StorageHealth {
  activeStorage: 'r2' | 's3' | 'local'
  r2: { enabled: boolean; ok?: boolean; buckets?: number; error?: string }
  s3: { enabled: boolean }
  segments: {
    UPLOADED:   number
    PENDING:    number
    FAILED:     number
    LOCAL_ONLY: number
    TOTAL:      number
  }
  stuck: Array<{
    id:           string
    storagePath:  string
    uploadStatus: string
    attempts:     number
    error:        string | null
    startedAt:    string
  }>
  tenancyMisconfigured: Array<{
    cameraId:   string
    cameraName: string
    reason:     string
  }>
}

export function AdminRecordingOpsPage() {
  if (!isSuperAdmin) return <Navigate to="/" replace />

  const [health, setHealth]     = useState<HealthResponse | null>(null)
  const [storage, setStorage]   = useState<StorageHealth | null>(null)
  const [loading, setLoading]   = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([
        fetch('/api/health').then(r => r.json()).catch(() => null),
        api.get('/recordings/storage/health').then(r => r.data).catch(() => null),
      ])
      setHealth(h)
      setStorage(s)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(reload, 15_000)
    return () => clearInterval(t)
  }, [autoRefresh, reload])

  async function retryNow() {
    setRetrying(true)
    setFeedback(null)
    try {
      const r = await api.post('/recordings/storage/retry-now')
      setFeedback({ ok: true, msg: `Worker disparado. ${r.data.processed ?? 0} segments processados.` })
      reload()
    } catch (err) {
      setFeedback({ ok: false, msg: formatApiError(err) })
    } finally {
      setRetrying(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  const tmpfsPct = health?.tmpfs?.pct ?? 0
  const tmpfsPaused = health?.tmpfs?.paused ?? false
  const totalSegments = storage?.segments?.TOTAL ?? 0
  const uploadedPct = totalSegments > 0
    ? Math.round(((storage?.segments?.UPLOADED ?? 0) / totalSegments) * 1000) / 10
    : 100
  const r2Ok = storage?.r2?.ok ?? false

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-rose-500/5 to-transparent border-cyan-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-rose-500 flex items-center justify-center shrink-0">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Recording Ops</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Saúde do pipeline de gravação: tmpfs, uploads R2, tenancy, crash-loop. Auto-refresh 15s.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
            <button
              onClick={reload}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10"
              title="Recarregar"
            >
              <RefreshCw className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>
      </GlassCard>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={HardDrive}
          label="Tmpfs"
          value={`${tmpfsPct.toFixed(1)}%`}
          sub={tmpfsPaused ? '🔴 PAUSED' : tmpfsPct > 70 ? '⚠️ Atenção' : 'OK'}
          accent={tmpfsPaused ? 'rose' : tmpfsPct > 70 ? 'amber' : 'emerald'}
        />
        <KpiCard
          icon={Server}
          label="R2 Storage"
          value={r2Ok ? 'OK' : 'OFF'}
          sub={r2Ok ? `${storage?.r2?.buckets ?? 0} buckets` : (storage?.r2?.error ?? 'desativado')}
          accent={r2Ok ? 'emerald' : 'rose'}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Upload OK"
          value={`${uploadedPct.toFixed(1)}%`}
          sub={`${(storage?.segments?.UPLOADED ?? 0).toLocaleString('pt-BR')} segments`}
          accent={uploadedPct > 95 ? 'emerald' : uploadedPct > 80 ? 'amber' : 'rose'}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Falhas"
          value={`${(storage?.segments?.FAILED ?? 0).toLocaleString('pt-BR')}`}
          sub={`${(storage?.segments?.PENDING ?? 0).toLocaleString('pt-BR')} pendentes`}
          accent={(storage?.segments?.FAILED ?? 0) > 0 ? 'rose' : 'slate'}
        />
      </div>

      {/* Tmpfs detail */}
      {health?.tmpfs && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="w-4 h-4 text-cyan-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Tmpfs /recordings</h3>
            {tmpfsPaused && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                <Pause className="w-3 h-3" /> RECORDING PAUSED
              </span>
            )}
          </div>
          <div className="h-3 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-300',
                tmpfsPct >= 85 ? 'bg-rose-500' : tmpfsPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500',
              )}
              style={{ width: `${Math.max(2, tmpfsPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
            <span>{formatBytes(health.tmpfs.usedBytes ?? 0)} usado</span>
            <span>{formatBytes(health.tmpfs.totalBytes ?? 0)} total</span>
          </div>
          {tmpfsPaused && (
            <p className="text-xs text-rose-600 dark:text-rose-300 mt-2 italic">
              Tmpfs em estado PAUSED — recording.service não vai iniciar novos ffmpeg até descer
              abaixo de 60%. Confira se o upload-worker está conseguindo escoar a fila do R2.
            </p>
          )}
        </GlassCard>
      )}

      {/* Upload status */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Fila de uploads</h3>
          </div>
          <button
            onClick={retryNow}
            disabled={retrying || (storage?.segments?.PENDING ?? 0) === 0}
            className="px-3 py-1.5 text-xs rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Retry agora
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          {[
            { k: 'UPLOADED' as const, color: 'emerald' },
            { k: 'PENDING' as const,  color: 'amber'   },
            { k: 'FAILED' as const,   color: 'rose'    },
            { k: 'LOCAL_ONLY' as const, color: 'slate' },
          ].map(({ k, color }) => (
            <div key={k} className={cn(
              'p-2 rounded-lg border',
              color === 'emerald' && 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30',
              color === 'amber'   && 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30',
              color === 'rose'    && 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30',
              color === 'slate'   && 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10',
            )}>
              <p className="text-[10px] uppercase font-bold text-slate-500">{k}</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white">
                {(storage?.segments?.[k] ?? 0).toLocaleString('pt-BR')}
              </p>
            </div>
          ))}
        </div>
        {feedback && (
          <div className={cn(
            'mt-3 p-2 rounded-lg text-xs flex items-center gap-2',
            feedback.ok
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
          )}>
            {feedback.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {feedback.msg}
          </div>
        )}
      </GlassCard>

      {/* Stuck segments */}
      {(storage?.stuck?.length ?? 0) > 0 && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Segments com problema (top 5)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500 text-[10px] uppercase">
                <tr>
                  <th className="text-left p-2">Segment</th>
                  <th className="text-left p-2">Path</th>
                  <th className="text-center p-2">Tentativas</th>
                  <th className="text-center p-2">Status</th>
                  <th className="text-left p-2">Erro</th>
                </tr>
              </thead>
              <tbody>
                {storage!.stuck.map(s => (
                  <tr key={s.id} className="border-t border-slate-200 dark:border-white/5">
                    <td className="p-2 font-mono text-[10px]">{s.id.slice(0, 8)}</td>
                    <td className="p-2 font-mono text-[10px] text-slate-500 truncate max-w-xs">{s.storagePath}</td>
                    <td className="p-2 text-center font-bold">{s.attempts}</td>
                    <td className="p-2 text-center">
                      <span className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                        s.uploadStatus === 'FAILED'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
                      )}>
                        {s.uploadStatus}
                      </span>
                    </td>
                    <td className="p-2 text-[10px] text-slate-500 truncate max-w-xs">{s.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* Tenancy misconfigured */}
      {(storage?.tenancyMisconfigured?.length ?? 0) > 0 && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Câmeras com tenancy misconfigured
              <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                {storage!.tenancyMisconfigured.length}
              </span>
            </h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Câmeras com recordEnabled=true mas sem integradorId resolvível. Recording aborta
            pra não cair em bucket genérico. Corrija Site/ClienteFinal/Integrador.
          </p>
          <div className="space-y-1.5">
            {storage!.tenancyMisconfigured.map(c => (
              <div key={c.cameraId} className="flex items-center justify-between p-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-xs">
                <div>
                  <Link
                    to={`/cameras/${c.cameraId}`}
                    className="font-medium text-cyan-600 hover:underline"
                  >
                    {c.cameraName}
                  </Link>
                  <p className="text-[10px] text-slate-500 font-mono">{c.cameraId.slice(0, 8)}</p>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  {c.reason.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, accent }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  accent: 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate'
}) {
  const colors = {
    emerald: 'text-emerald-600',
    amber:   'text-amber-600',
    rose:    'text-rose-600',
    cyan:    'text-cyan-600',
    slate:   'text-slate-600',
  }
  return (
    <GlassCard className="p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase text-slate-500 font-bold">{label}</span>
        <Icon className={cn('w-4 h-4', colors[accent])} />
      </div>
      <p className={cn('text-xl font-bold', colors[accent])}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </GlassCard>
  )
}

function formatBytes(b: number): string {
  if (!b) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = b, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
