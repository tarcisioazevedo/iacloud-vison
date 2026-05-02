/**
 * TenantCockpitPage — Cockpit de gestão de integradores para SuperAdmin
 *
 * Tabs: Overview | Clientes | Usuários | Boxes | Storage | Logs | Config
 */
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Building2, Plus, Search, Eye, EyeOff, Loader2, AlertTriangle, CheckCircle2,
  X, Mail, Users, Activity, Puzzle, ArrowLeft, BarChart3, HardDrive,
  Server, FileText, Settings, Power, PowerOff, RefreshCw, ChevronRight,
  Calendar, Clock, Shield, Cpu, Database, User, MapPin, Video,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useIntegradores, useIntegradorOverview, useIntegradorClients, useIntegradorUsers,
  useIntegradorBoxes, useIntegradorStorage, useIntegradorLogs, useIntegradorModulesInfo,
  createIntegrador, suspendIntegrador, formatApiError,
  type CreateIntegradorPayload, type IntegradorRow,
} from '../api/client'
import { cn } from '../lib/utils'

type TabId = 'overview' | 'clients' | 'users' | 'boxes' | 'storage' | 'logs' | 'config'

const TABS: { id: TabId; label: string; icon: typeof BarChart3 }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'clients',  label: 'Clientes', icon: Building2 },
  { id: 'users',    label: 'Usuários', icon: Users },
  { id: 'boxes',    label: 'Edge Boxes', icon: Server },
  { id: 'storage',  label: 'Storage', icon: HardDrive },
  { id: 'logs',     label: 'Logs', icon: FileText },
  { id: 'config',   label: 'Config', icon: Settings },
]

export function TenantCockpitPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  if (id) {
    return (
      <CockpitView
        integradorId={id}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onBack={() => navigate('/admin/tenants')}
      />
    )
  }

  return <IntegradoresListView onSelect={id => navigate(`/admin/tenants/${id}`)} />
}

function IntegradoresListView({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, error, isLoading, mutate } = useIntegradores()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const filtered = useMemo(() => {
    const list = data?.integradores ?? []
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(i => i.name.toLowerCase().includes(q) || i.email.toLowerCase().includes(q))
  }, [data, search])

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
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
                Gerencie integradores, seus clientes, usuários, edge boxes, storage e módulos em um único cockpit.
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
      </GlassCard>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou email..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <span className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400 font-mono">
          {filtered.length} tenant{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

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

      {isLoading && !data && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando tenants...</p>
        </GlassCard>
      )}

      {data && filtered.length === 0 && !search && (
        <GlassCard className="p-12 text-center">
          <Building2 className="w-12 h-12 mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum tenant cadastrado.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-200 text-xs font-bold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Cadastrar o primeiro
          </button>
        </GlassCard>
      )}

      {filtered.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(i => (
            <TenantCard key={i.id} integrador={i} onSelect={() => onSelect(i.id)} />
          ))}
        </div>
      )}

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

  return (
    <div className="space-y-4">
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
        {activeTab === 'storage' && <StorageTab integradorId={integradorId} />}
        {activeTab === 'logs' && <LogsTab integradorId={integradorId} />}
        {activeTab === 'config' && <ConfigTab integradorId={integradorId} integrador={integrador} onUpdate={() => mutate()} />}
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, value, label, color }: { icon: typeof Building2; value: number; label: string; color: string }) {
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
  const { data, error, isLoading } = useIntegradorClients(integradorId)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const list = data?.clients ?? []
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
  }, [data, search])

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-white">Clientes ({data?.total ?? 0})</h3>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
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

function UsersTab({ integradorId }: { integradorId: string }) {
  const { data, error, isLoading } = useIntegradorUsers(integradorId)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const list = data?.users ?? []
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [data, search])

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-white">Usuários ({data?.total ?? 0})</h3>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar usuário..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
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
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-medium text-white">{u.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-400 font-mono">{u.email}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono">
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
// TAB: BOXES
// ────────────────────────────────────────────────────────────────────────────

