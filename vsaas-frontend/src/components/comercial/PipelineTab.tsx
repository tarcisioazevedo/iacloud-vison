/**
 * PipelineTab — Pipeline Kanban com drag-and-drop por status do lead.
 * 5 colunas: NEW · CONTACTED · DEMO_SENT · NEGOTIATION* · CONVERTED · LOST (sidebar)
 * (*NEGOTIATION mapeia para Lead com SalesOpportunity OPEN do tipo NEW_LEAD)
 */
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import { Search, Plus, Filter, RefreshCw, GripVertical, Phone, Mail, MessageCircle, Sparkles, Calendar, Target } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { api, formatApiError, useLeadScore } from '../../api/client'
import { cn } from '../../lib/utils'

const fetcher = (u: string) => api.get(u).then(r => r.data)

const COLUMNS = [
  { id: 'NEW',        label: 'Novos',        color: 'cyan',    description: 'aguardando 1º contato' },
  { id: 'CONTACTED',  label: 'Contatados',   color: 'violet',  description: 'qualificação em andamento' },
  { id: 'DEMO_SENT',  label: 'Demo enviada', color: 'amber',   description: 'aguardando reação' },
  { id: 'CONVERTED',  label: 'Convertidos',  color: 'emerald', description: 'cliente fechado' },
  { id: 'LOST',       label: 'Perdidos',     color: 'rose',    description: 'aprendizado' },
]

export function PipelineTab() {
  const { data, isLoading, mutate } = useSWR<any>('/leads?limit=500', fetcher, { refreshInterval: 30_000 })
  const [search, setSearch] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const list = data?.items ?? data?.leads ?? []
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter((l: any) =>
      (l.contactName ?? '').toLowerCase().includes(q) ||
      (l.companyName ?? '').toLowerCase().includes(q) ||
      (l.contactEmail ?? '').toLowerCase().includes(q)
    )
  }, [data, search])

  const byStatus = useMemo(() => {
    const map: Record<string, any[]> = { NEW: [], CONTACTED: [], DEMO_SENT: [], CONVERTED: [], LOST: [] }
    for (const l of filtered) {
      if (map[l.status]) map[l.status].push(l)
    }
    return map
  }, [filtered])

  async function moveTo(leadId: string, newStatus: string) {
    try {
      await api.patch(`/leads/${leadId}`, { status: newStatus })
      mutate()
    } catch (e) { alert(formatApiError(e)) }
  }

  const totalValue = filtered.length // sem MRR por lead ainda, contagem

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <GlassCard className="p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <Target className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white">{filtered.length} leads no pipeline</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400">arraste cards entre colunas</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar lead..."
                className="pl-7 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white" />
            </div>
            <button onClick={() => mutate()} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </GlassCard>

      {isLoading ? (
        <div className="grid grid-cols-5 gap-2">
          {[0,1,2,3,4].map(i => <div key={i} className="h-96 rounded-lg bg-white/5 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 min-h-[400px]">
          {COLUMNS.map(col => {
            const items = byStatus[col.id] ?? []
            const colorMap: Record<string, string> = {
              cyan:    'border-cyan-500/30 bg-cyan-500/5',
              violet:  'border-violet-500/30 bg-violet-500/5',
              amber:   'border-amber-500/30 bg-amber-500/5',
              emerald: 'border-emerald-500/30 bg-emerald-500/5',
              rose:    'border-rose-500/30 bg-rose-500/5',
            }
            const textMap: Record<string, string> = {
              cyan: 'text-cyan-300', violet: 'text-violet-300', amber: 'text-amber-300',
              emerald: 'text-emerald-300', rose: 'text-rose-300',
            }
            return (
              <div key={col.id}
                onDragOver={e => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const leadId = e.dataTransfer.getData('text/plain')
                  if (leadId && draggingId === leadId) moveTo(leadId, col.id)
                  setDraggingId(null)
                }}
                className={cn('rounded-lg border p-2 min-h-[400px] flex flex-col', colorMap[col.color])}>
                <div className="flex items-center justify-between mb-2 px-1 shrink-0">
                  <h3 className={cn('text-xs font-bold uppercase tracking-wider', textMap[col.color])}>{col.label}</h3>
                  <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded', textMap[col.color])}>{items.length}</span>
                </div>
                <p className="text-[9px] text-slate-500 px-1 mb-2 shrink-0">{col.description}</p>
                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {items.map((lead: any) => (
                    <PipelineCard key={lead.id} lead={lead}
                      onDragStart={() => setDraggingId(lead.id)}
                      onDragEnd={() => setDraggingId(null)} />
                  ))}
                  {items.length === 0 && (
                    <div className="text-[10px] text-slate-600 text-center py-8 italic">arraste um card aqui</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PipelineCard({ lead, onDragStart, onDragEnd }: { lead: any; onDragStart: () => void; onDragEnd: () => void }) {
  const { data: scoreData } = useLeadScore(lead.id)
  const score = scoreData?.score ?? 50

  const scoreColor = score >= 75 ? 'rose' : score >= 50 ? 'amber' : 'slate'
  const scoreCls: Record<string, string> = {
    rose:  'bg-rose-500/30 text-rose-200 border-rose-500/40',
    amber: 'bg-amber-500/30 text-amber-200 border-amber-500/40',
    slate: 'bg-slate-500/30 text-slate-300 border-slate-500/40',
  }

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', lead.id); onDragStart() }}
      onDragEnd={onDragEnd}
      className="bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-white/20 rounded p-2 cursor-grab active:cursor-grabbing transition group"
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="text-xs font-bold text-white truncate flex-1">{lead.contactName}</p>
        <span className={cn('shrink-0 px-1 py-0.5 rounded text-[9px] font-bold border', scoreCls[scoreColor])}>{score}</span>
      </div>
      {lead.companyName && (
        <p className="text-[10px] text-slate-400 truncate">{lead.companyName}</p>
      )}
      <div className="flex items-center gap-1 mt-1.5 text-[9px] text-slate-500">
        <span className={cn('px-1 py-0.5 rounded',
          lead.kind === 'INTEGRADOR' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-violet-500/15 text-violet-300')}>
          {lead.kind === 'INTEGRADOR' ? 'INTG' : 'CF'}
        </span>
        {lead.cameraVolume && <span>· {lead.cameraVolume}</span>}
      </div>
      {lead.contactPhone && (
        <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1 mt-1.5">
          <a href={`tel:${lead.contactPhone}`} className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" onClick={e => e.stopPropagation()}>
            <Phone className="w-2.5 h-2.5" />
          </a>
          <a href={`mailto:${lead.contactEmail}`} className="p-1 rounded hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300" onClick={e => e.stopPropagation()}>
            <Mail className="w-2.5 h-2.5" />
          </a>
          <a href={`https://wa.me/${lead.contactPhone?.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
            className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" onClick={e => e.stopPropagation()}>
            <MessageCircle className="w-2.5 h-2.5" />
          </a>
        </div>
      )}
    </div>
  )
}
