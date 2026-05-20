/**
 * LogsCenter — explorer de logs de auditoria full + completo.
 *
 * Mental model 5W1H:
 *   WHO    actor (user/superadmin)
 *   WHAT   action
 *   WHERE  resource + resourceId
 *   WHEN   timestamp
 *   WHY    metadata (motivo/contexto)
 *   HOW    result (success/blocked/error) + severity derivada
 *
 * Features:
 *   - Header com KPIs + sparkline 24h
 *   - Filtros: período, categorias multi, severidades, ator, resource, IP, busca
 *   - Lista virtualizada com row expandível (mostra metadata JSON)
 *   - Export CSV
 *   - Reusable em /audit (global) e dentro do cockpit (filtra por integradorId via tenant scope JWT)
 */
import { useState, useMemo } from 'react'
import {
  Search, ChevronDown, ChevronUp, Download, RefreshCw, Filter,
  Shield, AlertTriangle, AlertOctagon, Info, Activity,
  User as UserIcon, Clock,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { useLogsExplorer, type LogEntry, type LogsExplorerQuery } from '../../api/client'
import { cn } from '../../lib/utils'

const CATEGORIES = [
  { id: 'auth',      label: 'Auth',       color: 'rose' },
  { id: 'users',     label: 'Usuários',   color: 'violet' },
  { id: 'tenancy',   label: 'Tenancy',    color: 'cyan' },
  { id: 'cameras',   label: 'Câmeras',    color: 'emerald' },
  { id: 'edge',      label: 'Edge',       color: 'amber' },
  { id: 'ingest',    label: 'Ingest',     color: 'amber' },
  { id: 'storage',   label: 'Storage',    color: 'cyan' },
  { id: 'quota',     label: 'Quota',      color: 'amber' },
  { id: 'modules',   label: 'Módulos',    color: 'violet' },
  { id: 'approvals', label: 'Aprovações', color: 'emerald' },
  { id: 'system',    label: 'Sistema',    color: 'slate' },
  { id: 'other',     label: 'Outros',     color: 'slate' },
]

/**
 * Origem (source) do log — cada uma vem de uma tabela diferente do banco.
 * Mostrar essa info ajuda operador a entender por quê um evento apareceu
 * (ex: "veio do Box via heartbeat" vs "ação humana via UI").
 */
const SOURCE_META: Record<string, { label: string; color: string; description: string }> = {
  'audit':           { label: 'Audit',     color: 'violet',  description: 'Ação humana (CRUD via UI/API) — AuditLog' },
  'edge-connection': { label: 'Edge',      color: 'amber',   description: 'Evento da Box: heartbeat, ativação, comando, drift — EdgeConnectionLog' },
  'system':          { label: 'Sistema',   color: 'slate',   description: 'Log do backend: jobs, GCP, batch, requests — SystemLog' },
  'camera':          { label: 'Câmera',    color: 'emerald', description: 'Pipeline da câmera: FFMPEG, DETECTOR, MOTION, ONVIF, IA — CameraLog' },
  'ingest':          { label: 'RTMP',      color: 'amber',   description: 'Push RTMP: PUBLISH_START / AUTH_FAIL / UNKNOWN_PATH — IngestLog' },
}

const SEVERITIES = [
  { id: 'info',     label: 'Info',     color: 'slate',   icon: Info },
  { id: 'warning',  label: 'Atenção',  color: 'amber',   icon: AlertTriangle },
  { id: 'error',    label: 'Erro',     color: 'rose',    icon: AlertOctagon },
  { id: 'critical', label: 'Crítico',  color: 'rose',    icon: Shield },
]

const PERIOD_PRESETS = [
  { label: '15min',  hours: 0.25 },
  { label: '1h',     hours: 1 },
  { label: '24h',    hours: 24 },
  { label: '7d',     hours: 24*7 },
  { label: '30d',    hours: 24*30 },
]

interface Props {
  /** Modo: 'cockpit' (dentro de tab) ou 'standalone' (página própria) */
  mode?: 'cockpit' | 'standalone'
  /** Filtra por resource (ex: 'EdgeNode') */
  initialResource?: string
  /** Filtra por resourceId específico (story view) */
  initialResourceId?: string
  /**
   * Restringe a auditoria a um Integrador específico, mesmo para SUPER_ADMIN.
   * Usado quando renderizado dentro do TenantCockpit para que o painel
   * mostre apenas eventos do tenant que está sendo navegado.
   */
  scopeIntegradorId?: string
}

export function LogsCenter({ mode = 'standalone', initialResource, initialResourceId, scopeIntegradorId }: Props) {
  const [periodHours, setPeriodHours] = useState(24)
  const [categories, setCategories] = useState<string[]>([])
  const [severities, setSeverities] = useState<string[]>([])
  const [actorEmail, setActorEmail] = useState('')
  const [resource, setResource] = useState(initialResource ?? '')
  const [resourceId, setResourceId] = useState(initialResourceId ?? '')
  const [ip, setIp] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  const days = Math.max(1, Math.ceil(periodHours / 24))
  const query: LogsExplorerQuery = useMemo(() => ({
    days,
    categories: categories.length ? categories : undefined,
    severities: severities.length ? severities : undefined,
    actorEmail: actorEmail || undefined,
    resource: resource || undefined,
    resourceId: resourceId || undefined,
    ip: ip || undefined,
    search: search || undefined,
    integradorId: scopeIntegradorId || undefined,
    page,
    limit: 50,
  }), [days, categories, severities, actorEmail, resource, resourceId, ip, search, scopeIntegradorId, page])

  const { data, error, isLoading, mutate } = useLogsExplorer(query)
  const logs = data?.logs ?? []
  const agg = data?.aggregations

  function toggleCategory(c: string) {
    setCategories(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c])
    setPage(1)
  }
  function toggleSeverity(s: string) {
    setSeverities(ss => ss.includes(s) ? ss.filter(x => x !== s) : [...ss, s])
    setPage(1)
  }

  function exportCsv() {
    if (!logs.length) return
    const header = ['Timestamp','Fonte','Categoria','Severidade','Ação','Recurso','ResourceID','Ator','Email','Tenant','IP','Resultado','Metadata']
    const rows = logs.map(l => [
      new Date(l.timestamp).toISOString(),
      l.source ?? '',
      l.category, l.severity, l.action, l.resource, l.resourceId ?? '',
      l.actor?.name ?? '', l.actor?.email ?? '',
      l.tenant?.name ?? '', l.ipAddress ?? '', l.result ?? '',
      JSON.stringify(l.metadata ?? {}),
    ])
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Header com KPIs */}
      {mode === 'standalone' && (
        <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 to-transparent border-violet-500/20">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
              <Activity className="w-6 h-6 text-slate-900 dark:text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Logs Explorer</h1>
              <p className="text-sm text-slate-400 mt-0.5">5W1H de toda atividade no seu escopo: quem, o quê, onde, quando, por quê, como.</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* KPIs por severidade + sparkline */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <KpiTile color="slate" label="Total" value={data?.total ?? 0} />
        {SEVERITIES.map(s => (
          <KpiTile key={s.id} color={s.color} label={s.label}
            value={agg?.countsBySeverity?.[s.id] ?? 0}
            icon={s.icon} />
        ))}
      </div>

      {/* Sparkline */}
      {agg?.sparkline24h && (
        <GlassCard className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase text-slate-500">Eventos últimas 24h</p>
            <p className="text-[10px] text-slate-500">{agg.sparkline24h.reduce((a,b)=>a+b,0)} eventos</p>
          </div>
          <div className="flex items-end gap-0.5 h-12">
            {agg.sparkline24h.map((v, i) => {
              const max = Math.max(...agg.sparkline24h, 1)
              const h = Math.max(2, (v / max) * 48)
              return (
                <div key={i}
                  className="flex-1 bg-violet-500/40 hover:bg-violet-400 rounded-t transition"
                  style={{ height: `${h}px` }}
                  title={`${v} eventos · ${23-i}h atrás`} />
              )
            })}
          </div>
        </GlassCard>
      )}

      {/* Filtros: chips de categoria */}
      <GlassCard className="p-3">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[10px] uppercase text-slate-500 mr-1">Período:</span>
          {PERIOD_PRESETS.map(p => (
            <button key={p.label} onClick={() => { setPeriodHours(p.hours); setPage(1) }}
              className={cn('px-2 py-0.5 rounded text-[10px] font-bold border transition',
                periodHours === p.hours ? 'bg-violet-500/30 text-violet-200 border-violet-500/50' : 'text-slate-400 border-slate-200 dark:border-white/10 hover:border-white/20')}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[10px] uppercase text-slate-500 mr-1">Categoria:</span>
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => toggleCategory(c.id)}
              className={cn('px-2 py-0.5 rounded text-[10px] font-bold border transition',
                categories.includes(c.id)
                  ? `bg-${c.color}-500/30 text-${c.color}-200 border-${c.color}-500/50`
                  : 'text-slate-400 border-slate-200 dark:border-white/10 hover:border-white/20')}>
              {c.label} {agg?.countsByCategory?.[c.id] ? `(${agg.countsByCategory[c.id]})` : ''}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase text-slate-500 mr-1">Severidade:</span>
          {SEVERITIES.map(s => (
            <button key={s.id} onClick={() => toggleSeverity(s.id)}
              className={cn('px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 transition',
                severities.includes(s.id)
                  ? `bg-${s.color}-500/30 text-${s.color}-200 border-${s.color}-500/50`
                  : 'text-slate-400 border-slate-200 dark:border-white/10 hover:border-white/20')}>
              <s.icon className="w-3 h-3" /> {s.label}
            </button>
          ))}
          <button onClick={() => setShowFilters(s => !s)}
            className="ml-auto px-2 py-1 rounded text-[10px] bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:bg-white/10 text-slate-400 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Filtros avançados {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {showFilters && (
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/5 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input value={actorEmail} onChange={e => { setActorEmail(e.target.value); setPage(1) }}
              placeholder="Email do ator..."
              className="px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
            <input value={resource} onChange={e => { setResource(e.target.value); setPage(1) }}
              placeholder="Resource (ex: EdgeNode)..."
              className="px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
            <input value={resourceId} onChange={e => { setResourceId(e.target.value); setPage(1) }}
              placeholder="Resource ID (story view)..."
              className="px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
            <input value={ip} onChange={e => { setIp(e.target.value); setPage(1) }}
              placeholder="IP..."
              className="px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
            <div className="relative col-span-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
                placeholder="Busca textual em ação..."
                className="w-full pl-7 pr-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
            </div>
          </div>
        )}
      </GlassCard>

      {/* Top atores compacto */}
      {agg?.topActors && agg.topActors.length > 0 && (
        <GlassCard className="p-3">
          <p className="text-[10px] uppercase text-slate-500 mb-2">Top atores no período</p>
          <div className="flex flex-wrap gap-2">
            {agg.topActors.map(a => (
              <button key={a.email} onClick={() => { setActorEmail(a.email); setPage(1) }}
                className="px-2 py-1 rounded-full text-[10px] bg-slate-50 dark:bg-white/5 hover:bg-violet-500/20 hover:text-violet-300 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10">
                <UserIcon className="w-3 h-3 inline mr-1" />{a.name} <span className="text-slate-500">({a.count})</span>
              </button>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Lista de logs */}
      <GlassCard className="p-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Eventos ({data?.total?.toLocaleString('pt-BR') ?? 0})</p>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} disabled={!logs.length}
              className="px-2 py-1 rounded text-[10px] bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 disabled:opacity-40 flex items-center gap-1">
              <Download className="w-3 h-3" /> CSV
            </button>
            <button onClick={() => mutate()}
              className="p-1.5 rounded bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:bg-white/10 text-slate-400">
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {error ? (
          <p className="text-xs text-rose-300 py-6 text-center">Erro ao carregar logs</p>
        ) : isLoading ? (
          <div className="space-y-1">
            {[0,1,2,3,4].map(i => <div key={i} className="h-8 bg-slate-50 dark:bg-white/5 rounded animate-pulse" />)}
          </div>
        ) : logs.length === 0 ? (
          <p className="text-xs text-slate-500 py-12 text-center">Nenhum evento neste filtro</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-200 dark:border-white/5">
                <tr>
                  <th className="px-2 py-1.5 text-left w-[140px]">Quando</th>
                  <th className="px-2 py-1.5 text-left">Severidade</th>
                  <th className="px-2 py-1.5 text-left" title="Fonte: AuditLog (audit), EdgeConnectionLog (edge), SystemLog (sistema), CameraLog (câmera), IngestLog (ingest)">Fonte</th>
                  <th className="px-2 py-1.5 text-left">Ação</th>
                  <th className="px-2 py-1.5 text-left">Recurso</th>
                  <th className="px-2 py-1.5 text-left">Ator</th>
                  <th className="px-2 py-1.5 text-left">Tenant</th>
                  <th className="px-2 py-1.5 text-right">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <LogRow key={l.id} log={l} expanded={expanded === l.id} onToggle={() => setExpanded(expanded === l.id ? null : l.id)} />
                ))}
              </tbody>
            </table>

            {/* Paginação */}
            {data && data.pages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-white/5">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1 rounded bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:bg-white/10 text-xs text-slate-400 disabled:opacity-30">
                  Anterior
                </button>
                <span className="text-xs text-slate-500">Página {data.page} de {data.pages}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= data.pages}
                  className="px-3 py-1 rounded bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:bg-white/10 text-xs text-slate-400 disabled:opacity-30">
                  Próxima
                </button>
              </div>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  )
}

function LogRow({ log, expanded, onToggle }: { log: LogEntry; expanded: boolean; onToggle: () => void }) {
  const sevColor = {
    info:     'text-slate-400',
    warning:  'text-amber-300',
    error:    'text-rose-300',
    critical: 'text-rose-400',
  }[log.severity]
  const sevIcon = SEVERITIES.find(s => s.id === log.severity)?.icon ?? Info
  const sourceMeta = log.source ? SOURCE_META[log.source] : null

  return (
    <>
      <tr className="border-b border-slate-200 dark:border-white/5 hover:bg-white/[0.02] cursor-pointer" onClick={onToggle}>
        <td className="px-2 py-1.5 text-[10px] text-slate-500 font-mono whitespace-nowrap">
          <Clock className="w-3 h-3 inline mr-1" />
          {new Date(log.timestamp).toLocaleString('pt-BR')}
        </td>
        <td className="px-2 py-1.5">
          <span className={cn('flex items-center gap-1 text-[10px] uppercase font-bold', sevColor)}>
            {(() => { const Icon = sevIcon; return <Icon className="w-3 h-3" /> })()}
            {log.severity}
          </span>
        </td>
        <td className="px-2 py-1.5">
          {sourceMeta ? (
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold',
                sourceMeta.color === 'violet'  && 'bg-violet-500/15 text-violet-300',
                sourceMeta.color === 'amber'   && 'bg-amber-500/15 text-amber-300',
                sourceMeta.color === 'slate'   && 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
                sourceMeta.color === 'emerald' && 'bg-emerald-500/15 text-emerald-300',
              )}
              title={sourceMeta.description}
            >
              {sourceMeta.label}
            </span>
          ) : (
            <span className="text-[9px] text-slate-600">—</span>
          )}
        </td>
        <td className="px-2 py-1.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300 font-mono">{log.action}</span>
          {log.result === 'BLOCKED' && <span className="ml-1 text-[9px] text-rose-300">BLOCKED</span>}
          {log.result === 'ERROR'   && <span className="ml-1 text-[9px] text-rose-400">ERROR</span>}
        </td>
        <td className="px-2 py-1.5 text-xs text-slate-400">
          {log.resource}
          {log.resourceId && <span className="text-slate-600 font-mono ml-1">:{String(log.resourceId).slice(0,8)}</span>}
        </td>
        <td className="px-2 py-1.5 text-xs">
          {log.actor ? (
            <span className={cn('text-slate-600 dark:text-slate-300', log.actor.kind === 'superadmin' && 'text-rose-300')}>
              {log.actor.name ?? log.actor.email}
            </span>
          ) : log.source === 'edge-connection' || log.source === 'camera' ? (
            <span className="text-[10px] text-amber-400/70 italic">box/sistema</span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-xs text-slate-400 truncate max-w-[120px]">
          {log.tenant?.name ?? '—'}
        </td>
        <td className="px-2 py-1.5 text-right text-[10px] text-slate-500 font-mono">
          {log.ipAddress ?? '—'}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-200 dark:border-white/5 bg-black/30">
          <td colSpan={8} className="px-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[10px]">
              <div>
                <p className="uppercase text-slate-500 mb-1">Recurso completo</p>
                <code className="text-slate-600 dark:text-slate-300 font-mono">{log.resource}:{log.resourceId}</code>
              </div>
              <div>
                <p className="uppercase text-slate-500 mb-1">User-Agent</p>
                <code className="text-slate-600 dark:text-slate-300 font-mono break-all">{log.userAgent ?? '—'}</code>
              </div>
            </div>
            <p className="text-[10px] uppercase text-slate-500 mt-2 mb-1">Metadata</p>
            <pre className="text-[10px] text-slate-600 dark:text-slate-300 bg-black/40 p-2 rounded overflow-x-auto font-mono max-h-40">
              {JSON.stringify(log.metadata ?? {}, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

function KpiTile({ color, label, value, icon: Icon }: { color: string; label: string; value: number; icon?: any }) {
  const cls = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    amber:   'border-amber-500/30 bg-amber-500/5 text-amber-300',
    violet:  'border-violet-500/30 bg-violet-500/5 text-violet-300',
    rose:    'border-rose-500/30 bg-rose-500/5 text-rose-300',
    cyan:    'border-cyan-500/30 bg-cyan-500/5 text-cyan-300',
    slate:   'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300',
  }[color] ?? 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300'
  return (
    <div className={cn('p-3 rounded-lg border', cls)}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-500">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </div>
      <p className="text-lg font-bold mt-1">{value.toLocaleString('pt-BR')}</p>
    </div>
  )
}
