/**
 * Sprint U.3.2 — EdgeNodesPage
 *
 * Página dedicada de Edge Nodes (gateways YOLOv8 on-prem). Substitui o
 * placeholder em `/edge`.
 *
 * Backend hoje (`vsaas-backend/src/routes/edge-nodes.ts`):
 *   - GET /edge-nodes               → lista escopada por tenant
 *   - GET /edge-nodes/:id           → detalhe (sanitiza apiToken/go2rtcAuth)
 *
 * Não há POST/PATCH/DELETE — provisionamento de edge é via device + serial,
 * fora deste fluxo. UI fica read-only com:
 *   - KPIs agregados (total, online, offline, alertas)
 *   - Filtro por site + toggle "incluir offline"
 *   - Cards com status, métricas (CPU/MEM/temp), heartbeat, link "ver câmeras"
 */
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import {
  Cpu, Wifi, WifiOff, AlertTriangle, Loader2, Search, Server,
  Thermometer, MemoryStick, Activity, Camera as CameraIcon,
  Clock, ExternalLink, X, MapPin, Hash, Plus, Copy, Check, ShieldCheck,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useEdgeNodes, useSites, formatApiError, provisionEdgeNode,
  type EdgeNodeRow, type ProvisionEdgeResponse,
} from '../api/client'
import { cn } from '../lib/utils'

const userRole = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
const canProvision = ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'].includes(userRole)

const STATUS_BADGES: Record<EdgeNodeRow['status'], string> = {
  ONLINE:       'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  DEGRADED:     'bg-amber-500/15 text-amber-300 border-amber-500/30',
  OFFLINE:      'bg-rose-500/15 text-rose-300 border-rose-500/30',
  MAINTENANCE:  'bg-slate-500/15 text-slate-300 border-slate-500/30',
  PROVISIONING: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
}

const STATUS_LABELS: Record<EdgeNodeRow['status'], string> = {
  ONLINE:       'Online',
  DEGRADED:     'Degradado',
  OFFLINE:      'Offline',
  MAINTENANCE:  'Manutenção',
  PROVISIONING: 'Provisionando',
}

