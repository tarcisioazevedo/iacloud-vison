/**
 * ExecutiveTab — Dashboard executivo do CCO/Diretor.
 * KPIs estratégicos: MRR, pipeline value, win rate, top performers, funil mes, alertas.
 */
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  TrendingUp, Target, Award, Activity, Sparkles, AlertTriangle,
  ArrowUp, ArrowDown, ChevronRight, DollarSign, Users, Trophy,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { useSalesExecutiveStats, useSalesRanking } from '../../api/client'
import { cn } from '../../lib/utils'

export function ExecutiveTab() {
  const { data: stats, isLoading } = useSalesExecutiveStats(30)
  const { data: ranking } = useSalesRanking()

  if (isLoading) return <div className="h-96 rounded-lg bg-white/5 animate-pulse" />

  const k = stats?.kpis ?? {}
  const f = stats?.funnel ?? {}
  const top = stats?.topOpportunities ?? []

  return (
    <div className="space-y-4">
      {/* KPIs grandes */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <BigKpi color="emerald" icon={DollarSign} label="MRR fechado (mês)"
          value={`R$ ${(k.mrrClosed ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
          sub={`${k.dealsWon ?? 0} deals fechados`} />
        <BigKpi color="violet"  icon={Target} label="Pipeline value"
          value={`R$ ${(k.pipelineValue ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
          sub={`${k.pipelineCount ?? 0} oportunidades abertas`} />
        <BigKpi color="cyan"    icon={Trophy} label="Win Rate"
          value={`${(k.winRate ?? 0).toFixed(0)}%`}
          sub="ganhos vs perdas" />
        <BigKpi color="amber"   icon={Award} label="Ticket Médio"
          value={`R$ ${(k.avgTicket ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
          sub="por deal fechado" />
        <BigKpi color="rose"    icon={Sparkles} label="Conversão Lead→Cliente"
          value={`${(k.conversionRate ?? 0).toFixed(1)}%`}
          sub={`${k.leadsConverted ?? 0} de ${k.leadsTotal ?? 0} leads`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Funil do mês */}
        <GlassCard className="p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-violet-400" /> Funil do mês
          </h3>
          <div className="space-y-2.5">
            <FunnelStage label="Novos leads"      value={f.novos ?? 0}       max={f.novos ?? 1} color="violet" />
            <FunnelStage label="Contatados"       value={f.contatados ?? 0}  max={f.novos ?? 1} color="cyan" />
            <FunnelStage label="Demos enviadas"   value={f.demosEnv ?? 0}    max={f.novos ?? 1} color="amber" />
            <FunnelStage label="Em negociação"    value={f.negociacao ?? 0}  max={f.novos ?? 1} color="emerald" />
            <FunnelStage label="Convertidos"      value={f.convertidos ?? 0} max={f.novos ?? 1} color="rose" />
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-slate-500">Atividades no mês</p>
              <p className="text-lg font-bold text-white">{(k.activities ?? 0).toLocaleString('pt-BR')}</p>
            </div>
            <div>
              <p className="text-slate-500">Demos realizadas</p>
              <p className="text-lg font-bold text-white">{k.demosDone ?? 0}</p>
            </div>
          </div>
        </GlassCard>

        {/* Top oportunidades */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" /> Top oportunidades abertas
            </h3>
            <Link to="/admin/comercial?tab=opportunities" className="text-xs text-cyan-400 hover:text-cyan-300">Ver todas →</Link>
          </div>
          {top.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">Nenhuma oportunidade aberta. <br />Vá em <Link to="/admin/comercial?tab=opportunities" className="text-cyan-400">Oportunidades</Link> e clique "Auto-detectar".</p>
          ) : (
            <div className="space-y-2">
              {top.map((o: any) => (
                <div key={o.id} className={cn('p-2 rounded border',
                  o.type === 'CROSS_SELL' ? 'bg-emerald-500/5 border-emerald-500/20' :
                  o.type === 'UPSELL'     ? 'bg-amber-500/5 border-amber-500/20' :
                                            'bg-violet-500/5 border-violet-500/20')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">{o.title}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{o.description ?? '—'}</p>
                    </div>
                    <span className="text-sm font-bold text-emerald-300 shrink-0">
                      R$ {(o.estimatedMrr ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px]">
                    <span className={cn('px-1.5 py-0.5 rounded',
                      o.type === 'CROSS_SELL' ? 'bg-emerald-500/15 text-emerald-300' :
                      o.type === 'UPSELL'     ? 'bg-amber-500/15 text-amber-300' :
                                                'bg-violet-500/15 text-violet-300')}>
                      {o.type.replace('_',' ')}
                    </span>
                    {o.probability != null && (
                      <span className="text-slate-500">{o.probability}% prob.</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Top Performers */}
      {ranking?.rankings && ranking.rankings.length > 0 && (
        <GlassCard className="p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" /> Top performers (mês atual)
          </h3>
          <div className="grid gap-2">
            {ranking.rankings.slice(0, 5).map((r: any, idx: number) => (
              <div key={r.salesUser.id} className="flex items-center gap-3 p-2 rounded bg-white/[0.02] border border-white/5">
                <span className="text-base font-bold w-6 text-center">
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{r.salesUser.name}</p>
                  <p className="text-[10px] text-slate-500">{r.salesUser.role}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-emerald-300">R$ {r.mrr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                  <p className="text-[10px] text-slate-500">{r.deals} deals · {r.demos} demos · {r.calls} calls</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}

function BigKpi({ color, icon: Icon, label, value, sub }: {
  color: string; icon: any; label: string; value: string; sub?: string
}) {
  const cls: Record<string, string> = {
    violet:  'border-violet-500/30 bg-violet-500/5 text-violet-300',
    cyan:    'border-cyan-500/30 bg-cyan-500/5 text-cyan-300',
    amber:   'border-amber-500/30 bg-amber-500/5 text-amber-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    rose:    'border-rose-500/30 bg-rose-500/5 text-rose-300',
  }
  return (
    <motion.div whileHover={{ y: -2 }} className={cn('p-4 rounded-lg border', cls[color])}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </motion.div>
  )
}

function FunnelStage({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const cls: Record<string, string> = {
    violet:  'from-violet-500 to-violet-400',
    cyan:    'from-cyan-500 to-cyan-400',
    amber:   'from-amber-500 to-amber-400',
    emerald: 'from-emerald-500 to-emerald-400',
    rose:    'from-rose-500 to-rose-400',
  }
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="font-bold text-white">{value} <span className="text-slate-500 font-normal">({pct.toFixed(0)}%)</span></span>
      </div>
      <div className="h-2.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          className={cn('h-full bg-gradient-to-r', cls[color])} />
      </div>
    </div>
  )
}
