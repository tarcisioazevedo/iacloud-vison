/**
 * FleetDetailPage — detalhe completo de um Edge Node.
 *
 * Tabs:
 *   ① Overview   — snapshot de telemetria + identity card
 *   ② Câmeras    — grid de câmeras associadas com healthScore
 *   ③ Comandos   — fila de comandos + formulário de enfileiramento
 *   ④ Telemetria — gráficos de série temporal (Recharts)
 */
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  Cpu, Wifi, WifiOff, AlertTriangle, Wrench, Server,
  ChevronLeft, RefreshCw, Thermometer, Activity, Camera,
  Clock, Terminal, HardDrive, MemoryStick, Network, Zap,
  CheckCircle, XCircle, Send, ChevronRight, Shield, Tag,
  BarChart2, Settings2,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'MAINTENANCE' | 'PROVISIONING'

interface HeartbeatPoint {
  cpuUsage: number | null
  memUsage: number | null
  diskUsage: number | null
  tempCelsius: number | null
  fpsCurrent: number | null
  networkInBps: number | null
  networkOutBps: number | null
  recordedAt: string
}

interface CameraItem {
  id: string
  name: string
  status: string
  tier: string
  pipeline: string | null
  brand: string | null
  model: string | null
  resolution: string | null
  fps: number | null
  healthScore: number | null
  lastOnlineAt: string | null
  zones: { id: string; name: string; type: string }[]
}

interface CommandItem {
  id: string
  type: string
  payload: Record<string, unknown>
  issuedAt: string
  ackedAt: string | null
  createdById: string
}

interface FleetNodeDetail {
  id: string
  name: string
  serialNumber: string
  model: string | null
  ipLocal: string | null
  status: NodeStatus
  firmwareVersion: string | null
  configRevision: number
  maxCameras: number | null
  licenseExpiresAt: string | null
  cameraCount: number
  pendingCommandCount: number
  site: {
    id: string; name: string; city: string | null; state: string | null
    clienteFinal: {
      id: string; name: string; vertical: string
      integrador: { id: string; name: string; tradeName: string | null }
    }
  }
  cameras: CameraItem[]
  commands: CommandItem[]
  heartbeatSeries: HeartbeatPoint[]
}

interface HeartbeatSeries {
  edgeNodeId: string
  hours: number
  series: HeartbeatPoint[]
}

