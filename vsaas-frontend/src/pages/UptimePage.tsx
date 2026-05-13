import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Gauge, ArrowLeft, AlertTriangle, Clock, Activity,
  TrendingDown, TrendingUp, Search, Filter, Info, Camera as CameraIcon,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useCameras } from '../api/client'
import { cn } from '../lib/utils'
import { ExportCsvButton } from '../components/ExportCsvButton'
import type { CsvColumn } from '../lib/csv'

/**
 * /analytics/uptime — SLA tracking (Sprint 2.2)
 *
 * Alinhado ao Monuv `/dashboard/cameras/status-report`, acrescentando:
 *   • MTTR (mean time to recovery) agregado
 *   • Export CSV multi-period
 *   • Filtro fora-de-SLA (<99,0%)
 *
 * Observação: enquanto o endpoint `/bi/uptime` não está publicado, os números
 * exibidos são síntese determinística a partir do hash do cameraId + status.
 * É o suficiente para validação de UX e para o integrador treinar o olhar
 * antes da métrica real. O flag abaixo controla.
 */
const SYNTHETIC_MODE = true

// ─────────────────────────────────────────────────────────────────────────────
// Síntese determinística
// ─────────────────────────────────────────────────────────────────────────────

function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface SlaRow {
  cameraId: string
  cameraName: string
  site: string | null
  status: string
  uptime24h: number      // 0..1
  uptime7d:  number
  uptime30d: number
  incidents30d: number
  mttrMinutes: number    // média minutos de downtime por incidente
  lastDowntimeAt: string | null // ISO
  totalDowntime30dMin: number
}

function synthSla(cam: any): SlaRow {
  const h = hash32(cam.id)
  // Câmeras INACTIVE/ERROR puxam SLA pra baixo
  const base =
    cam.status === 'ERROR'    ? 0.86 :
    cam.status === 'INACTIVE' ? 0.94 :
    cam.status === 'MAINT'    ? 0.97 :
    0.996
  const jitter = (h % 400) / 10000 // 0..0.04
  const u30 = Math.max(0.5, Math.min(0.9999, base - jitter + ((h >> 8) % 100) / 10000))
  // 24h tende a estar um pouco melhor que 30d (recovery recente)
  const u7  = Math.max(0.5, Math.min(0.9999, u30 + ((h >> 16) % 60 - 30) / 10000))
  const u24 = Math.max(0.5, Math.min(1,      u7  + ((h >> 24) % 80 - 40) / 10000))
  const incidents = cam.status === 'ACTIVE'
    ? (h % 4)              // 0..3
    : 2 + (h % 6)          // 2..7
  const mttr = cam.status === 'ACTIVE'
    ? 3 + (h % 12)         // 3..14 min
    : 15 + (h % 60)        // 15..74 min
  const totalDowntime = Math.round((1 - u30) * 30 * 24 * 60)
  const lastDown = incidents === 0
    ? null
    : new Date(Date.now() - ((h % 72) + 1) * 3600 * 1000).toISOString()
  return {
    cameraId:    cam.id,
    cameraName:  cam.name ?? cam.id.slice(0, 8),
    site:        cam.site ?? cam.siteName ?? null,
    status:      cam.status ?? 'UNKNOWN',
    uptime24h:   u24,
    uptime7d:    u7,
    uptime30d:   u30,
    incidents30d:incidents,
    mttrMinutes: mttr,
    lastDowntimeAt: lastDown,
    totalDowntime30dMin: totalDowntime,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de UI
// ─────────────────────────────────────────────────────────────────────────────

const SLA_TARGET = 0.99

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m === 0 ? `${h}h` : `${h}h${m}m`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh === 0 ? `${d}d` : `${d}d${rh}h`
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const dt = new Date(iso).getTime()
  const diff = Date.now() - dt
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'agora'
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function slaBadge(v: number): string {
  if (v >= 0.9999) return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25'
  if (v >= 0.999)  return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
  if (v >= SLA_TARGET) return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-brand-sky/10 dark:text-brand-skyLight dark:border-brand-sky/20'
  if (v >= 0.97)   return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25'
  return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30'
}

function SortHeader({
  label, active, dir, onClick, className,
}: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold',
        active ? 'text-cyan-700 dark:text-cyan-300' : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-600 dark:text-slate-300',
        className,
      )}
    >
      {label}
      {active && (
        dir === 'desc'
          ? <TrendingDown className="w-3 h-3" />
          : <TrendingUp className="w-3 h-3" />
      )}
    </button>
  )
}