function BoxesTab({ integradorId }: { integradorId: string }) {
  const { data, error, isLoading } = useIntegradorBoxes(integradorId)

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  const boxes = data?.boxes ?? []

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-white">
          Edge Boxes ({data?.total ?? 0})
          <span className="ml-2 text-xs text-violet-300 font-normal">
            {data?.licensed ?? 0} licenciadas
          </span>
        </h3>
      </div>
      {boxes.length === 0 ? (
        <p className="text-xs text-slate-500 py-8 text-center">Nenhuma edge box registrada</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boxes.map(box => (
            <div
              key={box.id}
              className="p-3 rounded-lg bg-white/[0.02] border border-white/10 hover:border-white/20 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center',
                    box.status === 'ONLINE' ? 'bg-emerald-500/20' : 'bg-slate-500/20'
                  )}>
                    <Cpu className={cn(
                      'w-4 h-4',
                      box.status === 'ONLINE' ? 'text-emerald-400' : 'text-slate-500'
                    )} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{box.name}</p>
                    <p className="text-[10px] text-slate-500 font-mono">{box.serialNumber ?? 'N/A'}</p>
                  </div>
                </div>
                {box.licenseKey && (
                  <span title="Licenciada"><Shield className="w-4 h-4 text-violet-400" /></span>
                )}
              </div>
              <div className="mt-3 pt-2 border-t border-white/5 space-y-1">
                {box.site && (
                  <p className="text-[10px] text-slate-400">
                    <MapPin className="w-3 h-3 inline mr-1" />
                    {box.site.name}
                  </p>
                )}
                {box.clienteFinal && (
                  <p className="text-[10px] text-slate-400">
                    <Building2 className="w-3 h-3 inline mr-1" />
                    {box.clienteFinal.name}
                  </p>
                )}
                {box.licenseExpiresAt && (
                  <p className="text-[10px] text-slate-500">
                    Licença até: {new Date(box.licenseExpiresAt).toLocaleDateString('pt-BR')}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB: STORAGE
// ────────────────────────────────────────────────────────────────────────────

function StorageTab({ integradorId }: { integradorId: string }) {
  const { data, error, isLoading } = useIntegradorStorage(integradorId)

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/20 flex items-center justify-center">
            <Database className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <p className="text-[10px] uppercase text-slate-500">Storage Total</p>
            <p className="text-2xl font-bold text-white">{formatBytes(data?.totalBytes ?? 0)}</p>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Buckets */}
        <GlassCard className="p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Por Bucket</h3>
          {(data?.buckets ?? []).length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">Sem dados de buckets</p>
          ) : (
            <div className="space-y-2">
              {data?.buckets.map(b => (
                <div key={b.name} className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-xs text-slate-300 font-mono">{b.name}</span>
                  <div className="text-right">
                    <span className="text-xs text-white">{formatBytes(b.bytes)}</span>
                    <span className="text-[10px] text-slate-500 ml-2">{b.objects.toLocaleString()} obj</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* By Client */}
        <GlassCard className="p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Por Cliente</h3>
          {(data?.byClient ?? []).length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">Sem dados por cliente</p>
          ) : (
            <div className="space-y-2">
              {data?.byClient.map(c => (
                <div key={c.clientId} className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-xs text-slate-300">{c.clientName}</span>
                  <span className="text-xs text-white">{formatBytes(c.bytes)}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB: LOGS
// ────────────────────────────────────────────────────────────────────────────

function LogsTab({ integradorId }: { integradorId: string }) {
  const [page, setPage] = useState(1)
  const { data, error, isLoading } = useIntegradorLogs(integradorId, { page, limit: 20 })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  const logs = data?.logs ?? []

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-white">Logs de Auditoria ({data?.total ?? 0})</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-slate-400 disabled:opacity-30"
          >
            Anterior
          </button>
          <span className="text-xs text-slate-500">
            Página {data?.page ?? 1} de {data?.pages ?? 1}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= (data?.pages ?? 1)}
            className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-slate-400 disabled:opacity-30"
          >
            Próxima
          </button>
        </div>
      </div>
      {logs.length === 0 ? (
        <p className="text-xs text-slate-500 py-8 text-center">Nenhum log encontrado</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-slate-500 border-b border-white/5">
              <tr>
                <th className="px-3 py-2 text-left">Ação</th>
                <th className="px-3 py-2 text-left">Alvo</th>
                <th className="px-3 py-2 text-left">Usuário</th>
                <th className="px-3 py-2 text-right">Data</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                      {l.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {l.targetType}:{l.targetId.slice(0, 8)}...
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-300">{l.userName}</td>
                  <td className="px-3 py-2 text-right text-[10px] text-slate-500 font-mono">
                    {new Date(l.createdAt).toLocaleString('pt-BR')}
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
// TAB: CONFIG
// ────────────────────────────────────────────────────────────────────────────

function ConfigTab({
  integradorId,
  integrador,
  onUpdate,
}: {
  integradorId: string
  integrador: { id: string; name: string; active: boolean }
  onUpdate: () => void
}) {
  const { data: modulesData, error: modulesErr, isLoading: modulesLoading } = useIntegradorModulesInfo(integradorId)
  const [suspending, setSuspending] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')
  const [showSuspendModal, setShowSuspendModal] = useState(false)

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
    <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      <p className="text-xs">Carregando...</p>
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
