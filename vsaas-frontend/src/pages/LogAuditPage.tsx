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
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Shield, Search, AlertTriangle, Loader2, ChevronDown,
  Filter, User, Activity, Bell, Webhook, DollarSign,
  HardDrive, Server, Camera as CameraIcon, Cpu, Eye, Database,
  Sparkles, MessageCircle, Briefcase, Building2, MapPin, X,
  Save, Download, Bookmark, ScrollText,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useLogsExplorer, useLogAuditFilterOptions, formatApiError,
  type LogEntry, type LogSource,
} from '../api/client'
import { cn } from '../lib/utils'
import { bg500_15, border500_30, darkText300, text700 } from '../lib/colorClasses'

// ────────────────────────────────────────────────────────────────────────────
// Sub-abas — mapeamento UI → categorias server-side
// ────────────────────────────────────────────────────────────────────────────

type SubTab = 'all' | 'admin' | 'ops' | 'ai' | 'comm' | 'usage' | 'lgpd' | 'video'

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
  { id: 'lgpd',  label: 'LGPD',          icon: ScrollText,  categories: ['lgpd'],
    description: 'Transparência LGPD: impersonações, exportações, exclusões e requisições de titulares' },
  { id: 'video', label: '📺 Acesso a Câmeras', icon: Eye, categories: ['video'],
    description: 'Auditoria de visualização de streams de vídeo (ao vivo e playback)' },
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
  'video-session': { label: 'Vídeo',         icon: Eye,            color: 'cyan' },
} as any

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

