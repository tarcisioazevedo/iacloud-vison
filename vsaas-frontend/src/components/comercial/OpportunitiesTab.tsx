/**
 * OpportunitiesTab — Oportunidades comerciais (cross-sell/upsell + new leads).
 *
 * Mostra 2 seções:
 *   - 🎯 Novas vendas (NEW_LEAD)
 *   - 📈 Expansão de base (CROSS_SELL · UPSELL · RENEWAL)
 *
 * Botão "Auto-detectar" roda heurísticas no backend para gerar oportunidades
 * em integradores existentes (cross-sell de módulos baseado em vertical, quota, etc).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Layers, Sparkles, RefreshCw, TrendingUp, Building2, Brain,
  CheckCircle, XCircle, Loader2,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import {
  useSalesOpportunities, autoDetectOpportunities, updateOpportunity, formatApiError,
  type SalesOpportunity,
} from '../../api/client'
import { cn } from '../../lib/utils'
import { useUiToast } from '../Toast'
import { bg500_20, bg500_30, border500_40, text200, text400 } from '../../lib/colorClasses'

const TYPE_CONFIG: Record<string, { color: string; label: string; icon: any }> = {
  NEW_LEAD:    { color: 'violet',  label: 'Novo lead',  icon: Sparkles },
  CROSS_SELL:  { color: 'emerald', label: 'Cross-sell', icon: Layers },
  UPSELL:      { color: 'amber',   label: 'Upsell',     icon: TrendingUp },
  RENEWAL:     { color: 'cyan',    label: 'Renovação',  icon: RefreshCw },
}

export function OpportunitiesTab() {
  const toast = useUiToast()
  const { data, isLoading, mutate } = useSalesOpportunities({ status: 'OPEN' })
  const [busy, setBusy] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)

  async function detect() {
    setBusy(true)
    try {
      const r = await autoDetectOpportunities()
      mutate()
      toast.success(`${r.created} novas oportunidades detectadas com base em sinais de cross-sell/upsell.`)
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setBusy(false) }
  }

  async function setStatus(id: string, status: 'WON' | 'LOST' | 'STALLED') {
    let lostReason: string | undefined
    if (status === 'LOST') {
      const reason = prompt('Motivo da perda? (opcional)')
      if (reason === null) return
      lostReason = reason || undefined
    }
    setActingId(id)
    try { await updateOpportunity(id, { status, lostReason }); mutate() }
    catch (e) { toast.error(formatApiError(e)) }
    finally { setActingId(null) }
  }

  if (isLoading) return <div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />

  const opps = data?.opportunities ?? []
  const newLead = opps.filter((o: SalesOpportunity) => o.type === 'NEW_LEAD')
  const expansion = opps.filter((o: SalesOpportunity) => ['CROSS_SELL','UPSELL','RENEWAL'].includes(o.type))

  return (
    <div className="space-y-4">
      {/* Header com KPIs + ação auto-detect */}
      <GlassCard className="p-4 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-violet-500/5 to-transparent">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <Layers className="w-6 h-6 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-white">Oportunidades Comerciais</h3>
              <p className="text-xs text-slate-400 mt-1">
                Pipeline real de novas vendas (leads) + expansão em base instalada (cross-sell/upsell de módulos).
              </p>
              <div className="flex gap-3 mt-2 text-xs">
                <span><span className="text-violet-300 font-bold">{newLead.length}</span> <span className="text-slate-500">novos leads</span></span>
                <span><span className="text-emerald-300 font-bold">{expansion.length}</span> <span className="text-slate-500">expansão</span></span>
                <span><span className="text-amber-300 font-bold">R$ {(data?.totalValue ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span> <span className="text-slate-500">pipeline</span></span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={detect} disabled={busy}
              className="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
              Auto-detectar
            </button>
            <p className="text-[10px] text-slate-500 max-w-[180px] text-center">
              IA analisa base instalada e sugere cross-sell/upsell de módulos
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Seção: Expansão (CROSS_SELL/UPSELL) */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-emerald-300 font-bold mb-2 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Expansão de Base ({expansion.length})
        </h3>
        {expansion.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <Sparkles className="w-10 h-10 mx-auto text-slate-700 mb-2" />
            <p className="text-sm text-slate-500">Nenhuma oportunidade em base instalada detectada.</p>
            <p className="text-xs text-slate-600 mt-1">Clique em "Auto-detectar" para analisar tenants existentes.</p>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {expansion.map((o: SalesOpportunity) => (
              <OpportunityCard key={o.id} opp={o} onAction={setStatus} acting={actingId === o.id} />
            ))}
          </div>
        )}
      </div>

      {/* Seção: Novos leads */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-violet-300 font-bold mb-2 flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> Novas Vendas ({newLead.length})
        </h3>
        {newLead.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <p className="text-sm text-slate-500">Nenhuma oportunidade de novo lead aberta no momento.</p>
            <p className="text-xs text-slate-600 mt-1">Oportunidades novas surgem quando demos viram negociação.</p>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {newLead.map((o: SalesOpportunity) => (
              <OpportunityCard key={o.id} opp={o} onAction={setStatus} acting={actingId === o.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function OpportunityCard({ opp, onAction, acting }: {
  opp: SalesOpportunity & { tenantName?: string | null; leadName?: string | null }
  onAction: (id: string, status: 'WON' | 'LOST' | 'STALLED') => void
  acting: boolean
}) {
  const cfg = TYPE_CONFIG[opp.type] ?? TYPE_CONFIG.NEW_LEAD
  const Icon = cfg.icon
  const colorMap: Record<string, string> = {
    violet:  'border-violet-500/30 bg-violet-500/5',
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    amber:   'border-amber-500/30 bg-amber-500/5',
    cyan:    'border-cyan-500/30 bg-cyan-500/5',
  }
  const targetName = opp.tenantName ?? opp.leadName ?? '—'

  return (
    <motion.div whileHover={{ y: -1 }}
      className={cn('p-3 rounded-lg border', colorMap[cfg.color])}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', bg500_20(cfg.color))}>
            <Icon className={cn('w-4 h-4', text400(cfg.color))} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={cn('text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border',
                bg500_30(cfg.color), text200(cfg.color), border500_40(cfg.color))}>
                {cfg.label}
              </span>
              {opp.probability != null && (
                <span className="text-[10px] text-slate-400">{opp.probability}% prob.</span>
              )}
              {opp.integradorId && (
                <Link to={`/admin/tenants/${opp.integradorId}`} className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                  <Building2 className="w-3 h-3" />{targetName}
                </Link>
              )}
            </div>
            <h4 className="text-sm font-bold text-white">{opp.title}</h4>
            {opp.description && <p className="text-xs text-slate-400 mt-1">{opp.description}</p>}
            {opp.modulesProposed && opp.modulesProposed.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {opp.modulesProposed.map((m: string) => (
                  <span key={m} className="px-1.5 py-0.5 rounded text-[9px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 font-mono">
                    {m}
                  </span>
                ))}
              </div>
            )}
            {opp.reasonAi && (
              <div className="mt-2 p-2 rounded bg-black/20 border border-slate-200 dark:border-white/5 flex items-start gap-2">
                <Brain className="w-3 h-3 text-cyan-400 shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-600 dark:text-slate-300 italic">{opp.reasonAi}</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {opp.estimatedMrr && (
            <div className="text-right">
              <p className="text-base font-bold text-emerald-300">
                R$ {opp.estimatedMrr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
              </p>
              <p className="text-[9px] text-slate-500 uppercase">MRR estimado</p>
            </div>
          )}
          <div className="flex gap-1">
            <button onClick={() => onAction(opp.id, 'WON')} disabled={acting}
              className="px-2 py-1 rounded text-[10px] bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30">
              <CheckCircle className="w-3 h-3 inline mr-0.5" /> Ganhei
            </button>
            <button onClick={() => onAction(opp.id, 'LOST')} disabled={acting}
              className="px-2 py-1 rounded text-[10px] bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30">
              <XCircle className="w-3 h-3 inline mr-0.5" /> Perdi
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
