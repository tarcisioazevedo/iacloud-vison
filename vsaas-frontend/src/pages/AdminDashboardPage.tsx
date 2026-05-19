/**
 * AdminDashboardPage — Dashboard executivo do SUPER_ADMIN.
 *
 * Visão de comando: KPIs estratégicos + alertas críticos + top tenants + receita.
 * Diferente do Dashboard operacional (cliente final) — aqui é nível executivo.
 */
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import {
  Building2, Activity,
  Briefcase, AlertTriangle, ArrowRight,
  Award, Sparkles, ChevronRight, HeartPulse, Network, DollarSign, ShieldAlert,
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

  // Onda 6 (2026-05-12): split global EDGE vs DIRECT cams pro Hero.
  const edgeCams   = stats?.camerasBreakdown?.edge   ?? { online: 0, total: 0 }
  const directCams = stats?.camerasBreakdown?.direct ?? { online: 0, total: 0 }
  const totalCams  = edgeCams.total + directCams.total
  const onlineCams = edgeCams.online + directCams.online

  // Sparkline placeholder until backend exposes historical data.
  // Deterministic by design: avoids subtle chart jitter on every React render.
  const fakeSpark = (cur: number) => Array.from({ length: 9 }, (_, i) => {
    const wave = [0.02, 0.08, -0.03, 0.10, 0.04, 0.12, 0.01, 0.15, 0.07][i] ?? 0
    return Math.max(0, cur * (0.34 + (i / 9) * 0.64 + wave))
  })

  return (
    <div className="space-y-4">
      {/* Hero — espelha o mockup vsaas-mockup/02-dashboard.html:
       *   título grande + subtítulo gradient + meta-line monospace abaixo.
       *   Light: surface branco com borda cyan; Dark: surface navy translúcido. */}
      <GlassCard className="p-6 border-cyan-500/30 dark:border-cyan-500/20 bg-gradient-to-br from-cyan-50 via-white to-violet-50 dark:from-cyan-500/5 dark:via-slate-900/40 dark:to-violet-500/5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-[28px] font-extrabold tracking-tight leading-[1.1] text-slate-900 dark:text-white"
                style={{ fontFamily: 'Manrope, Inter, sans-serif' }}>
              Visão geral{' '}
              <span className="bg-gradient-to-r from-cyan-500 to-emerald-500 dark:from-cyan-400 dark:to-emerald-400 bg-clip-text text-transparent">
                — comando do fabricante
              </span>
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-2 font-mono">
              {stats?.integradores.total ?? 0} integrador{(stats?.integradores.total ?? 0) !== 1 ? 'es' : ''}
              {' · '}
              {stats?.clientes.total ?? 0} cliente{(stats?.clientes.total ?? 0) !== 1 ? 's' : ''} final{(stats?.clientes.total ?? 0) !== 1 ? 'is' : ''}
              {' · '}
              <span className={cn(edgeOnline === edgeTotal && edgeTotal > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400')}>
                ● {edgeOnline}/{edgeTotal} box{edgeTotal !== 1 ? 'es' : ''} online
              </span>
              {' · '}
              {newLeads} lead{newLeads !== 1 ? 's' : ''} no pipeline
            </p>
            {/* Linha de câmeras agregadas: total + split EDGE vs DIRECT.
                Onda 6 (2026-05-12) — operador SUPER_ADMIN tem visão de relance
                de quantas câmeras direct (sem box) estão online globalmente. */}
            {totalCams > 0 && (
              <div className="flex items-center gap-2 mt-3 text-xs font-mono flex-wrap">
                <span className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-semibold',
                  onlineCams === totalCams
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300'
                    : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300',
                )}>
                  📹 {onlineCams}/{totalCams} câmeras online
                </span>
                {edgeCams.total > 0 && (
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px]',
                    edgeCams.online === edgeCams.total
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300'
                      : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300',
                  )} title="Câmeras gerenciadas por Edge Box local">
                    🖥 edge {edgeCams.online}/{edgeCams.total}
                  </span>
                )}
                {directCams.total > 0 && (
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px]',
                    directCams.online === directCams.total
                      ? 'bg-cyan-50 border-cyan-200 text-cyan-700 dark:bg-cyan-500/10 dark:border-cyan-500/30 dark:text-cyan-300'
                      : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300',
                  )} title="Câmeras CLOUD_DIRECT (RTSP/ONVIF/RTMP/P2P direto na cloud, sem box)">
                    ☁ direct {directCams.online}/{directCams.total}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link to="/admin/alerts"
              className={cn('px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 border transition',
                criticalAlerts > 0
                  ? 'bg-rose-500/10 text-rose-700 border-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30 animate-pulse shadow-[0_0_18px_-4px_rgba(244,63,94,0.5)]'
                  : 'bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30')}>
              <AlertTriangle className="w-4 h-4" />
              {totalAlerts} alerta{totalAlerts !== 1 ? 's' : ''} {criticalAlerts > 0 && `(${criticalAlerts} críticos)`}
            </Link>
          </div>
        </div>
      </GlassCard>

      {/* 4 cards densos — Saúde · Tenants · Comercial · Risco
       * Layout do mockup: ícone tintado top-left + label uppercase +
       * número grande + sparkline + stats footer + glow blob no canto. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <DenseKpiCard
          color="emerald"
          icon={HeartPulse}
          title="Saúde"
          subtitle="30d"
          mainValue={healthPct != null ? `${healthPct}%` : '—'}
          mainLabel="uptime cluster"
          spark={fakeSpark(healthPct ?? 100)}
          stats={[
            { label: 'boxes online', value: `${edgeOnline}/${edgeTotal}`, accent: edgeOnline === edgeTotal && edgeTotal > 0 ? 'emerald' : 'amber' },
            { label: 'P0 abertos', value: criticalAlerts },
          ]}
          extra={<HealthScoreBadge score={healthPct} />}
        />
        <DenseKpiCard
          color="violet"
          icon={Network}
          title="Crescimento"
          subtitle="30d"
          mainValue={stats?.integradores.total ?? 0}
          mainLabel="integradores ativos"
          spark={fakeSpark(stats?.integradores.total ?? 0)}
          stats={[
            { label: 'ativos', value: stats?.integradores.ativos ?? 0 },
            { label: 'suspensos', value: stats?.integradores.suspensos ?? 0 },
          ]}
          link="/admin/tenants"
        />
        <DenseKpiCard
          color="amber"
          icon={Briefcase}
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
          icon={ShieldAlert}
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
        <GlassCard className="p-5 border-emerald-200 dark:border-emerald-500/30 bg-gradient-to-r from-emerald-50 via-cyan-50/40 to-transparent dark:from-emerald-500/10 dark:via-cyan-500/5 dark:to-transparent hover:border-emerald-300 dark:hover:border-emerald-500/50 transition cursor-pointer">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 shrink-0">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-bold">Receita (MRR)</p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white"
                   style={{ fontFamily: 'Manrope, Inter, sans-serif' }}>
                  R$ 0 <span className="text-base font-normal text-slate-500 dark:text-slate-400">/ mês</span>
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">⚠ Stripe ainda não configurado — billing em construção</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              Configurar billing <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </div>
        </GlassCard>
      </Link>

      {/* Atalhos rápidos */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Atalhos do dia a dia
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
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" /> Top 5 alertas ativos
            </h3>
            <Link to="/admin/alerts" className="text-xs font-semibold text-cyan-700 dark:text-cyan-400 hover:text-cyan-800 dark:hover:text-cyan-300">Ver todos →</Link>
          </div>
          <div className="space-y-1.5">
            {alerts.alerts.slice(0, 5).map((a: any) => (
              <Link key={a.id} to={a.actions?.[0]?.href ?? '/admin/alerts'}
                className={cn('flex items-center gap-3 p-2 rounded border transition',
                  a.severity === 'critical' ? 'border-rose-200 bg-rose-50 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/5 dark:hover:bg-rose-500/10'
                    : a.severity === 'high'  ? 'border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/5 dark:hover:bg-amber-500/10'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-slate-50 dark:bg-white/5')}>
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                  a.severity === 'critical' ? 'bg-rose-500 animate-pulse'
                    : a.severity === 'high'  ? 'bg-amber-500'
                    : 'bg-cyan-500')} />
                <span className="text-xs text-slate-900 dark:text-white truncate flex-1">{a.title}</span>
                {a.tenant && <span className="text-[10px] text-slate-500 dark:text-slate-500 hidden sm:inline">{a.tenant.name}</span>}
                <ChevronRight className="w-3 h-3 text-slate-400 dark:text-slate-600 shrink-0" />
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
  /** Ícone Lucide — fica no box tintado no topo do card (estilo mockup). */
  icon?: React.ComponentType<{ className?: string }>
  title: string
  subtitle: string
  mainValue: React.ReactNode
  mainLabel: string
  spark: number[]
  stats?: Array<{ label: string; value: React.ReactNode; accent?: 'emerald' | 'amber' | 'rose' }>
  extra?: React.ReactNode
  link?: string
}

function DenseKpiCard({ color, icon: Icon, title, subtitle, mainValue, mainLabel, spark, stats, extra, link }: DenseKpiCardProps) {
  // Cada accent tem 4 tokens: border (light + dark), texto do label (light + dark),
  // bg do ícone-box (light + dark), e RGB pro sparkline (mesma cor nos dois temas).
  const map = {
    emerald: {
      border:    'border-emerald-200 dark:border-emerald-500/20',
      label:     'text-emerald-700 dark:text-emerald-300',
      iconBg:    'bg-emerald-100 dark:bg-emerald-500/15',
      iconText:  'text-emerald-700 dark:text-emerald-300',
      sparkRgb:  'rgb(16 185 129)',
      glowBg:    'bg-emerald-400/20',
    },
    violet:  {
      border:    'border-violet-200 dark:border-violet-500/20',
      label:     'text-violet-700 dark:text-violet-300',
      iconBg:    'bg-violet-100 dark:bg-violet-500/15',
      iconText:  'text-violet-700 dark:text-violet-300',
      sparkRgb:  'rgb(73 60 127)',
      glowBg:    'bg-violet-400/20',
    },
    cyan:    {
      border:    'border-cyan-200 dark:border-cyan-500/20',
      label:     'text-cyan-700 dark:text-cyan-300',
      iconBg:    'bg-cyan-100 dark:bg-cyan-500/15',
      iconText:  'text-cyan-700 dark:text-cyan-300',
      sparkRgb:  'rgb(0 192 208)',
      glowBg:    'bg-cyan-400/20',
    },
    amber:   {
      border:    'border-amber-200 dark:border-amber-500/20',
      label:     'text-amber-700 dark:text-amber-300',
      iconBg:    'bg-amber-100 dark:bg-amber-500/15',
      iconText:  'text-amber-700 dark:text-amber-300',
      sparkRgb:  'rgb(245 158 11)',
      glowBg:    'bg-amber-400/20',
    },
    rose:    {
      border:    'border-rose-200 dark:border-rose-500/20',
      label:     'text-rose-700 dark:text-rose-300',
      iconBg:    'bg-rose-100 dark:bg-rose-500/15',
      iconText:  'text-rose-700 dark:text-rose-300',
      sparkRgb:  'rgb(244 63 94)',
      glowBg:    'bg-rose-400/20',
    },
  }[color]
  const inner = (
    <GlassCard className={cn('p-5 transition h-full relative overflow-hidden', map.border, link && 'hover:shadow-lg cursor-pointer')}>
      {/* Glow blob decorativo (igual ao mockup `kpi::after`) — só no canto inf-direito */}
      <div className={cn('absolute -right-5 -bottom-8 w-24 h-14 rounded-full blur-3xl pointer-events-none', map.glowBg)} aria-hidden />

      {/* Header: ícone tintado + label uppercase + subtitle mono */}
      <div className="flex items-start justify-between gap-2 mb-3 relative">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className={cn('w-9 h-9 rounded-lg grid place-items-center shrink-0', map.iconBg)}>
              <Icon className={cn('w-4.5 h-4.5', map.iconText)} />
            </div>
          )}
          <span className={cn('text-[11px] uppercase tracking-wider font-bold flex items-center gap-1.5', map.label)}>
            {color === 'rose' && subtitle.startsWith('●') ? null : null}
            {title}
          </span>
        </div>
        <span className={cn('text-[10px] font-mono mt-1.5',
          color === 'rose' && subtitle.includes('ATENÇÃO')
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-slate-500 dark:text-slate-500')}>
          {subtitle}
        </span>
      </div>

      {/* Valor principal */}
      <div className="flex items-baseline gap-2 relative">
        <div className="text-[32px] leading-none font-extrabold tracking-tight text-slate-900 dark:text-white"
             style={{ fontFamily: 'Manrope, Inter, sans-serif' }}>
          {mainValue}
        </div>
        {extra}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 relative">{mainLabel}</div>

      <Sparkline values={spark} color={map.sparkRgb} className="mt-3 relative" />

      {stats && (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-1 relative">
          {stats.map((s, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">{s.label}</span>
              <span className={cn(
                'font-semibold tabular-nums',
                s.accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
                  : s.accent === 'amber' ? 'text-amber-600 dark:text-amber-400'
                  : s.accent === 'rose' ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-900 dark:text-white',
              )}>
                {typeof s.value === 'number' ? s.value.toLocaleString('pt-BR') : s.value}
              </span>
            </div>
          ))}
        </div>
      )}
      {link && (
        <div className="mt-3 flex items-center justify-end text-[10px] text-slate-400 dark:text-slate-500 group relative">
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
    violet:  'hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/5 dark:hover:text-violet-300',
    cyan:    'hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 dark:hover:border-cyan-500/40 dark:hover:bg-cyan-500/5 dark:hover:text-cyan-300',
    amber:   'hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:hover:border-amber-500/40 dark:hover:bg-amber-500/5 dark:hover:text-amber-300',
    emerald: 'hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/5 dark:hover:text-emerald-300',
  }
  return (
    <Link to={to}
      className={cn(
        'flex items-center gap-2 p-3 rounded-lg border transition',
        'border-slate-200 bg-slate-50/50 text-slate-600',
        'dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400',
        cls[color],
      )}>
      <Icon className="w-4 h-4" />
      <span className="text-xs font-bold">{label}</span>
    </Link>
  )
}