// ── API ───────────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('icv_token')}` } })
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() })

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<NodeStatus, { label: string; dot: string; badge: string; Icon: any }> = {
  ONLINE:       { label: 'Online',        dot: 'bg-emerald-500', badge: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40', Icon: Wifi },
  OFFLINE:      { label: 'Offline',       dot: 'bg-rose-500',    badge: 'text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-700/40',                 Icon: WifiOff },
  DEGRADED:     { label: 'Degradado',     dot: 'bg-amber-500',   badge: 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/40',           Icon: AlertTriangle },
  MAINTENANCE:  { label: 'Manutenção',    dot: 'bg-blue-400',    badge: 'text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700/40',                 Icon: Wrench },
  PROVISIONING: { label: 'Provisionando', dot: 'bg-slate-400',   badge: 'text-slate-600 bg-slate-100 border-slate-200 dark:bg-white/5 dark:text-slate-400 dark:border-white/10',                  Icon: Server },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, unit = '%', dec = 0) {
  if (val == null) return '—'
  return `${val.toFixed(dec)}${unit}`
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function relTime(iso: string | null) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)    return `${s}s atrás`
  if (s < 3600)  return `${Math.floor(s / 60)}min atrás`
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`
  return `${Math.floor(s / 86400)}d atrás`
}

function fmtBps(bps: number | null) {
  if (bps == null) return '—'
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1_048_576) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1_048_576).toFixed(2)} MB/s`
}

function TelBar({ val, warn = 70, crit = 90 }: { val: number | null; warn?: number; crit?: number }) {
  if (val == null) return <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 w-full" />
  const color = val >= crit ? 'bg-rose-500' : val >= warn ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 w-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${Math.min(val, 100)}%` }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════════════════════

type Tab = 'overview' | 'cameras' | 'commands' | 'telemetry'

export function FleetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [hbHours, setHbHours] = useState(24)
  const role = localStorage.getItem('icv_role') ?? ''

  const { data: node, isLoading, mutate } =
    useSWR<FleetNodeDetail>(id ? `/fleet/${id}` : null, fetcher, { refreshInterval: 30_000 })

  const { data: hbData, mutate: mutateHb } =
    useSWR<HeartbeatSeries>(
      tab === 'telemetry' && id ? `/fleet/${id}/heartbeats?hours=${hbHours}` : null,
      fetcher,
      { refreshInterval: 60_000 },
    )

  function refresh() { mutate(); mutateHb() }

  if (isLoading) return <LoadingSkeleton />
  if (!node) return (
    <div className="flex flex-col items-center justify-center h-80 text-slate-400 dark:text-slate-500">
      <Cpu className="w-10 h-10 mb-3 opacity-30" />
      <p className="font-medium">Edge Node não encontrado</p>
      <button onClick={() => navigate('/fleet')} className="mt-3 text-xs text-indigo-500 hover:underline">
        ← Voltar para Fleet
      </button>
    </div>
  )

  const cfg = STATUS_CFG[node.status] ?? STATUS_CFG.PROVISIONING
  const hb  = node.heartbeatSeries[node.heartbeatSeries.length - 1] ?? null

  const canSendCommands = ['SUPER_ADMIN', 'ADMIN_GLOBAL', 'INTEGRADOR_ADMIN'].includes(role)

  return (
    <div className="px-6 py-6 max-w-6xl">

      {/* ── Breadcrumb nav ── */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mb-4">
        <button onClick={() => navigate('/fleet')} className="flex items-center gap-1 hover:text-indigo-500 transition">
          <ChevronLeft className="w-3.5 h-3.5" /> Fleet
        </button>
        <span className="opacity-40">›</span>
        <span className="truncate">{node.site.clienteFinal.integrador.tradeName ?? node.site.clienteFinal.integrador.name}</span>
        <span className="opacity-40">›</span>
        <span className="truncate">{node.site.clienteFinal.name}</span>
        <span className="opacity-40">›</span>
        <span className="truncate">{node.site.name}</span>
        {node.site.city && <span className="opacity-40">({node.site.city})</span>}
      </div>

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full shrink-0 ${cfg.dot} shadow-sm`} />
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{node.name}</h1>
            <p className="text-xs font-mono text-slate-400 mt-0.5">{node.serialNumber}</p>
          </div>
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
            {cfg.label}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {node.pendingCommandCount > 0 && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-xs font-semibold border border-amber-200 dark:border-amber-700/40">
              <Terminal className="w-3 h-3" />
              {node.pendingCommandCount} cmd{node.pendingCommandCount !== 1 ? 's' : ''} pendente{node.pendingCommandCount !== 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 text-xs hover:bg-slate-50 dark:hover:bg-white/5 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
        </div>
      </div>

      {/* ── Identity strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
        <InfoChip icon={Tag} label="Modelo" value={node.model ?? '—'} />
        <InfoChip icon={Settings2} label="Firmware" value={node.firmwareVersion ?? '—'} />
        <InfoChip icon={Network} label="IP Local" value={node.ipLocal ?? '—'} mono />
        <InfoChip icon={Cpu} label="Config Rev." value={`#${node.configRevision}`} />
        <InfoChip icon={Camera} label="Câmeras" value={`${node.cameraCount}${node.maxCameras ? ` / ${node.maxCameras}` : ''}`} />
        <InfoChip icon={Shield} label="Licença" value={fmtDate(node.licenseExpiresAt)} />
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-5 border-b border-slate-200 dark:border-white/8">
        {([
          { id: 'overview',  label: 'Overview',   Icon: Activity },
          { id: 'cameras',   label: 'Câmeras',    Icon: Camera },
          { id: 'commands',  label: 'Comandos',   Icon: Terminal },
          { id: 'telemetry', label: 'Telemetria', Icon: BarChart2 },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition',
              tab === t.id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/5'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
            ].join(' ')}
          >
            <t.Icon className="w-3.5 h-3.5" />
            {t.label}
            {t.id === 'commands' && node.pendingCommandCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[9px] font-bold">
                {node.pendingCommandCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {tab === 'overview'  && <OverviewTab hb={hb} node={node} />}
      {tab === 'cameras'   && <CamerasTab  cameras={node.cameras} />}
      {tab === 'commands'  && <CommandsTab commands={node.commands} nodeId={node.id} canSend={canSendCommands} onSent={refresh} />}
      {tab === 'telemetry' && <TelemetryTab data={hbData} hours={hbHours} setHours={setHbHours} />}
    </div>
  )
}

// ── InfoChip ──────────────────────────────────────────────────────────────────

function InfoChip({ icon: Icon, label, value, mono }: { icon: any; label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-space-900 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-slate-400" />
        <p className="text-[9px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{label}</p>
      </div>
      <p className={`text-xs font-semibold text-slate-700 dark:text-slate-200 truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: Overview
// ═══════════════════════════════════════════════════════════════════════════════

function OverviewTab({ hb, node }: { hb: HeartbeatPoint | null; node: FleetNodeDetail }) {
  const metrics = [
    { icon: Cpu,         label: 'CPU',        val: hb?.cpuUsage   ?? null, unit: '%' },
    { icon: MemoryStick, label: 'Memória',     val: hb?.memUsage   ?? null, unit: '%' },
    { icon: HardDrive,   label: 'Disco',       val: hb?.diskUsage  ?? null, unit: '%' },
    { icon: Thermometer, label: 'Temperatura', val: hb?.tempCelsius ?? null, unit: '°C', dec: 1, warn: 60, crit: 75 },
    { icon: Activity,    label: 'FPS Atual',   val: hb?.fpsCurrent  ?? null, unit: ' fps', dec: 1, maxBar: null },
  ]

  return (
    <div className="space-y-5">
      {/* Telemetria atual */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-space-900 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <m.icon className="w-4 h-4 text-slate-400" />
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{m.label}</p>
              </div>
              <p className="text-xl font-bold text-slate-900 dark:text-white">
                {m.val == null ? '—' : `${m.val.toFixed(m.dec ?? 0)}${m.unit}`}
              </p>
            </div>
            {m.maxBar !== null && <TelBar val={m.val} warn={m.warn ?? 70} crit={m.crit ?? 90} />}
          </div>
        ))}

        {/* Network I/O */}
        <div className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-space-900 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Network className="w-4 h-4 text-slate-400" />
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Rede</p>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">↓ Entrada</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200 font-mono">{fmtBps(hb?.networkInBps ?? null)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">↑ Saída</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200 font-mono">{fmtBps(hb?.networkOutBps ?? null)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Last heartbeat info */}
      <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <Clock className="w-3.5 h-3.5" />
        Último heartbeat: {relTime(hb?.recordedAt ?? null)}
      </div>

      {/* Sparkline mini — últimos 20 pontos do heartbeatSeries */}
      {node.heartbeatSeries.length > 1 && (
        <div className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-space-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">CPU × Memória (histórico recente)</p>
          <MiniSparkline data={node.heartbeatSeries.slice(-20)} />
        </div>
      )}
    </div>
  )
}

