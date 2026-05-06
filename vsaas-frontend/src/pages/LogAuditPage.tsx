/**
 * LogAuditPage — Operations & Audit Center.
 *
 * Página única consolidada de logs+eventos (Onda 3 do plano /log-audit).
 * Substitui as páginas redundantes: AuditPage (/audit), AdminLogsPage
 * (/admin/logs), LogsPage (/logs), IngestLogPage (/admin/ingest-log).
 *
 * RBAC server-side via /audit/explorer:
 *   - SUPER_ADMIN/ADMIN_GLOBAL: vê tudo, pode filtrar por integrador específico
 *   - INTEGRADOR_*: backend força integradorId próprio (mesmo passando outro)
 *   - CLIENTE_*:    backend força clienteFinalId próprio
 *
 * 6 sub-abas (filter por categoria server-side):
 *   1. Tudo
 *   2. Administração (auth, users, tenancy, modules, approvals)
 *   3. Operação (system, edge, ingest, cameras)
 *   4. Eventos IA (ai)
 *   5. Comunicação (notifications, webhooks)
 *   6. Uso & Storage (usage, storage)
 *
 * Embeddable: passe `embedded={true}` + `integradorId` para usar dentro
 * do TenantCockpit com filtro pré-aplicado.
 */
import { useMemo, useState } from 'react'
import {
  Shield, Search, AlertTriangle, Loader2, ChevronDown,
  Filter, User, ShieldAlert, Activity, Bell, Webhook, DollarSign,
  HardDrive, Server, Camera as CameraIcon, Cpu, Eye, Database,
  Sparkles, MessageCircle,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PremiumHero } from '../components/hierarchy'
import {
  useLogsExplorer, formatApiError,
  type LogEntry, type LogSource,
} from '../api/client'
import { cn } from '../lib/utils'

// ────────────────────────────────────────────────────────────────────────────
// Sub-abas — mapeamento UI → categorias server-side
// ────────────────────────────────────────────────────────────────────────────

type SubTab = 'all' | 'admin' | 'ops' | 'ai' | 'comm' | 'usage'

const TABS: Array<{
  id: SubTab
  label: string
  icon: typeof Shield
  categories: string[]   // empty = todos
  description: string
}> = [
  { id: 'all',   label: 'Tudo',          icon: Activity,    categories: [],
    description: 'Timeline cronológica completa de todas as fontes' },
  { id: 'admin', label: 'Administração', icon: User,        categories: ['auth','users','tenancy','modules','approvals'],
    description: 'Ações humanas no painel: login, convites, módulos, aprovações' },
  { id: 'ops',   label: 'Operação',      icon: Server,      categories: ['system','edge','ingest','cameras'],
    description: 'Eventos da infraestrutura: heartbeats, edge boxes, ingest RTMP, câmeras' },
  { id: 'ai',    label: 'Eventos IA',    icon: Sparkles,    categories: ['ai'],
    description: 'Detecções de IA: faces, placas, áudio, analytics genéricos' },
  { id: 'comm',  label: 'Comunicação',   icon: MessageCircle, categories: ['notifications','webhooks'],
    description: 'WhatsApp/email enviados + webhooks externos (Asaas)' },
  { id: 'usage', label: 'Uso & Storage', icon: Database,    categories: ['usage','storage'],
    description: 'Consumo Vision/Vertex/GCS + acessos a R2/S3' },
]

const SEVERITY_COLOR: Record<LogEntry['severity'], string> = {
  info:     'text-cyan-600 dark:text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  warning:  'text-amber-600 dark:text-amber-300 bg-amber-500/10 border-amber-500/30',
  error:    'text-rose-600 dark:text-rose-300 bg-rose-500/10 border-rose-500/30',
  critical: 'text-rose-700 dark:text-rose-200 bg-rose-500/20 border-rose-500/50 font-bold',
}

const SOURCE_LABEL: Record<LogSource, { label: string; icon: typeof Shield; color: string }> = {
  audit:           { label: 'Audit',         icon: Shield,         color: 'violet' },
  'edge-connection': { label: 'Edge',         icon: Cpu,            color: 'amber' },
  system:          { label: 'Sistema',       icon: Server,         color: 'slate' },
  camera:          { label: 'Câmera',        icon: CameraIcon,     color: 'emerald' },
  ingest:          { label: 'Ingest',        icon: HardDrive,      color: 'amber' },
  'ai-event':      { label: 'IA',            icon: Sparkles,       color: 'cyan' },
  notification:    { label: 'Notificação',   icon: Bell,           color: 'emerald' },
  webhook:         { label: 'Webhook',       icon: Webhook,        color: 'violet' },
  'api-usage':     { label: 'Uso API',       icon: DollarSign,     color: 'amber' },
  'storage-access':{ label: 'Storage',       icon: Database,       color: 'cyan' },
}

