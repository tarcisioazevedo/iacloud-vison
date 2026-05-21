/**
 * AdminStorageHealthPage — resumo de saúde do storage billing.
 *
 * Consome GET /billing/health-summary (SUPER_ADMIN only).
 * Refresh automático a cada 60s via useSWR.
 * Ação manual: POST /billing/run-health-summary.
 */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import useSWR from 'swr'
import {
  Activity, CheckCircle2, XCircle, RefreshCw, Loader2,
  HardDrive, BarChart2, Database, CreditCard, AlertCircle,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api } from '../api/client'
import { cn } from '../lib/utils'

// ─── Auth guard ────────────────────────────────────────────────────────────
const role = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const isSuperAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'

// ─── Types ─────────────────────────────────────────────────────────────────
interface StorageHealthSummary {
  generatedAt:  string
  windowHours:  number
  buckets: {
    total:            number
    active:           number
    withRecentEvents: number
    avgStorageGb:     number
  }
  usage: {
    rowsLast24h:  number
    bytesLast24h: number
  }
  recording: {
    segmentsLast24h: number
    cameras:         number
    failedUploads:   number
    pendingUploads:  number
  }
  billing: {
    snapshotsThisMonth: number
    avgDriftPct:        number
    outliersThisMonth:  number
    pendingUpgrades:    number
  }
  crons: {
    eventConsumerHealthy:  boolean
    reconciliationHealthy: boolean
    billingHealthy:        boolean
  }
}

// ─── Fetcher ───────────────────────────────────────────────────────────────
const fetcher = (url: string) => api.get(url).then(r => r.data)

// ─── Helpers ───────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return `há ${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `há ${mins}min`
  const hrs = Math.floor(mins / 60)
  return `há ${hrs}h`
}

