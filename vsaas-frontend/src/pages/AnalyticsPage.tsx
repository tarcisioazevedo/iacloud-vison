import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Brain, Activity, AlertTriangle, ShieldAlert, Camera, Image as ImageIcon,
  TrendingUp, TrendingDown, Minus, Flame, Gauge,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { motion } from 'framer-motion'
import { GlassCard } from '../components/cards/GlassCard'
import { KpiCard } from '../components/cards/KpiCard'
import {
  useIaKpis, useIaBreakdown, useIaHeatmap, useIaTopCameras, useIaTimeline,
} from '../api/client'
import { cn } from '../lib/utils'
import { ExportCsvButton } from '../components/ExportCsvButton'
import type { CsvColumn } from '../lib/csv'

// ── Helpers ────────────────────────────────────────────────────────────────

const MODEL_LABELS: Record<string, string> = {
  FACE_ANNOTATION:             'Faces',
  LABEL_DETECTION:             'Labels',
  LOGO_DETECTION:              'Logos',
  OBJECT_LOCALIZATION:         'Objetos',
  SAFE_SEARCH:                 'Safe Search',
  OCCUPANCY_ANALYTICS:         'Ocupação',
  PPE_DETECTION:               'EPI',
  PEOPLE_COUNTING:             'Contagem',
  VEHICLE_DETECTION:           'Veículos',
  CROWD_DENSITY:               'Densidade',
  QUEUE_LENGTH:                'Filas',
  FACE_RECOGNITION:            'Reconhecimento Facial',
  LICENSE_PLATE_RECOGNITION:   'LPR',
  AUDIO_DETECTION:             'Áudio',
  SEMANTIC_SEARCH:             'Busca Semântica',
  GENAI_DESCRIPTION:           'GenAI',
}

const DONUT_COLORS = [
  '#4A90E2', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e',
  '#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#fb7185',
]

const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function densityToColor(v: number): string {
  // 0..1 — rampa cyan→sky→amber→rose (tema brand)
  if (v <= 0)   return 'rgba(255,255,255,0.03)'
  if (v < 0.25) return `rgba(74,144,226,${0.25 + v})`
  if (v < 0.5)  return `rgba(139,92,246,${0.4 + v * 0.5})`
  if (v < 0.75) return `rgba(251,191,36,${0.5 + v * 0.5})`
  return `rgba(244,63,94,${0.6 + v * 0.4})`
}

function PeriodSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const opts = [1, 7, 14, 30]
  return (
    <div className="flex gap-1 bg-slate-50 dark:bg-white/[0.03] rounded-lg p-1 text-xs">
      {opts.map(o => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            'px-2.5 py-1 rounded-md transition-colors',
            value === o ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300 font-medium' : 'text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
          )}
        >
          {o === 1 ? '24h' : `${o}d`}
        </button>
      ))}
    </div>
  )
}

// ── KPI strip ──────────────────────────────────────────────────────────────

function KpisStrip({ days }: { days: number }) {
  const { data, isLoading } = useIaKpis(days)

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 rounded-2xl border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-white/[0.02] animate-pulse" />
        ))}
      </div>
    )
  }

  const trend = data.deltaPct ?? undefined
  const sev = data.bySeverity ?? { INFO: 0, WARNING: 0, CRITICAL: 0 }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      <KpiCard
        title="Total de Detecções"
        value={data.total}
        subtitle={`Últimos ${data.periodDays}d`}
        icon={<Brain className="w-full h-full" />}
        accent="cyan"
        trend={trend}
        delay={0.05}
      />
      <KpiCard
        title="Últimas 24h"
        value={data.last24h}
        subtitle="janela móvel"
        icon={<Activity className="w-full h-full" />}
        accent="violet"
        delay={0.1}
      />
      <KpiCard
        title="Câmeras Ativas em IA"
        value={data.activeCameras}
        subtitle="com detecção no período"
        icon={<Camera className="w-full h-full" />}
        accent="emerald"
        delay={0.15}
      />
      <KpiCard
        title="Com Evidência"
        value={data.withEvidencePct}
        subtitle="snapshots no GCS"
        icon={<ImageIcon className="w-full h-full" />}
        accent="amber"
        format="pct"
        delay={0.2}
      />
      <KpiCard
        title="Alertas (WARNING)"
        value={sev.WARNING}
        subtitle="moderada severidade"
        icon={<AlertTriangle className="w-full h-full" />}
        accent="amber"
        delay={0.25}
      />
      <KpiCard
        title="Críticos"
        value={sev.CRITICAL}
        subtitle="alta prioridade"
        icon={<ShieldAlert className="w-full h-full" />}
        accent="rose"
        delay={0.3}
      />
    </div>
  )
}

