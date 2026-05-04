/**
 * ActivitiesTab — Feed cronológico de atividades da equipe comercial.
 */
import { useState, useMemo } from 'react'
import {
  Activity, Phone, Mail, MessageCircle, Calendar, FileText, CheckSquare, Send, Sparkles, Clock,
  Filter,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { useSalesActivities, useSalesTeam, type SalesActivity } from '../../api/client'
import { cn } from '../../lib/utils'

const TYPE_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  CALL:           { icon: Phone,        color: 'emerald', label: 'Call' },
  EMAIL:          { icon: Mail,         color: 'cyan',    label: 'Email' },
  WHATSAPP:       { icon: MessageCircle, color: 'emerald', label: 'WhatsApp' },
  MEETING:        { icon: Calendar,     color: 'violet',  label: 'Reunião' },
  NOTE:           { icon: FileText,     color: 'slate',   label: 'Nota' },
  TASK:           { icon: CheckSquare,  color: 'amber',   label: 'Tarefa' },
  PROPOSAL_SENT:  { icon: Send,         color: 'rose',    label: 'Proposta' },
  DEMO_DONE:      { icon: Sparkles,     color: 'amber',   label: 'Demo realizada' },
}

export function ActivitiesTab() {
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [salesUserId, setSalesUserId] = useState<string>('')
  const { data, isLoading } = useSalesActivities({
    salesUserId: salesUserId || undefined,
    limit: 100,
  })
  const { data: teamData } = useSalesTeam()

  const filtered = useMemo(() => {
    const list = data?.activities ?? []
    return typeFilter ? list.filter((a: SalesActivity) => a.type === typeFilter) : list
  }, [data, typeFilter])

  // Agrupa por dia
  const byDay = useMemo(() => {
    const map: Record<string, SalesActivity[]> = {}
    for (const act of filtered) {
      const day = new Date(act.createdAt).toLocaleDateString('pt-BR')
      if (!map[day]) map[day] = []
      map[day].push(act)
    }
    return map
  }, [filtered])

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="px-2 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-white">
            <option value="">Todos tipos</option>
            {Object.entries(TYPE_CONFIG).map(([id, c]) => (
              <option key={id} value={id}>{c.label}</option>
            ))}
          </select>
          <select value={salesUserId} onChange={e => setSalesUserId(e.target.value)}
            className="px-2 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-white">
            <option value="">Equipe inteira</option>
            {(teamData?.team ?? []).map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
            ))}
          </select>
          <span className="ml-auto text-xs text-slate-500">{filtered.length} atividades</span>
        </div>
      </GlassCard>

      {isLoading ? (
        <div className="space-y-2">{[0,1,2,3,4].map(i => <div key={i} className="h-12 bg-white/5 rounded animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <Activity className="w-12 h-12 mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500">Nenhuma atividade registrada ainda.</p>
          <p className="text-xs text-slate-600 mt-2">Atividades aparecem aqui conforme equipe registra calls, emails, demos.</p>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {Object.entries(byDay).map(([day, acts]) => (
            <div key={day}>
              <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-2 px-1">{day}</p>
              <GlassCard className="p-2">
                <div className="space-y-1">
                  {acts.map(act => {
                    const cfg = TYPE_CONFIG[act.type] ?? TYPE_CONFIG.NOTE
                    const Icon = cfg.icon
                    const colorMap: Record<string, string> = {
                      emerald: 'text-emerald-400 bg-emerald-500/10',
                      cyan:    'text-cyan-400 bg-cyan-500/10',
                      violet:  'text-violet-400 bg-violet-500/10',
                      slate:   'text-slate-400 bg-slate-500/10',
                      amber:   'text-amber-400 bg-amber-500/10',
                      rose:    'text-rose-400 bg-rose-500/10',
                    }
                    return (
                      <div key={act.id} className="flex items-start gap-3 p-2 rounded hover:bg-white/[0.02] transition">
                        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', colorMap[cfg.color])}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-bold text-white">{act.salesUser?.name ?? 'Sistema'}</span>
                            <span className="text-[10px] text-slate-500">·</span>
                            <span className="text-[10px] text-slate-500">{cfg.label}</span>
                            {act.durationSec && (
                              <>
                                <span className="text-[10px] text-slate-500">·</span>
                                <span className="text-[10px] text-slate-500">{Math.round(act.durationSec / 60)}min</span>
                              </>
                            )}
                          </div>
                          {act.notes && <p className="text-xs text-slate-300 line-clamp-2">{act.notes}</p>}
                          {act.outcome && <p className="text-[10px] text-slate-500 mt-0.5">resultado: {act.outcome}</p>}
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                          <Clock className="w-3 h-3 inline mr-0.5" />
                          {new Date(act.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </GlassCard>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
