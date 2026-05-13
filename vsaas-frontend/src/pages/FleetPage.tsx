/**
 * FleetPage — visão centralizada de todos os Edge Nodes do tenant.
 *
 * Layout:
 *   ① Cards de resumo por status (clicáveis = filtro)
 *   ② Barra de busca + filtro de status + badge de total
 *   ③ Grid de cards por edge node com telemetria ao vivo
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Cpu, Wifi, WifiOff, AlertTriangle, Wrench, RefreshCw,
  Search, ChevronRight, Thermometer, Activity, Camera,
  Clock, Terminal, Server,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface FleetSummary {
  total: number
  byStatus: { online: number; offline: number; degraded: number; maintenance: number; provisioning: number }
  pendingCommands: number
  healthPct: number
}

interface HeartbeatSnapshot {
  cpuUsage: number | null
  memUsage: number | null
  diskUsage: number | null
  tempCelsius: number | null
  fpsCurrent: number | null
  recordedAt: string
}

interface FleetNode {
  id: string
  name: string
  serialNumber: string
  model: string | null
  ipLocal: string | null
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'MAINTENANCE' | 'PROVISIONING'
  firmwareVersion: string | null
  configRevision: number
  maxCameras: number | null
  licenseExpiresAt: string | null
  cameraCount: number
  pendingCommandCount: number
  lastHeartbeat: HeartbeatSnapshot | null
  site: {
    id: string; name: string; city: string | null; state: string | null
    clienteFinal: {
      id: string; name: string; vertical: string
      integrador: { id: string; name: string }
    }
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('icv_token')}` } })
    .then(r => r.json())

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
  ONLINE:       { label: 'Online',       dot: 'bg-emerald-500', badge: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/40', Icon: Wifi },
  OFFLINE:      { label: 'Offline',      dot: 'bg-rose-500',    badge: 'text-rose-700 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-300 border-rose-200 dark:border-rose-700/40',                 Icon: WifiOff },
  DEGRADED:     { label: 'Degradado',    dot: 'bg-amber-500',   badge: 'text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-700/40',           Icon: AlertTriangle },
  MAINTENANCE:  { label: 'Manutenção',   dot: 'bg-blue-400',    badge: 'text-blue-700 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-700/40',                 Icon: Wrench },
  PROVISIONING: { label: 'Provisionando',dot: 'bg-slate-400',   badge: 'text-slate-600 bg-slate-100 dark:bg-white/5 dark:text-slate-400 border-slate-200 dark:border-white/10',                  Icon: Server },
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, unit = '%', dec = 0) {
  if (val == null) return '—'
  return `${val.toFixed(dec)}${unit}`
}

function relTime(iso: string | null) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)  return `${s}s atrás`
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`
  return `${Math.floor(s / 86400)}d atrás`
}

function TelBar({ val, warn = 70, crit = 90 }: { val: number | null; warn?: number; crit?: number }) {
  if (val == null) return <div className="h-1 rounded-full bg-slate-200 dark:bg-white/10 w-full" />
  const color = val >= crit ? 'bg-rose-500' : val >= warn ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-1 rounded-full bg-slate-200 dark:bg-white/10 w-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(val, 100)}%` }} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Componente principal
// ══════════════════════════════════════════════════════════════════════════════

export function FleetPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [q, setQ] = useState('')

  const summaryUrl = '/fleet/summary'
  const listUrl = useMemo(() => {
    const p = new URLSearchParams()
    if (statusFilter) p.set('status', statusFilter)
    if (q.trim())     p.set('q', q.trim())
    p.set('limit', '100')
    return '/fleet?' + p.toString()
  }, [statusFilter, q])

  const { data: summary, mutate: mutateSummary } =
    useSWR<FleetSummary>(summaryUrl, fetcher, { refreshInterval: 20_000 })

  const { data: list, isLoading, mutate: mutateList } =
    useSWR<{ total: number; items: FleetNode[] }>(listUrl, fetcher, { refreshInterval: 20_000 })

  function refresh() { mutateSummary(); mutateList() }

  const summaryCards = [
    { key: 'online',       label: 'Online',       count: summary?.byStatus.online       ?? 0, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20',   border: 'border-emerald-200 dark:border-emerald-700/30' },
    { key: 'offline',      label: 'Offline',      count: summary?.byStatus.offline      ?? 0, color: 'text-rose-600',    bg: 'bg-rose-50 dark:bg-rose-900/20',          border: 'border-rose-200 dark:border-rose-700/30'       },
    { key: 'degraded',     label: 'Degradado',    count: summary?.byStatus.degraded     ?? 0, color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-900/20',        border: 'border-amber-200 dark:border-amber-700/30'     },
    { key: 'maintenance',  label: 'Manutenção',   count: summary?.byStatus.maintenance  ?? 0, color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-900/20',          border: 'border-blue-200 dark:border-blue-700/30'       },
    { key: 'provisioning', label: 'Prov.',         count: summary?.byStatus.provisioning ?? 0, color: 'text-slate-500',   bg: 'bg-slate-100 dark:bg-white/5',            border: 'border-slate-200 dark:border-white/10'         },
  ]

  return (
    <div className="px-6 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-500" />
            Fleet de Edge Nodes
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {summary ? `${summary.total} dispositivo${summary.total !== 1 ? 's' : ''} · ${summary.healthPct}% saudáveis` : 'Carregando…'}
            {(summary?.pendingCommands ?? 0) > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                {summary!.pendingCommands} cmd{summary!.pendingCommands !== 1 ? 's' : ''} pendente{summary!.pendingCommands !== 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 text-xs hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {summaryCards.map(c => (
          <button
            key={c.key}
            onClick={() => setStatusFilter(statusFilter === c.key.toUpperCase() ? '' : c.key.toUpperCase())}
            className={[
              'rounded-xl border p-3 text-left transition hover:shadow-sm',
              statusFilter === c.key.toUpperCase()
                ? `${c.bg} ${c.border} ring-1 ring-offset-0`
                : 'bg-white dark:bg-space-900 border-slate-200 dark:border-white/8',
            ].join(' ')}
          >
            <p className={`text-xs font-medium mb-1 ${c.color}`}>{c.label}</p>
            <p className={`text-2xl font-bold ${c.color}`}>{c.count}</p>
          </button>
        ))}
      </div>

      {/* Busca */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar por nome, serial, IP…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-space-900 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        {list && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {list.total} resultado{list.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Grid de nodes */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 rounded-2xl bg-slate-100 dark:bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : list?.items.length === 0 ? (
        <div className="text-center py-20 text-slate-400 dark:text-slate-500">
          <Cpu className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhum Edge Node encontrado</p>
          <p className="text-xs mt-1">Ajuste os filtros ou adicione um dispositivo.</p>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list?.items.map(node => (
              <NodeCard key={node.id} node={node} onClick={() => navigate(`/fleet/${node.id}`)} />
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  )
}

// ── NodeCard ──────────────────────────────────────────────────────────────────

function NodeCard({ node, onClick }: { node: FleetNode; onClick: () => void }) {
  const cfg = STATUS_CFG[node.status] ?? STATUS_CFG.PROVISIONING
  const hb  = node.lastHeartbeat

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="text-left rounded-2xl border border-slate-200 dark:border-white/8 bg-white dark:bg-space-900 p-4 hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700/50 transition-all duration-200 flex flex-col gap-3"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot} shadow-sm`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{node.name}</p>
            <p className="text-[10px] text-slate-400 font-mono truncate">{node.serialNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
            {cfg.label}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        </div>
      </div>

      {/* Site hierarchy */}
      <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 truncate">
        <span className="truncate">{node.site.clienteFinal.integrador.name}</span>
        <span className="opacity-40">›</span>
        <span className="truncate">{node.site.clienteFinal.name}</span>
        <span className="opacity-40">›</span>
        <span className="truncate font-medium text-slate-600 dark:text-slate-300">{node.site.name}</span>
        {node.site.city && <span className="opacity-50 ml-1">({node.site.city})</span>}
      </div>

      {/* Telemetria */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400">
          <span>CPU {fmt(hb?.cpuUsage)}</span>
          <span>MEM {fmt(hb?.memUsage)}</span>
          <span>DISK {fmt(hb?.diskUsage)}</span>
          {hb?.tempCelsius != null && (
            <span className="flex items-center gap-0.5">
              <Thermometer className="w-3 h-3" />{fmt(hb.tempCelsius, '°C', 1)}
            </span>
          )}
        </div>
        <TelBar val={hb?.cpuUsage ?? null} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Camera className="w-3 h-3" />{node.cameraCount}
          </span>
          {node.pendingCommandCount > 0 && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
              <Terminal className="w-3 h-3" />{node.pendingCommandCount} cmd
            </span>
          )}
          {hb?.fpsCurrent != null && (
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3" />{hb.fpsCurrent.toFixed(1)} fps
            </span>
          )}
        </div>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />{relTime(hb?.recordedAt ?? null)}
        </span>
      </div>
    </motion.button>
  )
}