export function EdgeNodesPage() {
  const [siteFilter, setSiteFilter] = useState<string>('')
  const [includeOffline, setIncludeOffline] = useState(false)
  const [search, setSearch] = useState('')
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [provisionOpen, setProvisionOpen] = useState(false)
  const [provisionResult, setProvisionResult] = useState<ProvisionEdgeResponse | null>(null)

  const { data, error, isLoading } = useEdgeNodes({
    siteId: siteFilter || undefined,
    includeOffline,
  })
  const { data: sitesData } = useSites()

  const nodes = data?.edgeNodes ?? []

  const filtered = useMemo(() => {
    if (!search) return nodes
    const q = search.toLowerCase()
    return nodes.filter(n =>
      n.name.toLowerCase().includes(q) ||
      n.serialNumber.toLowerCase().includes(q) ||
      (n.ipLocal ?? '').includes(q),
    )
  }, [nodes, search])

  const stats = useMemo(() => {
    const total    = nodes.length
    const online   = nodes.filter(n => n.status === 'ONLINE').length
    const degraded = nodes.filter(n => n.status === 'DEGRADED').length
    const offline  = nodes.filter(n => n.status === 'OFFLINE').length
    return { total, online, degraded, offline }
  }, [nodes])

  const drawerNode = useMemo(
    () => nodes.find(n => n.id === drawerId) ?? null,
    [nodes, drawerId],
  )

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Cpu className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Edge Nodes</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Gateways on-prem que rodam YOLOv8 e go2rtc. Ficam entre as câmeras
                e a cloud, fazendo pré-filtragem (reduzindo custo de API) e
                servindo streams WebRTC com baixa latência. Use "Provisionar" para
                gerar credenciais e bootstrap pra um novo device.
              </p>
            </div>
          </div>
          {canProvision && (
            <button
              onClick={() => setProvisionOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-200 text-xs font-bold transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Provisionar Edge
            </button>
          )}
        </div>
      </GlassCard>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Server}  label="Total"     value={stats.total}    accent="cyan" />
        <Kpi icon={Wifi}    label="Online"    value={stats.online}   accent="emerald" />
        <Kpi icon={Activity} label="Degradados" value={stats.degraded} accent="amber" />
        <Kpi icon={WifiOff} label="Offline"   value={stats.offline}  accent="rose" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, serial ou IP..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <select
          value={siteFilter}
          onChange={e => setSiteFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-300 focus:outline-none focus:border-violet-500/50"
        >
          <option value="" className="bg-space-900">Todos os sites</option>
          {(sitesData?.sites ?? []).map(s => (
            <option key={s.id} value={s.id} className="bg-space-900">{s.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400 cursor-pointer hover:text-slate-200">
          <input
            type="checkbox"
            checked={includeOffline}
            onChange={e => setIncludeOffline(e.target.checked)}
            className="accent-violet-500"
          />
          Incluir offline
        </label>
        <span className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400 font-mono">
          {filtered.length}
        </span>
      </div>

      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao listar edge nodes</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {isLoading && !data && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando edge nodes...</p>
        </GlassCard>
      )}

      {data && filtered.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Cpu className="w-12 h-12 mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {search ? 'Nenhum edge node bate com a busca.' : 'Nenhum edge node provisionado.'}
          </p>
          {!search && (
            <p className="text-xs text-slate-600 mt-2">
              Edge nodes são provisionados via comando local no device, com serial
              único. Consulte a documentação de instalação.
            </p>
          )}
        </GlassCard>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(n => (
            <EdgeNodeCard key={n.id} node={n} onSelect={() => setDrawerId(n.id)} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {drawerNode && (
          <EdgeNodeDrawer node={drawerNode} onClose={() => setDrawerId(null)} />
        )}
        {provisionOpen && (
          <ProvisionModal
            sites={sitesData?.sites ?? []}
            onClose={() => setProvisionOpen(false)}
            onSuccess={result => {
              setProvisionOpen(false)
              setProvisionResult(result)
            }}
          />
        )}
        {provisionResult && (
          <BootstrapModal
            result={provisionResult}
            onClose={() => setProvisionResult(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function EdgeNodeCard({ node, onSelect }: { node: EdgeNodeRow; onSelect: () => void }) {
  const cpuColor = colorByPct(node.cpuUsage)
  const memColor = colorByPct(node.memUsage)
  const lastBeat = node.lastHeartbeat ? timeAgo(node.lastHeartbeat) : null

  return (
    <GlassCard
      className="p-4 cursor-pointer hover:border-violet-500/30 transition"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{node.name}</h3>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
            <Hash className="w-2.5 h-2.5 inline mr-0.5" />
            {node.serialNumber}
          </p>
        </div>
        <span className={cn('px-1.5 py-0.5 rounded text-[10px] border font-mono uppercase shrink-0', STATUS_BADGES[node.status])}>
          {STATUS_LABELS[node.status]}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          {node.site.name}
        </span>
        <span className="inline-flex items-center gap-1">
          <CameraIcon className="w-3 h-3" />
          {node._count.cameras} cam
        </span>
        {node.go2rtcEndpoint && (
          <span className="inline-flex items-center gap-1 text-cyan-400">
            <Wifi className="w-3 h-3" />
            live
          </span>
        )}
      </div>

      {/* Métricas */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric icon={Cpu}        label="CPU"  value={node.cpuUsage}  unit="%"    color={cpuColor} />
        <Metric icon={MemoryStick} label="MEM"  value={node.memUsage}  unit="%"    color={memColor} />
        <Metric icon={Thermometer} label="Temp" value={node.tempCelsius} unit="°C" />
      </div>

      {lastBeat && (
        <p className="mt-3 text-[10px] text-slate-500 font-mono flex items-center gap-1">
          <Clock className="w-3 h-3" />
          heartbeat {lastBeat}
        </p>
      )}
    </GlassCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function EdgeNodeDrawer({ node, onClose }: { node: EdgeNodeRow; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}
        transition={{ type: 'tween', duration: 0.2 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg h-full bg-space-900 border-l border-white/10 overflow-y-auto"
      >
        <header className="sticky top-0 bg-space-900/95 backdrop-blur border-b border-white/10 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{node.name}</h3>
            <p className="text-xs text-slate-500 font-mono">{node.serialNumber}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {/* Status row */}
          <div className="flex items-center gap-2">
            <span className={cn('px-2 py-1 rounded text-[11px] border font-mono uppercase', STATUS_BADGES[node.status])}>
              {STATUS_LABELS[node.status]}
            </span>
            {node.lastHeartbeat && (
              <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                <Clock className="w-3 h-3" />
                heartbeat {timeAgo(node.lastHeartbeat)}
              </span>
            )}
          </div>

          {/* Hardware */}
          <Section title="Hardware">
            <Detail label="Modelo"      value={node.model       ?? '—'} />
            <Detail label="Acelerador"  value={node.accelerator ?? '—'} />
            <Detail label="IP Local"    value={node.ipLocal     ?? '—'} mono />
            <Detail label="Site"        value={node.site.name} />
            <Detail label="Cliente"     value={node.site.clienteFinal.name} />
            <Detail label="Câmeras"     value={String(node._count.cameras)} />
          </Section>

          {/* Software */}
          <Section title="Software">
            <Detail label="Firmware"     value={node.firmwareVersion  ?? '—'} mono />
            <Detail label="YOLO model"   value={node.yoloModelVersion ?? '—'} mono />
            <Detail label="go2rtc"       value={node.go2rtcEndpoint ? 'habilitado' : 'não'} />
          </Section>

          {/* Métricas em tempo real */}
          <Section title="Métricas">
            <div className="space-y-2 col-span-2">
              <MetricBar label="CPU"        value={node.cpuUsage}    unit="%" />
              <MetricBar label="Memória"    value={node.memUsage}    unit="%" />
              <MetricBar label="Temperatura" value={node.tempCelsius} unit="°C" max={85} />
            </div>
          </Section>

          {/* Ações */}
          <div className="pt-2 space-y-2">
            <Link
              to={`/cameras?siteId=${node.site.id}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-200 text-xs font-semibold transition"
            >
              <span className="flex items-center gap-2">
                <CameraIcon className="w-3.5 h-3.5" />
                Ver câmeras deste site
              </span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <p className="text-[10px] text-slate-600 font-mono pt-2 border-t border-white/5">
            edge_node_id: {node.id}
          </p>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function Kpi({ icon: Icon, label, value, accent }: {
  icon: any; label: string; value: number
  accent: 'cyan' | 'emerald' | 'amber' | 'rose'
}) {
  const colors = {
    cyan:    'text-cyan-300 border-cyan-500/20 bg-cyan-500/5',
    emerald: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/5',
    amber:   'text-amber-300 border-amber-500/20 bg-amber-500/5',
    rose:    'text-rose-300 border-rose-500/20 bg-rose-500/5',
  }[accent]
  return (
    <div className={cn('rounded-xl border p-3', colors)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="mt-1 text-xl font-bold text-white">{value}</p>
    </div>
  )
}

function Metric({ icon: Icon, label, value, unit, color }: {
  icon: any; label: string; value: number | null; unit: string; color?: string
}) {
  const display = value == null ? '—' : `${Math.round(value)}${unit}`
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-white/5 border border-white/10">
      <Icon className={cn('w-3 h-3', color ?? 'text-slate-500')} />
      <div className="min-w-0">
        <p className="text-[9px] text-slate-500 uppercase">{label}</p>
        <p className={cn('text-[11px] font-mono font-bold leading-tight', color ?? 'text-slate-200')}>{display}</p>
      </div>
    </div>
  )
}

function MetricBar({ label, value, unit, max = 100 }: {
  label: string; value: number | null; unit: string; max?: number
}) {
  const v = value ?? 0
  const pct = Math.min(100, (v / max) * 100)
  let color = 'from-emerald-500 to-cyan-500'
  if (pct >= 85)      color = 'from-rose-500 to-rose-400'
  else if (pct >= 70) color = 'from-amber-500 to-amber-400'

  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-slate-400">
          {value == null ? '—' : `${Math.round(v)}${unit}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
        <div className={cn('h-full bg-gradient-to-r', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{title}</h4>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] p-2">
      <p className="text-[9px] text-slate-500 uppercase">{label}</p>
      <p className={cn('text-xs text-slate-200 truncate mt-0.5', mono && 'font-mono')}>{value}</p>
    </div>
  )
}

function colorByPct(v: number | null): string | undefined {
  if (v == null) return undefined
  if (v >= 85) return 'text-rose-300'
  if (v >= 70) return 'text-amber-300'
  return 'text-emerald-300'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const sec  = Math.floor(diff / 1000)
  if (sec < 60)        return `${sec}s atrás`
  const min  = Math.floor(sec / 60)
  if (min < 60)        return `${min}m atrás`
  const hr   = Math.floor(min / 60)
  if (hr  < 24)        return `${hr}h atrás`
  const days = Math.floor(hr / 24)
  return `${days}d atrás`
}

// ────────────────────────────────────────────────────────────────────────────
// Gap 2 — Provision flow
// ────────────────────────────────────────────────────────────────────────────

interface SiteOption { id: string; name: string }

function ProvisionModal({ sites, onClose, onSuccess }: {
  sites: SiteOption[]
  onClose: () => void
  onSuccess: (r: ProvisionEdgeResponse) => void
}) {
  const { mutate } = useSWRConfig()
  const [form, setForm] = useState({
    siteId:           '',
    name:             '',
    serialNumber:     '',
    description:      '',
    model:            'Raspberry Pi 5',
    accelerator:      'Hailo-8L',
    macAddress:       '',
    firmwareVersion:  '',
    yoloModelVersion: 'yolov8n',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function handleSubmit() {
    if (!form.siteId || !form.name || !form.serialNumber) {
      setError('Site, nome e serialNumber são obrigatórios')
      return
    }
    setSaving(true); setError(null)
    try {
      const result = await provisionEdgeNode({
        siteId:           form.siteId,
        name:             form.name.trim(),
        serialNumber:     form.serialNumber.trim(),
        description:      form.description.trim() || undefined,
        model:            form.model.trim() || undefined,
        accelerator:      form.accelerator.trim() || undefined,
        macAddress:       form.macAddress.trim() || undefined,
        firmwareVersion:  form.firmwareVersion.trim() || undefined,
        yoloModelVersion: form.yoloModelVersion.trim() || undefined,
      })
      // Revalida a lista (SWR) — o novo node aparece em PROVISIONING.
      await mutate(
        (key: any) => typeof key === 'string' && key.startsWith('/edge-nodes'),
        undefined,
        { revalidate: true },
      )
      onSuccess(result)
    } catch (err: any) {
      setError(formatApiError(err))
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Provisionar Edge Node" onClose={onClose} accent="violet">
      <div className="space-y-3 text-sm">
        <Field label="Site *">
          <select
            value={form.siteId}
            onChange={e => setForm({ ...form, siteId: e.target.value })}
            className={inputCls}
          >
            <option value="" className="bg-space-900">— selecionar site —</option>
            {sites.map(s => (
              <option key={s.id} value={s.id} className="bg-space-900">{s.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome *">
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Edge Loja Centro"
              className={inputCls}
            />
          </Field>
          <Field label="Serial *">
            <input
              value={form.serialNumber}
              onChange={e => setForm({ ...form, serialNumber: e.target.value })}
              placeholder="RPI5-A1B2C3"
              className={inputCls + ' font-mono'}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Modelo">
            <input
              value={form.model}
              onChange={e => setForm({ ...form, model: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Acelerador">
            <input
              value={form.accelerator}
              onChange={e => setForm({ ...form, accelerator: e.target.value })}
              className={inputCls}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="MAC (opcional)">
            <input
              value={form.macAddress}
              onChange={e => setForm({ ...form, macAddress: e.target.value })}
              placeholder="AA:BB:CC:DD:EE:FF"
              className={inputCls + ' font-mono'}
            />
          </Field>
          <Field label="Modelo YOLO">
            <select
              value={form.yoloModelVersion}
              onChange={e => setForm({ ...form, yoloModelVersion: e.target.value })}
              className={inputCls}
            >
              <option className="bg-space-900">yolov8n</option>
              <option className="bg-space-900">yolov8s</option>
              <option className="bg-space-900">yolov8m</option>
            </select>
          </Field>
        </div>
        <Field label="Descrição (opcional)">
          <input
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Edge dedicado ao site Centro — backup do principal"
            className={inputCls}
          />
        </Field>

        {error && (
          <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-violet-200 text-xs font-bold disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Provisionar
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function BootstrapModal({ result, onClose }: {
  result: ProvisionEdgeResponse
  onClose: () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const bootstrapJson = JSON.stringify(result.bootstrap, null, 2)

  // QR code via API pública (qrserver.com). NÃO ideal para token sensível,
  // por isso o QR só inclui o edgeNodeId — o operador pareia o token via
  // copy/paste que é seguro. Para QR completo offline, instalar `qrcode` lib.
  const qrPayload = encodeURIComponent(`icv-edge://${result.edgeNode.id}`)
  const qrUrl     = `https://api.qrserver.com/v1/create-qr-code/?data=${qrPayload}&size=180x180&margin=0&bgcolor=0f172a&color=ffffff`

  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <ModalShell title="Bootstrap do Edge Node" onClose={onClose} accent="emerald" wide>
      <div className="space-y-4 text-sm">
        <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong className="block mb-0.5">Token de API só aparece UMA vez</strong>
            Copie o JSON abaixo e cole no <code className="px-1 mx-0.5 bg-black/30 rounded font-mono">/etc/icv-edge/bootstrap.json</code> do device.
            Após fechar este modal, o token não pode ser recuperado — apenas rotacionado.
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-2 md:col-span-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Edge Node criado</p>
            <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs">
              <p className="text-white"><strong>{result.edgeNode.name}</strong></p>
              <p className="text-slate-400 mt-0.5">
                Site: {result.edgeNode.site.name} · Cliente: {result.edgeNode.clienteFinal.name}
              </p>
              <p className="text-slate-500 font-mono mt-0.5 text-[10px]">
                ID: {result.edgeNode.id}
              </p>
            </div>

            <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-3">API Token</p>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-[11px] font-mono text-emerald-300 truncate">
                {result.apiToken}
              </code>
              <button
                onClick={() => copy('token', result.apiToken)}
                className="px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-1.5"
              >
                {copied === 'token' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === 'token' ? 'Copiado' : 'Copiar'}
              </button>
            </div>

            <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-3">Bootstrap completo (bootstrap.json)</p>
            <div className="relative">
              <pre className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-[10px] font-mono text-slate-300 overflow-auto max-h-64">
{bootstrapJson}
              </pre>
              <button
                onClick={() => copy('json', bootstrapJson)}
                className="absolute top-2 right-2 px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-200 text-[10px] flex items-center gap-1"
              >
                {copied === 'json' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === 'json' ? 'Copiado' : 'Copiar JSON'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">QR de pareamento</p>
            <div className="rounded-lg border border-white/10 bg-black/40 p-3 flex items-center justify-center">
              <img src={qrUrl} alt="QR pareamento" className="w-full h-auto" />
            </div>
            <p className="text-[10px] text-slate-500 leading-snug">
              Apenas o ID do edge — o token continua via copy/paste por segurança.
              O agente edge faz o handshake usando esse ID + o token colado.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-bold"
          >
            Concluído
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function ModalShell({ title, onClose, accent, wide, children }: {
  title: string; onClose: () => void; accent: 'violet' | 'emerald'
  wide?: boolean; children: React.ReactNode
}) {
  const accentRing = accent === 'violet' ? 'border-violet-500/30' : 'border-emerald-500/30'
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={cn(
          'w-full max-h-[90vh] overflow-auto rounded-2xl bg-space-900 border p-5',
          accentRing,
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50'