// ── Donut breakdown by model ───────────────────────────────────────────────

function ModelBreakdown({ days }: { days: number }) {
  const { data, isLoading } = useIaBreakdown(days)

  const slices = (data?.byModel ?? []).slice(0, 8).map((m, i) => ({
    name:  MODEL_LABELS[m.model] ?? m.model,
    value: m.count,
    pct:   m.pct,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }))

  return (
    <GlassCard delay={0.4} className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">IAs por Modelo</h3>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-500">{data?.total ?? 0} detecções</span>
      </div>

      {isLoading ? (
        <div className="h-56 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : slices.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs text-slate-500 dark:text-slate-500">
          Sem detecções no período
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 items-center">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={slices}
                cx="50%" cy="50%"
                innerRadius={45} outerRadius={75}
                dataKey="value"
                strokeWidth={0}
              >
                {slices.map((s, i) => (
                  <Cell key={i} fill={s.color} opacity={0.9} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#0a1628', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#fff' }}
              />
            </PieChart>
          </ResponsiveContainer>

          <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
            {slices.map(s => (
              <div key={s.name} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="text-slate-700 dark:text-slate-300 flex-1 truncate">{s.name}</span>
                <span className="text-slate-500 dark:text-slate-500 font-mono">{s.value}</span>
                <span className="text-slate-500 dark:text-slate-600 w-9 text-right">{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top event types */}
      {data?.byEventType?.length ? (
        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-white/5">
          <p className="text-[10px] text-slate-500 dark:text-slate-500 uppercase tracking-wider mb-2">Top tipos de evento</p>
          <div className="flex flex-wrap gap-1.5">
            {data.byEventType.slice(0, 8).map(et => (
              <span
                key={et.eventType}
                className="text-[10px] px-2 py-0.5 rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/5 dark:text-cyan-300"
              >
                {et.eventType} <span className="text-slate-500 dark:text-slate-500 ml-1">{et.count}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </GlassCard>
  )
}

// ── Heatmap 7 × 24 ─────────────────────────────────────────────────────────

function HourDayHeatmap({ days }: { days: number }) {
  const { data, isLoading } = useIaHeatmap(days)
  const matrix = data?.matrix ?? Array.from({ length: 7 }, () => Array(24).fill(0))
  const max    = Math.max(1, data?.max ?? 1)

  return (
    <GlassCard delay={0.45} className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Flame className="w-4 h-4 text-rose-700 dark:text-rose-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Heatmap Hora × Dia</h3>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-500">{data?.total ?? 0} eventos · {data?.periodDays ?? days}d</span>
      </div>

      {isLoading ? (
        <div className="h-56 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-1">
          {/* Hour ruler */}
          <div className="grid gap-0.5 text-[8px] text-slate-500 dark:text-slate-600 pl-9" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
            {Array.from({ length: 24 }).map((_, h) => (
              <span key={h} className="text-center">{h % 3 === 0 ? h : ''}</span>
            ))}
          </div>

          {matrix.map((row, dow) => (
            <div key={dow} className="flex items-center gap-1">
              <span className="text-[10px] text-slate-500 dark:text-slate-500 w-8 shrink-0">{DOW_LABELS[dow]}</span>
              <div
                className="grid gap-0.5 flex-1 rounded overflow-hidden"
                style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}
              >
                {row.map((val, h) => (
                  <motion.div
                    key={h}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.45 + (dow * 24 + h) * 0.001, duration: 0.25 }}
                    title={`${DOW_LABELS[dow]} ${h}h: ${val} eventos`}
                    className="aspect-square rounded-[1px] cursor-crosshair"
                    style={{ background: densityToColor(val / max) }}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between mt-3 px-9">
            <span className="text-[10px] text-slate-500 dark:text-slate-600">Sem eventos</span>
            <div className="flex gap-0.5 flex-1 mx-3 h-1.5 rounded-full overflow-hidden">
              {[0.05, 0.2, 0.4, 0.6, 0.8, 1].map((v, i) => (
                <div key={i} className="flex-1" style={{ background: densityToColor(v) }} />
              ))}
            </div>
            <span className="text-[10px] text-slate-500 dark:text-slate-600">Pico ({max})</span>
          </div>
        </div>
      )}
    </GlassCard>
  )
}

// ── Top câmeras ruidosas ───────────────────────────────────────────────────

function TopCameras({ days }: { days: number }) {
  const { data, isLoading } = useIaTopCameras(days, 10)
  const rows = data?.data ?? []
  const max  = Math.max(1, ...rows.map(r => r.events))

  return (
    <GlassCard delay={0.5} className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Camera className="w-4 h-4 text-amber-500 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Top câmeras (mais detecções)</h3>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-500">Top {rows.length}</span>
      </div>

      {isLoading ? (
        <div className="h-56 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs text-slate-500 dark:text-slate-500">
          Nenhuma câmera com detecções no período
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((c, i) => {
            const pct = (c.events / max) * 100
            return (
              <div key={c.cameraId} className="group">
                <div className="flex items-baseline justify-between text-xs mb-1">
                  <span className="text-slate-700 dark:text-slate-300 truncate flex items-center gap-2">
                    <span className="text-slate-500 dark:text-slate-600 font-mono w-4">{i + 1}.</span>
                    <span className="font-medium">{c.cameraName}</span>
                    {c.siteName && <span className="text-slate-500 dark:text-slate-600">• {c.siteName}</span>}
                    {c.clientName && <span className="text-slate-500 dark:text-slate-700 hidden lg:inline">• {c.clientName}</span>}
                  </span>
                  <span className="text-cyan-700 dark:text-cyan-300 font-mono shrink-0 ml-2">{c.events}</span>
                </div>
                <div className="h-1.5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut', delay: 0.5 + i * 0.05 }}
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-cyan-400 to-violet-400"
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </GlassCard>
  )
}

// ── Timeline ───────────────────────────────────────────────────────────────

function Timeline({ days }: { days: number }) {
  const granularity = days <= 1 ? 'hour' : 'day'
  const { data, isLoading } = useIaTimeline(days, granularity)

  const chartData = (data?.data ?? []).map(p => ({
    bucket:   p.bucket,
    Total:    p.total,
    Atenção:  p.warning,
    Crítico:  p.critical,
  }))

  return (
    <GlassCard delay={0.55} className="p-5">
      <div className="flex items-center gap-2 mb-5">
        <TrendingUp className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Evolução Temporal</h3>
        <span className="ml-auto flex gap-3 text-xs text-slate-500 dark:text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" />Total</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />Atenção</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400" />Crítico</span>
        </span>
      </div>

      {isLoading ? (
        <div className="h-56 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="iaGradTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#4A90E2" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#4A90E2" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="iaGradWarn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#fbbf24" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="iaGradCrit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#0a1628', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: '#94a3b8' }}
              itemStyle={{ color: '#fff' }}
            />
            <Area type="monotone" dataKey="Total"   stroke="#4A90E2" strokeWidth={2} fill="url(#iaGradTotal)" dot={false} />
            <Area type="monotone" dataKey="Atenção" stroke="#fbbf24" strokeWidth={2} fill="url(#iaGradWarn)"  dot={false} />
            <Area type="monotone" dataKey="Crítico" stroke="#f43f5e" strokeWidth={2} fill="url(#iaGradCrit)"  dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  )
}

// ── Comparativo período ─────────────────────────────────────────────────────

function PeriodComparison({ days }: { days: number }) {
  const { data } = useIaKpis(days)
  if (!data) return null

  const delta = data.deltaPct
  const Icon = delta == null ? Minus : delta > 0 ? TrendingUp : TrendingDown
  const color =
    delta == null ? 'text-slate-700 dark:text-slate-400' :
    delta > 0 ? 'text-emerald-700 dark:text-emerald-400' :
    'text-rose-700 dark:text-rose-400'

  return (
    <GlassCard delay={0.35} className="p-4">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500 mb-1">vs período anterior</p>
      <div className="flex items-baseline gap-2">
        <Icon className={cn('w-5 h-5', color)} />
        <span className={cn('text-2xl font-bold tabular-nums', color)}>
          {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`}
        </span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
        {data.total.toLocaleString('pt-BR')} agora · {data.prevPeriodTotal.toLocaleString('pt-BR')} antes
      </p>
    </GlassCard>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

function AnalyticsExportBar({ days }: { days: number }) {
  const breakdown = useIaBreakdown(days).data?.data ?? []
  const topCams   = useIaTopCameras(days, 100).data?.data ?? []
  const timeline  = useIaTimeline(days, 'day').data?.data ?? []

  const breakdownCols: CsvColumn<any>[] = [
    { header: 'Modelo',         accessor: r => MODEL_LABELS[r.model] ?? r.model },
    { header: 'Modelo (raw)',   accessor: r => r.model },
    { header: 'Total',          accessor: r => r.total },
    { header: 'Crítico',        accessor: r => r.critical ?? 0 },
    { header: 'Alerta',         accessor: r => r.warning ?? 0 },
    { header: 'Info',           accessor: r => r.info ?? 0 },
    { header: '% do total',     accessor: r => r.pctOfTotal ?? '' },
  ]
  const topCamsCols: CsvColumn<any>[] = [
    { header: 'Câmera',  accessor: r => r.cameraName ?? r.name ?? '' },
    { header: 'ID',      accessor: r => r.cameraId ?? r.id ?? '' },
    { header: 'Total',   accessor: r => r.total ?? r.count ?? 0 },
    { header: 'Crítico', accessor: r => r.critical ?? 0 },
    { header: 'Alerta',  accessor: r => r.warning ?? 0 },
    { header: 'Cliente', accessor: r => r.clienteNome ?? '' },
  ]
  const timelineCols: CsvColumn<any>[] = [
    { header: 'Data',    accessor: r => r.bucket ?? r.date ?? r.ts ?? '' },
    { header: 'Info',    accessor: r => r.info ?? 0 },
    { header: 'Alerta',  accessor: r => r.warning ?? 0 },
    { header: 'Crítico', accessor: r => r.critical ?? 0 },
    { header: 'Total',   accessor: r => (r.info ?? 0) + (r.warning ?? 0) + (r.critical ?? 0) },
  ]

  return (
    <div className="flex items-center gap-1">
      <ExportCsvButton basename={`analytics_modelos_${days}d`}    rows={breakdown} columns={breakdownCols} label="Modelos" />
      <ExportCsvButton basename={`analytics_top_cameras_${days}d`} rows={topCams}   columns={topCamsCols}   label="Top câmeras" />
      <ExportCsvButton basename={`analytics_timeline_${days}d`}    rows={timeline}  columns={timelineCols}  label="Timeline" />
    </div>
  )
}

export function AnalyticsPage() {
  const [days, setDays] = useState(7)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-space-950">
      {/* Ambient glow */}
      <div className="hidden dark:block fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-cyan-500/5 blur-3xl" />
        <div className="absolute top-1/3 right-0 w-80 h-80 rounded-full bg-violet-500/5 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 rounded-full bg-rose-500/4 blur-3xl" />
      </div>

      <div className="relative p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Brain className="w-5 h-5 text-cyan-700 dark:text-cyan-400" />
              Dashboard de IA
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
              Visão consolidada das detecções, severidade, câmeras ruidosas e tendência temporal.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to="/analytics/uptime"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition"
              title="SLA por câmera + MTTR + export CSV"
            >
              <Gauge className="w-3.5 h-3.5 text-brand-skyLight" />
              SLA / Uptime
            </Link>
            <AnalyticsExportBar days={days} />
            <PeriodSelect value={days} onChange={setDays} />
          </div>
        </div>

        {/* KPIs */}
        <KpisStrip days={days} />

        {/* Comparativo + breakdown */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          <div className="xl:col-span-1">
            <PeriodComparison days={days} />
          </div>
          <div className="xl:col-span-3">
            <ModelBreakdown days={days} />
          </div>
        </div>

        {/* Heatmap + Top câmeras */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <HourDayHeatmap days={Math.max(days, 7)} />
          <TopCameras days={days} />
        </div>

        {/* Timeline */}
        <Timeline days={days} />
      </div>
    </div>
  )
}
