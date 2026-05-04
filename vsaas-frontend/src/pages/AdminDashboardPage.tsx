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
  DollarSign, Award, Sparkles, ChevronRight,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api, useTenantsGlobalStats } from '../api/client'
import { cn } from '../lib/utils'

const fetcher = (u: string) => api.get(u).then(r => r.data)

export function AdminDashboardPage() {
  const { data: stats } = useTenantsGlobalStats()
  const { data: alerts } = useSWR<any>('/admin/alerts/active', fetcher, { refreshInterval: 60_000 })
  const { data: leads }  = useSWR<any>('/leads?status=NEW', fetcher, { refreshInterval: 60_000 })

  const totalAlerts = alerts?.total ?? 0
  const criticalAlerts = alerts?.counts?.critical ?? 0
  const newLeads = leads?.total ?? leads?.leads?.length ?? 0

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-6 bg-gradient-to-br from-violet-500/15 via-cyan-500/10 to-amber-500/5 border-violet-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 via-cyan-500 to-amber-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <LayoutDashboard className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard Global</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Visão executiva da plataforma — saúde, receita, comercial e operações.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/admin/alerts"
              className={cn('px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 border',
                criticalAlerts > 0
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 animate-pulse'
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30')}>
              <AlertTriangle className="w-4 h-4" />
              {totalAlerts} alertas {criticalAlerts > 0 && `(${criticalAlerts} críticos)`}
            </Link>
          </div>
        </div>
      </GlassCard>

      {/* KPI Tenants — único KPI consolidado para o super_admin (resto é por tenant) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BigKpi color="violet" icon={Building2} label="Tenants (Integradores)" value={stats?.integradores.total ?? 0}
          sub={`${stats?.integradores.ativos ?? 0} ativos · ${stats?.integradores.suspensos ?? 0} suspensos`}
          link="/admin/tenants" />
        <BigKpi color="amber" icon={Briefcase} label="Comercial — Leads em pipeline" value={newLeads}
          sub={newLeads > 0 ? 'demo aguardando aprovação' : 'pipeline limpo'}
          link="/admin/comercial" />
      </div>

      {/* Linha 2: Demos pendentes + MRR */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link to="/admin/comercial?tab=approvals">
          <GlassCard className={cn('p-4 hover:border-amber-500/40 transition cursor-pointer h-full',
            newLeads > 0 ? 'border-amber-500/40 bg-amber-500/5' : '')}>
            <div className="flex items-start justify-between mb-2">
              <CheckCircle2 className={cn('w-6 h-6', newLeads > 0 ? 'text-amber-400 animate-pulse' : 'text-emerald-400')} />
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </div>
            <p className="text-3xl font-bold text-white">{newLeads}</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">Demos aguardando aprovação</p>
            <p className="text-xs text-slate-400 mt-2">SLA: 1 dia útil. {newLeads > 0 ? 'Ação requerida →' : 'Tudo limpo ✨'}</p>
          </GlassCard>
        </Link>

        <Link to="/admin/comercial?tab=pricing">
          <GlassCard className="p-4 hover:border-emerald-500/40 transition cursor-pointer h-full">
            <div className="flex items-start justify-between mb-2">
              <DollarSign className="w-6 h-6 text-emerald-400" />
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </div>
            <p className="text-3xl font-bold text-white">R$ —</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">MRR (em construção)</p>
            <p className="text-xs text-slate-400 mt-2">Faturamento será exibido no módulo Billing →</p>
          </GlassCard>
        </Link>
      </div>

      {/* Linha 3: Atalhos rápidos */}
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

function BigKpi({ color, icon: Icon, label, value, sub, link }: {
  color: string; icon: any; label: string; value: number; sub?: string; link?: string
}) {
  const cls: Record<string, string> = {
    violet:  'border-violet-500/30 bg-violet-500/5 text-violet-300',
    cyan:    'border-cyan-500/30 bg-cyan-500/5 text-cyan-300',
    amber:   'border-amber-500/30 bg-amber-500/5 text-amber-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    rose:    'border-rose-500/30 bg-rose-500/5 text-rose-300',
  }
  const Wrapper = link ? Link : 'div'
  return (
    <Wrapper to={link ?? ''} className="block">
      <motion.div whileHover={{ y: -2 }}
        className={cn('p-4 rounded-lg border transition', cls[color])}>
        <div className="flex items-center justify-between mb-2">
          <Icon className="w-5 h-5" />
          {link && <ArrowRight className="w-3.5 h-3.5 text-slate-600" />}
        </div>
        <p className="text-3xl font-bold text-white">{value.toLocaleString('pt-BR')}</p>
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-2">{sub}</p>}
      </motion.div>
    </Wrapper>
  )
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