const role = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const isSuperAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'

// ────────────────────────────────────────────────────────────────────────────
// Componente
// ────────────────────────────────────────────────────────────────────────────

interface LogAuditPageProps {
  /** Renderiza sem hero/sidebar — para embed em TenantCockpit. */
  embedded?: boolean
  /** Pré-filtra integrador (SUPER_ADMIN dentro de TenantCockpit). */
  integradorId?: string
}

export function LogAuditPage({ embedded = false, integradorId }: LogAuditPageProps = {}) {
  const [tab, setTab]               = useState<SubTab>('all')
  const [days, setDays]             = useState(30)
  const [search, setSearch]         = useState('')
  const [severityFilter, setSeverityFilter] = useState<string[]>([])
  const [actorEmail, setActorEmail] = useState('')
  const [page, setPage]             = useState(1)
  const [expanded, setExpanded]     = useState<string | null>(null)

  const tabSpec = TABS.find(t => t.id === tab)!

  const { data, error, isLoading } = useLogsExplorer({
    days,
    categories:  tabSpec.categories.length ? tabSpec.categories : undefined,
    severities:  severityFilter.length ? severityFilter : undefined,
    search:      search || undefined,
    actorEmail:  actorEmail || undefined,
    integradorId,
    page,
    limit: 50,
  })

  const logs = data?.logs ?? []
  const aggregations = data?.aggregations

  return (
    <div className="space-y-4">
      {!embedded && (
        <PremiumHero
          emoji="🛡️"
          title="Log & Audit Center"
          subtitle={`${data?.total ?? 0} evento${data?.total !== 1 ? 's' : ''} nas últimas ${days}d · ${tabSpec.description.toLowerCase()}`}
          accent="violet"
          tags={[
            { label: 'LGPD', color: 'emerald' },
            { label: '10 fontes', color: 'cyan' },
            { label: isSuperAdmin ? 'Cross-tenant' : 'Tenant scope', color: 'violet' },
          ]}
        />
      )}

      {/* Sub-abas */}
      <GlassCard className="p-1">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setPage(1) }}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-xs font-bold whitespace-nowrap transition',
                  active
                    ? 'bg-violet-500/15 text-violet-700 dark:text-violet-200 border border-violet-500/30'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border border-transparent',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>
      </GlassCard>

      {/* Filtros + agregações */}
      <GlassCard className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Período */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <select
              value={days}
              onChange={e => { setDays(Number(e.target.value)); setPage(1) }}
              className={inputCls + ' pl-9 pr-8 appearance-none w-full'}
            >
              <option value={1}>Últimas 24h</option>
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={180}>Últimos 180 dias</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>

          {/* Busca */}
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por ação, mensagem, recurso…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className={inputCls + ' pl-9 w-full'}
            />
          </div>

          {/* Ator (search por email) */}
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Email do ator…"
              value={actorEmail}
              onChange={e => { setActorEmail(e.target.value); setPage(1) }}
              className={inputCls + ' pl-9 w-full'}
            />
          </div>
        </div>

        {/* Filtros de severidade (chips toggle) */}
        <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-slate-500 mr-1">Severidade:</span>
          {(['info', 'warning', 'error', 'critical'] as const).map(s => {
            const active = severityFilter.includes(s)
            const count = aggregations?.countsBySeverity?.[s] ?? 0
            return (
              <button
                key={s}
                onClick={() => {
                  setSeverityFilter(prev =>
                    prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
                  setPage(1)
                }}
                className={cn(
                  'px-2.5 py-0.5 rounded-full border transition',
                  active ? SEVERITY_COLOR[s] : 'border-slate-300 dark:border-white/10 text-slate-500 hover:border-slate-400',
                )}
              >
                {s} {count > 0 && <span className="opacity-70">·{count}</span>}
              </button>
            )
          })}
          {severityFilter.length > 0 && (
            <button
              onClick={() => { setSeverityFilter([]); setPage(1) }}
              className="text-[10px] text-slate-500 underline ml-2"
            >
              limpar
            </button>
          )}
        </div>
      </GlassCard>

      {/* KPIs sparkline + top atores */}
      {aggregations && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <GlassCard className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Eventos 24h</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">
              {aggregations.sparkline24h.reduce((a, b) => a + b, 0)}
            </p>
            <Sparkline values={aggregations.sparkline24h} />
          </GlassCard>
          <GlassCard className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Por categoria</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Object.entries(aggregations.countsByCategory).slice(0, 6).map(([c, n]) => (
                <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300">
                  {c} <span className="text-slate-500">·{n}</span>
                </span>
              ))}
            </div>
          </GlassCard>
          <GlassCard className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Top atores</p>
            <div className="space-y-1 mt-1">
              {aggregations.topActors.slice(0, 3).map(a => (
                <div key={a.email} className="text-[11px] flex justify-between gap-2">
                  <span className="truncate text-slate-700 dark:text-slate-300">{a.name || a.email}</span>
                  <span className="text-slate-500 font-mono shrink-0">·{a.count}</span>
                </div>
              ))}
              {aggregations.topActors.length === 0 && (
                <p className="text-[11px] text-slate-500 italic">— sem atores humanos no recorte</p>
              )}
            </div>
          </GlassCard>
        </div>
      )}

      {/* Lista de logs */}
      {isLoading && (
        <GlassCard className="p-12 text-center">
          <Loader2 className="w-6 h-6 text-violet-500 mx-auto animate-spin" />
          <p className="text-slate-500 text-sm mt-3">Carregando…</p>
        </GlassCard>
      )}
      {error && (
        <GlassCard className="p-6 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-center gap-3 text-rose-600 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5" />
            <p className="text-sm">{formatApiError(error)}</p>
          </div>
        </GlassCard>
      )}
      {!isLoading && !error && logs.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Shield className="w-10 h-10 text-slate-400 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Nenhum evento nesta janela com os filtros atuais.</p>
        </GlassCard>
      )}
      {!isLoading && logs.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="divide-y divide-slate-200 dark:divide-white/5">
            {logs.map(l => (
              <LogRow
                key={`${l.source ?? 'audit'}:${l.id}`}
                entry={l}
                expanded={expanded === l.id}
                onToggle={() => setExpanded(e => e === l.id ? null : l.id)}
              />
            ))}
          </div>

          {/* Paginação simples */}
          {(data?.pages ?? 1) > 1 && (
            <div className="px-4 py-3 border-t border-slate-200 dark:border-white/5 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">
                Página {data?.page} de {data?.pages} · {data?.total} eventos
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-2.5 py-1 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← Anterior
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= (data?.pages ?? 1)}
                  className="px-2.5 py-1 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Próxima →
                </button>
              </div>
            </div>
          )}
        </GlassCard>
      )}
    </div>
  )
}

