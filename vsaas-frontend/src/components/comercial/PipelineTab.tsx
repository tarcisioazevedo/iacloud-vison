/**
 * PipelineTab — Pipeline Kanban integrado: Leads + Opportunities.
 *
 * 5 colunas: NEW · CONTACTED · DEMO_SENT · CONVERTED · LOST
 * Cada card é arrastável; ao mover, faz PATCH no lead E atualiza Opportunity vinculada.
 *
 * Mostra TANTO leads (NEW_LEAD opps) quanto cross-sell/upsell:
 *   - Leads ficam em colunas NEW/CONTACTED/DEMO_SENT/CONVERTED/LOST
 *   - Cross-sell/Upsell aparecem em coluna lateral "Expansão" com status OPEN/WON/LOST
 *
 * Hover em card mostra atalhos call/email/whatsapp que abrem ActivityModal.
 */
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { Search, RefreshCw, Phone, Mail, MessageCircle, Sparkles, Target, Layers, TrendingUp, X, Loader2, Plus } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import {
  api, formatApiError, useLeadScore, useSalesOpportunities, useSalesTeam,
  logSalesActivity, updateOpportunity,
} from '../../api/client'
import { cn } from '../../lib/utils'

const fetcher = (u: string) => api.get(u).then(r => r.data)

const COLUMNS = [
  { id: 'NEW',        label: 'Novos',        color: 'cyan',    description: 'aguardando 1º contato' },
  { id: 'CONTACTED',  label: 'Contatados',   color: 'violet',  description: 'qualificação' },
  { id: 'DEMO_SENT',  label: 'Demo enviada', color: 'amber',   description: 'aguardando reação' },
  { id: 'CONVERTED',  label: 'Convertidos',  color: 'emerald', description: 'cliente fechado' },
  { id: 'LOST',       label: 'Perdidos',     color: 'rose',    description: 'aprendizado' },
]

type CardData =
  | { kind: 'LEAD'; id: string; status: string; lead: any }
  | { kind: 'OPP_NEW';   id: string; status: string; opp: any }
  | { kind: 'OPP_CROSS'; id: string; status: string; opp: any }

