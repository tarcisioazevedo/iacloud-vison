/**
 * IntegradorCockpitPage — Cockpit do INTEGRADOR (espelho do TenantCockpit do
 * Fabricante, mas escopado ao próprio tenant via JWT).
 *
 * Persona: INTEGRADOR_ADMIN / INTEGRADOR_TECNICO
 * Rota: /integrador (root) e /integrador/clientes/:id (drill)
 * Escopo: SEMPRE o integradorId do JWT (não pode espiar outros integradores)
 *
 * Diferenças vs Fabricante:
 * - Tom: "Meu Negócio" em vez de "Tenant Management"
 * - Sem KPI de receita do fabricante; tem KPI de plano contratado
 * - Filtros automáticos por integradorId via RBAC server-side
 * - Sem botão "criar integrador" — fora do escopo
 * - Banner discreto: "powered by IA Cloud Vision"
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Building2, Briefcase, Users, Server, Camera, MapPin, Plus,
  TrendingUp, Activity, Loader2, AlertTriangle, Search,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { TreeView, HealthScoreBadge } from '../components/hierarchy'
import { useMyIntegradorTree, formatApiError } from '../api/client'
import { cn } from '../lib/utils'

export function IntegradorCockpitPage() {
  const navigate = useNavigate()
  const { data, error, isLoading } = useMyIntegradorTree(3)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all'|'active'|'inactive'>('all')

  const filtered = useMemo(() => {
    const list = data?.clientes ?? []
    return list.filter(c => {
      if (statusFilter === 'active' && !c.active) return false
      if (statusFilter === 'inactive' && c.active) return false
      if (!search) return true
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    })
  }, [data, search, statusFilter])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
        <span className="ml-2 text-sm text-slate-400">Carregando seu cockpit...</span>
      </div>
    )
  }

  if (error) {
    return (
      <GlassCard className="p-5 border-rose-500/30">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-rose-300">Não foi possível carregar seu cockpit</p>
            <p className="text-xs text-slate-400 mt-1">{formatApiError(error)}</p>
          </div>
        </div>
      </GlassCard>
    )
  }

  if (!data) return null

  const { integrador, summary, clientes } = data
  const healthScore = summary.edgeNodes > 0
    ? Math.round((summary.edgeNodesOnline / summary.edgeNodes) * 100)
    : null

  return (
    <div className="space-y-4">
      {/* Hero do Integrador — "Meu Negócio" */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent border-cyan-500/20">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-2xl">
                🤝
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Olá, {integrador.tradeName ?? integrador.name} 👋</h1>
                <p className="text-sm text-slate-400 mt-1">
                  Aqui está o resumo do seu negócio · {summary.clientes} cliente{summary.clientes !== 1 ? 's' : ''} ·{' '}
                  {summary.sites} site{summary.sites !== 1 ? 's' : ''} · {summary.edgeNodesOnline}/{summary.edgeNodes} box{summary.edgeNodes !== 1 ? 'es' : ''} online
                </p>
                <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                  <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono uppercase">
                    Integrador
                  </span>
                  <span className={cn(
                    'px-2 py-0.5 rounded border',
                    integrador.active
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/30',
                  )}>
                    {integrador.active ? '● Ativo' : '⏸ Suspenso'}
                  </span>
                  <span className="text-slate-500">{integrador.email}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => navigate('/clientes-finais')}
                className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-sm text-white transition flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Novo cliente
              </button>
              <button
                onClick={() => navigate('/edge')}
                className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-amber-500/50 text-sm text-white transition flex items-center gap-1.5"
              >
                <Server className="w-3.5 h-3.5" /> Provisionar box
              </button>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* 3 cards densos: Meu Negócio · Operação · Plano */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCardLarge
          title="Meu Negócio"
          icon={Briefcase}
          color="cyan"
          subtitle="Crescimento 30d"
          stats={[
            { label: 'cliente final', value: summary.clientes },
            { label: 'site ativo', value: summary.sites },
            { label: 'câmera ativa', value: summary.cameras },
            { label: 'usuário convidado', value: '—' },
          ]}
        />
        <KpiCardLarge
          title="Operação"
          icon={Activity}
          color="emerald"
          subtitle="status em tempo real"
          mainValue={
            <div className="flex items-center gap-1.5">
              <HealthScoreBadge score={healthScore} size="md" />
              <span className="text-base text-slate-400">/100</span>
            </div>
          }
          mainLabel="saúde média da rede"
          stats={[
            { label: 'boxes online', value: `${summary.edgeNodesOnline}/${summary.edgeNodes}` },
            { label: 'eventos críticos 24h', value: 0 },
          ]}
        />
        <KpiCardLarge
          title="Plano Atual"
          icon={TrendingUp}
          color="amber"
          subtitle="Free Trial"
          mainValue={<span className="text-3xl font-bold text-white">27<span className="text-base text-slate-400"> dias</span></span>}
          mainLabel="restantes no trial"
          cta={{ label: 'Upgrade →', onClick: () => navigate('/quota') }}
        />
      </div>

      {/* Lista de Clientes com TreeView */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-cyan-400" />
              Meus Clientes ({summary.clientes})
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Clique para expandir e ver sites, boxes e câmeras</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all'|'active'|'inactive')}
              className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white [&>option]:bg-slate-900">
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
            <button
              onClick={() => navigate('/clientes-finais')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-white text-xs font-bold shadow-lg shadow-cyan-500/20"
            >
              <Plus className="w-3.5 h-3.5" /> Novo cliente
            </button>
          </div>
        </div>
        <TreeView
          clientes={filtered}
          onAddSite={() => navigate('/sites')}
          onAddBox={() => navigate('/edge')}
          onAddCamera={() => navigate('/cameras')}
          emptyState={
            <>
              <div className="text-4xl mb-2">🤝</div>
              <div className="text-sm">
                {clientes.length === 0
                  ? 'Você ainda não tem clientes cadastrados'
                  : `Nenhum cliente encontrado para "${search}"`}
              </div>
              <div className="text-xs mt-1 text-slate-600">
                {clientes.length === 0 && 'Comece adicionando seu primeiro cliente final'}
              </div>
            </>
          }
        />
      </GlassCard>

      {/* Footer "powered by" */}
      <div className="text-center text-[10px] text-slate-600 pt-2">
        powered by IA Cloud Vision · v0.1
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Componentes auxiliares
// ────────────────────────────────────────────────────────────────────────────

interface KpiCardLargeProps {
  title: string
  icon: typeof Building2
  color: 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose'
  subtitle?: string
  mainValue?: React.ReactNode
  mainLabel?: string
  stats?: Array<{ label: string; value: React.ReactNode }>
  cta?: { label: string; onClick: () => void }
}

function KpiCardLarge({ title, icon: Icon, color, subtitle, mainValue, mainLabel, stats, cta }: KpiCardLargeProps) {
  const colorMap = {
    cyan:    { border: 'border-cyan-500/20',    text: 'text-cyan-300',    bg: 'bg-cyan-500/10',    bar: 'from-cyan-500 to-blue-500' },
    emerald: { border: 'border-emerald-500/20', text: 'text-emerald-300', bg: 'bg-emerald-500/10', bar: 'from-emerald-500 to-cyan-500' },
    amber:   { border: 'border-amber-500/20',   text: 'text-amber-300',   bg: 'bg-amber-500/10',   bar: 'from-amber-500 to-rose-500' },
    violet:  { border: 'border-violet-500/20',  text: 'text-violet-300',  bg: 'bg-violet-500/10',  bar: 'from-violet-500 to-cyan-500' },
    rose:    { border: 'border-rose-500/20',    text: 'text-rose-300',    bg: 'bg-rose-500/10',    bar: 'from-rose-500 to-amber-500' },
  }[color]

  return (
    <GlassCard className={cn('p-5', colorMap.border)}>
      <div className="flex items-center justify-between mb-3">
        <span className={cn('text-xs uppercase tracking-wider font-bold flex items-center gap-1.5', colorMap.text)}>
          <Icon className="w-3.5 h-3.5" />
          {title}
        </span>
        {subtitle && <span className="text-[10px] text-slate-500">{subtitle}</span>}
      </div>

      {mainValue && (
        <div>
          <div className="text-3xl font-bold text-white">{mainValue}</div>
          {mainLabel && <div className="text-xs text-slate-400 mt-1">{mainLabel}</div>}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          {stats.map((s, idx) => (
            <div key={idx}>
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {cta && (
        <button
          onClick={cta.onClick}
          className={cn(
            'mt-3 w-full py-2 px-3 rounded-lg text-xs font-bold text-white transition bg-gradient-to-r hover:opacity-90',
            colorMap.bar,
          )}
        >
          {cta.label}
        </button>
      )}
    </GlassCard>
  )
}
