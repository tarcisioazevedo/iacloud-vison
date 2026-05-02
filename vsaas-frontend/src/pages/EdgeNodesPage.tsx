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
  Radio, Zap, BarChart2, Shield,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useEdgeNodes, useSites, useIntegradores, formatApiError, provisionEdgeNode,
  generateLicenseKey, revokeLicense, useIntegrationSnapshot,
  type EdgeNodeRow, type ProvisionEdgeResponse,
} from '../api/client'
import { cn } from '../lib/utils'

const userRole = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
const canProvision = ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'].includes(userRole)
const isSuperAdmin = userRole === 'SUPER_ADMIN'

const TARGET_FIRMWARE = 'v1.0.0' // Versão atual alvo para todas as Boxes

const STATUS_BADGES: Record<EdgeNodeRow['status'], string> = {
  ONLINE:       'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  DEGRADED:     'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  OFFLINE:      'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30',
  MAINTENANCE:  'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30',
  PROVISIONING: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30',
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
  const [integradorFilter, setIntegradorFilter] = useState<string>('')
  const [includeOffline, setIncludeOffline] = useState(false)
  const [search, setSearch] = useState('')
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [provisionOpen, setProvisionOpen] = useState(false)
  const [provisionResult, setProvisionResult] = useState<ProvisionEdgeResponse | null>(null)

  const { data, error, isLoading } = useEdgeNodes({
    siteId: siteFilter || undefined,
    integradorId: integradorFilter || undefined,
    includeOffline,
  })
  const { data: sitesData } = useSites()
  const { data: integradoresData } = useIntegradores()

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
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-700 dark:text-violet-200 text-xs font-bold transition"
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
        {isSuperAdmin && (
          <select
            value={integradorFilter}
            onChange={e => {
              setIntegradorFilter(e.target.value)
              setSiteFilter('') // reseta site ao trocar integrador
            }}
            className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-violet-500/50"
          >
            <option value="" className="bg-space-900">Todos os integradores</option>
            {(integradoresData?.integradores ?? []).map((i: any) => (
              <option key={i.id} value={i.id} className="bg-space-900">{i.name}</option>
            ))}
          </select>
        )}

        <select
          value={siteFilter}
          onChange={e => setSiteFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-violet-500/50"
        >
          <option value="" className="bg-space-900">Todos os sites</option>
          {(sitesData?.sites ?? [])
            .filter((s: any) => !integradorFilter || s.clienteFinal?.integradorId === integradorFilter)
            .map((s: any) => (
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
        <div className="flex flex-col items-end gap-1">
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] border font-mono uppercase shrink-0', STATUS_BADGES[node.status])}>
            {STATUS_LABELS[node.status]}
          </span>
          {(!node.firmwareVersion || node.firmwareVersion !== TARGET_FIRMWARE) && (
            <span className="px-1.5 py-0.5 rounded text-[9px] border font-mono uppercase shrink-0 bg-amber-500/15 text-amber-300 border-amber-500/30">
              Update Disp.
            </span>
          )}
        </div>
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
        className="w-full max-w-lg h-full bg-white dark:bg-space-900 border-l border-slate-200 dark:border-white/10 overflow-y-auto"
      >
        <header className="sticky top-0 bg-white/95 dark:bg-space-900/95 backdrop-blur border-b border-slate-200 dark:border-white/10 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{node.name}</h3>
            <p className="text-xs text-slate-500 font-mono">{node.serialNumber}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:hover:text-white">
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
          <Section title="Hardware" defaultOpen={false}>
            <Detail label="Modelo"      value={node.model       ?? '—'} />
            <Detail label="Acelerador"  value={node.accelerator ?? '—'} />
            <Detail label="IP Local"    value={node.ipLocal     ?? '—'} mono />
            <Detail label="Site"        value={node.site.name} />
            <Detail label="Cliente"     value={node.site.clienteFinal.name} />
            <Detail label="Câmeras"     value={String(node._count.cameras)} />
          </Section>

          {/* Software */}
          <Section title="Software" defaultOpen={false}>
            <Detail label="Firmware" value={node.firmwareVersion ?? 'Desconhecido'} mono />
            {(!node.firmwareVersion || node.firmwareVersion !== TARGET_FIRMWARE) ? (
              <Detail label="Status Atualização" value={
                <div className="flex flex-col gap-0.5 items-start mt-0.5">
                  <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                    Desatualizado
                  </span>
                  <span className="text-[9px] text-slate-500 leading-tight">
                    Alvo: {TARGET_FIRMWARE}
                  </span>
                </div>
              } />
            ) : (
              <Detail label="Status Atualização" value={
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
                  <Check className="w-3 h-3" /> Atualizado
                </span>
              } />
            )}
            <Detail label="YOLO model"   value={node.yoloModelVersion ?? '—'} mono />
            <Detail label="go2rtc"       value={node.go2rtcEndpoint ? 'habilitado' : 'não'} />
          </Section>

          {/* Licenciamento e Controle Remoto */}
          <Section title="Licenciamento & Cloud Sync" defaultOpen={false}>
            <LicensePanel node={node} isSuperAdmin={isSuperAdmin} canProvision={canProvision} />
          </Section>

          {/* Métricas em tempo real */}
          <Section title="Métricas" defaultOpen={true}>
            <div className="space-y-2 col-span-2">
              <MetricBar label="CPU"        value={node.cpuUsage}    unit="%" />
              <MetricBar label="Memória"    value={node.memUsage}    unit="%" />
              <MetricBar label="Temperatura" value={node.tempCelsius} unit="°C" max={85} />
              <MetricBar label="Latência"   value={node.status === 'ONLINE' ? 14 : null} unit="ms" max={100} />
            </div>
          </Section>

          {/* Integração Cloud ↔ Box */}
          <Section title="Integração Cloud ↔ Box" defaultOpen={true}>
            <div className="col-span-2">
              <IntegrationPanel nodeId={node.id} />
            </div>
          </Section>

          {/* Ações */}
          <div className="pt-4 space-y-2">
            <Link
              to={`/cameras?siteId=${node.site.id}`}
              className="flex items-center justify-between gap-2 px-4 py-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold transition shadow-lg shadow-cyan-600/20"
            >
              <span className="flex items-center gap-2">
                <CameraIcon className="w-4 h-4" />
                Acessar Câmeras do Site
              </span>
              <ExternalLink className="w-4 h-4" />
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
// Integration Panel
// ────────────────────────────────────────────────────────────────────────────

function IntegrationPanel({ nodeId }: { nodeId: string }) {
  const { data, error, isLoading } = useIntegrationSnapshot(nodeId)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-slate-500 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Carregando snapshot de integração…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-xs text-rose-400">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          {error?.response?.status === 404
            ? 'Box ainda não ativou (nenhum heartbeat recebido).'
            : `Falha ao carregar snapshot: ${formatApiError(error)}`}
        </span>
      </div>
    )
  }

  if (!data) return null

  const beatAgo = data.lastHeartbeatAt
    ? timeAgo(new Date(data.lastHeartbeatAt * 1000).toISOString())
    : 'nunca'

  const skillList = Object.entries(data.skills).filter(([, v]) => v.enabled)

  return (
    <div className="space-y-3">
      {/* ── Canal ── */}
      <div className="grid grid-cols-2 gap-2">
        {/* Licensed */}
        <div className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
          <Shield className={cn('w-4 h-4', data.licensed ? 'text-emerald-400' : 'text-rose-400')} />
          <div>
            <p className="text-[9px] uppercase text-slate-500">Licença</p>
            <p className={cn('text-xs font-bold', data.licensed ? 'text-emerald-400' : 'text-rose-400')}>
              {data.licensed ? 'Ativa' : 'Suspensa'}
            </p>
          </div>
        </div>
        {/* Último heartbeat */}
        <div className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
          <Radio className="w-4 h-4 text-violet-400" />
          <div>
            <p className="text-[9px] uppercase text-slate-500">Último heartbeat</p>
            <p className="text-xs font-mono text-slate-200">{beatAgo}</p>
          </div>
        </div>
        {/* Câmeras online */}
        <div className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
          <CameraIcon className="w-4 h-4 text-cyan-400" />
          <div>
            <p className="text-[9px] uppercase text-slate-500">Câmeras</p>
            <p className="text-xs font-mono text-slate-200">
              {data.camerasOnline}/{data.camerasTotal} online
            </p>
          </div>
        </div>
        {/* Comandos pendentes */}
        <div className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
          <Zap className={cn('w-4 h-4', data.pendingCommandsCount > 0 ? 'text-amber-400' : 'text-slate-600')} />
          <div>
            <p className="text-[9px] uppercase text-slate-500">Cmds pendentes</p>
            <p className={cn('text-xs font-mono', data.pendingCommandsCount > 0 ? 'text-amber-400 font-bold' : 'text-slate-400')}>
              {data.pendingCommandsCount}
            </p>
          </div>
        </div>
      </div>

      {/* ── Skills ── */}
      {skillList.length > 0 && (
        <div>
          <p className="text-[9px] uppercase text-slate-500 mb-1.5">Skills ativas</p>
          <div className="flex flex-wrap gap-1.5">
            {skillList.map(([key, s]) => (
              <span
                key={key}
                className="px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 text-[10px] font-medium"
              >
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Sparkline de heartbeats (CPU) ── */}
      {data.recentHeartbeats.length > 1 && (
        <div>
          <p className="text-[9px] uppercase text-slate-500 mb-1">CPU últimos {data.recentHeartbeats.length} batimentos</p>
          <CpuSparkline beats={data.recentHeartbeats} />
        </div>
      )}

      {/* ── Eventos recentes ── */}
      <div>
        <p className="text-[9px] uppercase text-slate-500 mb-1.5 flex items-center gap-1">
          <BarChart2 className="w-3 h-3" />
          Eventos recentes ({data.recentEvents.length})
        </p>
        {data.recentEvents.length === 0 ? (
          <p className="text-[10px] text-slate-600">Nenhum evento registrado ainda.</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {data.recentEvents.map(ev => (
              <div
                key={ev.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded border border-white/5 bg-white/[0.02] text-[10px]"
              >
                <span className={cn(
                  'shrink-0 w-1.5 h-1.5 rounded-full',
                  ev.severity === 'WARNING' ? 'bg-amber-400' : 'bg-emerald-400',
                )} />
                <span className="text-slate-300 font-mono truncate flex-1">
                  {ev.classes.slice(0, 3).join(', ') || ev.eventType}
                </span>
                <span className="shrink-0 text-slate-500 font-mono">{ev.objectCount}x</span>
                <span className="shrink-0 text-slate-600 font-mono">{timeAgo(ev.capturedAt)}</span>
                <span className="shrink-0 text-slate-600 truncate max-w-[60px]">{ev.camera.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Meta ── */}
      <p className="text-[9px] text-slate-700 font-mono pt-1 border-t border-white/5">
        openApi: {data.openApiVersion} · refresh 30s
      </p>
    </div>
  )
}

/** Mini sparkline SVG para série de CPU ao longo dos heartbeats */
function CpuSparkline({ beats }: { beats: { cpuUsage: number; recordedAt: string }[] }) {
  // beats chegam desc (mais recente primeiro) — inverte para eixo temporal →
  const sorted = [...beats].reverse()
  const values = sorted.map(b => b.cpuUsage)
  const max = Math.max(...values, 1)
  const W = 220, H = 32, pad = 2

  const points = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * (W - pad * 2)
    const y = H - pad - (v / max) * (H - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const lastVal = values[values.length - 1] ?? 0
  const lineColor = lastVal >= 85 ? '#f87171' : lastVal >= 70 ? '#fbbf24' : '#34d399'

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {/* área abaixo */}
        <polyline
          points={`${pad},${H} ${points} ${W - pad},${H}`}
          fill={`${lineColor}22`}
          stroke="none"
        />
        {/* linha */}
        <polyline
          points={points}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* último ponto */}
        <circle
          cx={parseFloat(points.split(' ').pop()!.split(',')[0])}
          cy={parseFloat(points.split(' ').pop()!.split(',')[1])}
          r="2.5"
          fill={lineColor}
        />
      </svg>
      <span className="absolute right-0 top-0 text-[9px] font-mono text-slate-500">
        {Math.round(lastVal)}%
      </span>
    </div>
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
    cyan:    'text-cyan-600 dark:text-cyan-300 border-cyan-500/20 bg-cyan-500/5',
    emerald: 'text-emerald-600 dark:text-emerald-300 border-emerald-500/20 bg-emerald-500/5',
    amber:   'text-amber-600 dark:text-amber-300 border-amber-500/20 bg-amber-500/5',
    rose:    'text-rose-600 dark:text-rose-300 border-rose-500/20 bg-rose-500/5',
  }[accent]
  return (
    <div className={cn('rounded-xl border p-3', colors)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="mt-1 text-xl font-bold text-slate-800 dark:text-white">{value}</p>
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
        <p className={cn('text-[11px] font-mono font-bold leading-tight', color ?? 'text-slate-800 dark:text-slate-200')}>{display}</p>
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
        <span className="text-slate-700 dark:text-slate-300">{label}</span>
        <span className="font-mono text-slate-600 dark:text-slate-400">
          {value == null ? '—' : `${Math.round(v)}${unit}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
        <div className={cn('h-full bg-gradient-to-r', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function LicensePanel({ node, isSuperAdmin, canProvision }: { node: EdgeNodeRow; isSuperAdmin: boolean; canProvision: boolean }) {
  const { mutate } = useSWRConfig()
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await generateLicenseKey(node.id)
      setGeneratedKey(result.licenseKey)
      mutate((key: string) => typeof key === 'string' && key.startsWith('/edge-nodes'))
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async () => {
    if (!confirm('Tem certeza? A Box perderá acesso à nuvem até receber uma nova chave.')) return
    setLoading(true)
    setError(null)
    try {
      await revokeLicense(node.id)
      setGeneratedKey(null)
      mutate((key: string) => typeof key === 'string' && key.startsWith('/edge-nodes'))
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex flex-col gap-2 col-span-2 p-3 rounded-lg border border-violet-500/20 bg-violet-500/5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        <span className="text-xs font-bold text-violet-700 dark:text-violet-200">Licença Cloud</span>
      </div>

      {generatedKey ? (
        <div className="mt-1 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
          <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold mb-1">⚠️ Copie agora — não será exibida novamente:</p>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-emerald-800 dark:text-emerald-200 bg-emerald-500/10 px-2 py-1 rounded flex-1 select-all">
              {generatedKey}
            </code>
            <button onClick={handleCopy} className="p-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          Gere uma chave de licença para ativar o sincronismo Edge → Cloud nesta Box.
        </p>
      )}

      {error && (
        <p className="text-[10px] text-rose-500 font-medium">{error}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {isSuperAdmin && !generatedKey && (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded text-[10px] text-white font-medium transition"
          >
            {loading ? 'Gerando...' : '🔑 Gerar Chave de Licença'}
          </button>
        )}
        {isSuperAdmin && (
          <button
            onClick={handleRevoke}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-700 dark:bg-slate-800 hover:bg-slate-600 dark:hover:bg-slate-700 border border-slate-500 dark:border-slate-600 disabled:opacity-50 rounded text-[10px] text-white font-medium transition"
          >
            Revogar Licença
          </button>
        )}
      </div>
    </div>
  )
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group mt-2" open={defaultOpen}>
      <summary className="flex items-center justify-between cursor-pointer list-none text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-500 font-bold select-none mb-2 outline-none">
        {title}
        <span className="transition-transform group-open:rotate-180">▼</span>
      </summary>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </details>
  )
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] p-2">
      <p className="text-[9px] text-slate-500 uppercase">{label}</p>
      <div className={cn('text-xs text-slate-800 dark:text-slate-200 truncate mt-0.5', mono && 'font-mono')}>{value}</div>
    </div>
  )
}

function colorByPct(v: number | null): string | undefined {
  if (v == null) return undefined
  if (v >= 85) return 'text-rose-600 dark:text-rose-300'
  if (v >= 70) return 'text-amber-600 dark:text-amber-300'
  return 'text-emerald-600 dark:text-emerald-300'
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
    technicianEmail:  '',
    sendEmail:        false,
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
        technicianEmail:  form.technicianEmail.trim() || undefined,
        sendEmail:        form.sendEmail,
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
            <option value="">— selecionar site —</option>
            {sites.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
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
              <option>yolov8n</option>
              <option>yolov8s</option>
              <option>yolov8m</option>
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

        <div className="border-t border-white/10 pt-3 space-y-2">
          <Field label="E-mail do técnico (opcional)">
            <input
              type="email"
              value={form.technicianEmail}
              onChange={e => setForm({ ...form, technicianEmail: e.target.value })}
              placeholder="tecnico@empresa.com"
              className={inputCls}
            />
          </Field>
          {form.technicianEmail && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.sendEmail}
                onChange={e => setForm({ ...form, sendEmail: e.target.checked })}
                className="accent-violet-500"
              />
              <span className="text-xs text-slate-400">
                Enviar chave de licença por e-mail para o técnico
              </span>
            </label>
          )}
        </div>

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
            <strong className="block mb-0.5">Chave de licença só aparece UMA vez</strong>
            Copie o JSON abaixo e cole no <code className="px-1 mx-0.5 bg-black/30 rounded font-mono">/etc/icv-edge/bootstrap.json</code> do device.
            Após fechar este modal, a chave não pode ser recuperada — apenas rotacionada.
          </div>
        </div>

        {result.email && (
          <div className={`px-3 py-2 rounded-lg text-xs flex items-center gap-2 border ${result.email.sent ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-500/10 border-slate-500/30 text-slate-400'}`}>
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {result.email.sent
              ? `E-mail enviado para ${result.email.to}`
              : `E-mail não enviado${result.email.error ? ` — ${result.email.error}` : ''}`}
          </div>
        )}

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

            <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-3">Chave de Licença</p>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-[11px] font-mono text-emerald-300 truncate">
                {result.licenseKey}
              </code>
              <button
                onClick={() => copy('token', result.licenseKey)}
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
      <span className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1 font-semibold">{label}</span>
      {children}
    </label>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50'