// ── MiniSparkline ─────────────────────────────────────────────────────────────

function MiniSparkline({ data }: { data: HeartbeatPoint[] }) {
  const pts = data.map(d => ({
    t: new Date(d.recordedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    cpu: d.cpuUsage,
    mem: d.memUsage,
  }))
  return (
    <ResponsiveContainer width="100%" height={80}>
      <LineChart data={pts} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
        <XAxis dataKey="t" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
        <YAxis domain={[0, 100]} tick={{ fontSize: 8 }} />
        <Line type="monotone" dataKey="cpu" stroke="#6366f1" dot={false} strokeWidth={1.5} name="CPU" />
        <Line type="monotone" dataKey="mem" stroke="#06b6d4" dot={false} strokeWidth={1.5} name="MEM" />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: Câmeras
// ═══════════════════════════════════════════════════════════════════════════════

const CAM_STATUS: Record<string, { dot: string; badge: string }> = {
  ONLINE:  { dot: 'bg-emerald-500', badge: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300' },
  OFFLINE: { dot: 'bg-rose-500',    badge: 'text-rose-700 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-300' },
  DEGRADED:{ dot: 'bg-amber-500',   badge: 'text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300' },
}

function CamerasTab({ cameras }: { cameras: CameraItem[] }) {
  if (cameras.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 dark:text-slate-500">
        <Camera className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm font-medium">Nenhuma câmera ativa</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {cameras.map(cam => {
        const cs = CAM_STATUS[cam.status] ?? CAM_STATUS.OFFLINE
        return (
          <motion.div
            key={cam.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-space-900 p-3.5 space-y-2"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${cs.dot}`} />
                <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{cam.name}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${cs.badge}`}>
                {cam.status}
              </span>
            </div>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
              {cam.brand && <span>Marca: <span className="font-medium text-slate-600 dark:text-slate-300">{cam.brand}</span></span>}
              {cam.model && <span>Modelo: <span className="font-medium text-slate-600 dark:text-slate-300">{cam.model}</span></span>}
              {cam.resolution && <span>Res: <span className="font-medium">{cam.resolution}</span></span>}
              {cam.fps        && <span>FPS: <span className="font-medium">{cam.fps}</span></span>}
              <span>Tier: <span className="font-medium">{cam.tier}</span></span>
              <span>Zonas: <span className="font-medium">{cam.zones.length}</span></span>
            </div>

            {/* Health score */}
            {cam.healthScore != null && (
              <div className="space-y-0.5">
                <div className="flex justify-between text-[9px] text-slate-400">
                  <span>Health Score</span>
                  <span className="font-semibold">{cam.healthScore}%</span>
                </div>
                <TelBar val={cam.healthScore} />
              </div>
            )}

            {/* Last online */}
            {cam.lastOnlineAt && (
              <p className="text-[9px] text-slate-400 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" /> {relTime(cam.lastOnlineAt)}
              </p>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: Comandos
// ═══════════════════════════════════════════════════════════════════════════════

const COMMON_COMMANDS = [
  'REBOOT', 'SYNC_CONFIG', 'UPDATE_FIRMWARE', 'CLEAR_CACHE',
  'RESTART_STREAM', 'COLLECT_LOGS', 'PING',
]

function CommandsTab({
  commands, nodeId, canSend, onSent,
}: {
  commands: CommandItem[]
  nodeId: string
  canSend: boolean
  onSent: () => void
}) {
  const [type, setType]       = useState('')
  const [payloadStr, setPayloadStr] = useState('{}')
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function sendCommand() {
    setError(null)
    let payload: Record<string, unknown>
    try { payload = JSON.parse(payloadStr) } catch { setError('Payload inválido — deve ser JSON válido'); return }
    setSending(true)
    try {
      const r = await fetch(`/fleet/${nodeId}/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('icv_token')}`,
        },
        body: JSON.stringify({ type: type.trim(), payload }),
      })
      if (!r.ok) { const e = await r.json().catch(() => ({})); setError(e.message ?? `Erro ${r.status}`); return }
      setType(''); setPayloadStr('{}')
      onSent()
    } catch (e: any) {
      setError(e.message ?? 'Erro de rede')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Send form ── */}
      {canSend && (
        <div className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-space-900 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-indigo-400" /> Enfileirar Comando
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Type input com sugestões */}
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Tipo</label>
              <input
                value={type}
                onChange={e => setType(e.target.value.toUpperCase())}
                list="cmd-types"
                placeholder="ex: REBOOT"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-space-800 text-sm font-mono text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <datalist id="cmd-types">
                {COMMON_COMMANDS.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>

            {/* Payload JSON */}
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Payload (JSON)</label>
              <input
                value={payloadStr}
                onChange={e => setPayloadStr(e.target.value)}
                placeholder="{}"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-space-800 text-sm font-mono text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-500 dark:text-rose-400 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> {error}
            </p>
          )}

          {/* Quick buttons */}
          <div className="flex flex-wrap gap-1.5">
            {COMMON_COMMANDS.map(c => (
              <button
                key={c}
                onClick={() => { setType(c); setPayloadStr('{}') }}
                className="px-2 py-0.5 rounded-full text-[10px] font-mono border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition"
              >
                {c}
              </button>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              onClick={sendCommand}
              disabled={!type.trim() || sending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition"
            >
              {sending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {sending ? 'Enviando…' : 'Enfileirar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Command list ── */}
      {commands.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-slate-500">
          <Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">Nenhum comando registrado</p>
        </div>
      ) : (
        <div className="space-y-2">
          {commands.map(cmd => (
            <motion.div
              key={cmd.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-space-900 px-4 py-3 flex items-center gap-3"
            >
              {cmd.ackedAt
                ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                : <Zap className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold font-mono text-slate-800 dark:text-white">{cmd.type}</p>
                {Object.keys(cmd.payload).length > 0 && (
                  <p className="text-[10px] font-mono text-slate-400 truncate">{JSON.stringify(cmd.payload)}</p>
                )}
              </div>
              <div className="text-right text-[10px] text-slate-400 shrink-0">
                <p>Emitido: {relTime(cmd.issuedAt)}</p>
                {cmd.ackedAt && <p className="text-emerald-500">ACK: {relTime(cmd.ackedAt)}</p>}
                {!cmd.ackedAt && <p className="text-amber-500 font-semibold">Pendente</p>}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: Telemetria
// ═══════════════════════════════════════════════════════════════════════════════

const RANGE_OPTIONS = [
  { h: 1,   label: '1h' },
  { h: 6,   label: '6h' },
  { h: 24,  label: '24h' },
  { h: 72,  label: '3d' },
  { h: 168, label: '7d' },
]

function TelemetryTab({
  data, hours, setHours,
}: {
  data: HeartbeatSeries | undefined
  hours: number
  setHours: (h: number) => void
}) {
  const series = useMemo(() => {
    if (!data?.series) return []
    return data.series.map(d => ({
      t:    new Date(d.recordedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      cpu:  d.cpuUsage,
      mem:  d.memUsage,
      disk: d.diskUsage,
      temp: d.tempCelsius,
      fps:  d.fpsCurrent,
      netIn:  d.networkInBps != null ? +(d.networkInBps / 1024).toFixed(1) : null,
      netOut: d.networkOutBps != null ? +(d.networkOutBps / 1024).toFixed(1) : null,
    }))
  }, [data])

  const chartProps = {
    margin: { top: 4, right: 12, bottom: 0, left: -10 },
  }

  const axisProps = {
    xAxis: { dataKey: 't', tick: { fontSize: 9 }, interval: 'preserveStartEnd' as const },
    yAxis: { tick: { fontSize: 9 }, width: 34 },
    grid:  { strokeDasharray: '3 3', stroke: 'rgba(100,116,139,0.15)' },
    tt:    { contentStyle: { fontSize: 11, borderRadius: 8, border: '1px solid rgba(100,116,139,0.2)' } },
  }

  return (
    <div className="space-y-5">
      {/* Range selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-slate-400 mr-1">Período:</span>
        {RANGE_OPTIONS.map(o => (
          <button
            key={o.h}
            onClick={() => setHours(o.h)}
            className={[
              'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition',
              hours === o.h
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-indigo-400',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
        {!data && (
          <span className="ml-2 text-[10px] text-slate-400 animate-pulse">Carregando…</span>
        )}
      </div>

      {series.length === 0 && data && (
        <div className="text-center py-12 text-slate-400 dark:text-slate-500">
          <BarChart2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">Sem dados no período</p>
        </div>
      )}

      {series.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* CPU + MEM */}
          <ChartCard title="CPU & Memória (%)">
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={series} {...chartProps}>
                <CartesianGrid {...axisProps.grid} />
                <XAxis {...axisProps.xAxis} />
                <YAxis {...axisProps.yAxis} domain={[0, 100]} unit="%" />
                <Tooltip {...axisProps.tt} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="cpu"  stroke="#6366f1" dot={false} strokeWidth={1.5} name="CPU" />
                <Line type="monotone" dataKey="mem"  stroke="#06b6d4" dot={false} strokeWidth={1.5} name="MEM" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* DISK */}
          <ChartCard title="Disco (%)">
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={series} {...chartProps}>
                <CartesianGrid {...axisProps.grid} />
                <XAxis {...axisProps.xAxis} />
                <YAxis {...axisProps.yAxis} domain={[0, 100]} unit="%" />
                <Tooltip {...axisProps.tt} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="disk" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="DISK" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* TEMP */}
          <ChartCard title="Temperatura (°C)">
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={series} {...chartProps}>
                <CartesianGrid {...axisProps.grid} />
                <XAxis {...axisProps.xAxis} />
                <YAxis {...axisProps.yAxis} unit="°" />
                <Tooltip {...axisProps.tt} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="temp" stroke="#ef4444" dot={false} strokeWidth={1.5} name="Temp" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Network I/O KB/s */}
          <ChartCard title="Rede (KB/s)">
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={series} {...chartProps}>
                <CartesianGrid {...axisProps.grid} />
                <XAxis {...axisProps.xAxis} />
                <YAxis {...axisProps.yAxis} unit="KB" />
                <Tooltip {...axisProps.tt} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="netIn"  stroke="#10b981" dot={false} strokeWidth={1.5} name="↓ Entrada" />
                <Line type="monotone" dataKey="netOut" stroke="#8b5cf6" dot={false} strokeWidth={1.5} name="↑ Saída" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-space-900 p-4">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">{title}</p>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Loading skeleton
// ═══════════════════════════════════════════════════════════════════════════════

function LoadingSkeleton() {
  return (
    <div className="px-6 py-6 space-y-4 animate-pulse">
      <div className="h-4 w-64 rounded bg-slate-200 dark:bg-white/10" />
      <div className="h-8 w-80 rounded bg-slate-200 dark:bg-white/10" />
      <div className="grid grid-cols-6 gap-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-slate-100 dark:bg-white/5" />)}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[...Array(5)].map((_, i) => <div key={i} className="h-28 rounded-xl bg-slate-100 dark:bg-white/5" />)}
      </div>
    </div>
  )
}
