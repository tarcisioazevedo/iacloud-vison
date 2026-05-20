/**
 * ExecutiveTab 2.0 — Painel de Controle do CCO/Diretor.
 *
 * 7 blocos:
 *  1. Topo do funil (KPIs grandes + sparklines + comparação vs anterior)
 *  2. Atividades da equipe (calls/emails/whatsapp/meetings + heatmap hora×dia)
 *  3. Receita (MRR, ticket médio, win rate + tendência 12 semanas)
 *  4. Funil visual + identificação de gargalo
 *  5. Top performers (ranking + meta)
 *  6. Features vendidas (cross-sell tracker)
 *  7. Alertas operacionais
 *
 * Filtros globais sticky (período, vendedor, time, vertical, kind, compare).
 * Drill-down: clicar em qualquer KPI abre modal com lista detalhada.
 */
import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  TrendingUp, TrendingDown, Target, Award, Activity, Sparkles, AlertTriangle,
  ChevronRight, DollarSign, Trophy, Phone, Mail, MessageCircle, Calendar,
  FileText, Filter, X, Users, Layers, Flame, Zap, Bell,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { GlassCard } from '../cards/GlassCard'
import {
  useSalesExecutiveStats, useSalesTeam, useCycleTime, type ExecStatsFilter, api,
} from '../../api/client'
import { cn } from '../../lib/utils'
import { LeadDrawer } from './LeadDrawer'

const fetcher = (u: string) => api.get(u).then(r => r.data)

const VERTICALS = ['RETAIL','SHOPPING_MALL','CONDOMINIUM','INDUSTRIAL','OFFICE','SCHOOL','HEALTHCARE','HOSPITALITY','LOGISTICS','PARKING','BANK']
const PERIOD_PRESETS = [
  { label: 'Hoje',     days: 1 },
  { label: 'Semana',   days: 7 },
  { label: 'Mês',      days: 30 },
  { label: 'Trim.',    days: 90 },
  { label: 'Ano',      days: 365 },
]