// ─── Linha de log com drill-down inline ─────────────────────────────────────

function LogRow({
  entry, expanded, onToggle,
}: { entry: LogEntry; expanded: boolean; onToggle: () => void }) {
  const sourceConf = SOURCE_LABEL[entry.source ?? 'audit']
  const SourceIcon = sourceConf.icon
  const sevColor = SEVERITY_COLOR[entry.severity]

  const actor = entry.actor
  const tenant = entry.tenant
  const ts = new Date(entry.timestamp)

  return (
    <div className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <div className={cn('w-8 h-8 rounded-lg border flex items-center justify-center shrink-0', sevColor)}>
          <SourceIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-mono text-slate-900 dark:text-white truncate max-w-[400px]">{entry.action}</span>
            <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border', sevColor)}>
              {entry.severity}
            </span>
            <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">
              {sourceConf.label}
            </span>
            {entry.result && entry.result !== 'SUCCESS' && (
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-bold',
                entry.result === 'BLOCKED' ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300',
              )}>
                {entry.result}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
            {entry.resource}{entry.resourceId ? `:${entry.resourceId.slice(0, 8)}…` : ''}
            {actor && <> · <span className="text-cyan-600 dark:text-cyan-300">{actor.name ?? actor.email}</span></>}
            {tenant && <> · <span className="text-violet-600 dark:text-violet-300">{tenant.name}</span></>}
            {entry.ipAddress && <> · <span className="font-mono">{entry.ipAddress}</span></>}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 shrink-0 text-right">
          <div className="font-mono">{ts.toLocaleTimeString('pt-BR')}</div>
          <div className="text-slate-400 dark:text-slate-600">{ts.toLocaleDateString('pt-BR')}</div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 pl-15 -mt-1">
          <div className="rounded-lg bg-slate-100 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 p-3 text-[11px]">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Metadata</p>
            <pre className="font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-all overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
            {entry.userAgent && (
              <p className="mt-2 text-[10px] text-slate-500">
                <span className="uppercase tracking-wider">UA:</span> <span className="font-mono">{entry.userAgent}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sparkline mini ──────────────────────────────────────────────────────

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-px h-8 mt-2">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 bg-violet-500/40 dark:bg-violet-400/40 rounded-sm"
          style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
          title={`${v} eventos · -${24 - i}h`}
        />
      ))}
    </div>
  )
}

// Tailwind input class — copia do AuditPage para consistência visual
const inputCls =
  'px-3 py-2 bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 ' +
  'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-slate-600 rounded-lg text-xs ' +
  'focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/50 transition'