export function LogAuditPage({ embedded = false, integradorId: pinnedIntegradorId }: LogAuditPageProps = {}) {
  const [params, setParams] = useSearchParams()

  // Estado dos filtros — sincronizado com URL para deep-links
  const [tab, setTab]               = useState<SubTab>(() => (params.get('tab') as SubTab) || 'all')
  const [days, setDays]             = useState(() => Number(params.get('days')) || 30)
  const [search, setSearch]         = useState(() => params.get('q') || '')
  const [severityFilter, setSeverityFilter] = useState<string[]>(() => {
    const s = params.get('sev'); return s ? s.split(',') : []
  })
  const [actorEmail, setActorEmail] = useState(() => params.get('actor') || '')
  const [page, setPage]             = useState(1)
  const [expanded, setExpanded]     = useState<string | null>(null)

  // Onda 5 — filtros hierárquicos (cascading)
  const [filterIntegradorId,   setFilterIntegradorId]   = useState<string>(() => params.get('integ') || '')
  const [filterClienteFinalId, setFilterClienteFinalId] = useState<string>(() => params.get('cli') || '')
  const [filterSiteId,         setFilterSiteId]         = useState<string>(() => params.get('site') || '')
  const [filterCameraId,       setFilterCameraId]       = useState<string>(() => params.get('cam') || '')
  const [filterEdgeNodeId,     setFilterEdgeNodeId]     = useState<string>(() => params.get('edge') || '')

  // Onda 6 — filtros estruturados (chips)
  const [filterMethod, setFilterMethod]   = useState<'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|''>(() => (params.get('m') as any) || '')
  const [filterResult, setFilterResult]   = useState<'SUCCESS'|'BLOCKED'|'ERROR'|''>(() => (params.get('r') as any) || '')
  const [filterRoles,  setFilterRoles]    = useState<string[]>(() => {
    const r = params.get('role'); return r ? r.split(',') : []
  })

  // Onda 7 — drawer "Perfil de auditoria"
  const [actorDrawer, setActorDrawer] = useState<{ email: string; name?: string | null } | null>(null)

  // Onda 9 — Saved filters (localStorage)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters())

  // Listener para botões "ver atividade" inline na lista
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.email) setActorDrawer({ email: detail.email, name: detail.name })
    }
    window.addEventListener('log-audit:open-actor-drawer', handler)
    return () => window.removeEventListener('log-audit:open-actor-drawer', handler)
  }, [])

  // Resolve `integradorId` efetivo: super-admin no /admin/tenants/:id passa pinned;
  // dropdown manual sobrepõe; outras roles ficam undefined (RBAC server-side força).
  const effectiveIntegradorId = pinnedIntegradorId || filterIntegradorId || undefined

  const filterOptions = useLogAuditFilterOptions()
  const isSuper = filterOptions.data?.scope.isSuper ?? false

  // Cascading reset: quando muda Integrador, zera Cliente/Site/Câmera/Edge
  // (porque IDs filhos podem não pertencer ao novo integrador)
  useEffect(() => {
    if (filterIntegradorId) {
      // Não zera se os filhos atuais já pertencem ao integrador escolhido
      const opts = filterOptions.data
      if (opts) {
        const cliOk  = !filterClienteFinalId || opts.clientesFinais.some(c => c.id === filterClienteFinalId && c.integradorId === filterIntegradorId)
        const siteOk = !filterSiteId         || opts.sites.some(s => s.id === filterSiteId && opts.clientesFinais.find(c => c.id === s.clienteFinalId)?.integradorId === filterIntegradorId)
        const camOk  = !filterCameraId       || opts.cameras.some(c => c.id === filterCameraId && opts.sites.some(s => s.id === c.siteId && opts.clientesFinais.find(cf => cf.id === s.clienteFinalId)?.integradorId === filterIntegradorId))
        if (!cliOk)  setFilterClienteFinalId('')
        if (!siteOk) setFilterSiteId('')
        if (!camOk)  setFilterCameraId('')
        if (!camOk)  setFilterEdgeNodeId('')
      }
    }
  }, [filterIntegradorId])  // eslint-disable-line — só queremos rodar ao mudar integrador

  // Mesma lógica para Cliente → Site/Cam zera se mudar
  useEffect(() => {
    if (filterClienteFinalId) {
      const opts = filterOptions.data
      if (opts) {
        const siteOk = !filterSiteId   || opts.sites.some(s => s.id === filterSiteId && s.clienteFinalId === filterClienteFinalId)
        if (!siteOk) setFilterSiteId('')
      }
    }
  }, [filterClienteFinalId])  // eslint-disable-line

  // Sync URL state (deep-link)
  useEffect(() => {
    if (embedded) return  // embedded não polui URL
    const next = new URLSearchParams()
    if (tab !== 'all') next.set('tab', tab)
    if (days !== 30) next.set('days', String(days))
    if (search) next.set('q', search)
    if (severityFilter.length) next.set('sev', severityFilter.join(','))
    if (actorEmail) next.set('actor', actorEmail)
    if (filterIntegradorId)   next.set('integ', filterIntegradorId)
    if (filterClienteFinalId) next.set('cli',   filterClienteFinalId)
    if (filterSiteId)         next.set('site',  filterSiteId)
    if (filterCameraId)       next.set('cam',   filterCameraId)
    if (filterEdgeNodeId)     next.set('edge',  filterEdgeNodeId)
    if (filterMethod) next.set('m', filterMethod)
    if (filterResult) next.set('r', filterResult)
    if (filterRoles.length) next.set('role', filterRoles.join(','))
    setParams(next, { replace: true })
  }, [embedded, tab, days, search, severityFilter, actorEmail,
      filterIntegradorId, filterClienteFinalId, filterSiteId, filterCameraId, filterEdgeNodeId,
      filterMethod, filterResult, filterRoles])  // eslint-disable-line

  const tabSpec = TABS.find(t => t.id === tab)!

  const { data, error, isLoading } = useLogsExplorer({
    days,
    categories:  tabSpec.categories.length ? tabSpec.categories : undefined,
    severities:  severityFilter.length ? severityFilter : undefined,
    search:      search || undefined,
    actorEmail:  actorEmail || undefined,
    integradorId:   effectiveIntegradorId,
    clienteFinalId: filterClienteFinalId || undefined,
    siteId:         filterSiteId         || undefined,
    cameraId:       filterCameraId       || undefined,
    edgeNodeId:     filterEdgeNodeId     || undefined,
    method:         filterMethod         || undefined,
    result:         filterResult         || undefined,
    actorRole:      filterRoles.length ? filterRoles : undefined,
    page,
    limit: 50,
  })

  const logs = data?.logs ?? []
  const aggregations = data?.aggregations

  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex items-center justify-between p-6 w-full bg-white dark:bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-300 dark:border-slate-700/50 shadow-2xl">
          
          {/* Lado Esquerdo: Ícone + Textos */}
          <div className="flex items-center gap-5">
            <div className="flex-shrink-0 p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-[0_0_20px_rgba(59,130,246,0.3)]">
              <Shield className="w-8 h-8 text-white" />
            </div>
            
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-3">
                <h1 className="text-2xl font-bold text-white tracking-tight">Log & Audit Center</h1>
                <span className="text-sm font-medium text-slate-400">
                  {data?.total ?? 0} evento{data?.total !== 1 ? 's' : ''} ({days}d)
                </span>
              </div>
              
              {/* Badges Premium */}
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 text-[11px] uppercase tracking-wider font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-md">LGPD</span>
                <span className="px-2.5 py-0.5 text-[11px] uppercase tracking-wider font-semibold text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 rounded-md">11 Fontes</span>
                <span className="px-2.5 py-0.5 text-[11px] uppercase tracking-wider font-semibold text-indigo-400 bg-indigo-400/10 border border-indigo-400/20 rounded-md">{isSuperAdmin ? 'Cross-tenant' : 'Tenant scope'}</span>
              </div>
            </div>
          </div>

          {/* Lado Direito: Botões Centrados no Eixo Y */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                const name = prompt('Nome para este filtro salvo:')
                if (!name?.trim()) return
                const next: SavedFilter = {
                  id: 'sf_' + Date.now(),
                  name: name.trim().slice(0, 60),
                  state: {
                    tab, days, search, severityFilter, actorEmail,
                    filterIntegradorId, filterClienteFinalId, filterSiteId,
                    filterCameraId, filterEdgeNodeId,
                    filterMethod, filterResult, filterRoles,
                  },
                }
                const updated = [next, ...savedFilters].slice(0, 10)
                setSavedFilters(updated)
                persistSavedFilters(updated)
              }}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-700 border border-slate-600 rounded-lg transition-colors flex items-center gap-1.5"
              title="Salvar combinação atual de filtros"
            >
              <Save className="w-4 h-4" /> Salvar filtro
            </button>
            <button
              onClick={() => {
                const params = new URLSearchParams()
                if (days) params.set('days', String(days))
                if (search) params.set('search', search)
                if (severityFilter.length) params.set('severities', severityFilter.join(','))
                if (actorEmail) params.set('actorEmail', actorEmail)
                if (effectiveIntegradorId)   params.set('integradorId', effectiveIntegradorId)
                if (filterClienteFinalId)    params.set('clienteFinalId', filterClienteFinalId)
                if (filterSiteId)            params.set('siteId', filterSiteId)
                if (filterCameraId)          params.set('cameraId', filterCameraId)
                if (filterEdgeNodeId)        params.set('edgeNodeId', filterEdgeNodeId)
                if (filterMethod)            params.set('method', filterMethod)
                if (filterResult)            params.set('result', filterResult)
                if (filterRoles.length)      params.set('actorRole', filterRoles.join(','))
                const url = `/api/audit/explorer/export.csv?${params.toString()}`
                window.open(url, '_blank')
              }}
              className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-lg shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all flex items-center gap-2"
              title="Baixar CSV (max 10k linhas, respeita escopo)"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          
        </div>
      )}

      {/* Onda 9 — Saved filters chips */}
      {!embedded && savedFilters.length > 0 && (
        <GlassCard className="p-3">
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <Bookmark className="w-3.5 h-3.5 text-violet-500 shrink-0" />
            <span className="text-slate-500 mr-1">Filtros salvos:</span>
            {savedFilters.map(sf => (
              <div key={sf.id} className="inline-flex items-center gap-0.5 group">
                <button
                  onClick={() => {
                    const s = sf.state
                    setTab(s.tab); setDays(s.days); setSearch(s.search)
                    setSeverityFilter(s.severityFilter); setActorEmail(s.actorEmail)
                    setFilterIntegradorId(s.filterIntegradorId)
                    setFilterClienteFinalId(s.filterClienteFinalId)
                    setFilterSiteId(s.filterSiteId); setFilterCameraId(s.filterCameraId)
                    setFilterEdgeNodeId(s.filterEdgeNodeId)
                    setFilterMethod(s.filterMethod); setFilterResult(s.filterResult)
                    setFilterRoles(s.filterRoles)
                    setPage(1)
                  }}
                  className="px-2 py-0.5 rounded-l-full bg-violet-500/10 hover:bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30"
                >
                  {sf.name}
                </button>
                <button
                  onClick={() => {
                    const updated = savedFilters.filter(x => x.id !== sf.id)
                    setSavedFilters(updated)
                    persistSavedFilters(updated)
                  }}
                  className="px-1 py-0.5 rounded-r-full bg-violet-500/10 hover:bg-rose-500/20 text-violet-700 dark:text-violet-300 border border-l-0 border-violet-500/30 opacity-0 group-hover:opacity-100"
                  title="Remover filtro salvo"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            <span className="text-[10px] text-slate-500 ml-2">
              {savedFilters.length}/10
            </span>
          </div>
        </GlassCard>
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
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-600 dark:text-slate-300 border border-transparent',
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

        {/* ── Onda 6 — Filtros estruturados HTTP ────────────────────────────── */}
        <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-slate-500 mr-1">Método:</span>
          {(['GET','POST','PUT','PATCH','DELETE'] as const).map(m => {
            const active = filterMethod === m
            return (
              <button
                key={m}
                onClick={() => { setFilterMethod(active ? '' : m); setPage(1) }}
                className={cn(
                  'px-2 py-0.5 rounded-full border transition font-mono text-[10px]',
                  active
                    ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30'
                    : 'border-slate-300 dark:border-white/10 text-slate-500 hover:border-slate-400',
                )}
              >
                {m}
              </button>
            )
          })}
          <span className="text-slate-500 mx-2">·</span>
          <span className="text-slate-500 mr-1">Resultado:</span>
          {(['SUCCESS','BLOCKED','ERROR'] as const).map(r => {
            const active = filterResult === r
            const tone = r === 'SUCCESS' ? 'emerald' : r === 'BLOCKED' ? 'amber' : 'rose'
            return (
              <button
                key={r}
                onClick={() => { setFilterResult(active ? '' : r); setPage(1) }}
                className={cn(
                  'px-2 py-0.5 rounded-full border transition text-[10px] font-bold',
                  active
                    ? cn(bg500_15(tone), text700(tone), darkText300(tone), border500_30(tone))
                    : 'border-slate-300 dark:border-white/10 text-slate-500 hover:border-slate-400',
                )}
              >
                {r}
              </button>
            )
          })}
        </div>

        {/* ── Onda 6 — Filtros de role (chips multi) ───────────────────────────── */}
        <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-slate-500 mr-1">Role do ator:</span>
          {(['SUPER_ADMIN','INTEGRADOR_ADMIN','INTEGRADOR_TECNICO','CLIENTE_ADMIN','CLIENTE_OPERADOR','CLIENTE_VIEWER'] as const).map(r => {
            const active = filterRoles.includes(r)
            return (
              <button
                key={r}
                onClick={() => {
                  setFilterRoles(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])
                  setPage(1)
                }}
                className={cn(
                  'px-2 py-0.5 rounded-full border transition text-[10px] font-mono',
                  active
                    ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30'
                    : 'border-slate-300 dark:border-white/10 text-slate-500 hover:border-slate-400',
                )}
              >
                {r.toLowerCase().replace('_', ' ')}
              </button>
            )
          })}
        </div>

        {/* ── Onda 5 — Filtros hierárquicos cascading ────────────────────────── */}
        {filterOptions.data && (
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] text-slate-500">Escopo:</span>
              {(filterIntegradorId || filterClienteFinalId || filterSiteId || filterCameraId || filterEdgeNodeId) && (
                <button
                  onClick={() => {
                    setFilterIntegradorId(''); setFilterClienteFinalId('')
                    setFilterSiteId(''); setFilterCameraId(''); setFilterEdgeNodeId('')
                    setPage(1)
                  }}
                  className="text-[10px] text-slate-500 underline"
                >
                  limpar tudo
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
              {/* Integrador — só super-admin escolhe */}
              {isSuper && (
                <CascadingSelect
                  icon={Briefcase}
                  label="Integrador"
                  value={filterIntegradorId}
                  onChange={v => { setFilterIntegradorId(v); setPage(1) }}
                  options={filterOptions.data.integradores.map(i => ({
                    value: i.id, label: i.tradeName ?? i.name,
                  }))}
                  placeholder="Todos integradores"
                />
              )}

              {/* Cliente Final */}
              <CascadingSelect
                icon={Building2}
                label="Cliente final"
                value={filterClienteFinalId}
                onChange={v => { setFilterClienteFinalId(v); setPage(1) }}
                options={filterOptions.data.clientesFinais
                  .filter(c => !filterIntegradorId || c.integradorId === filterIntegradorId)
                  .map(c => ({ value: c.id, label: c.tradeName ?? c.name }))}
                placeholder="Todos clientes"
                disabled={isSuper && !filterIntegradorId && filterOptions.data.integradores.length > 1}
                disabledReason={isSuper && !filterIntegradorId ? 'Selecione integrador primeiro' : undefined}
              />

              {/* Site */}
              <CascadingSelect
                icon={MapPin}
                label="Site"
                value={filterSiteId}
                onChange={v => { setFilterSiteId(v); setPage(1) }}
                options={filterOptions.data.sites
                  .filter(s => !filterClienteFinalId || s.clienteFinalId === filterClienteFinalId)
                  .map(s => ({
                    value: s.id,
                    label: s.city ? `${s.name} (${s.city}/${s.state ?? ''})` : s.name,
                  }))}
                placeholder="Todos sites"
              />

              {/* Câmera */}
              <CascadingSelect
                icon={CameraIcon}
                label="Câmera"
                value={filterCameraId}
                onChange={v => { setFilterCameraId(v); setPage(1) }}
                options={filterOptions.data.cameras
                  .filter(c => !filterSiteId || c.siteId === filterSiteId)
                  .map(c => ({ value: c.id, label: c.name }))}
                placeholder="Todas câmeras"
              />

              {/* Edge Box */}
              <CascadingSelect
                icon={Cpu}
                label="Edge Box"
                value={filterEdgeNodeId}
                onChange={v => { setFilterEdgeNodeId(v); setPage(1) }}
                options={filterOptions.data.edgeNodes
                  .filter(e => !filterSiteId || e.siteId === filterSiteId)
                  .map(e => ({ value: e.id, label: `${e.name} · ${e.serialNumber}` }))}
                placeholder="Todas edge boxes"
              />
            </div>
          </div>
        )}
      </GlassCard>

      {/* ── Onda 10 — Banner contextual LGPD ─────────────────────────────── */}
      {tab === 'lgpd' && (
        <GlassCard className="p-4 border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 via-cyan-500/5 to-transparent">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-lg shrink-0">
              ⚖️
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Transparência LGPD</h3>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40">
                  Art. 7º IX · Art. 18 IV · Art. 37º
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/40">
                  {isSuper ? 'Cross-tenant (admin)' : 'Tenant scope'}
                </span>
              </div>
              <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-1">
                {isSuper
                  ? 'Você vê todos os eventos LGPD da plataforma. Use os filtros de Integrador / Cliente final / Site para isolar um titular específico.'
                  : role.startsWith('INTEGRADOR_')
                  ? 'Você vê eventos LGPD dos clientes finais do seu tenant. Filtre por cliente para auditar acessos a um titular específico.'
                  : 'Você vê os eventos LGPD do seu cliente final (impersonações realizadas em você, exportações, exclusões, requisições).'}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-600 dark:text-slate-400">
                <span>🔐 IMPERSONATION_START / END</span>
                <span>📤 LGPD_DATA_EXPORTED</span>
                <span>🗑️ LGPD_DATA_ERASED · LGPD_ERASURE_EXECUTED</span>
                <span>📝 LGPD_REQUEST_*</span>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* ── Onda 10 — KPIs específicos LGPD ─────────────────────────────── */}
      {tab === 'lgpd' && aggregations && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { key: 'imp', label: 'Impersonações',    icon: '🔐', filter: ['IMPERSONATION_START'],
              cls: 'border-rose-500/30 bg-gradient-to-br from-rose-500/5 to-transparent',
              text: 'text-rose-700 dark:text-rose-300', meta: 'text-rose-700 dark:text-rose-400' },
            { key: 'exp', label: 'Dados exportados', icon: '📤', filter: ['LGPD_DATA_EXPORTED'],
              cls: 'border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-transparent',
              text: 'text-cyan-700 dark:text-cyan-300', meta: 'text-cyan-700 dark:text-cyan-400' },
            { key: 'era', label: 'Dados apagados',   icon: '🗑️', filter: ['LGPD_DATA_ERASED','LGPD_ERASURE_EXECUTED'],
              cls: 'border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent',
              text: 'text-amber-700 dark:text-amber-300', meta: 'text-amber-700 dark:text-amber-400' },
            { key: 'req', label: 'Requisições',      icon: '📝', filter: ['LGPD_REQUEST_CREATED','LGPD_REQUEST_PROCESSED'],
              cls: 'border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-transparent',
              text: 'text-violet-700 dark:text-violet-300', meta: 'text-violet-700 dark:text-violet-400' },
          ] as const).map(card => {
            const count = logs.filter(l => card.filter.some(a => l.action.startsWith(a))).length
            return (
              <GlassCard key={card.key} className={'p-3 ' + card.cls}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-base">{card.icon}</span>
                  <span className={'text-[9px] uppercase tracking-wider font-bold ' + card.meta}>
                    {days}d
                  </span>
                </div>
                <p className={'text-2xl font-bold ' + card.text}>{count}</p>
                <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">{card.label}</p>
              </GlassCard>
            )
          })}
        </div>
      )}

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
          <div className="flex items-start gap-3 text-rose-600 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Erro ao carregar logs</p>
              <p className="text-xs mt-1 opacity-80">{formatApiError(error)}</p>
              {(error as any)?.requestId && (
                <p className="text-[10px] mt-2 font-mono opacity-60">
                  Request ID: {(error as any).requestId} — informe ao suporte se o problema persistir.
                </p>
              )}
            </div>
          </div>
        </GlassCard>
      )}

      {/* Onda 0 hotfix — banner de resposta parcial.
          Quando o backend devolve sourceErrors, mostra "X fontes degradadas"
          ao invés de esconder a falha. Logs disponíveis continuam visíveis. */}
      {!isLoading && data?.sourceErrors && data.sourceErrors.length > 0 && (
        <GlassCard className="p-3 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 text-[11px]">
              <p className="font-semibold">
                {data.sourceErrors.length} fonte{data.sourceErrors.length !== 1 ? 's' : ''} de log indisponíve{data.sourceErrors.length !== 1 ? 'is' : 'l'} no momento — exibindo resposta parcial.
              </p>
              <p className="opacity-80 mt-0.5">
                Afetadas: <span className="font-mono">{data.sourceErrors.map(s => s.source).join(', ')}</span>
                {data.requestId && (
                  <> · Request ID: <span className="font-mono opacity-70">{data.requestId}</span></>
                )}
              </p>
            </div>
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

      {/* Onda 7 — Drawer lateral "Perfil de auditoria" (timeline do ator) */}
      {actorDrawer && (
        <ActorDrawer
          email={actorDrawer.email}
          name={actorDrawer.name ?? null}
          days={days}
          onClose={() => setActorDrawer(null)}
        />
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
            {actor && (
              <> · <button
                onClick={(e) => {
                  e.stopPropagation()
                  // Notifica o pai para abrir o drawer
                  window.dispatchEvent(new CustomEvent<{ email: string; name?: string | null }>(
                    'log-audit:open-actor-drawer',
                    { detail: { email: actor.email, name: actor.name } } as any
                  ))
                }}
                className="text-cyan-600 dark:text-cyan-300 hover:underline cursor-pointer"
                title="Ver atividade deste usuário"
              >{actor.name ?? actor.email}</button>
              </>
            )}
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

// ─── Onda 7 — Drawer "Perfil de auditoria" ─────────────────────────────────
// Timeline e agregações da atividade de um ator específico nas últimas N dias.
// Reusa /audit/explorer?actorEmail=X — RBAC server-side garante escopo:
// SUPER vê tudo, INTEGRADOR vê próprios users, CLIENTE vê próprios users.

function ActorDrawer({
  email, name, days, onClose,
}: {
  email: string
  name: string | null
  days: number
  onClose: () => void
}) {
  const { data, error, isLoading } = useLogsExplorer({
    days,
    actorEmail: email,
    limit: 100,
  })

  // Fecha com Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const logs = data?.logs ?? []
  const aggregations = data?.aggregations
  const totalActions = aggregations?.countsBySeverity
    ? Object.values(aggregations.countsBySeverity).reduce((a, b) => a + b, 0)
    : 0

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-white/10 overflow-y-auto"
      >
        {/* Header */}
        <header className="sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-white/10 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-white text-base font-bold shrink-0">
              {(name || email).slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                {name ?? email}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{email}</p>
              <p className="text-[10px] text-slate-500 mt-1">
                {totalActions} ação{totalActions !== 1 ? 'ões' : ''} nos últimos {days} dia{days !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Agregações */}
        {aggregations && (
          <div className="p-4 grid grid-cols-2 gap-3 border-b border-slate-200 dark:border-white/5">
            {/* Por categoria */}
            <GlassCard className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Por categoria</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(aggregations.countsByCategory).slice(0, 6).map(([c, n]) => (
                  <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10">
                    {c} <span className="text-slate-500">·{n}</span>
                  </span>
                ))}
                {Object.keys(aggregations.countsByCategory).length === 0 && (
                  <span className="text-[10px] text-slate-500 italic">—</span>
                )}
              </div>
            </GlassCard>
            {/* Por severidade */}
            <GlassCard className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Por severidade</p>
              <div className="flex flex-wrap gap-1">
                {(['info','warning','error','critical'] as const).map(s => {
                  const n = aggregations.countsBySeverity[s] ?? 0
                  if (n === 0) return null
                  return (
                    <span key={s} className={cn('text-[10px] px-1.5 py-0.5 rounded border', SEVERITY_COLOR[s])}>
                      {s} ·{n}
                    </span>
                  )
                })}
              </div>
            </GlassCard>
          </div>
        )}

        {/* Sparkline 24h */}
        {aggregations && aggregations.sparkline24h.some(v => v > 0) && (
          <div className="p-4 border-b border-slate-200 dark:border-white/5">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Atividade 24h</p>
            <Sparkline values={aggregations.sparkline24h} />
          </div>
        )}

        {/* Timeline */}
        <div className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Timeline</p>
          {isLoading && (
            <div className="py-8 text-center text-slate-500 text-xs">
              <Loader2 className="w-5 h-5 mx-auto animate-spin" />
              <p className="mt-2">Carregando…</p>
            </div>
          )}
          {error && (
            <div className="text-rose-600 dark:text-rose-300 text-xs">{formatApiError(error)}</div>
          )}
          {!isLoading && !error && logs.length === 0 && (
            <div className="py-8 text-center text-slate-500 text-xs italic">
              Nenhuma ação registrada deste usuário no período.
            </div>
          )}
          {!isLoading && logs.length > 0 && (
            <div className="space-y-1">
              {logs.map(l => {
                const ts = new Date(l.timestamp)
                const sevColor = SEVERITY_COLOR[l.severity]
                const sourceConf = SOURCE_LABEL[l.source ?? 'audit']
                return (
                  <div
                    key={`${l.source}:${l.id}`}
                    className="text-[11px] flex items-baseline gap-2 py-1.5 border-b border-slate-100 dark:border-white/5 last:border-0"
                  >
                    <span className="text-slate-500 font-mono text-[10px] shrink-0 w-20">
                      {ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded border shrink-0', sevColor)}>
                      {l.severity}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 shrink-0">
                      {sourceConf.label}
                    </span>
                    <span className="font-mono text-slate-700 dark:text-slate-300 truncate flex-1">
                      {l.action}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
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

// ─── Onda 5 — Cascading select (dropdown hierárquico) ──────────────────────

interface CascadingSelectProps {
  icon: typeof Briefcase
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  placeholder: string
  disabled?: boolean
  disabledReason?: string
}

function CascadingSelect({
  icon: Icon, label, value, onChange, options, placeholder,
  disabled, disabledReason,
}: CascadingSelectProps) {
  return (
    <div title={disabled ? disabledReason : undefined}>
      <label className="text-[9px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled || options.length === 0}
          className={cn(
            inputCls + ' w-full pr-8 appearance-none disabled:cursor-not-allowed disabled:opacity-50',
            value && 'border-violet-500/50 bg-violet-500/5',
          )}
        >
          <option value="">{disabled ? '—' : placeholder} ({options.length})</option>
          {options.slice(0, 500).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          {options.length > 500 && (
            <option disabled>+ {options.length - 500} (use busca para refinar)</option>
          )}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-7 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10"
            aria-label="Limpar"
          >
            <X className="w-3 h-3 text-slate-500" />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Onda 9 — Saved filters (localStorage) ─────────────────────────────────

interface SavedFilterState {
  tab: SubTab
  days: number
  search: string
  severityFilter: string[]
  actorEmail: string
  filterIntegradorId: string
  filterClienteFinalId: string
  filterSiteId: string
  filterCameraId: string
  filterEdgeNodeId: string
  filterMethod: '' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  filterResult: '' | 'SUCCESS' | 'BLOCKED' | 'ERROR'
  filterRoles: string[]
}
interface SavedFilter {
  id: string
  name: string
  state: SavedFilterState
}

const SAVED_FILTERS_KEY = 'icv_log_audit_saved_filters_v1'

function loadSavedFilters(): SavedFilter[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(SAVED_FILTERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 10)
  } catch { return [] }
}

function persistSavedFilters(filters: SavedFilter[]) {
  if (typeof window === 'undefined') return
  try {
    const json = JSON.stringify(filters.slice(0, 10))
    if (json.length > 8000) return  // size cap defensivo
    localStorage.setItem(SAVED_FILTERS_KEY, json)
  } catch { /* quota exceeded etc */ }
}

// Tailwind input class — copia do AuditPage para consistência visual
const inputCls =
  'px-3 py-2 bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 ' +
  'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-slate-600 rounded-lg text-xs ' +
  'focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/50 transition'