export function ExecutiveTab() {
  const [filter, setFilter] = useState<ExecStatsFilter>({ days: 30, compare: true })
  const { data: stats, isLoading } = useSalesExecutiveStats(filter)
  const { data: teamData } = useSalesTeam()
  const [drillDown, setDrillDown] = useState<{ title: string; type: 'leads'|'demos'|'won'|'activities'|'features'; statusFilter?: string; days?: number } | null>(null)
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null)

  if (isLoading) return <ExecSkeleton />
  if (!stats) return null

  const { topOfFunnel, activities, revenue, funnel, topPerformers, featuresSold, alerts, previous } = stats

  function delta(current: number, previousValue: number): { pct: number; up: boolean } | null {
    if (!previous || previousValue == null || previousValue === 0) return null
    const pct = ((current - previousValue) / previousValue) * 100
    return { pct: Math.abs(pct), up: pct >= 0 }
  }

  return (
    <div className="space-y-4">
      {/* ───────────── FILTROS GLOBAIS STICKY ───────────── */}
      <FilterBar filter={filter} setFilter={setFilter} team={teamData?.team ?? []} />

      {/* ───────────── BLOCO 1: TOPO DO FUNIL ───────────── */}
      <div>
        <SectionHeader icon={Target} color="violet" title="Topo do funil" subtitle={`Período: últimos ${filter.days}d`} />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <BigKpi color="violet"  icon={Users}      label="Leads"      value={topOfFunnel.leads}     spark={topOfFunnel.sparklines.leads}      delta={delta(topOfFunnel.leads, previous?.leadsTotal)}
            onClick={() => setDrillDown({ title: `Leads recebidos · últimos ${filter.days}d`, type: 'leads', days: filter.days })} />
          <BigKpi color="cyan"    icon={Phone}      label="Contatos"   value={topOfFunnel.contatos}  spark={topOfFunnel.sparklines.activities} delta={null}
            sub={`${topOfFunnel.conversion.leadToContato.toFixed(0)}% qualif.`}
            onClick={() => setDrillDown({ title: `Leads contatados · últimos ${filter.days}d`, type: 'leads', statusFilter: 'CONTACTED', days: filter.days })} />
          <BigKpi color="amber"   icon={Sparkles}   label="Demos"      value={topOfFunnel.demos}     spark={null} delta={null}
            sub={`${topOfFunnel.conversion.contatoToDemo.toFixed(0)}% conv.`}
            onClick={() => setDrillDown({ title: `Demos enviadas · últimos ${filter.days}d`, type: 'leads', statusFilter: 'DEMO_SENT', days: filter.days })} />
          <BigKpi color="emerald" icon={Award}      label="Fechados"   value={topOfFunnel.fechados}  spark={topOfFunnel.sparklines.converted}  delta={delta(topOfFunnel.fechados, previous?.leadsConverted)}
            sub={`${topOfFunnel.conversion.demoToFechou.toFixed(0)}% close`}
            onClick={() => setDrillDown({ title: `Leads convertidos · últimos ${filter.days}d`, type: 'leads', statusFilter: 'CONVERTED', days: filter.days })} />
          <BigKpi color="rose"    icon={X}          label="Perdidos"   value={topOfFunnel.perdidos}  spark={null} delta={delta(topOfFunnel.perdidos, previous?.leadsLost)}
            invertDelta
            onClick={() => setDrillDown({ title: `Leads perdidos · últimos ${filter.days}d`, type: 'leads', statusFilter: 'LOST', days: filter.days })} />
        </div>
      </div>

      {/* ───────────── BLOCO 2: ATIVIDADES + HEATMAP ───────────── */}
      <div>
        <SectionHeader icon={Activity} color="cyan" title="Atividades da equipe" subtitle={`${activities.total} eventos no período`} />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <ActivityKpi icon={Phone}        color="emerald" label="Calls"     value={activities.calls}    delta={delta(activities.calls, previous?.calls)} />
          <ActivityKpi icon={Mail}         color="cyan"    label="Emails"    value={activities.emails}    />
          <ActivityKpi icon={MessageCircle} color="emerald" label="WhatsApp" value={activities.whatsapp}  />
          <ActivityKpi icon={Calendar}     color="violet"  label="Reuniões"  value={activities.meetings}  />
          <ActivityKpi icon={FileText}     color="slate"   label="Notas"     value={activities.notes}     />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Sparkline atividades por dia */}
          <GlassCard className="p-4 lg:col-span-1">
            <p className="text-xs uppercase text-slate-500 mb-2">Atividades por dia</p>
            <SparkBar data={activities.perDay} color="cyan" height={60} />
            <p className="text-[10px] text-slate-500 mt-2">
              Pico: {Math.max(...activities.perDay)} eventos · Média: {Math.round(activities.perDay.reduce((a: number, b: number) => a + b, 0) / Math.max(activities.perDay.length, 1))}
            </p>
          </GlassCard>

          {/* Heatmap calendário hora × dia da semana */}
          <GlassCard className="p-4 lg:col-span-2">
            <p className="text-xs uppercase text-slate-500 mb-2">Heatmap · hora × dia da semana</p>
            <HeatmapCalendar data={activities.heatmap} />
          </GlassCard>
        </div>
      </div>

      {/* ───────────── BLOCO 3: RECEITA ───────────── */}
      <div>
        <SectionHeader icon={DollarSign} color="emerald" title="Receita / Fechamentos" subtitle="MRR fechado e tendência" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <BigKpi color="emerald" icon={DollarSign} label="MRR fechado"
            value={`R$ ${(revenue.mrrClosed).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
            delta={delta(revenue.mrrClosed, previous?.mrrClosed)} />
          <BigKpi color="amber"   icon={Award}     label="Ticket médio"
            value={`R$ ${(revenue.avgTicket).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
            sub={`${revenue.dealsWon} deals`} />
          <BigKpi color="cyan"    icon={Trophy}    label="Win Rate"
            value={`${revenue.winRate.toFixed(0)}%`}
            sub="ganhos vs perdas" />
          <BigKpi color="violet"  icon={Target}    label="Pipeline"
            value={`R$ ${(revenue.pipelineValue).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
            sub={`${revenue.pipelineCount} oportunidades`} />
        </div>

        {/* Tendência 12 semanas */}
        <GlassCard className="p-4">
          <p className="text-xs uppercase text-slate-500 mb-3">Tendência MRR (12 semanas)</p>
          <SparkLine data={revenue.trend.map((t: any) => t.mrr)} labels={revenue.trend.map((t: any) => t.week.slice(5))} color="emerald" height={120} />
        </GlassCard>

        {/* Sales Velocity */}
        {stats.salesVelocity && (
          <GlassCard className="p-4 border-violet-500/30 bg-violet-500/5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase text-violet-300 font-bold">Sales Velocity</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  R$ {stats.salesVelocity.value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  <span className="text-xs text-slate-500 font-normal ml-2">por dia</span>
                </p>
                <p className="text-[10px] text-slate-500 mt-1" title={stats.salesVelocity.formula}>
                  Fórmula: Leads × Win Rate × Ticket Médio ÷ Ciclo Médio ({stats.salesVelocity.avgCycleDays.toFixed(0)}d)
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase text-slate-500">Ciclo médio</p>
                <p className="text-xl font-bold text-violet-300">{stats.salesVelocity.avgCycleDays.toFixed(0)}d</p>
              </div>
            </div>
          </GlassCard>
        )}
      </div>

      {/* ───────────── BLOCO 3.5: TEMPO MÉDIO POR ETAPA (cycle-time) ───────────── */}
      <CycleTimeBlock />

      {/* ───────────── BLOCO 4: FUNIL VISUAL + GARGALO ───────────── */}
      <GlassCard className="p-4">
        <SectionHeader icon={Layers} color="cyan" title="Funil de conversão" subtitle="Identificação automática de gargalos" inline />
        <div className="space-y-2 mt-3">
          {funnel.stages.map((s: any, idx: number) => (
            <FunnelStage key={s.stage}
              label={s.stage}
              value={s.value}
              max={funnel.stages[0].value || 1}
              conversion={idx > 0 ? s.conversionFromPrev : null}
              isBottleneck={s.stage === funnel.bottleneck.stage} />
          ))}
        </div>
        {funnel.bottleneck && (
          <div className="mt-3 p-2 rounded bg-rose-500/10 border border-rose-500/20">
            <p className="text-xs text-rose-300">
              ⚠️ <strong>Gargalo identificado</strong>: etapa <strong>{funnel.bottleneck.stage}</strong> com conversão {funnel.bottleneck.conversion.toFixed(0)}%.
              Considere revisar abordagem nesta etapa.
            </p>
          </div>
        )}
      </GlassCard>

      {/* ───────────── BLOCO 5: TOP PERFORMERS ───────────── */}
      {topPerformers && topPerformers.length > 0 && (
        <div>
          <SectionHeader icon={Trophy} color="amber" title="Top performers" subtitle="Mês atual" />
          <GlassCard className="p-4">
            <div className="space-y-2">
              {topPerformers.slice(0, 5).map((p: any, idx: number) => (
                <PerformerRow key={p.salesUser.id} performer={p} rank={idx + 1} />
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {/* ───────────── BLOCO 6: FEATURES VENDIDAS ───────────── */}
      {featuresSold && featuresSold.length > 0 && (
        <div>
          <SectionHeader icon={Zap} color="amber" title="Features vendidas" subtitle="Mix de produto · cross-sell tracker" />
          <GlassCard className="p-4">
            <div className="grid gap-2">
              {featuresSold.slice(0, 8).map((f: any) => (
                <FeatureRow key={f.module} feature={f} maxMrr={featuresSold[0].mrr} />
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {/* ───────────── BLOCO 7: ALERTAS OPERACIONAIS ───────────── */}
      <div>
        <SectionHeader icon={Bell} color="rose" title="Alertas e ações" />
        <div className="grid gap-2">
          {alerts.hotSemContato > 0 && (
            <AlertCard color="rose" icon={Flame}
              title={`${alerts.hotSemContato} leads HOT sem contato há > 4h`}
              action="Distribuir agora"
              link="/admin/comercial?tab=pipeline" />
          )}
          {alerts.demosVencendo > 0 && (
            <AlertCard color="amber" icon={Sparkles}
              title={`${alerts.demosVencendo} demos vencendo em 7 dias`}
              action="Avisar Closers"
              link="/admin/comercial?tab=demos" />
          )}
          {alerts.oppsBig > 0 && (
            <AlertCard color="emerald" icon={DollarSign}
              title={`${alerts.oppsBig} oportunidades > R$ 10k abertas`}
              action="Revisar pipeline"
              link="/admin/comercial?tab=opportunities" />
          )}
          {alerts.semAtividadeHoje && (
            <AlertCard color="rose" icon={AlertTriangle}
              title="Sem atividade registrada hoje"
              action="Investigar"
              link="/admin/comercial?tab=activities" />
          )}
          {!alerts.hotSemContato && !alerts.demosVencendo && !alerts.oppsBig && !alerts.semAtividadeHoje && (
            <GlassCard className="p-6 text-center border-emerald-500/20">
              <p className="text-sm text-emerald-300">✨ Operação saudável — nenhum alerta crítico.</p>
            </GlassCard>
          )}
        </div>
      </div>

      {drillDown && (
        <DrillDownModal
          data={drillDown}
          onClose={() => setDrillDown(null)}
          onPickLead={(id) => { setDrillDown(null); setDrawerLeadId(id) }}
        />
      )}
      {drawerLeadId && (
        <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function FilterBar({ filter, setFilter, team }: { filter: ExecStatsFilter; setFilter: (f: ExecStatsFilter) => void; team: any[] }) {
  return (
    <GlassCard className="p-3 sticky top-0 z-20 backdrop-blur-md">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <Filter className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-slate-500 font-bold uppercase tracking-wider">Filtros:</span>

        {/* Período */}
        <div className="flex items-center gap-1">
          {PERIOD_PRESETS.map(p => (
            <button key={p.label} onClick={() => setFilter({ ...filter, days: p.days })}
              className={cn('px-2 py-1 rounded text-[10px] font-bold border',
                filter.days === p.days
                  ? 'bg-violet-500/30 text-violet-200 border-violet-500/50'
                  : 'text-slate-400 border-slate-200 dark:border-white/10 hover:border-white/20')}>
              {p.label}
            </button>
          ))}
        </div>

        <span className="text-slate-700">|</span>

        {/* Time */}
        <select value={filter.team ?? 'all'} onChange={e => setFilter({ ...filter, team: e.target.value as any, vendedorId: undefined })}
          className="px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
          <option value="all">Equipe inteira</option>
          <option value="SDR">SDRs</option>
          <option value="HUNTER">Hunters</option>
          <option value="CLOSER">Closers</option>
          <option value="AE">AEs</option>
          <option value="CS">CSMs</option>
        </select>

        {/* Vendedor */}
        <select value={filter.vendedorId ?? ''} onChange={e => setFilter({ ...filter, vendedorId: e.target.value || undefined })}
          className="px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
          <option value="">Todos vendedores</option>
          {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        {/* Vertical */}
        <select value={filter.vertical ?? ''} onChange={e => setFilter({ ...filter, vertical: e.target.value || undefined })}
          className="px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
          <option value="">Todas verticais</option>
          {VERTICALS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>

        {/* Kind */}
        <select value={filter.kind ?? ''} onChange={e => setFilter({ ...filter, kind: e.target.value as any || undefined })}
          className="px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
          <option value="">INTG + CF</option>
          <option value="INTEGRADOR">Integradores</option>
          <option value="CLIENTE_FINAL">Clientes Finais</option>
        </select>

        {/* Compare toggle */}
        <label className="flex items-center gap-1 text-slate-400 cursor-pointer">
          <input type="checkbox" checked={filter.compare ?? true}
            onChange={e => setFilter({ ...filter, compare: e.target.checked })}
            className="accent-violet-500" />
          vs período anterior
        </label>
      </div>
    </GlassCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, color, title, subtitle, inline }: {
  icon: any; color: string; title: string; subtitle?: string; inline?: boolean
}) {
  const cls: Record<string, string> = {
    violet: 'text-violet-400', cyan: 'text-cyan-400', amber: 'text-amber-400',
    emerald: 'text-emerald-400', rose: 'text-rose-400',
  }
  if (inline) return (
    <div className="flex items-center gap-2">
      <Icon className={cn('w-4 h-4', cls[color])} />
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
      {subtitle && <span className="text-xs text-slate-500">· {subtitle}</span>}
    </div>
  )
  return (
    <div className="flex items-center gap-2 mb-2 px-1">
      <Icon className={cn('w-4 h-4', cls[color])} />
      <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">{title}</h2>
      {subtitle && <span className="text-xs text-slate-500">· {subtitle}</span>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function BigKpi({ color, icon: Icon, label, value, sub, spark, delta, invertDelta, onClick }: {
  color: string; icon: any; label: string; value: number | string
  sub?: string; spark?: number[] | null; delta?: { pct: number; up: boolean } | null
  invertDelta?: boolean; onClick?: () => void
}) {
  const cls: Record<string, string> = {
    violet:  'border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10',
    cyan:    'border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/10',
    amber:   'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10',
    rose:    'border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10',
  }
  const iconCls: Record<string, string> = {
    violet: 'text-violet-400', cyan: 'text-cyan-400', amber: 'text-amber-400',
    emerald: 'text-emerald-400', rose: 'text-rose-400',
  }
  const positiveIsGood = !invertDelta
  const deltaGood = delta ? (positiveIsGood ? delta.up : !delta.up) : null

  return (
    <motion.div whileHover={{ y: -2 }}
      className={cn('p-4 rounded-lg border transition cursor-pointer', cls[color])}
      onClick={onClick}>
      <div className="flex items-start justify-between mb-2">
        <Icon className={cn('w-5 h-5', iconCls[color])} />
        {delta && (
          <span className={cn('flex items-center gap-0.5 text-[10px] font-bold',
            deltaGood ? 'text-emerald-400' : 'text-rose-400')}>
            {delta.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {delta.pct.toFixed(0)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
      {spark && spark.length > 1 && (
        <div className="mt-2"><SparkBar data={spark} color={color} height={20} small /></div>
      )}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function ActivityKpi({ color, icon: Icon, label, value, delta }: {
  color: string; icon: any; label: string; value: number; delta?: { pct: number; up: boolean } | null
}) {
  const cls: Record<string, string> = {
    emerald: 'text-emerald-400', cyan: 'text-cyan-400', violet: 'text-violet-400',
    slate: 'text-slate-400', amber: 'text-amber-400', rose: 'text-rose-400',
  }
  return (
    <div className="p-3 rounded-lg bg-white/[0.03] border border-slate-200 dark:border-white/10">
      <div className="flex items-center justify-between">
        <Icon className={cn('w-4 h-4', cls[color])} />
        {delta && (
          <span className={cn('text-[9px] font-bold', delta.up ? 'text-emerald-400' : 'text-rose-400')}>
            {delta.up ? '↑' : '↓'}{delta.pct.toFixed(0)}%
          </span>
        )}
      </div>
      <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">{value.toLocaleString('pt-BR')}</p>
      <p className="text-[9px] uppercase text-slate-500">{label}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function FunnelStage({ label, value, max, conversion, isBottleneck }: {
  label: string; value: number; max: number; conversion: number | null; isBottleneck?: boolean
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-600 dark:text-slate-300 capitalize">{label}</span>
        <div className="flex items-center gap-2">
          {conversion != null && (
            <span className={cn('text-[10px]',
              isBottleneck ? 'text-rose-300 font-bold' : 'text-slate-500')}>
              {isBottleneck && '⚠ '}
              {conversion.toFixed(0)}% ↓
            </span>
          )}
          <span className="font-bold text-slate-900 dark:text-white">{value}</span>
        </div>
      </div>
      <div className="h-3 rounded-full bg-slate-50 dark:bg-white/5 overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          className={cn('h-full',
            isBottleneck ? 'bg-rose-500' : 'bg-gradient-to-r from-violet-500 to-cyan-500')} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function PerformerRow({ performer, rank }: { performer: any; rank: number }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`
  return (
    <div className="flex items-center gap-3 p-2 rounded bg-white/[0.02] border border-slate-200 dark:border-white/5">
      <span className="text-base font-bold w-8 text-center">{medal}</span>
      <div className="flex-1">
        <p className="text-sm font-bold text-slate-900 dark:text-white">{performer.salesUser.name}</p>
        <p className="text-[10px] text-slate-500">{performer.salesUser.role}</p>
      </div>
      <div className="grid grid-cols-4 gap-3 text-xs text-right">
        <div><p className="text-emerald-300 font-bold">R$ {performer.mrr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p><p className="text-[9px] text-slate-500">MRR</p></div>
        <div><p className="text-cyan-300 font-bold">{performer.deals}</p><p className="text-[9px] text-slate-500">deals</p></div>
        <div><p className="text-amber-300 font-bold">{performer.demos}</p><p className="text-[9px] text-slate-500">demos</p></div>
        <div><p className="text-violet-300 font-bold">{performer.calls}</p><p className="text-[9px] text-slate-500">calls</p></div>
      </div>
      {performer.target > 0 && (
        <div className="w-24">
          <div className="h-1.5 rounded-full bg-slate-50 dark:bg-white/5 overflow-hidden">
            <div className={cn('h-full', performer.pctTarget >= 80 ? 'bg-emerald-500' : performer.pctTarget >= 50 ? 'bg-amber-500' : 'bg-rose-500')}
              style={{ width: `${Math.min(100, performer.pctTarget)}%` }} />
          </div>
          <p className="text-[9px] text-slate-500 text-center mt-0.5">{performer.pctTarget.toFixed(0)}% meta</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function FeatureRow({ feature, maxMrr }: { feature: any; maxMrr: number }) {
  const pct = maxMrr > 0 ? (feature.mrr / maxMrr) * 100 : 0
  return (
    <div className="flex items-center gap-3 p-2 rounded hover:bg-white/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">{feature.module}</span>
          <span className="text-xs font-bold text-emerald-300">R$ {feature.mrr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
        </div>
        <div className="h-1 rounded-full bg-slate-50 dark:bg-white/5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="text-right shrink-0 w-20">
        <p className="text-xs text-slate-900 dark:text-white">{feature.count} venda{feature.count !== 1 ? 's' : ''}</p>
        <p className="text-[9px] text-slate-500 uppercase">{feature.type === 'CROSS_SELL' ? 'cross' : feature.type === 'UPSELL' ? 'upsell' : 'novo'}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function AlertCard({ color, icon: Icon, title, action, link }: {
  color: string; icon: any; title: string; action: string; link: string
}) {
  const cls: Record<string, string> = {
    rose:    'border-rose-500/30 bg-rose-500/10 text-rose-300',
    amber:   'border-amber-500/30 bg-amber-500/10 text-amber-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  }
  return (
    <Link to={link} className={cn('flex items-center gap-3 p-3 rounded-lg border hover:bg-slate-50 dark:bg-white/5 transition', cls[color])}>
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 text-sm">{title}</span>
      <span className="text-xs font-bold flex items-center gap-1">
        {action} <ChevronRight className="w-3 h-3" />
      </span>
    </Link>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function SparkBar({ data, color, height = 40, small: _small }: { data: number[]; color: string; height?: number; small?: boolean }) {
  const max = Math.max(...data, 1)
  const colorMap: Record<string, string> = {
    violet: 'bg-violet-500/60', cyan: 'bg-cyan-500/60', amber: 'bg-amber-500/60',
    emerald: 'bg-emerald-500/60', rose: 'bg-rose-500/60',
  }
  return (
    <div className="flex items-end gap-px" style={{ height }}>
      {data.map((v, i) => (
        <div key={i} className={cn('flex-1 rounded-t transition', colorMap[color] ?? 'bg-slate-500/60')}
          style={{ height: `${Math.max(2, (v / max) * height)}px` }}
          title={`Dia ${i+1}: ${v}`} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function SparkLine({ data, labels, color, height = 80 }: { data: number[]; labels?: string[]; color: string; height?: number }) {
  const max = Math.max(...data, 1)
  const w = 100 / Math.max(data.length - 1, 1)
  const points = data.map((v, i) => `${i * w},${100 - (v / max) * 100}`).join(' ')
  const colorMap: Record<string, string> = {
    violet: '#8b5cf6', cyan: '#00C0D0', amber: '#f59e0b', emerald: '#10b981', rose: '#f43f5e',
  }
  return (
    <div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} className="w-full">
        <polyline fill="none" stroke={colorMap[color] ?? '#00C0D0'} strokeWidth="1.2" points={points} />
        {/* Dots */}
        {data.map((v, i) => (
          <circle key={i} cx={i * w} cy={100 - (v / max) * 100} r="0.8" fill={colorMap[color] ?? '#00C0D0'} />
        ))}
      </svg>
      {labels && (
        <div className="flex justify-between text-[9px] text-slate-600 mt-1 font-mono">
          {labels.map((l, i) => (i % 2 === 0 ? <span key={i}>{l}</span> : <span key={i}></span>))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function HeatmapCalendar({ data }: { data: number[][] }) {
  const max = Math.max(...data.flat(), 1)
  const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
  return (
    <div>
      <div className="flex gap-px text-[8px] text-slate-600 ml-8 mb-1">
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} className="flex-1 text-center" style={{ minWidth: 12 }}>
            {h % 3 === 0 ? h : ''}
          </div>
        ))}
      </div>
      {data.map((row, d) => (
        <div key={d} className="flex items-center gap-px mb-px">
          <span className="text-[9px] text-slate-500 w-7 shrink-0 text-right pr-1">{days[d]}</span>
          {row.map((v, h) => {
            const intensity = v / max
            return (
              <div key={h} className="flex-1 rounded-sm transition hover:scale-125"
                style={{
                  height: 12,
                  minWidth: 12,
                  backgroundColor: v === 0 ? 'rgba(255,255,255,0.03)' : `rgba(6,182,212,${0.1 + intensity * 0.7})`,
                }}
                title={`${days[d]} ${h}h: ${v} eventos`} />
            )
          })}
        </div>
      ))}
      <div className="flex items-center gap-1 mt-2 text-[9px] text-slate-500">
        <span>menos</span>
        <div className="flex gap-px">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map(i => (
            <div key={i} style={{ width: 12, height: 8, backgroundColor: `rgba(6,182,212,${i})` }} className="rounded-sm" />
          ))}
        </div>
        <span>mais</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function DrillDownModal({ data, onClose, onPickLead }: {
  data: { title: string; type: string; statusFilter?: string; days?: number }
  onClose: () => void
  onPickLead: (id: string) => void
}) {
  // Monta query do backend conforme tipo
  const queryUrl = (() => {
    if (data.type === 'leads') {
      const p = new URLSearchParams()
      if (data.statusFilter) p.set('status', data.statusFilter)
      p.set('limit', '500')
      return `/leads?${p}`
    }
    return null
  })()

  const { data: result, isLoading } = useSWR<any>(queryUrl, fetcher)

  // Filtra por período (criação ou conversão dependendo do tipo)
  const items: any[] = useMemo(() => {
    const list = result?.items ?? result?.leads ?? []
    if (!data.days) return list
    const since = Date.now() - data.days * 24 * 3600 * 1000
    return list.filter((l: any) => {
      const ref = data.statusFilter === 'CONVERTED'
        ? l.convertedAt
        : data.statusFilter === 'DEMO_SENT'
          ? l.demoSentAt
          : data.statusFilter === 'CONTACTED'
            ? l.contactedAt
            : data.statusFilter === 'LOST'
              ? l.updatedAt
              : l.createdAt
      return ref ? new Date(ref).getTime() >= since : true
    })
  }, [result, data])

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-4xl max-h-[80vh] flex flex-col bg-space-900 border border-violet-500/30 rounded-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-white/10">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{data.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{items.length} resultados · clique para abrir o lead</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="space-y-1">{[0,1,2,3].map(i => <div key={i} className="h-12 bg-slate-50 dark:bg-white/5 rounded animate-pulse" />)}</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="w-12 h-12 mx-auto text-slate-700 mb-3" />
              <p className="text-sm text-slate-500">Nenhum lead encontrado neste período/filtro.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((l: any) => (
                <button key={l.id} onClick={() => onPickLead(l.id)}
                  className="w-full text-left flex items-center gap-3 p-2 rounded hover:bg-violet-500/10 border border-transparent hover:border-violet-500/30 transition group">
                  <div className="w-8 h-8 rounded bg-gradient-to-br from-violet-500/30 to-cyan-500/30 border border-violet-500/30 flex items-center justify-center text-xs font-bold text-violet-300 shrink-0">
                    {(l.contactName?.[0] ?? 'L').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{l.contactName}</p>
                      <span className={cn('px-1 py-0.5 rounded text-[9px] uppercase font-bold',
                        l.kind === 'INTEGRADOR'
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : 'bg-violet-500/20 text-violet-300')}>
                        {l.kind === 'INTEGRADOR' ? 'INTG' : 'CF'}
                      </span>
                      <span className={cn('px-1 py-0.5 rounded text-[9px] uppercase',
                        l.status === 'NEW' ? 'bg-cyan-500/15 text-cyan-300' :
                        l.status === 'CONTACTED' ? 'bg-violet-500/15 text-violet-300' :
                        l.status === 'DEMO_SENT' ? 'bg-amber-500/15 text-amber-300' :
                        l.status === 'CONVERTED' ? 'bg-emerald-500/15 text-emerald-300' :
                                                    'bg-rose-500/15 text-rose-300')}>
                        {l.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500 truncate">
                      {l.companyName && <span className="truncate">🏢 {l.companyName}</span>}
                      <span className="font-mono">{l.contactEmail}</span>
                      {l.cameraVolume && <span>📹 {l.cameraVolume}</span>}
                      {l.city && <span>📍 {l.city}/{l.state}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-slate-500">{new Date(l.createdAt).toLocaleDateString('pt-BR')}</p>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-violet-400 ml-auto" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-slate-200 dark:border-white/10 flex items-center justify-between bg-white/[0.02]">
          <p className="text-[10px] text-slate-500">Total: {items.length}</p>
          <Link to="/admin/comercial?tab=pipeline" className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
            Abrir no Pipeline <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function ExecSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-12 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />
      <div className="grid grid-cols-5 gap-3">
        {[0,1,2,3,4].map(i => <div key={i} className="h-24 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />)}
      </div>
      <div className="h-32 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />
      <div className="h-48 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bloco de Tempo médio por etapa (cycle-time) — identifica gargalo do funil.
const STAGE_LABEL: Record<string, string> = {
  NEW: 'Novo', CONTACTED: 'Contatado', DEMO_SENT: 'Demo enviada',
  NEGOTIATION: 'Negociação', CONVERTED: 'Convertido', LOST: 'Perdido',
}
const STAGE_COLOR: Record<string, string> = {
  NEW: 'cyan', CONTACTED: 'violet', DEMO_SENT: 'amber',
  NEGOTIATION: 'fuchsia', CONVERTED: 'emerald', LOST: 'rose',
}

function CycleTimeBlock() {
  const { data, isLoading } = useCycleTime(90)
  if (isLoading) return <div className="h-32 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />
  if (!data || !data.stages.length) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Tempo médio por etapa</h3>
          <span className="text-[10px] text-slate-500">últimos 90 dias</span>
        </div>
        <p className="text-xs text-slate-500 italic">
          Sem transições registradas ainda. Cada movimento de lead alimenta este bloco.
        </p>
      </GlassCard>
    )
  }

  const max = Math.max(...data.stages.map(s => s.avgDays))
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Tempo médio por etapa</h3>
          <span className="text-[10px] text-slate-500">últimos 90d · {data.totalLeads} leads movimentados</span>
        </div>
        {data.bottleneck && (
          <span className="text-[10px] text-amber-300 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Gargalo: {STAGE_LABEL[data.bottleneck.stage] ?? data.bottleneck.stage} ({data.bottleneck.avgDays}d)
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {data.stages.map(s => {
          const pct = max > 0 ? (s.avgDays / max) * 100 : 0
          const color = STAGE_COLOR[s.stage] ?? 'slate'
          const colorBg: Record<string, string> = {
            cyan: 'bg-cyan-500/40', violet: 'bg-violet-500/40', amber: 'bg-amber-500/40',
            fuchsia: 'bg-fuchsia-500/40', emerald: 'bg-emerald-500/40', rose: 'bg-rose-500/40',
            slate: 'bg-slate-500/40',
          }
          return (
            <div key={s.stage} className="flex items-center gap-2">
              <span className="text-[11px] text-slate-600 dark:text-slate-300 w-28 shrink-0 truncate">{STAGE_LABEL[s.stage] ?? s.stage}</span>
              <div className="flex-1 h-5 rounded bg-slate-50 dark:bg-white/5 relative overflow-hidden">
                <div className={cn('h-full rounded transition-all', colorBg[color])}
                  style={{ width: `${Math.max(pct, 2)}%` }} />
                <span className="absolute inset-0 flex items-center px-2 text-[10px] text-slate-900 dark:text-white font-mono">
                  {s.avgDays}d <span className="text-slate-400 ml-2">({s.sampleCount} amostras)</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-slate-500 italic mt-2">
        💡 Etapa com tempo elevado = gargalo. Foque coaching ou processos onde o lead "estaciona".
      </p>
    </GlassCard>
  )
}