export function PipelineTab() {
  const { data: leadsData, isLoading: lLoad, mutate: lMut } = useSWR<any>('/leads?limit=500', fetcher, { refreshInterval: 30_000 })
  const { data: oppsData,  isLoading: oLoad, mutate: oMut } = useSalesOpportunities({ status: 'OPEN' })
  const [search, setSearch] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [activityModal, setActivityModal] = useState<{ leadId?: string; integradorId?: string; channel: string; targetName: string } | null>(null)

  const leads: any[] = leadsData?.items ?? leadsData?.leads ?? []
  const opps: any[] = oppsData?.opportunities ?? []

  // Filtra leads por search
  const filteredLeads = useMemo(() => {
    if (!search) return leads
    const q = search.toLowerCase()
    return leads.filter(l =>
      (l.contactName ?? '').toLowerCase().includes(q) ||
      (l.companyName ?? '').toLowerCase().includes(q) ||
      (l.contactEmail ?? '').toLowerCase().includes(q)
    )
  }, [leads, search])

  // Agrupa leads por status
  const leadsByStatus = useMemo(() => {
    const map: Record<string, any[]> = { NEW: [], CONTACTED: [], DEMO_SENT: [], CONVERTED: [], LOST: [] }
    for (const l of filteredLeads) {
      if (map[l.status]) map[l.status].push(l)
    }
    return map
  }, [filteredLeads])

  // Cross-sell/upsell em coluna separada
  const crossSell = opps.filter(o => ['CROSS_SELL', 'UPSELL', 'RENEWAL'].includes(o.type))

  async function moveLeadTo(leadId: string, newStatus: string) {
    try {
      await api.patch(`/leads/${leadId}`, { status: newStatus })
      lMut(); oMut()
    } catch (e) { alert(formatApiError(e)) }
  }

  async function moveOppTo(oppId: string, newStatus: 'WON' | 'LOST' | 'STALLED' | 'OPEN') {
    try {
      await updateOpportunity(oppId, { status: newStatus })
      oMut()
    } catch (e) { alert(formatApiError(e)) }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <GlassCard className="p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <Target className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white">{filteredLeads.length} leads · {crossSell.length} cross-sell/upsell</span>
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
            <button onClick={() => { lMut(); oMut() }} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Pipeline principal — leads */}
      {(lLoad) ? (
        <div className="grid grid-cols-5 gap-2">
          {[0,1,2,3,4].map(i => <div key={i} className="h-96 rounded-lg bg-white/5 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 min-h-[400px]">
          {COLUMNS.map(col => {
            const items = leadsByStatus[col.id] ?? []
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
                  const id = e.dataTransfer.getData('text/plain')
                  if (id && draggingId === id) moveLeadTo(id, col.id)
                  setDraggingId(null)
                }}
                className={cn('rounded-lg border p-2 min-h-[400px] flex flex-col', colorMap[col.color])}>
                <div className="flex items-center justify-between mb-2 px-1 shrink-0">
                  <h3 className={cn('text-xs font-bold uppercase tracking-wider', textMap[col.color])}>{col.label}</h3>
                  <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded', textMap[col.color])}>{items.length}</span>
                </div>
                <p className="text-[9px] text-slate-500 px-1 mb-2 shrink-0">{col.description}</p>
                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {items.map(lead => (
                    <PipelineLeadCard key={lead.id} lead={lead}
                      onDragStart={() => setDraggingId(lead.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onChannel={(channel) => setActivityModal({ leadId: lead.id, channel, targetName: lead.contactName })} />
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

      {/* Cross-sell / Upsell em base instalada */}
      {crossSell.length > 0 && (
        <div>
          <h2 className="text-xs uppercase tracking-wider text-emerald-300 font-bold mt-4 mb-2 flex items-center gap-2 px-1">
            <Layers className="w-4 h-4" /> Expansão de Base ({crossSell.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {/* Open */}
            <CrossSellColumn label="Em prospecção" status="OPEN" color="violet" items={crossSell.filter(o => o.status === 'OPEN')}
              onMove={moveOppTo} draggingId={draggingId} setDraggingId={setDraggingId}
              onChannel={(o, channel) => setActivityModal({ integradorId: o.integradorId, channel, targetName: o.tenantName ?? o.title })} />
            <CrossSellColumn label="Ganhei" status="WON" color="emerald" items={[]}
              onMove={moveOppTo} draggingId={draggingId} setDraggingId={setDraggingId}
              onChannel={() => {}} />
            <CrossSellColumn label="Perdi" status="LOST" color="rose" items={[]}
              onMove={moveOppTo} draggingId={draggingId} setDraggingId={setDraggingId}
              onChannel={() => {}} />
          </div>
        </div>
      )}

      {activityModal && <ActivityModal data={activityModal} onClose={() => setActivityModal(null)} />}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function PipelineLeadCard({ lead, onDragStart, onDragEnd, onChannel }: {
  lead: any
  onDragStart: () => void
  onDragEnd: () => void
  onChannel: (channel: 'CALL' | 'EMAIL' | 'WHATSAPP') => void
}) {
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

      {/* Atalhos com modal de activity */}
      <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1 mt-1.5">
        {lead.contactPhone && (
          <button onClick={(e) => { e.stopPropagation(); onChannel('CALL') }}
            className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" title="Registrar call">
            <Phone className="w-2.5 h-2.5" />
          </button>
        )}
        {lead.contactEmail && (
          <button onClick={(e) => { e.stopPropagation(); onChannel('EMAIL') }}
            className="p-1 rounded hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300" title="Registrar email">
            <Mail className="w-2.5 h-2.5" />
          </button>
        )}
        {lead.contactPhone && (
          <button onClick={(e) => { e.stopPropagation(); onChannel('WHATSAPP') }}
            className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" title="Registrar WhatsApp">
            <MessageCircle className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function CrossSellColumn({ label, status, color, items, onMove, draggingId, setDraggingId, onChannel }: {
  label: string; status: 'OPEN' | 'WON' | 'LOST'; color: string; items: any[]
  onMove: (oppId: string, status: 'WON' | 'LOST' | 'STALLED' | 'OPEN') => void
  draggingId: string | null
  setDraggingId: (s: string | null) => void
  onChannel: (opp: any, channel: 'CALL' | 'EMAIL' | 'WHATSAPP') => void
}) {
  const colorMap: Record<string, string> = {
    violet:  'border-violet-500/30 bg-violet-500/5',
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    rose:    'border-rose-500/30 bg-rose-500/5',
  }
  const textMap: Record<string, string> = {
    violet: 'text-violet-300', emerald: 'text-emerald-300', rose: 'text-rose-300',
  }
  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('text/plain')
        if (id && draggingId === id) onMove(id, status)
        setDraggingId(null)
      }}
      className={cn('rounded-lg border p-2 min-h-[200px]', colorMap[color])}>
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className={cn('text-xs font-bold uppercase tracking-wider', textMap[color])}>{label}</h3>
        <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded', textMap[color])}>{items.length}</span>
      </div>
      <div className="space-y-1.5">
        {items.map(opp => (
          <CrossSellCard key={opp.id} opp={opp}
            onDragStart={() => setDraggingId(opp.id)}
            onDragEnd={() => setDraggingId(null)}
            onChannel={(channel) => onChannel(opp, channel)} />
        ))}
        {items.length === 0 && (
          <div className="text-[10px] text-slate-600 text-center py-4 italic">arraste pra cá</div>
        )}
      </div>
    </div>
  )
}

function CrossSellCard({ opp, onDragStart, onDragEnd, onChannel }: {
  opp: any
  onDragStart: () => void
  onDragEnd: () => void
  onChannel: (channel: 'CALL' | 'EMAIL' | 'WHATSAPP') => void
}) {
  const typeColor = opp.type === 'CROSS_SELL' ? 'emerald' : opp.type === 'UPSELL' ? 'amber' : 'cyan'
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', opp.id); onDragStart() }}
      onDragEnd={onDragEnd}
      className="bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-white/20 rounded p-2 cursor-grab active:cursor-grabbing transition group"
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="text-xs font-bold text-white truncate flex-1">{opp.title}</p>
        {opp.estimatedMrr && (
          <span className="shrink-0 text-[10px] font-bold text-emerald-300">
            R${opp.estimatedMrr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>
      {opp.tenantName && <p className="text-[10px] text-slate-400 truncate">🏢 {opp.tenantName}</p>}
      <div className="flex items-center gap-1 mt-1.5 text-[9px]">
        <span className={cn('px-1 py-0.5 rounded',
          `bg-${typeColor}-500/15 text-${typeColor}-300`)}>
          {opp.type.replace('_',' ')}
        </span>
        {opp.probability != null && <span className="text-slate-500">· {opp.probability}%</span>}
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1 mt-1.5">
        <button onClick={(e) => { e.stopPropagation(); onChannel('CALL') }}
          className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" title="Registrar call">
          <Phone className="w-2.5 h-2.5" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onChannel('WHATSAPP') }}
          className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" title="Registrar WhatsApp">
          <MessageCircle className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Modal de Registrar Activity
// ────────────────────────────────────────────────────────────────────────────
function ActivityModal({ data, onClose }: {
  data: { leadId?: string; integradorId?: string; channel: string; targetName: string }
  onClose: () => void
}) {
  const { data: teamData } = useSalesTeam()
  const team = teamData?.team ?? []
  const [salesUserId, setSalesUserId] = useState(team[0]?.id ?? '')
  const [duration, setDuration] = useState('')
  const [outcome, setOutcome] = useState<'positivo' | 'neutro' | 'negativo'>('positivo')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Default: pega primeiro membro da equipe
  if (!salesUserId && team.length > 0) {
    setSalesUserId(team[0].id)
  }

  async function save() {
    if (!salesUserId) { setErr('Selecione um vendedor'); return }
    setBusy(true); setErr(null)
    try {
      await logSalesActivity({
        salesUserId,
        leadId: data.leadId,
        integradorId: data.integradorId,
        type: data.channel,
        durationSec: duration ? parseInt(duration) * 60 : undefined,
        outcome,
        notes: notes || `${data.channel} com ${data.targetName}`,
      })
      onClose()
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-white dark:bg-space-900 border border-violet-500/30 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {data.channel === 'CALL' && <Phone className="w-4 h-4 text-emerald-400" />}
            {data.channel === 'EMAIL' && <Mail className="w-4 h-4 text-cyan-400" />}
            {data.channel === 'WHATSAPP' && <MessageCircle className="w-4 h-4 text-emerald-400" />}
            Registrar {data.channel === 'CALL' ? 'Call' : data.channel === 'EMAIL' ? 'Email' : 'WhatsApp'}
          </h3>
          <button onClick={onClose}><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        <p className="text-xs text-slate-500">Para: <strong className="text-slate-300">{data.targetName}</strong></p>

        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Vendedor *</label>
          <select value={salesUserId} onChange={e => setSalesUserId(e.target.value)}
            className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-white">
            {team.length === 0 && <option value="">Nenhum vendedor cadastrado</option>}
            {team.map(m => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
          </select>
        </div>

        {data.channel === 'CALL' && (
          <div>
            <label className="text-[10px] uppercase text-slate-500 mb-1 block">Duração (min)</label>
            <input type="number" value={duration} onChange={e => setDuration(e.target.value)} placeholder="5"
              className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-white" />
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Resultado</label>
          <div className="flex gap-1">
            {(['positivo','neutro','negativo'] as const).map(o => (
              <button key={o} onClick={() => setOutcome(o)}
                className={cn('flex-1 px-2 py-1.5 rounded text-xs border transition',
                  outcome === o
                    ? o === 'positivo' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : o === 'neutro' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-white/5 text-slate-400 border-white/10')}>
                {o}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Notas</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Resumo do contato, próximos passos..."
            className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-white h-20 resize-none" />
        </div>

        {/* Atalho para abrir app externo */}
        <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300">
          💡 Abra o {data.channel === 'CALL' ? 'discador' : data.channel === 'EMAIL' ? 'email' : 'WhatsApp'} em paralelo,
          faça o contato, e registre aqui.
        </div>

        {err && <p className="text-xs text-rose-300">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={save} disabled={busy || !salesUserId}
            className="flex-1 px-3 py-2 rounded bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Registrar
          </button>
        </div>
      </div>
    </div>
  )
}
