/**
 * HealthScoresPage — Saúde dos clientes finais.
 *
 * Persona-aware:
 *   - SUPER_ADMIN  → todos os clientes (filtro por integrador)
 *   - INTEGRADOR_* → seus próprios clientes (auto-scoped via JWT)
 *
 * Layout:
 *   Header + métricas (avg + tier breakdown)
 *   Lista de clientes ordenada por score (piores primeiro)
 *   Drill — signals detalhados em modal
 *
 * Atualiza a cada 60s automaticamente. Cache de 60s no backend reduz hit no DB.
 */
import { useState, useMemo } from 'react'
import { Activity, AlertTriangle, RefreshCw, ChevronRight, X, Camera, Cpu, Clock, Gauge, Sparkles } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { HealthScoreBadge } from '../components/hierarchy'
import { cn } from '../lib/utils'
import {
  useMyHealthScores,
  useAdminHealthScores,
  useClienteHealthScore,
  type ClienteHealthScore,
  type HealthScoreSummary,
} from '../api/client'

const TIER_LABEL: Record<ClienteHealthScore['tier'], { text: string; color: string }> = {
  optimal:  { text: 'Ótimo',     color: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30' },
  good:     { text: 'Bom',       color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20' },
  warn:     { text: 'Atenção',   color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30' },
  bad:      { text: 'Ruim',      color: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/30' },
  critical: { text: 'Crítico',   color: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30' },
}

const SIGNAL_ICONS: Record<string, any> = {
  cameras: Camera,
  edge: Cpu,
  activity_24h: Activity,
  freshness: Clock,
  quota: Gauge,
}

const SIGNAL_LABELS: Record<string, string> = {
  cameras: 'Câmeras ativas',
  edge: 'Edge boxes online',
  activity_24h: 'Atividade 24h',
  freshness: 'Última atividade',
  quota: 'Quota Vertex',
}

export function HealthScoresPage() {
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const isSuper = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
  const scope: 'admin' | 'me' = isSuper ? 'admin' : 'me'

  const adminQuery = useAdminHealthScores()
  const meQuery = useMyHealthScores()
  const { data, error, isLoading, mutate } = isSuper ? adminQuery : meQuery

  const [selected, setSelected] = useState<string | null>(null)

  const sortedScores = useMemo(() => {
    if (!data?.scores) return []
    return [...data.scores].sort((a, b) => a.score - b.score)
  }, [data?.scores])

  return (
    <div className="space-y-4">
      {/* Header */}
      <GlassCard className="p-5 bg-gradient-to-br from-emerald-500/10 via-cyan-500/5 to-transparent border-emerald-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Saúde dos Clientes</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Score 0-100 calculado de 5 sinais: câmeras ativas (30%), edge boxes (25%),
                atividade 24h (20%), quota (15%), última atividade (10%).
              </p>
            </div>
          </div>
          <button
            onClick={() => mutate()}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Recalcular
          </button>
        </div>
      </GlassCard>

      {isLoading && <GlassCard className="p-6 text-center text-sm text-slate-500">Calculando scores…</GlassCard>}
      {error && (
        <GlassCard className="p-6 text-center">
          <AlertTriangle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Falha ao carregar health scores: {String((error as any)?.response?.data?.error ?? (error as any)?.message)}
          </p>
        </GlassCard>
      )}

      {data && (
        <>
          {/* KPIs */}
          <SummaryKPIs summary={data.summary} />

          {/* Lista de clientes */}
          {sortedScores.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <Sparkles className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum cliente final cadastrado ainda.</p>
            </GlassCard>
          ) : (
            <GlassCard className="p-0 overflow-hidden">
              <div className="divide-y divide-slate-200 dark:divide-white/5">
                {sortedScores.map(s => (
                  <ScoreRow key={s.clienteFinalId} score={s} onSelect={() => setSelected(s.clienteFinalId)} />
                ))}
              </div>
            </GlassCard>
          )}
        </>
      )}

      {selected && (
        <DrillModal
          clienteFinalId={selected}
          scope={scope}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function SummaryKPIs({ summary }: { summary: HealthScoreSummary }) {
  const tiers: ClienteHealthScore['tier'][] = ['optimal', 'good', 'warn', 'bad', 'critical']
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <GlassCard className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Score médio</p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-slate-900 dark:text-white">{summary.averageScore}</span>
          <span className="text-xs text-slate-500">/100</span>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">
          Em {summary.total} cliente{summary.total === 1 ? '' : 's'}
        </p>
      </GlassCard>

      <GlassCard className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Distribuição por tier</p>
        <div className="flex items-center gap-1.5">
          {tiers.map(t => (
            <div key={t} className={cn('flex-1 px-1.5 py-1 rounded text-center', TIER_LABEL[t].color)}>
              <p className="text-[9px] uppercase font-semibold">{TIER_LABEL[t].text}</p>
              <p className="text-sm font-bold">{summary.byTier[t]}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Top 3 mais críticos</p>
        {summary.worstClients.slice(0, 3).map(c => (
          <div key={c.id} className="flex items-center justify-between py-1 text-xs">
            <span className="truncate text-slate-700 dark:text-slate-300">{c.name}</span>
            <HealthScoreBadge score={c.score} size="xs" />
          </div>
        ))}
        {summary.worstClients.length === 0 && <p className="text-[10px] text-slate-500">—</p>}
      </GlassCard>
    </div>
  )
}

function ScoreRow({ score, onSelect }: { score: ClienteHealthScore; onSelect: () => void }) {
  const tier = TIER_LABEL[score.tier]
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition text-left"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{score.clienteFinalName}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {score.signals.map(sig => (
            <span
              key={sig.key}
              className={cn(
                'px-1.5 py-0.5 rounded text-[9px] font-mono',
                sig.status === 'ok' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                sig.status === 'warn' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                sig.status === 'crit' && 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
              )}
              title={sig.message}
            >
              {SIGNAL_LABELS[sig.key] ?? sig.key}: {sig.value}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold', tier.color)}>{tier.text}</span>
        <HealthScoreBadge score={score.score} size="md" />
        <ChevronRight className="w-4 h-4 text-slate-400" />
      </div>
    </button>
  )
}

function DrillModal({ clienteFinalId, scope, onClose }: { clienteFinalId: string; scope: 'admin' | 'me'; onClose: () => void }) {
  const { data, error, isLoading } = useClienteHealthScore(clienteFinalId, scope)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl mt-12 bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {data?.clienteFinalName ?? 'Carregando…'}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading && <p className="text-sm text-slate-500">Carregando…</p>}
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">Erro ao carregar.</p>}

        {data && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-slate-50 dark:bg-space-800/50">
              <HealthScoreBadge score={data.score} size="md" />
              <div className="flex-1">
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{data.score}/100</p>
                <span className={cn('inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold', TIER_LABEL[data.tier].color)}>
                  {TIER_LABEL[data.tier].text}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 text-right">
                Calculado<br />{new Date(data.computedAt).toLocaleString('pt-BR')}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Sinais detalhados</p>
              <div className="space-y-2">
                {data.signals.map(sig => {
                  const Icon = SIGNAL_ICONS[sig.key] ?? Activity
                  return (
                    <div key={sig.key} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-white/10">
                      <div className={cn(
                        'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                        sig.status === 'ok' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                        sig.status === 'warn' && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                        sig.status === 'crit' && 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
                      )}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {SIGNAL_LABELS[sig.key] ?? sig.key}
                          </p>
                          <span className="text-[10px] text-slate-500 font-mono">peso {sig.weight}%</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 dark:bg-space-800 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                'h-full transition-all',
                                sig.status === 'ok' && 'bg-emerald-500',
                                sig.status === 'warn' && 'bg-amber-500',
                                sig.status === 'crit' && 'bg-rose-500',
                              )}
                              style={{ width: `${sig.value}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 w-10 text-right">
                            {sig.value}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">{sig.message}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
