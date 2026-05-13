/**
 * PriorityActionsBar — painel sticky no topo do Pipeline.
 * Mostra ações urgentes do dia: leads HOT sem contato, follow-ups vencidos,
 * progresso em metas, atividades hoje.
 *
 * Colapsável, atualiza a cada 30s.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Flame, AlertTriangle, Target, Phone, MessageCircle, Mail } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { usePriorityActions } from '../../api/client'
import { cn } from '../../lib/utils'

export function PriorityActionsBar({ salesUserId }: { salesUserId?: string }) {
  const { data, isLoading } = usePriorityActions(salesUserId)
  const [collapsed, setCollapsed] = useState(false)

  if (isLoading || !data) return null

  const hot = data.hotLeadsSemContato ?? []
  const overdue = data.overdueFollowUps ?? []
  const progress = data.progressGoals ?? []
  const totalUrgent = hot.length + overdue.length

  if (totalUrgent === 0 && progress.length === 0) return null

  return (
    <GlassCard className="border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-rose-500/5 to-transparent">
      <button onClick={() => setCollapsed(c => !c)}
        className="w-full p-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-sm font-bold text-white">
            <Flame className="w-4 h-4 text-amber-400 animate-pulse" /> Ações Prioritárias
          </span>
          {totalUrgent > 0 && (
            <span className="text-xs text-slate-400">
              {hot.length > 0 && <span className="text-rose-300 font-bold">{hot.length} hot</span>}
              {hot.length > 0 && overdue.length > 0 && ' · '}
              {overdue.length > 0 && <span className="text-amber-300 font-bold">{overdue.length} follow-ups vencidos</span>}
            </span>
          )}
          <span className="text-[10px] text-slate-500 ml-auto sm:ml-0">· hoje: {data.activitiesToday ?? 0} atividades</span>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronUp className="w-4 h-4 text-slate-500" />}
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-200 dark:border-white/5 pt-3">
          {/* HOT leads */}
          {hot.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-rose-300 font-bold mb-1.5 flex items-center gap-1">
                <Flame className="w-3 h-3" /> SEM CONTATO ({hot.length} leads HOT)
              </p>
              <div className="grid gap-1">
                {hot.slice(0, 5).map((l: any) => (
                  <div key={l.id} className="flex items-center gap-2 p-2 rounded bg-rose-500/5 border border-rose-500/20 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/30 text-rose-200 text-[10px] font-bold">{l.score}</span>
                    <span className="text-white font-medium flex-1 truncate">{l.contactName}</span>
                    {l.companyName && <span className="text-slate-500 truncate hidden sm:inline">{l.companyName}</span>}
                    <span className="text-[10px] text-slate-500 shrink-0">há {timeAgo(l.createdAt)}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {l.contactPhone && (
                        <>
                          <a href={`tel:${l.contactPhone}`} className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" title="Ligar">
                            <Phone className="w-3 h-3" />
                          </a>
                          <a href={`https://wa.me/${l.contactPhone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                            className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" title="WhatsApp">
                            <MessageCircle className="w-3 h-3" />
                          </a>
                        </>
                      )}
                      {l.contactEmail && (
                        <a href={`mailto:${l.contactEmail}`} className="p-1 rounded hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300" title="Email">
                          <Mail className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {hot.length > 5 && <Link to="/admin/comercial?tab=pipeline" className="text-[10px] text-rose-300 hover:underline">Ver todos {hot.length} →</Link>}
              </div>
            </div>
          )}

          {/* Overdue follow-ups */}
          {overdue.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-amber-300 font-bold mb-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> FOLLOW-UPS VENCIDOS ({overdue.length})
              </p>
              <div className="grid gap-1">
                {overdue.slice(0, 5).map((f: any) => (
                  <div key={f.id} className="flex items-center gap-2 p-2 rounded bg-amber-500/5 border border-amber-500/20 text-xs">
                    <span className="text-white font-medium flex-1 truncate">{f.lead?.contactName}</span>
                    <span className="text-slate-400 truncate hidden sm:inline italic">"{(f.content ?? '').slice(0, 50)}..."</span>
                    <span className="text-[10px] text-amber-300 shrink-0">venceu {timeAgo(f.dueDate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Progresso de metas */}
          {progress.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-violet-300 font-bold mb-1.5 flex items-center gap-1">
                <Target className="w-3 h-3" /> PROGRESSO HOJE
              </p>
              <div className="grid gap-1">
                {progress.map((g: any) => (
                  <div key={g.metric} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-600 dark:text-slate-300 w-32">{labelMetric(g.metric)}:</span>
                    <span className="font-bold text-white w-20">{g.actual}/{g.target}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-50 dark:bg-white/5 overflow-hidden">
                      <div className={cn('h-full transition-all',
                        g.pct >= 80 ? 'bg-emerald-500' : g.pct >= 50 ? 'bg-amber-500' : 'bg-rose-500')}
                        style={{ width: `${Math.min(100, g.pct)}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-500 w-10 text-right">{g.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}

function labelMetric(m: string): string {
  return ({ CALLS: 'Calls', QUALIFIED_LEADS: 'Quals', DEMOS_SENT: 'Demos', DEALS_CLOSED: 'Deals', CLOSED_MRR: 'MRR R$', REVENUE: 'Revenue' } as any)[m] ?? m
}

function timeAgo(iso: string | Date): string {
  const t = new Date(iso).getTime()
  const diff = Math.floor((Date.now() - t) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}