// ─── Page ──────────────────────────────────────────────────────────────────
export function AdminStorageHealthPage() {
  if (!isSuperAdmin) return <Navigate to="/" replace />

  const { data, error, isLoading, mutate } = useSWR<StorageHealthSummary>(
    '/billing/health-summary',
    fetcher,
    { refreshInterval: 60_000 },
  )

  const [running, setRunning]   = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  async function runHealthSummary() {
    setRunning(true)
    setFeedback(null)
    try {
      await api.post('/billing/run-health-summary')
      await mutate()
      setFeedback({ ok: true, msg: 'Resumo regenerado com sucesso.' })
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.response?.data?.message ?? 'Erro ao rodar resumo.' })
    } finally {
      setRunning(false)
    }
  }

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  // ── Error ──
  if (error || !data) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <GlassCard className="p-5 flex items-center gap-3 border-rose-500/30">
          <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Falha ao carregar resumo</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {error?.response?.data?.message ?? 'Verifique permissões ou tente novamente.'}
            </p>
          </div>
          <button
            onClick={() => mutate()}
            className="ml-auto p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <RefreshCw className="w-4 h-4 text-slate-500" />
          </button>
        </GlassCard>
      </div>
    )
  }

  const { buckets, usage, recording, billing, crons, generatedAt, windowHours } = data

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-emerald-500/5 to-transparent border-cyan-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shrink-0">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Storage Health</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Resumo de saúde do storage billing — janela de {windowHours}h. Auto-refresh 60s.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => mutate()}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"
              title="Recarregar"
            >
              <RefreshCw className="w-4 h-4 text-slate-500" />
            </button>
            <button
              onClick={runHealthSummary}
              disabled={running}
              className="px-3 py-1.5 text-xs rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white flex items-center gap-1.5"
            >
              {running
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Activity className="w-3 h-3" />
              }
              Refresh agora
            </button>
          </div>
        </div>
      </GlassCard>

      {/* ── Feedback ───────────────────────────────────────────────────── */}
      {feedback && (
        <GlassCard className={cn(
          'p-3 flex items-center gap-2 text-xs',
          feedback.ok
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-rose-500/30 bg-rose-500/5',
        )}>
          {feedback.ok
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            : <AlertCircle  className="w-4 h-4 text-rose-500 shrink-0"    />
          }
          <span className={feedback.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
            {feedback.msg}
          </span>
        </GlassCard>
      )}

      {/* ── Cron Health ────────────────────────────────────────────────── */}
      <GlassCard className="p-4">
        <h2 className="text-xs font-bold uppercase text-slate-500 mb-3">Cron Health</h2>
        <div className="flex flex-wrap gap-2">
          <CronChip label="Event Consumer"  healthy={crons.eventConsumerHealthy}  />
          <CronChip label="Reconciliation"  healthy={crons.reconciliationHealthy} />
          <CronChip label="Billing"         healthy={crons.billingHealthy}        />
        </div>
      </GlassCard>

      {/* ── 2×2 metric grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Recording */}
        <MetricCard
          icon={Activity}
          title="Recording"
          accent="cyan"
          rows={[
            {
              label: 'Segments (24h)',
              value: recording.segmentsLast24h.toLocaleString('pt-BR'),
            },
            {
              label: 'Câmeras ativas',
              value: recording.cameras.toLocaleString('pt-BR'),
            },
            {
              label: 'Falhas de upload',
              value: recording.failedUploads.toLocaleString('pt-BR'),
              accent: recording.failedUploads > 0 ? 'rose' : undefined,
            },
            {
              label: 'Uploads pendentes',
              value: recording.pendingUploads.toLocaleString('pt-BR'),
              accent: recording.pendingUploads > 0 ? 'amber' : undefined,
            },
          ]}
        />

        {/* Storage Buckets */}
        <MetricCard
          icon={HardDrive}
          title="Storage Buckets"
          accent="emerald"
          rows={[
            { label: 'Total',               value: buckets.total.toLocaleString('pt-BR')            },
            { label: 'Ativos',              value: buckets.active.toLocaleString('pt-BR')           },
            { label: 'Com eventos recentes', value: buckets.withRecentEvents.toLocaleString('pt-BR') },
            { label: 'Média armazenado',    value: `${buckets.avgStorageGb.toFixed(2)} GB`           },
          ]}
        />

        {/* Usage 24h */}
        <MetricCard
          icon={BarChart2}
          title="Usage (24h)"
          accent="violet"
          rows={[
            { label: 'Linhas inseridas', value: usage.rowsLast24h.toLocaleString('pt-BR') },
            { label: 'Bytes gravados',   value: formatBytes(usage.bytesLast24h)            },
          ]}
        />

        {/* Billing */}
        <MetricCard
          icon={CreditCard}
          title="Billing"
          accent="amber"
          rows={[
            {
              label: 'Snapshots (mês)',
              value: billing.snapshotsThisMonth.toLocaleString('pt-BR'),
            },
            {
              label: 'Drift médio',
              value: `${billing.avgDriftPct.toFixed(1)}%`,
              accent: billing.avgDriftPct > 5 ? 'amber' : undefined,
            },
            {
              label: 'Outliers (mês)',
              value: billing.outliersThisMonth.toLocaleString('pt-BR'),
              accent: billing.outliersThisMonth > 0 ? 'amber' : undefined,
            },
            {
              label: 'Upgrades pendentes',
              value: billing.pendingUpgrades.toLocaleString('pt-BR'),
              accent: billing.pendingUpgrades > 0 ? 'amber' : undefined,
            },
          ]}
        />

      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <p className="text-center text-[11px] text-slate-400 pb-2">
        <Database className="w-3 h-3 inline mr-1 opacity-60" />
        Gerado em: {relativeTime(generatedAt)} &nbsp;·&nbsp; {new Date(generatedAt).toLocaleString('pt-BR')}
      </p>

    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function CronChip({ label, healthy }: { label: string; healthy: boolean }) {
  return (
    <div className={cn(
      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border',
      healthy
        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
        : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300',
    )}>
      {healthy
        ? <CheckCircle2 className="w-3.5 h-3.5" />
        : <XCircle      className="w-3.5 h-3.5" />
      }
      {label}
    </div>
  )
}

type Accent = 'rose' | 'amber' | 'emerald' | 'cyan' | 'violet'

interface MetricRow {
  label:  string
  value:  string
  accent?: Accent
}

function MetricCard({
  icon: Icon, title, accent, rows,
}: {
  icon:   React.ComponentType<{ className?: string }>
  title:  string
  accent: Accent
  rows:   MetricRow[]
}) {
  const headerColors: Record<Accent, string> = {
    cyan:    'text-cyan-500',
    emerald: 'text-emerald-500',
    amber:   'text-amber-500',
    rose:    'text-rose-500',
    violet:  'text-violet-500',
  }
  const valueColors: Record<Accent, string> = {
    cyan:    'text-cyan-600 dark:text-cyan-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber:   'text-amber-600 dark:text-amber-400',
    rose:    'text-rose-600 dark:text-rose-400',
    violet:  'text-violet-600 dark:text-violet-400',
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn('w-4 h-4', headerColors[accent])} />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
      </div>
      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{row.label}</span>
            <span className={cn(
              'font-semibold tabular-nums',
              row.accent
                ? valueColors[row.accent]
                : 'text-slate-900 dark:text-white',
            )}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
