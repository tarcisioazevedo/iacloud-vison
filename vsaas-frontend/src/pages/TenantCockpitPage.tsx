/**
 * TenantCockpitPage — Cockpit de gestão de integradores para SuperAdmin
 *
 * Tabs: Overview | Clientes | Usuários | Boxes | Storage | Logs | Config
 */
import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import useSWRImport from 'swr'
import {
  Building2, Plus, Search, Eye, EyeOff, Loader2, AlertTriangle, CheckCircle2,
  X, Mail, Users, Activity, Puzzle, ArrowLeft, BarChart3, HardDrive,
  Server, FileText, Settings, Power, PowerOff, RefreshCw, ChevronRight,
  Calendar, Clock, Shield, Cpu, Database, User, MapPin, Video,
  ChevronDown, ChevronUp, History, Trash2, AlertCircle, Camera, Folder, Image, File,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  api,
  useIntegradores, useIntegradorOverview, useIntegradorClients, useIntegradorUsers,
  useIntegradorBoxes, useIntegradorStorage, useIntegradorLogs, useIntegradorModulesInfo,
  useIntegradorQuota, useTenantsGlobalStats, impersonateIntegrador,
  createIntegrador, suspendIntegrador, formatApiError,
  updateUser, deleteUser, resetUserPassword, inviteUser,
  updateIntegrador,
  usePendingEdgeApprovals, approveRequest, rejectRequest,
  suspendEdgeNode, resumeEdgeNode,
  type CreateIntegradorPayload, type IntegradorRow,
} from '../api/client'
import { Globe } from 'lucide-react'
import { EdgeBoxesPanel } from '../components/edge/EdgeBoxesPanel'
import { LogsCenter } from '../components/logs/LogsCenter'
import { LogoUploader } from '../components/branding/LogoUploader'
import { cn } from '../lib/utils'

type TabId = 'overview' | 'clients' | 'users' | 'boxes' | 'approvals' | 'storage' | 'logs' | 'config'

const TABS: { id: TabId; label: string; icon: typeof BarChart3 }[] = [
  { id: 'overview',  label: 'Overview', icon: BarChart3 },
  { id: 'clients',   label: 'Clientes', icon: Building2 },
  { id: 'users',     label: 'Usuários', icon: Users },
  { id: 'boxes',     label: 'Edge Boxes', icon: Server },
  { id: 'approvals', label: 'Aprovações', icon: Shield },
  { id: 'storage',   label: 'Storage', icon: HardDrive },
  { id: 'logs',      label: 'Logs', icon: FileText },
  { id: 'config',    label: 'Config', icon: Settings },
]

export function TenantCockpitPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tabFromUrl = (params.get('tab') as TabId) || 'overview'
  const [activeTab, setActiveTab] = useState<TabId>(tabFromUrl)

  // Sincroniza estado quando URL muda (back/forward + deep-link)
  useEffect(() => { setActiveTab(tabFromUrl) }, [tabFromUrl])

  function changeTab(t: TabId) {
    setActiveTab(t)
    setParams(p => { const np = new URLSearchParams(p); np.set('tab', t); return np }, { replace: true })
  }

  if (id) {
    return (
      <CockpitView
        integradorId={id}
        activeTab={activeTab}
        onTabChange={changeTab}
        onBack={() => navigate('/admin/tenants')}
      />
    )
  }

  return <IntegradoresListView onSelect={id => navigate(`/admin/tenants/${id}`)} />
}

