/**
 * AdminDashboardPage — Dashboard executivo do SUPER_ADMIN.
 *
 * Visão de comando: KPIs estratégicos + alertas críticos + top tenants + receita.
 * Diferente do Dashboard operacional (cliente final) — aqui é nível executivo.
 */
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Building2, Activity,
  Briefcase, AlertTriangle, ArrowRight, CheckCircle2,
  DollarSign, Award, Sparkles, ChevronRight, TrendingUp, Users, Server,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api, useTenantsGlobalStats } from '../api/client'
import { Sparkline, HealthScoreBadge } from '../components/hierarchy'
import { cn } from '../lib/utils'

const fetcher = (u: string) => api.get(u).then(r => r.data)

export function AdminDashboardPage() {
  const { data: stats } = useTenantsGlobalStats()
  const { data: alerts } = useSWR<any>('/admin/alerts/active', fetcher, { refreshInterval: 60_000 })
  const { data: leads }  = useSWR<any>('/leads?status=NEW', fetcher, { refreshInterval: 60_000 })

  const totalAlerts = alerts?.total ?? 0
  const criticalAlerts = alerts?.counts?.critical ?? 0
  const newLeads = leads?.total ?? leads?.leads?.length ?? 0
  const edgeOnline = stats?.edgeBoxes?.online ?? 0
  const edgeTotal = stats?.edgeBoxes?.total ?? 0
  const healthPct = edgeTotal > 0 ? Math.round((edgeOnline / edgeTotal) * 100) : null

  // Sparkline placeholder until backend exposes historical data
  const fakeSpark = (cur: number) => Array.from({ length: 9 }, (_, i) =>
    Math.max(0, cur * (0.3 + (i / 9) * 0.7) + (Math.random() * cur * 0.1))
  )

  return (
    <div className="space-y-4">
      {/* Hero — coerente com cockpit do fabricante */}
      <GlassCard className="p-6 bg-gradient-to-br from-violet-500/15 via-cyan-500/10 to-amber-500/5 border-violet-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 via-cyan-500 to-amber-500 flex items-center justify-center shadow-lg shadow-violet-500/30 text-2xl">
              🏭
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard Global · Fabricante</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {stats?.integradores.total ?? 0} integrador{(stats?.integradores.total ?? 0) !== 1 ? 'es' : ''} ·{' '}
                {stats?.clientes.total ?? 0} cliente{(stats?.clientes.total ?? 0) !== 1 ? 's' : ''} final{(stats?.clientes.total ?? 0) !== 1 ? 'is' : ''} ·{' '}
                {edgeOnline}/{edgeTotal} box{edgeTotal !== 1 ? 'es' : ''} online · {newLeads} lead{newLeads !== 1 ? 's' : ''} no pipeline
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/admin/alerts"
              className={cn('px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 border',
                criticalAlerts > 0
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 animate-pulse shadow-[0_0_18px_-4px_rgba(244,63,94,0.5)]'
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30')}>
              <AlertTriangle className="w-4 h-4" />
              {totalAlerts} alerta{totalAlerts !== 1 ? 's' : ''} {criticalAlerts > 0 && `(${criticalAlerts} críticos)`}
            </Link>
          </div>
        </div>
      </GlassCard>

      {/* 4 cards densos — Saúde · Tenants · Comercial · Risco */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <DenseKpiCard
          color="emerald"
          title="Saúde"
          subtitle="cluster"
          mainValue={healthPct != null ? `${healthPct}%` : '—'}
          mainLabel="uptime"
          spark={fakeSpark(healthPct ?? 100)}
          stats={[
            { label: 'boxes online', value: `${edgeOnline}/${edgeTotal}`, accent: edgeOnline === edgeTotal && edgeTotal > 0 ? 'emerald' : 'amber' },
            { label: 'P0 abertos', value: criticalAlerts },
          ]}
          extra={<HealthScoreBadge score={healthPct} />}
        />
        <DenseKpiCard
          color="violet"
          title="Tenants"
          subtitle="integradores"
          mainValue={stats?.integradores.total ?? 0}
          mainLabel="ativos na plataforma"
          spark={fakeSpark(stats?.integradores.total ?? 0)}
          stats={[
            { label: 'ativos', value: stats?.integradores.ativos ?? 0 },
            { label: 'suspensos', value: stats?.integradores.suspensos ?? 0 },
          ]}
          link="/admin/tenants"
        />
        <DenseKpiCard
          color="amber"
          title="Comercial"
          subtitle="pipeline"
          mainValue={newLeads}
          mainLabel={newLeads > 0 ? 'demos aguardando aprovação' : 'pipeline limpo'}
          spark={fakeSpark(newLeads)}
          stats={[
            { label: 'SLA', value: '1d útil' },
            { label: 'clientes', value: stats?.clientes.total ?? 0 },
          ]}
          link="/admin/comercial"
        />
        <DenseKpiCard
          color={criticalAlerts > 0 ? 'rose' : 'emerald'}
          title="Risco"
          subtitle={criticalAlerts > 0 ? '●ATENÇÃO' : '●OK'}
          mainValue={totalAlerts}
          mainLabel={`alerta${totalAlerts !== 1 ? 's' : ''} ativo${totalAlerts !== 1 ? 's' : ''}`}
          spark={fakeSpark(totalAlerts)}
          stats={[
            { label: 'críticos', value: criticalAlerts, accent: criticalAlerts > 0 ? 'rose' : undefined },
            { label: 'pending approval', value: stats?.pendingApprovals ?? 0 },
          ]}
          link="/admin/alerts"
        />
      </div>

      {/* Receita / Billing — destaque (placeholder até billing real) */}
      <Link to="/admin/integrations">
        <GlassCard className="p-5 border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-cyan-500/5 to-transparent hover:border-emerald-500/50 transition cursor-pointer">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-2xl shadow-lg shadow-emerald-500/30">
                💰
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-400 font-bold">Receita (MRR)</p>
                <p className="text-2xl font-bold text-white">R$ 0 <span className="text-base text-slate-400">/ mês</span></p>
                <p className="text-xs text-amber-400 mt-1">⚠ Stripe ainda não configurado — billing em construção</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              Configurar billing <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </div>
        </GlassCard>
      </Link>

      {/* Atalhos rápidos */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" /> Atalhos do dia a dia
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <QuickAction to="/admin/tenants"           icon={Building2}    label="Gerenciar tenants"   color="violet" />
          <QuickAction to="/admin/comercial"         icon={Briefcase}    label="Funil comercial"     color="amber" />
          <QuickAction to="/admin/logs"              icon={Activity}     label="Logs cross-tenant"   color="cyan" />
          <QuickAction to="/admin/whitelabel"        icon={Award}        label="White-label"         color="emerald" />
        </div>
      </GlassCard>

      {/* Top alertas */}
      {alerts && alerts.alerts.length > 0 && (
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" /> Top 5 alertas ativos
            </h3>
            <Link to="/admin/alerts" className="text-xs text-cyan-400 hover:text-cyan-300">Ver todos →</Link>
          </div>
          <div className="space-y-1.5">
            {alerts.alerts.slice(0, 5).map((a: any) => (
              <Link key={a.id} to={a.actions?.[0]?.href ?? '/admin/alerts'}
                className={cn('flex items-center gap-3 p-2 rounded border transition hover:bg-white/5',
                  a.severity === 'critical' ? 'border-rose-500/30 bg-rose-500/5'
                    : a.severity === 'high'  ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-white/10 bg-white/[0.02]')}>
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                  a.severity === 'critical' ? 'bg-rose-500 animate-pulse'
                    : a.severity === 'high'  ? 'bg-amber-500'
                    : 'bg-cyan-500')} />
                <span className="text-xs text-white truncate flex-1">{a.title}</span>
                {a.tenant && <span className="text-[10px] text-slate-500 hidden sm:inline">{a.tenant.name}</span>}
                <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
              </Link>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}

interface DenseKpiCardProps {
  color: 'emerald' | 'violet' | 'cyan' | 'amber' | 'rose'
  title: string
  subtitle: string
  mainValue: React.ReactNode
  mainLabel: string
  spark: number[]
  stats?: Array<{ label: string; value: React.ReactNode; accent?: 'emerald' | 'amber' | 'rose' }>
  extra?: React.ReactNode
  link?: string
}

function DenseKpiCard({ color, title, subtitle, mainValue, mainLabel, spark, stats, extra, link }: DenseKpiCardProps) {
  const map = {
    emerald: { border: 'border-emerald-500/20', text: 'text-emerald-300', sparkRgb: 'rgb(52 211 153)' },
    violet:  { border: 'border-violet-500/20',  text: 'text-violet-300',  sparkRgb: 'rgb(167 139 250)' },
    cyan:    { border: 'border-cyan-500/20',    text: 'text-cyan-300',    sparkRgb: 'rgb(34 211 238)' },
    amber:   { border: 'border-amber-500/20',   text: 'text-amber-300',   sparkRgb: 'rgb(251 191 36)' },
    rose:    { border: 'border-rose-500/20',    text: 'text-rose-300',    sparkRgb: 'rgb(251 113 133)' },
  }[color]
  const inner = (
    <GlassCard className={cn('p-5 transition h-full', map.border, link && 'hover:border-opacity-60 cursor-pointer')}>
      <div className="flex items-center justify-between mb-3">
        <span className={cn('text-xs uppercase tracking-wider font-bold', map.text)}>{title}</span>
        <span className={cn('text-[10px] font-mono', color === 'rose' ? 'text-rose-400' : 'text-slate-500')}>{subtitle}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-3xl font-bold text-white">{mainValue}</div>
        {extra}
      </div>
      <div className="text-xs text-slate-400 mt-1">{mainLabel}</div>
      <Sparkline values={spark} color={map.sparkRgb} className="mt-3" />
      {stats && (
        <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-400 space-y-0.5">
          {stats.map((s, i) => (
            <div key={i} className="flex justify-between">
              <span>{s.label}</span>
              <span className={cn(
                'font-bold',
                s.accent === 'emerald' ? 'text-emerald-400'
                  : s.accent === 'amber' ? 'text-amber-400'
                  : s.accent === 'rose' ? 'text-rose-400'
                  : 'text-white',
              )}>
                {typeof s.value === 'number' ? s.value.toLocaleString('pt-BR') : s.value}
              </span>
            </div>
          ))}
        </div>
      )}
      {link && (
        <div className="mt-3 flex items-center justify-end text-[10px] text-slate-500 group">
          ver detalhe <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition" />
        </div>
      )}
    </GlassCard>
  )
  if (link) return <Link to={link} className="block h-full">{inner}</Link>
  return inner
}

function QuickAction({ to, icon: Icon, label, color }: {
  to: string; icon: any; label: string; color: string
}) {
  const cls: Record<string, string> = {
    violet:  'hover:border-violet-500/40 hover:bg-violet-500/5 hover:text-violet-300',
    cyan:    'hover:border-cyan-500/40 hover:bg-cyan-500/5 hover:text-cyan-300',
    amber:   'hover:border-amber-500/40 hover:bg-amber-500/5 hover:text-amber-300',
    emerald: 'hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-300',
  }
  return (
    <Link to={to}
      className={cn('flex items-center gap-2 p-3 rounded-lg border border-white/10 bg-white/[0.02] text-slate-400 transition', cls[color])}>
      <Icon className="w-4 h-4" />
      <span className="text-xs font-bold">{label}</span>
    </Link>
  )
}