type Period = '24h' | '7d' | '30d'
type SortKey = 'name' | 'uptime' | 'incidents' | 'mttr' | 'lastDown'
type Accent  = 'cyan' | 'emerald' | 'rose' | 'amber' | 'violet' | 'sky'

const ACCENTS: Record<Accent, { text: string; bg: string; border: string }> = {
  cyan:    { text: 'text-cyan-700 dark:text-cyan-300',        bg: 'bg-cyan-50 dark:bg-cyan-500/10',    border: 'border-cyan-200 dark:border-cyan-500/20' },
  emerald: { text: 'text-emerald-700 dark:text-emerald-300',     bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20' },
  rose:    { text: 'text-rose-700 dark:text-rose-300',        bg: 'bg-rose-50 dark:bg-rose-500/10',    border: 'border-rose-200 dark:border-rose-500/25' },
  amber:   { text: 'text-amber-700 dark:text-amber-300',       bg: 'bg-amber-50 dark:bg-amber-500/10',   border: 'border-amber-200 dark:border-amber-500/25' },
  violet:  { text: 'text-violet-700 dark:text-violet-300',      bg: 'bg-violet-50 dark:bg-violet-500/10',  border: 'border-violet-200 dark:border-violet-500/20' },
  sky:     { text: 'text-sky-700 dark:text-brand-skyLight',  bg: 'bg-sky-50 dark:bg-brand-sky/10',   border: 'border-sky-200 dark:border-brand-sky/20' },
}

function SlaKpi({
  title, value, subtitle, icon, accent, delay = 0,
}: { title: string; value: string; subtitle: string; icon: React.ReactNode; accent: Accent; delay?: number }) {
  const a = ACCENTS[accent]
  return (
    <GlassCard delay={delay} className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2 rounded-xl border', a.bg, a.border, a.text)}>
          <div className="w-4 h-4">{icon}</div>
        </div>
      </div>
      <p className={cn('text-2xl font-bold tabular-nums leading-none', a.text)}>{value}</p>
      <p className="text-[11px] text-slate-700 dark:text-white/80 font-medium mt-1.5">{title}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5">{subtitle}</p>
    </GlassCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export function UptimePage() {
  const { data: camerasRaw, isLoading } = useCameras()
  const cameras: any[] = Array.isArray(camerasRaw) ? camerasRaw : (camerasRaw?.data ?? [])

  const [period, setPeriod]     = useState<Period>('7d')
  const [q, setQ]               = useState('')
  const [onlyBreach, setBreach] = useState(false)
  const [sortKey, setSortKey]   = useState<SortKey>('uptime')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc') // pior primeiro

  const rows = useMemo<SlaRow[]>(
    () => (SYNTHETIC_MODE ? cameras.map(synthSla) : []),
    [cameras],
  )

  const pickUptime = (r: SlaRow): number =>
    period === '24h' ? r.uptime24h : period === '7d' ? r.uptime7d : r.uptime30d

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows
      .filter(r => !onlyBreach || pickUptime(r) < SLA_TARGET)
      .filter(r => !needle ||
        r.cameraName.toLowerCase().includes(needle) ||
        (r.site ?? '').toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => {
        const mult = sortDir === 'asc' ? 1 : -1
        switch (sortKey) {
          case 'name':      return mult * a.cameraName.localeCompare(b.cameraName)
          case 'uptime':    return mult * (pickUptime(a) - pickUptime(b))
          case 'incidents': return mult * (a.incidents30d - b.incidents30d)
          case 'mttr':      return mult * (a.mttrMinutes - b.mttrMinutes)
          case 'lastDown': {
            const ta = a.lastDowntimeAt ? Date.parse(a.lastDowntimeAt) : 0
            const tb = b.lastDowntimeAt ? Date.parse(b.lastDowntimeAt) : 0
            return mult * (tb - ta) // mais recente primeiro em desc
          }
        }
      })
  }, [rows, q, onlyBreach, sortKey, sortDir, period])

  // KPIs agregados
  const kpis = useMemo(() => {
    if (rows.length === 0) {
      return { avg: 0, breach: 0, mttrAvg: 0, downtimeMin: 0, incidents: 0, total: 0 }
    }
    const avg        = rows.reduce((s, r) => s + pickUptime(r), 0) / rows.length
    const breach     = rows.filter(r => pickUptime(r) < SLA_TARGET).length
    const mttrAvg    = rows.reduce((s, r) => s + r.mttrMinutes, 0) / rows.length
    const downtime   = rows.reduce((s, r) => s + r.totalDowntime30dMin, 0)
    const incidents  = rows.reduce((s, r) => s + r.incidents30d, 0)
    return { avg, breach, mttrAvg, downtimeMin: downtime, incidents, total: rows.length }
  }, [rows, period])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  const csvCols: CsvColumn<SlaRow>[] = [
    { header: 'Câmera',             accessor: r => r.cameraName },
    { header: 'ID',                 accessor: r => r.cameraId },
    { header: 'Site',               accessor: r => r.site ?? '' },
    { header: 'Status',             accessor: r => r.status },
    { header: 'Uptime 24h (%)',     accessor: r => (r.uptime24h * 100).toFixed(3) },
    { header: 'Uptime 7d (%)',      accessor: r => (r.uptime7d  * 100).toFixed(3) },
    { header: 'Uptime 30d (%)',     accessor: r => (r.uptime30d * 100).toFixed(3) },
    { header: 'Incidentes 30d',     accessor: r => r.incidents30d },
    { header: 'MTTR (min)',         accessor: r => r.mttrMinutes },
    { header: 'Downtime 30d (min)', accessor: r => r.totalDowntime30dMin },
    { header: 'Última queda',       accessor: r => r.lastDowntimeAt ?? '' },
  ]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-space-950">
      {/* Ambient glow */}
      <div className="hidden dark:block fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-brand-sky/5 blur-3xl" />
        <div className="absolute top-1/3 right-0 w-80 h-80 rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      <div className="relative p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-start gap-3">
            <Link
              to="/analytics"
              className="mt-1 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
              title="Voltar para Dashboard de IA"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Gauge className="w-5 h-5 text-sky-700 dark:text-brand-skyLight" />
                SLA · Uptime por câmera
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                Disponibilidade em {period} · MTTR · incidentes · meta de SLA {pct(SLA_TARGET)}.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <ExportCsvButton
              basename={`sla_uptime_${period}`}
              rows={filtered}
              columns={csvCols}
              label="Exportar CSV"
              variant="primary"
            />
            <div className="flex gap-1 bg-slate-50 dark:bg-white/[0.03] rounded-lg p-1 text-xs">
              {(['24h', '7d', '30d'] as Period[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-colors font-medium',
                    period === p
                      ? 'bg-sky-100 text-sky-700 dark:bg-brand-sky/20 dark:text-brand-skyLight'
                      : 'text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Aviso modo síntese */}
        {SYNTHETIC_MODE && (
          <div className="flex items-start gap-2 rounded-xl border border-sky-200 dark:border-brand-sky/20 bg-sky-50 dark:bg-brand-sky/5 px-3 py-2.5 text-[11px] text-sky-700 dark:text-brand-skyLight">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <b className="text-slate-900 dark:text-white">Modo aproximação.</b> Os valores são sintetizados de forma
              determinística a partir do estado atual de cada câmera. O endpoint{' '}
              <code className="font-mono text-[10px] bg-slate-100 dark:bg-white/5 px-1 rounded">/bi/uptime</code>{' '}
              será publicado em seguida e substituirá esta camada sem mudar a UI.
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SlaKpi
            title={`SLA médio (${period})`}
            value={pct(kpis.avg)}
            subtitle={`meta ${pct(SLA_TARGET)}`}
            icon={<Gauge className="w-full h-full" />}
            accent={kpis.avg >= SLA_TARGET ? 'emerald' : 'rose'}
            delay={0.05}
          />
          <SlaKpi
            title="Câmeras fora de SLA"
            value={`${kpis.breach} / ${kpis.total}`}
            subtitle={`abaixo de ${pct(SLA_TARGET)}`}
            icon={<AlertTriangle className="w-full h-full" />}
            accent={kpis.breach === 0 ? 'emerald' : 'amber'}
            delay={0.1}
          />
          <SlaKpi
            title="MTTR médio"
            value={`${Math.round(kpis.mttrAvg)}min`}
            subtitle="tempo médio de recuperação"
            icon={<Clock className="w-full h-full" />}
            accent="cyan"
            delay={0.15}
          />
          <SlaKpi
            title="Downtime total (30d)"
            value={fmtMinutes(kpis.downtimeMin)}
            subtitle={`${kpis.incidents} incidentes`}
            icon={<Activity className="w-full h-full" />}
            accent={kpis.downtimeMin === 0 ? 'emerald' : 'violet'}
            delay={0.2}
          />
        </div>

        {/* Filtros */}
        <GlassCard className="p-3" delay={0.25}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 dark:text-slate-500" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar por câmera ou site…"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-brand-sky/40 focus:ring-1 focus:ring-brand-sky/25"
              />
            </div>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5">
              <input
                type="checkbox"
                checked={onlyBreach}
                onChange={e => setBreach(e.target.checked)}
                className="accent-brand-sky"
              />
              <Filter className="w-3.5 h-3.5" />
              Apenas abaixo de {pct(SLA_TARGET)}
            </label>
            <div className="text-[11px] text-slate-500 dark:text-slate-500 ml-auto">
              {filtered.length} / {rows.length} câmeras
            </div>
          </div>
        </GlassCard>

        {/* Tabela */}
        <GlassCard className="p-0 overflow-hidden" delay={0.3}>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/5">
                <tr>
                  <th className="text-left px-4 py-3">
                    <SortHeader label="Câmera" active={sortKey === 'name'} dir={sortDir} onClick={() => toggleSort('name')} />
                  </th>
                  <th className="text-left px-3 py-3 text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-500">Site</th>
                  <th className="text-right px-3 py-3">
                    <SortHeader label={`Uptime ${period}`} active={sortKey === 'uptime'} dir={sortDir} onClick={() => toggleSort('uptime')} className="ml-auto" />
                  </th>
                  <th className="text-right px-3 py-3 text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-500">7d</th>
                  <th className="text-right px-3 py-3 text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-500">30d</th>
                  <th className="text-right px-3 py-3">
                    <SortHeader label="Incidentes" active={sortKey === 'incidents'} dir={sortDir} onClick={() => toggleSort('incidents')} className="ml-auto" />
                  </th>
                  <th className="text-right px-3 py-3">
                    <SortHeader label="MTTR" active={sortKey === 'mttr'} dir={sortDir} onClick={() => toggleSort('mttr')} className="ml-auto" />
                  </th>
                  <th className="text-right px-4 py-3">
                    <SortHeader label="Última queda" active={sortKey === 'lastDown'} dir={sortDir} onClick={() => toggleSort('lastDown')} className="ml-auto" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                {isLoading && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500 dark:text-slate-500 text-xs">
                    Carregando câmeras…
                  </td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500 dark:text-slate-500 text-xs">
                    Nenhuma câmera encontrada com os filtros atuais.
                  </td></tr>
                )}
                {filtered.map((r, i) => {
                  const u = pickUptime(r)
                  const breach = u < SLA_TARGET
                  return (
                    <motion.tr
                      key={r.cameraId}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(0.2, i * 0.01) }}
                      className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <Link to={`/cameras/${r.cameraId}`} className="flex items-center gap-2 group">
                          <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0 group-hover:border-brand-sky/40 transition">
                            <CameraIcon className="w-3.5 h-3.5 text-slate-700 dark:text-slate-400 group-hover:text-brand-skyLight" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm text-slate-900 dark:text-white truncate group-hover:text-brand-skyLight transition">{r.cameraName}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-500 font-mono truncate">{r.cameraId.slice(0, 8)}… · {r.status}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-700 dark:text-slate-400 truncate max-w-[160px]">
                        {r.site ?? <span className="text-slate-500 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-mono tabular-nums',
                          slaBadge(u),
                        )}>
                          {breach && <AlertTriangle className="w-3 h-3" />}
                          {pct(u)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-700 dark:text-slate-400 font-mono tabular-nums">{pct(r.uptime7d)}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-700 dark:text-slate-400 font-mono tabular-nums">{pct(r.uptime30d)}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-700 dark:text-slate-300 font-mono tabular-nums">{r.incidents30d}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-700 dark:text-slate-300 font-mono tabular-nums">{fmtMinutes(r.mttrMinutes)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-500 dark:text-slate-500 font-mono">{fmtRelative(r.lastDowntimeAt)}</td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>

        {/* Footer reminder */}
        <p className="text-[10px] text-slate-500 dark:text-slate-600 text-center">
          SLA alvo contratual: {pct(SLA_TARGET)} · Cálculo sobre janela móvel ·
          MTTR = tempo médio entre queda e recuperação automática.
        </p>
      </div>
    </div>
  )
}