function IntegradoresListView({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, error, isLoading, mutate } = useIntegradores()
  const { data: stats } = useTenantsGlobalStats()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all'|'active'|'inactive'>('all')
  const [showCreate, setShowCreate] = useState(false)

  const filtered = useMemo(() => {
    const list = data?.integradores ?? []
    return list.filter(i => {
      if (statusFilter === 'active' && !i.active) return false
      if (statusFilter === 'inactive' && i.active) return false
      if (!search) return true
      const q = search.toLowerCase()
      return i.name.toLowerCase().includes(q) || i.email.toLowerCase().includes(q)
    })
  }, [data, search, statusFilter])

  return (
    <div className="space-y-4">
      {/* Hero + KPIs no estilo do detalhe (faixa superior) */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Tenant Management
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-mono uppercase">
                  super-admin
                </span>
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Visão consolidada de todos os integradores, seus clientes, sites, edge boxes, módulos e usuários.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 text-white text-sm font-bold shadow-lg shadow-violet-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            Novo integrador
          </button>
        </div>

        {/* Faixa de KPIs globais */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <KpiCard icon={Building2} value={stats?.integradores.total ?? 0} label="Integradores" color="violet"
            sub={stats ? `${stats.integradores.ativos} ativos` : undefined} />
          <KpiCard icon={Building2} value={stats?.clientes.total ?? 0} label="Clientes finais" color="cyan"
            sub={stats ? `${stats.clientes.ativos} ativos` : undefined} />
          <KpiCard icon={MapPin} value={stats?.sites ?? 0} label="Sites" color="amber" />
          <KpiCard icon={Video} value={stats?.cameras ?? 0} label="Câmeras" color="emerald" />
          <KpiCard icon={Users} value={stats?.usuarios ?? 0} label="Usuários" color="violet" />
          <KpiCard icon={Server} value={stats?.edgeBoxes.total ?? 0} label="Edge Boxes" color="cyan"
            sub={stats ? `${stats.edgeBoxes.online} online` : undefined} />
          <KpiCard icon={Shield} value={stats?.pendingApprovals ?? 0} label="Aprovações"
            color={stats && stats.pendingApprovals > 0 ? 'rose' : 'emerald'}
            sub={stats?.pendingApprovals ? 'pendentes' : 'ok'} />
        </div>
      </GlassCard>

      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao listar</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {isLoading && !data && <LoadingState />}

      {/* Pré-tela: Alertas + Top tenants */}
      <ActiveAlertsBar />
      <TopTenantsBar integradores={data?.integradores ?? []} />


      {/* Lista de integradores (tabela) */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className="text-sm font-semibold text-white">Integradores ({filtered.length})</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
              className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white [&>option]:bg-slate-900 [&>option]:text-white">
              <option value="all">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Suspensos</option>
            </select>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar nome ou email..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white" />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 className="w-10 h-10 mx-auto text-slate-700 mb-3" />
            <p className="text-sm text-slate-500">{search || statusFilter !== 'all' ? 'Nenhum tenant encontrado com este filtro.' : 'Nenhum tenant cadastrado.'}</p>
            {!search && statusFilter === 'all' && (
              <button onClick={() => setShowCreate(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 text-xs font-bold">
                <Plus className="w-3.5 h-3.5" />
                Cadastrar o primeiro
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-500 border-b border-white/5">
                <tr>
                  <th className="px-3 py-2 text-left">Integrador</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-center">Clientes</th>
                  <th className="px-3 py-2 text-center" title="Admins · Técnicos · Clientes">Usuários</th>
                  <th className="px-3 py-2 text-center">Edge Boxes</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-left">Criado</th>
                  <th className="px-3 py-2 text-center">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(i => (
                  <IntegradorRowComponent
                    key={i.id}
                    integrador={i}
                    onSelect={() => onSelect(i.id)}
                    onChanged={mutate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <AnimatePresence>
        {showCreate && (
          <CreateIntegradorModal
            onClose={() => setShowCreate(false)}
            onSuccess={() => { mutate(); setShowCreate(false) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Pré-tela: Alertas Ativos (compacto, com link para /admin/alerts)
// ────────────────────────────────────────────────────────────────────────────
function ActiveAlertsBar() {
  const fetcher = (u: string) => import('../api/client').then(m => m.api.get(u).then(r => r.data))
  const { data } = useSWRImport<any>('/admin/alerts/active', fetcher, { refreshInterval: 60_000 })
  const alerts = data?.alerts ?? []
  const top3 = alerts.slice(0, 3)

  if (!data || alerts.length === 0) return null

  const counts = data.counts ?? {}

  return (
    <GlassCard className="p-4 border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-rose-500/5 to-transparent">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
          <h3 className="text-sm font-bold text-white">Alertas ativos</h3>
          <span className="text-[10px] text-slate-500">
            {counts.critical > 0 && <span className="text-rose-300 font-bold">{counts.critical} críticos</span>}
            {counts.critical > 0 && counts.high > 0 && ' · '}
            {counts.high > 0 && <span className="text-amber-300">{counts.high} altos</span>}
          </span>
        </div>
        <Link to="/admin/alerts" className="text-xs text-amber-300 hover:text-amber-200 flex items-center gap-1">
          Ver todos ({alerts.length}) <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="space-y-1.5">
        {top3.map((a: any) => (
          <Link key={a.id} to={a.actions?.[0]?.href ?? '/admin/alerts'}
            className={cn(
              'flex items-center justify-between gap-3 p-2 rounded border transition hover:bg-white/5',
              a.severity === 'critical' ? 'border-rose-500/30 bg-rose-500/5'
                : a.severity === 'high'  ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-white/10 bg-white/[0.02]'
            )}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                a.severity === 'critical' ? 'bg-rose-500 animate-pulse'
                  : a.severity === 'high'  ? 'bg-amber-500'
                  : 'bg-cyan-500')} />
              <span className="text-xs text-white truncate">{a.title}</span>
            </div>
            <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
          </Link>
        ))}
      </div>
    </GlassCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Top Tenants — bar chart horizontal por número de clientes/edges
// ────────────────────────────────────────────────────────────────────────────
function TopTenantsBar({ integradores }: { integradores: IntegradorRow[] }) {
  const top = useMemo(() => {
    return [...integradores]
      .sort((a, b) => (b._count?.clienteFinais ?? 0) - (a._count?.clienteFinais ?? 0))
      .slice(0, 5)
  }, [integradores])

  if (top.length === 0) return null
  const max = Math.max(...top.map(t => t._count?.clienteFinais ?? 0), 1)

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-bold text-white">Top integradores por nº de clientes</h3>
      </div>
      <div className="space-y-2">
        {top.map((t, idx) => {
          const v = t._count?.clienteFinais ?? 0
          const pct = (v / max) * 100
          return (
            <div key={t.id}>
              <div className="flex items-center justify-between text-xs mb-1">
                <Link to={`/admin/tenants/${t.id}`} className="text-slate-300 hover:text-violet-300 flex items-center gap-2">
                  <span className="text-slate-500 font-mono">#{idx + 1}</span>
                  {t.name}
                </Link>
                <span className="text-white font-bold">
                  {v} <span className="text-slate-500 font-normal">cliente{v !== 1 ? 's' : ''}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                  className="h-full bg-gradient-to-r from-violet-500 to-cyan-500" />
              </div>
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}

function IntegradorRowComponent({ integrador: i, onSelect, onChanged }: {
  integrador: IntegradorRow
  onSelect: () => void
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  function go(e: React.MouseEvent, url: string) {
    e.stopPropagation()
    navigate(url)
  }

  async function handleImpersonate(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Logar como ${i.name}? Você verá a plataforma do ponto de vista deste integrador. Use 'Sair da impersonation' para voltar.`)) return
    setBusy(true)
    try {
      const r = await impersonateIntegrador(i.id, 'Suporte via cockpit')
      // Salva token e recarrega
      localStorage.setItem('icv_token', r.token)
      localStorage.setItem('icv_role', r.user.role)
      localStorage.setItem('icv_email', r.user.email)
      window.location.href = '/'
    } catch (err) {
      alert(formatApiError(err))
      setBusy(false)
    }
  }

  async function handleSuspend(e: React.MouseEvent) {
    e.stopPropagation()
    const action = i.active ? 'Suspender' : 'Reativar'
    let reason: string | undefined
    if (i.active) {
      const r = prompt(`Motivo da suspensão de ${i.name}? (opcional)`)
      if (r === null) return
      reason = r || undefined
    } else {
      if (!confirm(`Reativar ${i.name}?`)) return
    }
    setBusy(true)
    try { await suspendIntegrador(i.id, i.active, reason); onChanged() }
    catch (err) { alert(formatApiError(err)) }
    finally { setBusy(false) }
  }

  const u = i.users
  const edgeOnline = i.edgeNodesOnline ?? 0
  const edgeTotal = i.edgeNodesUsed ?? 0
  const edgeMax = i.maxEdgeNodes
  const pendingBadge = (i.pendingApprovals ?? 0) > 0

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer" onClick={onSelect}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/30 to-cyan-500/30 border border-violet-500/30 flex items-center justify-center text-xs font-bold text-violet-300">
            {i.name[0]?.toUpperCase() ?? 'T'}
          </div>
          <span className="font-medium text-white truncate">{i.name}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-slate-400 font-mono truncate">{i.email}</td>
      <td className="px-3 py-2 text-center text-xs text-slate-300">{i._count?.clienteFinais ?? 0}</td>
      <td className="px-3 py-2 text-center">
        {u ? (
          <span className="text-xs text-slate-300 font-mono" title={`${u.admins} Admin · ${u.tecnicos} Técnico · ${u.clientes} Cliente`}>
            <span className="text-violet-300">{u.admins}A</span>
            <span className="text-slate-500"> · </span>
            <span className="text-cyan-300">{u.tecnicos}T</span>
            <span className="text-slate-500"> · </span>
            <span className="text-emerald-300">{u.clientes}C</span>
          </span>
        ) : <span className="text-xs text-slate-500">—</span>}
      </td>
      <td className="px-3 py-2 text-center text-xs">
        <span className="text-slate-300" title={`${edgeOnline} online de ${edgeTotal}`}>
          <span className={cn('font-bold', edgeOnline > 0 ? 'text-emerald-300' : 'text-slate-500')}>{edgeOnline}</span>
          <span className="text-slate-500">/{edgeTotal}{edgeMax ? `/${edgeMax}` : ''}</span>
        </span>
      </td>
      <td className="px-3 py-2 text-center">
        {i.active ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Ativo</span>
        ) : (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-500/20 text-slate-400 border border-slate-500/30">Suspenso</span>
        )}
      </td>
      <td className="px-3 py-2 text-[10px] text-slate-500 font-mono">
        {new Date(i.createdAt).toLocaleDateString('pt-BR')}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-center gap-0.5" onClick={e => e.stopPropagation()}>
          <ActionBtn icon={Users} title="Usuários do tenant" onClick={e => go(e, `/admin/tenants/${i.id}?tab=users`)} color="violet" />
          <ActionBtn icon={Puzzle} title="Módulos disponíveis" onClick={e => go(e, `/admin/tenants/${i.id}?tab=config`)} color="amber" />
          <ActionBtn icon={Globe} title="Domínio white-label" onClick={e => go(e, `/custom-domains?integradorId=${i.id}`)} color="cyan" />
          <ActionBtn icon={Settings} title="Configuração" onClick={e => go(e, `/admin/tenants/${i.id}?tab=config`)} color="slate" />
          <ActionBtn icon={Shield} title={pendingBadge ? `${i.pendingApprovals} aprovação(ões) pendente(s)` : 'Aprovações'}
            onClick={e => go(e, `/admin/tenants/${i.id}?tab=approvals`)}
            color={pendingBadge ? 'amber' : 'emerald'}
            badge={pendingBadge ? i.pendingApprovals : undefined} />
          <ActionBtn icon={User} title="Logar como (impersonate)" onClick={handleImpersonate} disabled={busy} color="cyan" />
          <ActionBtn icon={i.active ? PowerOff : Power}
            title={i.active ? 'Suspender' : 'Reativar'}
            onClick={handleSuspend}
            disabled={busy}
            color={i.active ? 'rose' : 'emerald'} />
          <ChevronRight className="w-3 h-3 text-slate-600 ml-1" />
        </div>
      </td>
    </tr>
  )
}

function ActionBtn({ icon: Icon, title, onClick, color = 'slate', disabled, badge }: {
  icon: typeof Users
  title: string
  onClick: (e: React.MouseEvent) => void
  color?: 'violet'|'cyan'|'emerald'|'amber'|'rose'|'slate'
  disabled?: boolean
  badge?: number
}) {
  const colorMap = {
    violet:  'text-violet-400 hover:text-violet-300 hover:bg-violet-500/15 bg-violet-500/5',
    cyan:    'text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/15 bg-cyan-500/5',
    emerald: 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/15 bg-emerald-500/5',
    amber:   'text-amber-400 hover:text-amber-300 hover:bg-amber-500/15 bg-amber-500/5',
    rose:    'text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 bg-rose-500/5',
    slate:   'text-slate-400 hover:text-white hover:bg-white/10 bg-white/5',
  }[color]
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={cn('relative p-1.5 rounded transition disabled:opacity-30', colorMap)}>
      <Icon className="w-3.5 h-3.5" />
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-500 text-[8px] font-bold text-white flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

function TenantCard({ integrador, onSelect }: { integrador: IntegradorRow; onSelect: () => void }) {
  return (
    <GlassCard
      className="p-4 cursor-pointer hover:border-violet-500/30 transition group"
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/30 to-cyan-500/30 border border-violet-500/30 flex items-center justify-center text-sm font-bold text-violet-300">
          {integrador.name[0]?.toUpperCase() ?? 'T'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white truncate">{integrador.name}</h3>
            {integrador.active ? (
              <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500" title="Ativo" />
            ) : (
              <span className="shrink-0 w-2 h-2 rounded-full bg-slate-500" title="Inativo" />
            )}
          </div>
          <p className="text-xs text-slate-500 font-mono truncate">{integrador.email}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-violet-400 transition shrink-0" />
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/5">
        <Stat icon={Building2} value={integrador._count.clienteFinais} label="clientes" />
        <Stat icon={Calendar} value={new Date(integrador.createdAt).toLocaleDateString('pt-BR')} label="" small />
      </div>
    </GlassCard>
  )
}

function Stat({ icon: Icon, value, label, small }: { icon: typeof Building2; value: string | number; label: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn('text-slate-500', small ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
      <span className={cn('font-mono', small ? 'text-[10px] text-slate-500' : 'text-xs text-slate-300')}>
        {value} {label}
      </span>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// COCKPIT VIEW
// ────────────────────────────────────────────────────────────────────────────

function CockpitView({
  integradorId, activeTab, onTabChange, onBack,
}: {
  integradorId: string
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  onBack: () => void
}) {
  const { data: overview, error, isLoading, mutate } = useIntegradorOverview(integradorId)

  if (isLoading) {
    return (
      <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-xs">Carregando cockpit...</p>
      </GlassCard>
    )
  }

  if (error || !overview) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400" />
          <div>
            <p className="text-sm font-semibold text-rose-300">Erro ao carregar tenant</p>
            <p className="text-xs text-slate-500 mt-1">{formatApiError(error)}</p>
            <button onClick={onBack} className="mt-3 text-xs text-violet-400 hover:underline">
              Voltar à lista
            </button>
          </div>
        </div>
      </GlassCard>
    )
  }

  const { integrador, kpis, edgeNodes, quota } = overview

  const tabLabel = TABS.find(t => t.id === activeTab)?.label ?? 'Overview'

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-slate-500">
        <button onClick={onBack} className="hover:text-violet-400 transition">Tenants</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-slate-300">{integrador.name}</span>
        <ChevronRight className="w-3 h-3" />
        <span className="text-violet-300">{tabLabel}</span>
      </nav>

      {/* Header */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start gap-4">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-white">{integrador.name}</h1>
              {integrador.active ? (
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Ativo
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  Suspenso
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 font-mono mt-1">{integrador.email}</p>
            {integrador.tradeName && (
              <p className="text-xs text-slate-600 mt-0.5">{integrador.tradeName}</p>
            )}
          </div>
          <button
            onClick={() => mutate()}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
          <KpiCard icon={Building2} value={kpis.clientes} label="Clientes" color="cyan" />
          <KpiCard icon={Users} value={kpis.usuarios} label="Usuários" color="violet" />
          <KpiCard icon={MapPin} value={kpis.sites} label="Sites" color="amber" />
          <KpiCard icon={Video} value={kpis.cameras} label="Câmeras" color="emerald" />
          <KpiCard icon={Puzzle} value={kpis.modules} label="Módulos" color="rose" />
        </div>
      </GlassCard>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition',
              activeTab === tab.id
                ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'overview' && <OverviewTab overview={overview} />}
        {activeTab === 'clients' && <ClientsTab integradorId={integradorId} />}
        {activeTab === 'users' && <UsersTab integradorId={integradorId} />}
        {activeTab === 'boxes' && <BoxesTab integradorId={integradorId} />}
        {activeTab === 'approvals' && <ApprovalsTab integradorId={integradorId} />}
        {activeTab === 'storage' && <StorageTab integradorId={integradorId} />}
        {activeTab === 'logs' && <LogsTab integradorId={integradorId} />}
        {activeTab === 'config' && <ConfigTab integradorId={integradorId} integrador={integrador} onUpdate={() => mutate()} />}
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, value, label, color, sub }: { icon: typeof Building2; value: number; label: string; color: string; sub?: string }) {
  const colorClasses = {
    cyan: 'text-cyan-300 border-cyan-500/20 bg-cyan-500/5',
    violet: 'text-violet-300 border-violet-500/20 bg-violet-500/5',
    amber: 'text-amber-300 border-amber-500/20 bg-amber-500/5',
    emerald: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/5',
    rose: 'text-rose-300 border-rose-500/20 bg-rose-500/5',
  }[color] ?? 'text-slate-300 border-white/10 bg-white/5'

  return (
    <div className={cn('p-3 rounded-lg border', colorClasses)}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-500">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <p className="text-lg font-bold mt-1">{value.toLocaleString('pt-BR')}</p>
      {sub && <p className="text-[9px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB: OVERVIEW
// ────────────────────────────────────────────────────────────────────────────

function OverviewTab({ overview }: { overview: NonNullable<ReturnType<typeof useIntegradorOverview>['data']> }) {
  const { edgeNodes, quota, recentActivity } = overview

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Edge Nodes Status */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          <Server className="w-4 h-4 text-cyan-400" />
          Edge Boxes
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-center">
            <p className="text-2xl font-bold text-white">{edgeNodes.total}</p>
            <p className="text-[10px] text-slate-500 uppercase">Total</p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
            <p className="text-2xl font-bold text-emerald-300">{edgeNodes.online}</p>
            <p className="text-[10px] text-slate-500 uppercase">Online</p>
          </div>
          <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/20 text-center">
            <p className="text-2xl font-bold text-violet-300">{edgeNodes.maxAllowed ?? '∞'}</p>
            <p className="text-[10px] text-slate-500 uppercase">Máx Permitido</p>
          </div>
        </div>
      </GlassCard>

      {/* Quota Usage */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-violet-400" />
          Quota Mensal
        </h3>
        {quota ? (
          <div className="space-y-3">
            <QuotaBar
              label="Static Vision (req/mês)"
              used={quota.staticVisionMonthlyUsed}
              limit={quota.staticVisionMonthlyLimit}
            />
            <QuotaBar
              label="Streaming (min/mês)"
              used={quota.streamingMinutesUsed}
              limit={quota.streamingMinutesLimit}
            />
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-4 text-center">Quota não configurada</p>
        )}
      </GlassCard>

      {/* Recent Activity */}
      <GlassCard className="p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-amber-400" />
          Atividade Recente
        </h3>
        {recentActivity.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">Nenhuma atividade recente</p>
        ) : (
          <div className="space-y-2">
            {recentActivity.map((a, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                  <Activity className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-300">{a.action}</p>
                  <p className="text-[10px] text-slate-500 truncate">{a.target}</p>
                </div>
                <span className="text-[10px] text-slate-600 font-mono shrink-0">
                  {new Date(a.at).toLocaleString('pt-BR')}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB: CLIENTS
// ────────────────────────────────────────────────────────────────────────────

function ClientsTab({ integradorId }: { integradorId: string }) {
  const { data, error, isLoading, mutate } = useIntegradorClients(integradorId)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all'|'active'|'inactive'>('all')

  const filtered = useMemo(() => {
    const list = data?.clients ?? []
    return list.filter(c => {
      if (statusFilter === 'active' && !c.active) return false
      if (statusFilter === 'inactive' && c.active) return false
      if (!search) return true
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    })
  }, [data, search, statusFilter])

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  async function handleToggle(c: any) {
    try {
      // Reusa endpoint PATCH /clientes-finais/:id (precisa importar updateClienteFinal)
      const { updateClienteFinal } = await import('../api/client')
      await updateClienteFinal(c.id, { active: !c.active } as any)
      mutate()
    } catch (e) { alert(formatApiError(e)) }
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-sm font-semibold text-white">Clientes ({data?.total ?? 0})</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white [&>option]:bg-slate-900 [&>option]:text-white">
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar cliente..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white" />
          </div>
          <Link to="/clientes-finais"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold">
            <Plus className="w-3.5 h-3.5" /> Novo cliente
          </Link>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-500 py-8 text-center">Nenhum cliente encontrado</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-slate-500 border-b border-white/5">
              <tr>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-center">Usuários</th>
                <th className="px-3 py-2 text-center">Sites</th>
                <th className="px-3 py-2 text-center">Câmeras</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-medium text-white">{c.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-400 font-mono">{c.email}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-300">{c._count.users}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-300">{c._count.sites}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-300">{c._count.cameras}</td>
                  <td className="px-3 py-2 text-center">
                    {c.active ? (
                      <span className="text-[10px] text-emerald-300">Ativo</span>
                    ) : (
                      <span className="text-[10px] text-slate-500">Inativo</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <Link to={`/clientes-finais?id=${c.id}`} title="Ver detalhe"
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-cyan-300">
                        <ChevronRight className="w-3 h-3" />
                      </Link>
                      <button onClick={() => handleToggle(c)} title={c.active ? 'Suspender' : 'Reativar'}
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-rose-300">
                        {c.active ? <PowerOff className="w-3 h-3" /> : <Power className="w-3 h-3" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB: USERS
// ────────────────────────────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN:        'bg-rose-500/20 text-rose-300 border-rose-500/30',
  INTEGRADOR_ADMIN:   'bg-violet-500/20 text-violet-300 border-violet-500/30',
  INTEGRADOR_TECNICO: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  CLIENTE_ADMIN:      'bg-amber-500/20 text-amber-300 border-amber-500/30',
  CLIENTE_OPERADOR:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  CLIENTE_VIEWER:     'bg-slate-500/20 text-slate-300 border-slate-500/30',
}

function UsersTab({ integradorId }: { integradorId: string }) {
  const { data, error, isLoading, mutate } = useIntegradorUsers(integradorId)
  const { data: clientsData } = useIntegradorClients(integradorId)
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all'|'active'|'inactive'>('all')
  const [editing, setEditing] = useState<typeof data extends { users: infer U } ? U extends Array<infer X> ? X : never : never | null>(null as any)
  const [showInvite, setShowInvite] = useState(false)
  const [tempPassToShow, setTempPassToShow] = useState<{ pass: string; email: string } | null>(null)

  // Deep-link: ?invite=admin abre modal de convite automaticamente
  useEffect(() => {
    if (params.get('invite') === 'admin') setShowInvite(true)
  }, [params])

  const filtered = useMemo(() => {
    const list = data?.users ?? []
    return list.filter(u => {
      if (roleFilter && u.role !== roleFilter) return false
      if (statusFilter === 'active' && !u.active) return false
      if (statusFilter === 'inactive' && u.active) return false
      if (!search) return true
      const q = search.toLowerCase()
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    })
  }, [data, search, roleFilter, statusFilter])

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  async function handleToggle(u: any) {
    try {
      await updateUser(u.id, { active: !u.active })
      mutate()
    } catch (e) { alert(formatApiError(e)) }
  }
  async function handleReset(u: any) {
    if (!confirm(`Resetar senha de ${u.email}?`)) return
    try {
      const r = await resetUserPassword(u.id)
      setTempPassToShow({ pass: r.tempPassword, email: u.email })
    } catch (e) { alert(formatApiError(e)) }
  }
  async function handleDelete(u: any) {
    if (!confirm(`Desativar ${u.email}? (soft-delete, dados preservados)`)) return
    try { await deleteUser(u.id); mutate() } catch (e) { alert(formatApiError(e)) }
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-sm font-semibold text-white">Usuários ({data?.total ?? 0})</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white [&>option]:bg-slate-900 [&>option]:text-white">
            <option value="">Todos roles</option>
            {Object.keys(ROLE_BADGE).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white [&>option]:bg-slate-900 [&>option]:text-white">
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar usuário..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white" />
          </div>
          <button onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold">
            <Plus className="w-3.5 h-3.5" /> Convidar
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-500 py-8 text-center">Nenhum usuário encontrado</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-slate-500 border-b border-white/5">
              <tr>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-center">Último Login</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-medium text-white">{u.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-400 font-mono">{u.email}</td>
                  <td className="px-3 py-2">
                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] border font-mono', ROLE_BADGE[u.role] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30')}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">{u.clienteFinal?.name ?? '-'}</td>
                  <td className="px-3 py-2 text-center text-[10px] text-slate-500 font-mono">
                    {u.lastLogin ? new Date(u.lastLogin).toLocaleString('pt-BR') : '-'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.active ? (
                      <span className="text-[10px] text-emerald-300">Ativo</span>
                    ) : (
                      <span className="text-[10px] text-slate-500">Inativo</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setEditing(u as any)} title="Editar"
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white">
                        <Settings className="w-3 h-3" />
                      </button>
                      <button onClick={() => handleReset(u)} title="Resetar senha"
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-amber-300">
                        <RefreshCw className="w-3 h-3" />
                      </button>
                      <button onClick={() => handleToggle(u)} title={u.active ? 'Suspender' : 'Reativar'}
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-rose-300">
                        {u.active ? <PowerOff className="w-3 h-3" /> : <Power className="w-3 h-3" />}
                      </button>
                      <button onClick={() => handleDelete(u)} title="Desativar"
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-rose-400">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <EditUserModal user={editing as any} onClose={() => setEditing(null as any)} onSaved={() => { setEditing(null as any); mutate() }} />
        )}
        {showInvite && (
          <InviteUserModal
            integradorId={integradorId}
            clients={clientsData?.clients ?? []}
            onClose={() => setShowInvite(false)}
            onSuccess={(pass, email) => { setShowInvite(false); setTempPassToShow({ pass, email }); mutate() }}
          />
        )}
        {tempPassToShow && (
          <TempPasswordModal pass={tempPassToShow.pass} email={tempPassToShow.email} onClose={() => setTempPassToShow(null)} />
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

function EditUserModal({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user.name ?? '')
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState(user.role)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    try { await updateUser(user.id, { name, email, role }); onSaved() }
    catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Editar usuário</h3>
        <Input label="Nome" value={name} onChange={setName} />
        <Input label="Email" value={email} onChange={setEmail} />
        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-slate-900 [&>option]:text-white">
            {Object.keys(ROLE_BADGE).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {err && <p className="text-xs text-rose-300">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={save} disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function InviteUserModal({ integradorId, clients, onClose, onSuccess }: {
  integradorId: string
  clients: { id: string; name: string }[]
  onClose: () => void
  onSuccess: (pass: string, email: string) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'INTEGRADOR_ADMIN'|'INTEGRADOR_TECNICO'|'CLIENTE_ADMIN'|'CLIENTE_OPERADOR'|'CLIENTE_VIEWER'>('INTEGRADOR_TECNICO')
  const [clienteFinalId, setClienteFinalId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isIntegradorRole = role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO'
  const needsClient = !isIntegradorRole

  // Roles disponíveis com label amigável
  const ROLE_OPTIONS = [
    { value: 'INTEGRADOR_ADMIN',    label: 'Integrador Admin (gestor da empresa)',     emoji: '👔' },
    { value: 'INTEGRADOR_TECNICO',  label: 'Integrador Técnico (suporte/instalação)',  emoji: '🔧' },
    { value: 'CLIENTE_ADMIN',       label: 'Cliente Admin (gestor da loja/site)',      emoji: '🏢' },
    { value: 'CLIENTE_OPERADOR',    label: 'Cliente Operador (porteiro, monitor)',     emoji: '👁️' },
    { value: 'CLIENTE_VIEWER',      label: 'Cliente Viewer (somente visualização)',    emoji: '👀' },
  ]

  async function save() {
    setBusy(true); setErr(null)
    try {
      const r = await inviteUser({
        name, email, role,
        ...(needsClient ? { clienteFinalId, integradorId } : { integradorId }),
      } as any)
      onSuccess(r.invitation?.tempPassword ?? '', email)
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Convidar usuário</h3>
        <Input label="Nome *" value={name} onChange={setName} />
        <Input label="Email *" value={email} onChange={setEmail} />
        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Role *</label>
          <select value={role} onChange={e => setRole(e.target.value as any)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-slate-900 [&>option]:text-white">
            {ROLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.emoji} {opt.label}</option>
            ))}
          </select>
        </div>
        {needsClient && (
          <div>
            <label className="text-[10px] uppercase text-slate-500 mb-1 block">Cliente final *</label>
            <select value={clienteFinalId} onChange={e => setClienteFinalId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-slate-900 [&>option]:text-white">
              <option value="">Selecione...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {err && <p className="text-xs text-rose-300">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={save} disabled={busy || !name || !email || (needsClient && !clienteFinalId)}
            className="flex-1 px-3 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Convidar
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function TempPasswordModal({ pass, email, onClose }: { pass: string; email: string; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-space-900 border border-amber-500/30 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Senha temporária gerada</h3>
        </div>
        <p className="text-xs text-slate-500">Para {email} — copie agora, não será exibida novamente.</p>
        <div className="p-3 rounded-lg bg-slate-100 dark:bg-black/40 border border-amber-500/30">
          <code className="text-sm font-mono text-amber-600 dark:text-amber-300 break-all">{pass}</code>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { navigator.clipboard.writeText(pass); }}
            className="flex-1 px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold">
            Copiar senha
          </button>
          <button onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold">
            Fechar
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB: BOXES
// ────────────────────────────────────────────────────────────────────────────

function BoxesTab({ integradorId }: { integradorId: string }) {
  // Refactor: usa o componente compartilhado EdgeBoxesPanel.
  // Mode "cockpit" = sem hero próprio (já tem o do tenant em cima).
  return (
    <EdgeBoxesPanel
      integradorId={integradorId}
      mode="cockpit"
      canProvision
      isSuperAdmin
    />
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB: STORAGE — Dashboard completo com Buckets, Órfãos e Logs
// ────────────────────────────────────────────────────────────────────────────

function StorageTab({ integradorId }: { integradorId: string }) {
  const { data, error, isLoading, mutate } = useIntegradorStorage(integradorId)
  const [activeSubTab, setActiveSubTab] = useState<'buckets' | 'orphans' | 'logs'>('buckets')
  const [drawerClienteId, setDrawerClienteId] = useState<string | null>(null)

  // Orphans state
  const [orphansData, setOrphansData] = useState<any>(null)
  const [orphansLoading, setOrphansLoading] = useState(false)
  const [deletingOrphans, setDeletingOrphans] = useState(false)

  // Logs state
  const [logsData, setLogsData] = useState<any>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsPage, setLogsPage] = useState(1)
  const [logsFilters, setLogsFilters] = useState({ action: '', startDate: '', endDate: '' })

  const loadOrphans = async () => {
    if (orphansLoading) return
    setOrphansLoading(true)
    try {
      const res = await api.get(`/storage/orphans?integradorId=${integradorId}`)
      setOrphansData(res.data)
    } finally {
      setOrphansLoading(false)
    }
  }

  const deleteOrphansAction = async (cameraIds: string[]) => {
    if (!confirm(`Tem certeza que deseja excluir ${cameraIds.length} gravação(ões) órfã(s)? Esta ação não pode ser desfeita.`)) return
    setDeletingOrphans(true)
    try {
      await api.delete('/storage/orphans', { data: { integradorId, cameraIds, confirmDelete: true } })
      setOrphansData(null)
      loadOrphans()
      mutate()
    } finally {
      setDeletingOrphans(false)
    }
  }

  const loadLogs = async (page = 1) => {
    setLogsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20', integradorId })
      if (logsFilters.action) params.set('action', logsFilters.action)
      if (logsFilters.startDate) params.set('startDate', logsFilters.startDate)
      if (logsFilters.endDate) params.set('endDate', logsFilters.endDate)
      const res = await api.get(`/storage/logs?${params.toString()}`)
      setLogsData(res.data)
      setLogsPage(page)
    } finally {
      setLogsLoading(false)
    }
  }

  useEffect(() => {
    if (activeSubTab === 'logs' && !logsData) loadLogs()
  }, [activeSubTab])

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  const totalGB = ((data?.totalBytes ?? 0) / 1024 / 1024 / 1024).toFixed(2)

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Storage Total</p>
          <p className="text-xl font-bold text-cyan-400">{totalGB} GB</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Objetos</p>
          <p className="text-xl font-bold text-white">{(data?.objectCount ?? 0).toLocaleString('pt-BR')}</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Gravações</p>
          <p className="text-xl font-bold text-white">{(data?.recordingCount ?? 0).toLocaleString('pt-BR')}</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Câmeras</p>
          <p className="text-xl font-bold text-white">{data?.totalCameras ?? 0}</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Retenção</p>
          <p className="text-xl font-bold text-white">{data?.retainDays ?? 30}d</p>
        </GlassCard>
      </div>

      {/* R2 Status */}
      {data?.r2Enabled && (
        <GlassCard className={cn('p-3', data.type === 'r2' ? 'border-emerald-500/30' : 'border-amber-500/30')}>
          <div className="flex items-center gap-2">
            <Server className={cn('w-4 h-4', data.type === 'r2' ? 'text-emerald-500' : 'text-amber-500')} />
            <span className="text-xs font-semibold text-slate-300">
              Cloudflare R2: {data.type === 'r2' ? 'Ativo' : 'Disponível'}
            </span>
            {data.r2Endpoint && (
              <span className="text-[10px] text-slate-500 font-mono">{data.r2Endpoint}</span>
            )}
            {data.bucket && (
              <span className="text-[10px] text-slate-500 font-mono ml-auto">Bucket: {data.bucket}</span>
            )}
          </div>
        </GlassCard>
      )}

      {/* Storage warning */}
      {data?.type === 'none' && (
        <GlassCard className="p-3 border-rose-500/30">
          <p className="text-xs text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Storage não configurado. As gravações desta tenant não estão sendo salvas.</span>
          </p>
        </GlassCard>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-white/10">
        {([
          { id: 'buckets' as const, label: 'Buckets', icon: Server },
          { id: 'orphans' as const, label: 'Gravações Órfãs', icon: AlertTriangle },
          { id: 'logs' as const, label: 'Logs de Acesso', icon: History },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition border-b-2 -mb-px',
              activeSubTab === tab.id
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex items-center">
          <button onClick={() => mutate()}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 text-xs font-bold inline-flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3" /> Atualizar
          </button>
        </div>
      </div>

      {/* Sub-tab: Buckets */}
      {activeSubTab === 'buckets' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Database className="w-4 h-4 text-cyan-400" />
              Bucket
            </h3>
            {(data?.buckets ?? []).length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">Sem buckets configurados</p>
            ) : (
              <div className="space-y-2">
                {data?.buckets.map(b => (
                  <div key={b.name} className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-300 font-mono truncate">{b.name}</span>
                      <span className={cn(
                        'px-1.5 py-0.5 text-[9px] rounded font-medium',
                        data?.type === 'r2'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : data?.type === 'custom'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-slate-700 text-slate-400'
                      )}>
                        {(data?.type ?? 'none').toUpperCase()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Tamanho</p>
                        <p className="text-sm font-bold text-white">{formatBytes(b.bytes)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Objetos</p>
                        <p className="text-sm font-bold text-white">{b.objects.toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-violet-400" />
              Por Cliente Final
            </h3>
            {(data?.byClient ?? []).length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">Sem dados por cliente ainda</p>
            ) : (
              <div className="space-y-2">
                {data?.byClient.map(c => {
                  const pct = (data.totalBytes ?? 0) > 0 ? ((c.bytes / data.totalBytes!) * 100) : 0
                  return (
                    <div
                      key={c.clientId}
                      onClick={() => setDrawerClienteId(c.clientId)}
                      className="p-2 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] cursor-pointer transition"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-300 truncate">{c.clientName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white font-bold ml-2">{formatBytes(c.bytes)}</span>
                          <ChevronRight className="w-3 h-3 text-slate-500" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[10px] text-slate-500">{c.cameras} câmera{c.cameras !== 1 ? 's' : ''}</p>
                        <p className="text-[10px] text-slate-500">{pct.toFixed(1)}%</p>
                      </div>
                      <div className="h-1 mt-1 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full bg-violet-500/60" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* Sub-tab: Gravações Órfãs */}
      {activeSubTab === 'orphans' && (
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h3 className="font-semibold text-white">Gravações Órfãs</h3>
            </div>
            <button
              onClick={loadOrphans}
              disabled={orphansLoading}
              className="px-3 py-1.5 text-xs bg-white/10 rounded-lg hover:bg-white/20 transition text-slate-300"
            >
              {orphansLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : orphansData ? (
                <RefreshCw className="w-3 h-3" />
              ) : (
                'Verificar'
              )}
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Gravações de câmeras que foram excluídas ou desativadas. Esses arquivos ocupam espaço mas não são mais acessíveis pelo sistema.
          </p>

          {!orphansData && !orphansLoading && (
            <div className="text-center py-8 text-slate-500 text-sm">
              Clique em "Verificar" para escanear gravações órfãs
            </div>
          )}

          {orphansData && orphansData.orphans.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 py-4">
              <CheckCircle2 className="w-4 h-4" />
              Nenhuma gravação órfã encontrada
            </div>
          )}

          {orphansData && orphansData.orphans.length > 0 && (
            <>
              <div className="bg-amber-500/10 rounded-lg p-3 mb-4">
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div>
                    <p className="text-amber-400 font-bold text-lg">{orphansData.summary.totalOrphans}</p>
                    <p className="text-amber-300 text-[10px]">Órfãos</p>
                  </div>
                  <div>
                    <p className="text-amber-400 font-bold text-lg">{orphansData.summary.deletedCameras}</p>
                    <p className="text-amber-300 text-[10px]">Deletadas</p>
                  </div>
                  <div>
                    <p className="text-amber-400 font-bold text-lg">{orphansData.summary.totalGB} GB</p>
                    <p className="text-amber-300 text-[10px]">Espaço</p>
                  </div>
                  <div>
                    <p className="text-amber-400 font-bold text-lg">{orphansData.summary.totalObjects.toLocaleString()}</p>
                    <p className="text-amber-300 text-[10px]">Arquivos</p>
                  </div>
                </div>
              </div>

              <div className="space-y-1 mb-4">
                {orphansData.orphans.map((o: any) => (
                  <div key={o.cameraId} className="flex items-center justify-between p-2 bg-white/5 rounded-lg text-xs">
                    <div className="flex items-center gap-2">
                      <Camera className={cn('w-4 h-4', o.status === 'deleted' ? 'text-red-500' : 'text-amber-500')} />
                      <div>
                        <p className="font-medium text-white">{o.cameraName || 'Câmera excluída'}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{o.cameraId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] font-medium',
                        o.status === 'deleted'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-amber-500/20 text-amber-400'
                      )}>
                        {o.status === 'deleted' ? 'EXCLUÍDA' : 'INATIVA'}
                      </span>
                      <span className="text-slate-500">{o.objectCount} arquivos</span>
                      <span className="font-mono font-medium text-slate-300">{o.totalGB} GB</span>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => deleteOrphansAction(orphansData.orphans.map((o: any) => o.cameraId))}
                disabled={deletingOrphans}
                className="w-full px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {deletingOrphans ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Excluindo...</>
                ) : (
                  <><Trash2 className="w-3 h-3" /> Excluir todas ({orphansData.summary.totalGB} GB)</>
                )}
              </button>
            </>
          )}
        </GlassCard>
      )}

      {/* Sub-tab: Logs de Acesso */}
      {activeSubTab === 'logs' && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-5 h-5 text-slate-500" />
            <h3 className="font-semibold text-white">Logs de Acesso ao Storage</h3>
          </div>

          {/* Filtros */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <select
              value={logsFilters.action}
              onChange={e => setLogsFilters(f => ({ ...f, action: e.target.value }))}
              className="px-3 py-1.5 text-xs border border-white/10 rounded-lg bg-white/5 text-slate-300"
            >
              <option value="">Todas ações</option>
              <option value="VIEW_DASHBOARD">Dashboard</option>
              <option value="VIEW_BUCKET">Bucket</option>
              <option value="VIEW_CLIENTE">Cliente</option>
              <option value="BROWSE_OBJECTS">Navegação</option>
              <option value="PREVIEW_OBJECT">Preview</option>
              <option value="DOWNLOAD_OBJECT">Download</option>
              <option value="DELETE_OBJECT">Exclusão</option>
              <option value="DELETE_ORPHANS">Excluir Órfãos</option>
            </select>
            <input
              type="date"
              value={logsFilters.startDate}
              onChange={e => setLogsFilters(f => ({ ...f, startDate: e.target.value }))}
              className="px-3 py-1.5 text-xs border border-white/10 rounded-lg bg-white/5 text-slate-300"
              placeholder="Data início"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={logsFilters.endDate}
                onChange={e => setLogsFilters(f => ({ ...f, endDate: e.target.value }))}
                className="flex-1 px-3 py-1.5 text-xs border border-white/10 rounded-lg bg-white/5 text-slate-300"
                placeholder="Data fim"
              />
              <button
                onClick={() => loadLogs(1)}
                disabled={logsLoading}
                className="px-3 py-1.5 bg-cyan-500 text-white rounded-lg text-xs hover:bg-cyan-600 transition"
              >
                {logsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Filtrar'}
              </button>
            </div>
          </div>

          {logsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : logsData?.logs?.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-2 px-2 font-medium text-slate-500">Data</th>
                      <th className="text-left py-2 px-2 font-medium text-slate-500">Usuário</th>
                      <th className="text-left py-2 px-2 font-medium text-slate-500">Ação</th>
                      <th className="text-left py-2 px-2 font-medium text-slate-500">Detalhes</th>
                      <th className="text-right py-2 px-2 font-medium text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {logsData.logs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-white/5">
                        <td className="py-2 px-2 whitespace-nowrap text-slate-400">
                          {new Date(log.createdAt).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-2 px-2">
                          <p className="text-white">{log.actorEmail || log.actorId}</p>
                          <p className="text-[10px] text-slate-500">{log.actorType}</p>
                        </td>
                        <td className="py-2 px-2">
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[9px] font-medium',
                            log.action.includes('DELETE') ? 'bg-red-500/20 text-red-400' :
                            log.action.includes('VIEW') ? 'bg-blue-500/20 text-blue-400' :
                            'bg-slate-700 text-slate-300'
                          )}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-slate-500">
                          {log.objectKey ? (
                            <span className="font-mono text-[10px]">{log.objectKey.slice(0, 30)}...</span>
                          ) : log.cameraId ? (
                            <span className="font-mono text-[10px]">cam: {log.cameraId.slice(0, 8)}...</span>
                          ) : log.bytesAffected ? (
                            <span>{(log.bytesAffected / 1024 / 1024 / 1024).toFixed(2)} GB</span>
                          ) : '—'}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {log.success ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-red-500 inline" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {logsData.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
                  <p className="text-xs text-slate-500">
                    Página {logsData.pagination.page} de {logsData.pagination.totalPages} ({logsData.pagination.total} registros)
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => loadLogs(logsPage - 1)}
                      disabled={logsPage <= 1 || logsLoading}
                      className="px-3 py-1 text-xs bg-white/10 rounded disabled:opacity-50 text-slate-300"
                    >
                      Anterior
                    </button>
                    <button
                      onClick={() => loadLogs(logsPage + 1)}
                      disabled={logsPage >= logsData.pagination.totalPages || logsLoading}
                      className="px-3 py-1 text-xs bg-white/10 rounded disabled:opacity-50 text-slate-300"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-slate-500 text-sm">
              Nenhum log encontrado
            </div>
          )}
        </GlassCard>
      )}

      {/* Drawer Cliente Final */}
      <AnimatePresence>
        {drawerClienteId && (
          <StorageClienteDrawerCockpit
            clienteFinalId={drawerClienteId}
            onClose={() => setDrawerClienteId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function StorageClienteDrawerCockpit({ clienteFinalId, onClose }: { clienteFinalId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'cameras' | 'browser'>('cameras')
  const [browserPath, setBrowserPath] = useState('')
  const [browserData, setBrowserData] = useState<any>(null)
  const [browserLoading, setBrowserLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<'image' | 'video' | null>(null)

  useEffect(() => {
    api.get(`/storage/cliente/${clienteFinalId}`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [clienteFinalId])

  useEffect(() => {
    if (tab === 'browser') loadBrowser(browserPath)
  }, [tab, browserPath, clienteFinalId])

  async function loadBrowser(path: string) {
    setBrowserLoading(true)
    try {
      const res = await api.get(`/storage/cliente/${clienteFinalId}/browse`, { params: { path } })
      setBrowserData(res.data)
    } finally {
      setBrowserLoading(false)
    }
  }

  async function handlePreview(item: any) {
    if (item.mediaType === 'other') return
    try {
      const res = await api.get('/storage/preview', { params: { key: item.key, clienteFinalId } })
      setPreviewUrl(res.data.url)
      setPreviewType(item.mediaType)
    } catch (err) { console.error('Preview error:', err) }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-slate-900 shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-4 border-b border-white/10 flex items-center gap-3">
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded">
            <X className="w-5 h-5 text-slate-500" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white truncate">
              {data?.clienteFinal?.name || 'Carregando...'}
            </h2>
            <p className="text-[10px] text-slate-500">{data?.integrador?.name}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-white/10">
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-cyan-400">{data.storage.totalGB}</p>
                  <p className="text-[10px] text-slate-500">GB Usado</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{data.summary.totalCameras}</p>
                  <p className="text-[10px] text-slate-500">Câmeras</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-emerald-400">{data.summary.activeCameras}</p>
                  <p className="text-[10px] text-slate-500">Online</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{data.storage.retainDays}d</p>
                  <p className="text-[10px] text-slate-500">Retenção</p>
                </div>
              </div>
            </div>

            <div className="flex border-b border-white/10">
              <button
                onClick={() => setTab('cameras')}
                className={cn(
                  'flex-1 py-2 text-xs font-semibold transition',
                  tab === 'cameras' ? 'text-cyan-400 border-b-2 border-cyan-500' : 'text-slate-500 hover:text-slate-300'
                )}
              >
                <Camera className="w-4 h-4 inline mr-1" /> Câmeras
              </button>
              <button
                onClick={() => setTab('browser')}
                className={cn(
                  'flex-1 py-2 text-xs font-semibold transition',
                  tab === 'browser' ? 'text-cyan-400 border-b-2 border-cyan-500' : 'text-slate-500 hover:text-slate-300'
                )}
              >
                <Folder className="w-4 h-4 inline mr-1" /> Object Browser
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {tab === 'cameras' && (
                <div className="grid grid-cols-2 gap-3">
                  {data.cameras.map((cam: any) => (
                    <div key={cam.id} className="border border-white/10 rounded-lg overflow-hidden">
                      <div className="aspect-video bg-slate-800 relative">
                        {cam.lastSnapshotUrl ? (
                          <img src={cam.lastSnapshotUrl} alt={cam.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="w-8 h-8 text-slate-600" />
                          </div>
                        )}
                        <div className={cn(
                          'absolute top-2 right-2 px-1.5 py-0.5 text-[9px] rounded font-medium',
                          cam.status === 'ONLINE' ? 'bg-emerald-500 text-white' : 'bg-slate-500 text-white'
                        )}>
                          {cam.status}
                        </div>
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-semibold text-white truncate">{cam.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{cam.siteName}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[10px] text-slate-400">{cam.retainDays}d retenção</span>
                          {cam.recordEnabled && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-rose-500/20 text-rose-400">REC</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.cameras.length === 0 && (
                    <div className="col-span-2 text-center py-8 text-slate-500 text-sm">
                      Nenhuma câmera cadastrada
                    </div>
                  )}
                </div>
              )}

              {tab === 'browser' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-1 text-xs">
                    <button onClick={() => setBrowserPath('')} className="text-cyan-400 hover:underline">/</button>
                    {browserData?.breadcrumbs?.map((crumb: any, i: number) => (
                      <span key={crumb.path} className="flex items-center gap-1">
                        <span className="text-slate-400">/</span>
                        <button
                          onClick={() => setBrowserPath(crumb.path)}
                          className={cn(
                            i === browserData.breadcrumbs.length - 1 ? 'text-slate-300' : 'text-cyan-400 hover:underline'
                          )}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </div>

                  {browserLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
                    </div>
                  ) : (
                    <div className="border border-white/10 rounded-lg divide-y divide-white/5">
                      {browserPath && (
                        <div
                          onClick={() => {
                            const parts = browserPath.split('/').filter(Boolean)
                            parts.pop()
                            setBrowserPath(parts.length ? parts.join('/') + '/' : '')
                          }}
                          className="p-2 flex items-center gap-2 hover:bg-white/5 cursor-pointer"
                        >
                          <ArrowLeft className="w-4 h-4 text-slate-400" />
                          <span className="text-xs text-slate-500">..</span>
                        </div>
                      )}
                      {browserData?.items?.map((item: any) => (
                        <div
                          key={item.key}
                          onClick={() => {
                            if (item.type === 'folder') setBrowserPath(item.path)
                            else if (item.mediaType !== 'other') handlePreview(item)
                          }}
                          className={cn(
                            'p-2 flex items-center gap-2 transition',
                            (item.type === 'folder' || item.mediaType !== 'other')
                              ? 'hover:bg-white/5 cursor-pointer' : ''
                          )}
                        >
                          {item.type === 'folder' ? (
                            <Folder className="w-4 h-4 text-amber-500" />
                          ) : item.mediaType === 'image' ? (
                            <Image className="w-4 h-4 text-cyan-500" />
                          ) : item.mediaType === 'video' ? (
                            <Video className="w-4 h-4 text-purple-500" />
                          ) : (
                            <File className="w-4 h-4 text-slate-400" />
                          )}
                          <span className="flex-1 text-xs text-slate-300 truncate">{item.name}</span>
                          {item.type === 'file' && (
                            <span className="text-[10px] text-slate-400 font-mono">{item.sizeFormatted}</span>
                          )}
                        </div>
                      ))}
                      {browserData?.items?.length === 0 && (
                        <div className="p-8 text-center text-slate-500 text-sm">Pasta vazia</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => { setPreviewUrl(null); setPreviewType(null) }}
        >
          <button className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20">
            <X className="w-6 h-6 text-white" />
          </button>
          {previewType === 'image' && <img src={previewUrl} alt="Preview" className="max-w-full max-h-full object-contain" />}
          {previewType === 'video' && <video src={previewUrl} controls autoPlay className="max-w-full max-h-full" />}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB: LOGS — usa LogsCenter compartilhado (mental model 5W1H)
// ────────────────────────────────────────────────────────────────────────────

function LogsTab({ integradorId }: { integradorId: string }) {
  // Passa scopeIntegradorId para o explorer filtrar AuditLog +
  // EdgeConnectionLog do tenant aberto (ver `LogsCenter` + /audit/explorer).
  return <LogsCenter mode="cockpit" scopeIntegradorId={integradorId} />
}

// ────────────────────────────────────────────────────────────────────────────
// TAB: APPROVALS — Aprovação de licenças Edge (Sprint R7)
// ────────────────────────────────────────────────────────────────────────────

function ApprovalsTab({ integradorId }: { integradorId: string }) {
  const { data, error, isLoading, mutate } = usePendingEdgeApprovals()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectModal, setRejectModal] = useState<any | null>(null)

  // Filtra somente requests deste integrador
  const items = useMemo(() => {
    return (data?.items ?? []).filter((it: any) => {
      const p = it.payloadJson ?? {}
      return p.integradorId === integradorId
    })
  }, [data, integradorId])

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  async function approve(it: any) {
    setBusyId(it.id)
    try { await approveRequest(it.id); mutate() }
    catch (e) { alert(formatApiError(e)) }
    finally { setBusyId(null) }
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-400" />
          Solicitações pendentes ({items.length})
        </h3>
        <p className="text-xs text-slate-500">Apenas SUPER_ADMIN aprova ou rejeita</p>
      </div>
      {items.length === 0 ? (
        <div className="py-12 text-center">
          <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500/40 mb-3" />
          <p className="text-xs text-slate-500">Nenhuma solicitação pendente</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it: any) => {
            const p = it.payloadJson ?? {}
            return (
              <div key={it.id} className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white">{p.name ?? 'Edge Node'}</p>
                    <p className="text-[10px] text-slate-500 font-mono">S/N: {p.serialNumber}</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      <Building2 className="w-3 h-3 inline mr-1" />
                      {p.clienteFinalName ?? '-'}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      <MapPin className="w-3 h-3 inline mr-1" />
                      Site: {p.siteName ?? p.siteId}
                    </p>
                    {it.reason && (
                      <p className="text-[10px] text-slate-500 mt-2 italic">{it.reason}</p>
                    )}
                    <p className="text-[9px] text-slate-600 mt-2 font-mono">
                      Solicitado: {new Date(it.createdAt).toLocaleString('pt-BR')} · expira em {Math.ceil((new Date(it.expiresAt).getTime() - Date.now()) / 86400000)}d
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button onClick={() => approve(it)} disabled={busyId === it.id}
                      className="px-3 py-1.5 rounded text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-50 flex items-center gap-1">
                      {busyId === it.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                      Aprovar
                    </button>
                    <button onClick={() => setRejectModal(it)}
                      className="px-3 py-1.5 rounded text-xs bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 font-bold">
                      Rejeitar
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {rejectModal && (
          <RejectApprovalModal
            request={rejectModal}
            onClose={() => setRejectModal(null)}
            onDone={() => { setRejectModal(null); mutate() }}
          />
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

function RejectApprovalModal({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (reason.length < 5) { setErr('Motivo precisa de pelo menos 5 caracteres'); return }
    setBusy(true); setErr(null)
    try { await rejectRequest(request.id, reason); onDone() }
    catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-space-900 border border-rose-500/30 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Rejeitar solicitação</h3>
        <p className="text-xs text-slate-500">
          {request.payloadJson?.name} ({request.payloadJson?.serialNumber}) — esta ação não pode ser desfeita.
        </p>
        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Motivo *</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Ex: Quota excedida, hardware não homologado, falta de documentação..."
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-900 dark:text-white h-24 resize-none" />
        </div>
        {err && <p className="text-xs text-rose-300">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={submit} disabled={busy || reason.length < 5}
            className="flex-1 px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Rejeitar
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ConfigTab({
  integradorId,
  integrador,
  onUpdate,
}: {
  integradorId: string
  integrador: any
  onUpdate: () => void
}) {
  const { data: modulesData, error: modulesErr, isLoading: modulesLoading } = useIntegradorModulesInfo(integradorId)
  const { data: quotaData } = useIntegradorQuota(integradorId)
  const [suspending, setSuspending] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')
  const [showSuspendModal, setShowSuspendModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showQuotaModal, setShowQuotaModal] = useState(false)

  async function handleToggleSuspend() {
    setSuspending(true)
    try {
      await suspendIntegrador(integradorId, integrador.active, suspendReason)
      onUpdate()
      setShowSuspendModal(false)
      setSuspendReason('')
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setSuspending(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Dados do Integrador */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          <Building2 className="w-4 h-4 text-cyan-400" />
          Cadastro
        </h3>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-slate-500">Nome</span><span className="text-slate-200 truncate ml-2">{integrador.name}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Razão social</span><span className="text-slate-200 truncate ml-2">{integrador.tradeName ?? '-'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">CNPJ</span><span className="text-slate-200 font-mono ml-2">{integrador.cnpj ?? '-'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Email</span><span className="text-slate-200 font-mono truncate ml-2">{integrador.email ?? '-'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Telefone</span><span className="text-slate-200 ml-2">{integrador.phone ?? '-'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Website</span><span className="text-slate-200 truncate ml-2">{integrador.website ?? '-'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">GCP Project</span><span className="text-slate-200 font-mono truncate ml-2">{integrador.gcpProjectId ?? '-'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Billing</span><span className="text-slate-200 ml-2">{integrador.billingCycle ?? 'MONTHLY'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Max Edge Boxes</span><span className="text-slate-200 ml-2">{integrador.maxEdgeNodes ?? '∞'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Retenção</span><span className="text-slate-200 ml-2">{integrador.storageRetainDays ?? 30}d</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Criado em</span><span className="text-slate-200 ml-2">{integrador.createdAt ? new Date(integrador.createdAt).toLocaleDateString('pt-BR') : '-'}</span></div>
        </div>
        <button onClick={() => setShowEditModal(true)}
          className="mt-3 w-full px-3 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-300 text-xs font-bold">
          Editar cadastro completo
        </button>
      </GlassCard>

      {/* Quotas */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-amber-400" />
          Quotas e limites
        </h3>
        {quotaData?.quota ? (
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Static Vision</span>
              <span className="text-slate-200 font-mono">
                {quotaData.quota.staticVisionMonthlyUsed.toLocaleString()} / {quotaData.quota.staticVisionMonthlyLimit.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Streaming (min)</span>
              <span className="text-slate-200 font-mono">
                {quotaData.quota.streamingMinutesUsed.toLocaleString()} / {quotaData.quota.streamingMinutesLimit.toLocaleString()}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Quota não configurada</p>
        )}
        <button onClick={() => setShowQuotaModal(true)}
          className="mt-3 w-full px-3 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-bold">
          Ajustar quotas
        </button>
      </GlassCard>

      {/* Modules */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          <Puzzle className="w-4 h-4 text-violet-400" />
          Módulos Habilitados
        </h3>
        {modulesLoading ? (
          <LoadingState />
        ) : modulesErr ? (
          <ErrorState error={modulesErr} />
        ) : (
          <div className="space-y-2">
            {(modulesData?.modules ?? []).length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">Nenhum módulo habilitado</p>
            ) : (
              modulesData?.modules.map(m => (
                <div key={m.module} className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-xs text-slate-300 font-mono">{m.module}</span>
                  <span className={cn(
                    'text-[10px]',
                    m.enabled ? 'text-emerald-300' : 'text-slate-500'
                  )}>
                    {m.enabled ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        <Link
          to="/admin/modulos"
          className="mt-3 block text-xs text-violet-400 hover:underline"
        >
          Gerenciar módulos
        </Link>
      </GlassCard>

      {/* Suspend/Activate */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          {integrador.active ? (
            <>
              <PowerOff className="w-4 h-4 text-rose-400" />
              Suspender Tenant
            </>
          ) : (
            <>
              <Power className="w-4 h-4 text-emerald-400" />
              Reativar Tenant
            </>
          )}
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          {integrador.active
            ? 'Suspender bloqueia acesso de todos os usuários deste integrador.'
            : 'Reativar restaura o acesso de todos os usuários deste integrador.'}
        </p>
        <button
          onClick={() => setShowSuspendModal(true)}
          className={cn(
            'w-full px-4 py-2 rounded-lg text-sm font-medium transition',
            integrador.active
              ? 'bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300'
          )}
        >
          {integrador.active ? 'Suspender integrador' : 'Reativar integrador'}
        </button>
      </GlassCard>

      <AnimatePresence>
        {showEditModal && (
          <EditIntegradorModal
            integrador={integrador}
            onClose={() => setShowEditModal(false)}
            onSaved={() => { setShowEditModal(false); onUpdate() }}
          />
        )}
        {showQuotaModal && (
          <QuotaIntegradorModal
            integradorId={integradorId}
            current={quotaData?.quota}
            onClose={() => setShowQuotaModal(false)}
            onSaved={() => { setShowQuotaModal(false); onUpdate() }}
          />
        )}
        {showSuspendModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowSuspendModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md bg-space-900 border border-white/10 rounded-xl p-5 space-y-4"
            >
              <h3 className="text-sm font-bold text-white">
                {integrador.active ? 'Suspender' : 'Reativar'} {integrador.name}?
              </h3>
              {integrador.active && (
                <div>
                  <label className="text-[10px] uppercase text-slate-500 mb-1 block">Motivo (opcional)</label>
                  <textarea
                    value={suspendReason}
                    onChange={e => setSuspendReason(e.target.value)}
                    placeholder="Ex: Inadimplência, solicitação do cliente..."
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-slate-600 resize-none h-20"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSuspendModal(false)}
                  className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleToggleSuspend}
                  disabled={suspending}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2',
                    integrador.active
                      ? 'bg-rose-500 hover:bg-rose-600 text-white'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  )}
                >
                  {suspending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirmar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <GlassCard className="p-4">
      <div className="space-y-3">
        <div className="h-4 w-1/3 bg-white/5 rounded animate-pulse" />
        <div className="h-3 w-2/3 bg-white/5 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[0,1,2].map(i => <div key={i} className="h-16 bg-white/5 rounded animate-pulse" />)}
        </div>
        <div className="space-y-2 mt-4">
          {[0,1,2,3].map(i => <div key={i} className="h-8 bg-white/5 rounded animate-pulse" style={{ animationDelay: `${i*100}ms` }} />)}
        </div>
      </div>
    </GlassCard>
  )
}

function ErrorState({ error }: { error: unknown }) {
  return (
    <GlassCard className="p-6 border-rose-500/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-400" />
        <p className="text-xs text-rose-300">{formatApiError(error)}</p>
      </div>
    </GlassCard>
  )
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const safeLimit = Math.max(1, limit)
  const pct = Math.min(100, (used / safeLimit) * 100)
  const color = pct > 90 ? 'rose' : pct > 70 ? 'amber' : 'emerald'
  const colorClass = {
    rose: 'bg-rose-500',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
  }[color]

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300 font-mono">
          {used.toLocaleString('pt-BR')} / {limit.toLocaleString('pt-BR')}
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className={cn('h-full transition-all', colorClass)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-slate-500 mt-0.5">{Math.round(pct)}% utilizado</p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// CREATE MODAL (reused from old page)
// ────────────────────────────────────────────────────────────────────────────

function CreateIntegradorModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<CreateIntegradorPayload>({
    name: '',
    email: '',
    password: '',
    staticVisionMonthlyLimit: 50_000,
    streamingMinutesLimit: 6_000,
  })
  const [showPwd, setShowPwd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function update<K extends keyof CreateIntegradorPayload>(key: K, value: CreateIntegradorPayload[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await createIntegrador(form)
      onSuccess()
    } catch (e) {
      setErr(formatApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-2xl space-y-4"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Novo Tenant</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Cria conta com role <code className="text-violet-300">INTEGRADOR_ADMIN</code> + quota inicial.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="space-y-3">
          <Input label="Nome da empresa *" value={form.name} onChange={v => update('name', v)} />
          <Input label="Razão social" value={form.tradeName ?? ''} onChange={v => update('tradeName', v)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="CNPJ" value={form.cnpj ?? ''} onChange={v => update('cnpj', v)} placeholder="00.000.000/0001-00" />
            <Input label="Telefone" value={form.phone ?? ''} onChange={v => update('phone', v)} />
          </div>

          <div className="pt-2 border-t border-white/5 space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
              <Mail className="w-3 h-3" />
              Credenciais do admin
            </p>
            <Input label="Email *" type="email" value={form.email} onChange={v => update('email', v)} />
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Senha * (mín. 8)</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => update('password', e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-3 py-2 pr-10 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-violet-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-white/5 space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-cyan-300">Quota inicial mensal</p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Static Vision (req/mês)"
                type="number"
                value={String(form.staticVisionMonthlyLimit ?? 50_000)}
                onChange={v => update('staticVisionMonthlyLimit', Math.max(1, Number(v) || 0))}
              />
              <Input
                label="Streaming (min/mês)"
                type="number"
                value={String(form.streamingMinutesLimit ?? 6_000)}
                onChange={v => update('streamingMinutesLimit', Math.max(1, Number(v) || 0))}
              />
            </div>
            <Input
              label="GCP Project ID (opcional)"
              value={form.gcpProjectId ?? ''}
              onChange={v => update('gcpProjectId', v)}
              placeholder="meu-projeto-gcp"
            />
          </div>
        </div>

        {err && (
          <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-300">
            {err}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 hover:text-white text-xs"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !form.name || !form.email || !form.password || form.password.length < 8}
            className="flex-1 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Criar
          </button>
        </div>
      </motion.form>
    </motion.div>
  )
}

function Input({
  label, value, onChange, type = 'text', placeholder,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50"
      />
    </div>
  )
}

function EditIntegradorModal({ integrador, onClose, onSaved }: {
  integrador: any
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: integrador.name ?? '',
    tradeName: integrador.tradeName ?? '',
    cnpj: integrador.cnpj ?? '',
    email: integrador.email ?? '',
    phone: integrador.phone ?? '',
    website: integrador.website ?? '',
    logoUrl: integrador.logoUrl ?? '',
    gcpProjectId: integrador.gcpProjectId ?? '',
    billingCycle: integrador.billingCycle ?? 'MONTHLY',
    storageRetainDays: String(integrador.storageRetainDays ?? 30),
    maxEdgeNodes: integrador.maxEdgeNodes != null ? String(integrador.maxEdgeNodes) : '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    setBusy(true); setErr(null)
    try {
      await updateIntegrador(integrador.id, {
        name: form.name,
        tradeName: form.tradeName || null,
        cnpj: form.cnpj || null,
        email: form.email,
        phone: form.phone || null,
        website: form.website || null,
        logoUrl: form.logoUrl || null,
        gcpProjectId: form.gcpProjectId || null,
        billingCycle: form.billingCycle as any,
        storageRetainDays: Number(form.storageRetainDays) || 30,
        maxEdgeNodes: form.maxEdgeNodes === '' ? null : Number(form.maxEdgeNodes),
      })
      onSaved()
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Cadastro do Integrador</h3>

        <p className="text-[10px] uppercase tracking-wider text-cyan-300">Identificação</p>
        <Input label="Nome *" value={form.name} onChange={v => set('name', v)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Razão social" value={form.tradeName} onChange={v => set('tradeName', v)} />
          <Input label="CNPJ" value={form.cnpj} onChange={v => set('cnpj', v)} placeholder="00.000.000/0001-00" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email *" value={form.email} onChange={v => set('email', v)} />
          <Input label="Telefone" value={form.phone} onChange={v => set('phone', v)} />
        </div>
        <Input label="Website" value={form.website} onChange={v => set('website', v)} placeholder="https://..." />

        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Logo do Integrador (white-label)</label>
          <LogoUploader
            currentUrl={form.logoUrl || null}
            uploadUrl={`/admin/integradores/${integrador.id}/logo`}
            deleteUrl={`/admin/integradores/${integrador.id}/logo`}
            hint="Aparece no painel deste integrador e nos sub-clientes que não tenham logo próprio."
            onUploaded={url => set('logoUrl', url)}
            onDeleted={() => set('logoUrl', '')}
          />
        </div>

        <p className="text-[10px] uppercase tracking-wider text-violet-300 mt-4">Operacional</p>
        <Input label="GCP Project ID" value={form.gcpProjectId} onChange={v => set('gcpProjectId', v)} placeholder="meu-projeto-gcp" />
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] uppercase text-slate-500 mb-1 block">Ciclo billing</label>
            <select value={form.billingCycle} onChange={e => set('billingCycle', e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-slate-900 [&>option]:text-white">
              <option value="MONTHLY">Mensal</option>
              <option value="QUARTERLY">Trimestral</option>
              <option value="YEARLY">Anual</option>
            </select>
          </div>
          <Input label="Max Edge Boxes" type="number" value={form.maxEdgeNodes} onChange={v => set('maxEdgeNodes', v)} placeholder="vazio = ∞" />
          <Input label="Retenção (dias)" type="number" value={form.storageRetainDays} onChange={v => set('storageRetainDays', v)} />
        </div>

        {err && <p className="text-xs text-rose-300">{err}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={save} disabled={busy || !form.name || !form.email}
            className="flex-1 px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function QuotaIntegradorModal({ integradorId, current, onClose, onSaved }: {
  integradorId: string
  current: any
  onClose: () => void
  onSaved: () => void
}) {
  const [staticLimit, setStaticLimit] = useState(String(current?.staticVisionMonthlyLimit ?? 50000))
  const [streamLimit, setStreamLimit] = useState(String(current?.streamingMinutesLimit ?? 6000))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    try {
      await updateIntegrador(integradorId, {
        staticVisionMonthlyLimit: Number(staticLimit),
        streamingMinutesLimit: Number(streamLimit),
      })
      onSaved()
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-space-900 border border-amber-500/30 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Ajustar quotas mensais</h3>
        <p className="text-xs text-slate-500">Limites do ciclo atual. Resetam mensalmente.</p>
        <Input label="Static Vision (req/mês)" type="number" value={staticLimit} onChange={setStaticLimit} />
        <Input label="Streaming (min/mês)" type="number" value={streamLimit} onChange={setStreamLimit} />
        {err && <p className="text-xs text-rose-300">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={save} disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
