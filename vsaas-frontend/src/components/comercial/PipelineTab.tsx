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
import { useState, useMemo, useEffect } from 'react'
import useSWR from 'swr'
import { Search, RefreshCw, Phone, Mail, MessageCircle, Sparkles, Target, Layers, TrendingUp, X, Loader2, Plus } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import {
  api, formatApiError, useLeadScore, useSalesOpportunities, useSalesTeam,
  logSalesActivity, updateOpportunity,
} from '../../api/client'
import { cn } from '../../lib/utils'
import { PriorityActionsBar } from './PriorityActionsBar'
import { LeadDrawer } from './LeadDrawer'
import { openCall, openEmail, openWhatsapp, logChannelAttempt } from '../../lib/channels'

const fetcher = (u: string) => api.get(u).then(r => r.data)

const COLUMNS = [
  { id: 'NEW',         label: 'Novos',         color: 'cyan',    description: 'aguardando 1º contato' },
  { id: 'CONTACTED',   label: 'Contatados',    color: 'violet',  description: 'qualificação' },
  { id: 'DEMO_SENT',   label: 'Demo enviada',  color: 'amber',   description: 'aguardando reação' },
  { id: 'NEGOTIATION', label: 'Negociação',    color: 'fuchsia', description: 'proposta enviada' },
  { id: 'CONVERTED',   label: 'Convertidos',   color: 'emerald', description: 'cliente fechado' },
  { id: 'LOST',        label: 'Perdidos',      color: 'rose',    description: 'aprendizado' },
]

// Funil canônico — espelha backend para feedback visual no drag-drop.
const FUNNEL_RANK: Record<string, number> = {
  NEW: 0, CONTACTED: 1, DEMO_SENT: 2, NEGOTIATION: 3, CONVERTED: 4, LOST: 99,
}
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NEW:         ['CONTACTED', 'DEMO_SENT', 'LOST'],
  CONTACTED:   ['NEW', 'DEMO_SENT', 'NEGOTIATION', 'LOST'],
  DEMO_SENT:   ['CONTACTED', 'NEGOTIATION', 'CONVERTED', 'LOST'],
  NEGOTIATION: ['DEMO_SENT', 'CONVERTED', 'LOST'],
  CONVERTED:   [],
  LOST:        ['NEW'],
}
function isAllowedTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to)
}
function isBackwardTransition(from: string, to: string): boolean {
  if (to === 'LOST') return false
  return (FUNNEL_RANK[to] ?? 0) < (FUNNEL_RANK[from] ?? 0)
}

type CardData =
  | { kind: 'LEAD'; id: string; status: string; lead: any }
  | { kind: 'OPP_NEW';   id: string; status: string; opp: any }
  | { kind: 'OPP_CROSS'; id: string; status: string; opp: any }

export function PipelineTab() {
  // Pipeline carrega últimos 200 leads (status NEW/CONTACTED/DEMO_SENT/NEGOTIATION) — leads antigos com status CONVERTED/LOST
  // ficam fora; caso precise, drill-down via Visão Executiva traz com paginação adequada.
  const { data: leadsData, isLoading: lLoad, mutate: lMut } = useSWR<any>('/leads?limit=200', fetcher, { refreshInterval: 30_000 })
  const { data: oppsData,  isLoading: oLoad, mutate: oMut } = useSalesOpportunities({ status: 'OPEN' })
  // Filtros persistem em localStorage
  const [search, setSearch] = useState(() => localStorage.getItem('pipeline_search') ?? '')
  useEffect(() => { localStorage.setItem('pipeline_search', search) }, [search])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [wasDragging, setWasDragging] = useState(false) // bloqueia click após drag
  const [activityModal, setActivityModal] = useState<{ leadId?: string; integradorId?: string; channel: string; targetName: string } | null>(null)
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null)

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
    const map: Record<string, any[]> = { NEW: [], CONTACTED: [], DEMO_SENT: [], NEGOTIATION: [], CONVERTED: [], LOST: [] }
    for (const l of filteredLeads) {
      if (map[l.status]) map[l.status].push(l)
    }
    return map
  }, [filteredLeads])

  // Cross-sell/upsell em coluna separada
  const crossSell = opps.filter(o => ['CROSS_SELL', 'UPSELL', 'RENEWAL'].includes(o.type))

  async function moveLeadTo(leadId: string, newStatus: string) {
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return
    if (lead.status === newStatus) return

    if (!isAllowedTransition(lead.status, newStatus)) {
      alert(`Transição não permitida: ${lead.status} → ${newStatus}\n\nAbra o lead para ver as opções.`)
      return
    }

    // Para LOST e backward → exige confirmação rica → abre drawer.
    if (newStatus === 'LOST' || isBackwardTransition(lead.status, newStatus)) {
      setDrawerLeadId(leadId)
      return
    }

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
      {/* Painel sticky de ações prioritárias do dia */}
      <PriorityActionsBar />

      {/* Toolbar */}
      <GlassCard className="p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <Target className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-slate-900 dark:text-white">{filteredLeads.length} leads · {crossSell.length} cross-sell/upsell</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400">arraste cards entre colunas</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar lead..."
                className="pl-7 pr-3 py-1.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
            </div>
            <button onClick={() => { lMut(); oMut() }} className="p-1.5 rounded-lg bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:bg-white/10 text-slate-400">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Pipeline principal — leads */}
      {(lLoad) ? (
        <div className="grid grid-cols-5 gap-2">
          {[0,1,2,3,4].map(i => <div key={i} className="h-96 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 min-h-[400px]">
          {COLUMNS.map(col => {
            const items = leadsByStatus[col.id] ?? []
            const colorMap: Record<string, string> = {
              cyan:    'border-cyan-500/30 bg-cyan-500/5',
              violet:  'border-violet-500/30 bg-violet-500/5',
              amber:   'border-amber-500/30 bg-amber-500/5',
              fuchsia: 'border-fuchsia-500/30 bg-fuchsia-500/5',
              emerald: 'border-emerald-500/30 bg-emerald-500/5',
              rose:    'border-rose-500/30 bg-rose-500/5',
            }
            const textMap: Record<string, string> = {
              cyan: 'text-cyan-300', violet: 'text-violet-300', amber: 'text-amber-300',
              fuchsia: 'text-fuchsia-300',
              emerald: 'text-emerald-300', rose: 'text-rose-300',
            }
            // Feedback visual de drag-drop: highlight conforme validade da transição
            const draggingLead = draggingId ? leads.find(l => l.id === draggingId) : null
            const isDraggingFromHere = draggingLead?.status === col.id
            const allowed = draggingLead && !isDraggingFromHere && isAllowedTransition(draggingLead.status, col.id)
            const backward = allowed && isBackwardTransition(draggingLead!.status, col.id)
            const dropFeedback = !draggingLead || isDraggingFromHere
              ? ''
              : !allowed
                ? 'opacity-30 grayscale cursor-not-allowed'
                : backward
                  ? 'ring-2 ring-amber-500/60 bg-amber-500/10 scale-[0.99]'
                  : col.id === 'LOST'
                    ? 'ring-2 ring-rose-500/60 bg-rose-500/10'
                    : 'ring-2 ring-emerald-500/60 bg-emerald-500/10 scale-[1.01]'
            return (
              <div key={col.id}
                onDragOver={e => allowed && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/plain')
                  if (id && draggingId === id) moveLeadTo(id, col.id)
                  setDraggingId(null)
                }}
                className={cn('rounded-lg border p-2 min-h-[400px] flex flex-col transition-all', colorMap[col.color], dropFeedback)}>
                <div className="flex items-center justify-between mb-1 px-1 shrink-0">
                  <h3 className={cn('text-xs font-bold uppercase tracking-wider', textMap[col.color])}>{col.label}</h3>
                  <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded', textMap[col.color])}>{items.length}</span>
                </div>
                {/* Pipeline value real (estimatedMrr × probability dos leads desta coluna) */}
                {(() => {
                  const value = items.reduce((s, l) => {
                    const opp = opps.find(o => o.leadId === l.id && o.status === 'OPEN')
                    return s + (opp?.estimatedMrr ?? 0) * ((opp?.probability ?? 0) / 100)
                  }, 0)
                  return value > 0 ? (
                    <p className={cn('text-[10px] font-bold px-1 mb-1 shrink-0', textMap[col.color])}>
                      R$ {value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} ponderado
                    </p>
                  ) : null
                })()}
                <p className="text-[9px] text-slate-500 px-1 mb-2 shrink-0">{col.description}</p>
                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {items.map(lead => (
                    <PipelineLeadCard key={lead.id} lead={lead}
                      onDragStart={() => setDraggingId(lead.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onChannel={(channel) => setActivityModal({ leadId: lead.id, channel, targetName: lead.contactName })}
                      onClick={() => setDrawerLeadId(lead.id)} />
                  ))}
                  {items.length === 0 && (
                    <div className="text-[10px] text-slate-600 text-center py-8 italic">
                      {draggingLead && allowed
                        ? <span className="text-emerald-400 font-bold not-italic animate-pulse">↓ solte aqui</span>
                        : 'sem leads aqui'}
                    </div>
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
      {drawerLeadId && <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} onChanged={() => { lMut(); oMut() }} />}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function PipelineLeadCard({ lead, onDragStart, onDragEnd, onChannel, onClick }: {
  lead: any
  onDragStart: () => void
  onDragEnd: () => void
  onChannel: (channel: 'CALL' | 'EMAIL' | 'WHATSAPP') => void
  onClick: () => void
}) {
  const { data: scoreData } = useLeadScore(lead.id)
  const score = scoreData?.score ?? 50
  const scoreColor = score >= 75 ? 'rose' : score >= 50 ? 'amber' : 'slate'
  const scoreCls: Record<string, string> = {
    rose:  'bg-rose-500/30 text-rose-200 border-rose-500/40',
    amber: 'bg-amber-500/30 text-amber-200 border-amber-500/40',
    slate: 'bg-slate-500/30 text-slate-600 dark:text-slate-300 border-slate-500/40',
  }

  // Aging: tempo na coluna atual (usa updatedAt como proxy)
  const lastUpdate = lead.contactedAt ?? lead.demoSentAt ?? lead.updatedAt ?? lead.createdAt
  const daysInStage = Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 86400000)
  const agingClass = daysInStage > 14
    ? 'border-rose-500/60 ring-1 ring-rose-500/30'  // crítico
    : daysInStage > 7
      ? 'border-amber-500/50'                         // atenção
      : 'border-slate-200 dark:border-white/10'                             // ok

  // Last-touch indicator (verde/amarelo/vermelho)
  const lastTouch = daysInStage <= 3 ? 'emerald' : daysInStage <= 7 ? 'amber' : 'rose'
  const touchDot = {
    emerald: 'bg-emerald-500',
    amber:   'bg-amber-500',
    rose:    'bg-rose-500 animate-pulse',
  }[lastTouch]

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', lead.id); onDragStart() }}
      onDragEnd={(e) => { onDragEnd(); /* marca timestamp pra bloquear click logo após */ ;(e.currentTarget as any).__lastDragEnd = Date.now() }}
      onClick={(e) => {
        const last = (e.currentTarget as any).__lastDragEnd ?? 0
        if (Date.now() - last < 200) return
        onClick()
      }}
      className={cn('relative bg-white/[0.03] hover:bg-white/[0.06] border hover:border-violet-500/40 rounded p-2 pr-7 cursor-pointer transition group', agingClass)}
    >
      {/* Last-touch indicator + aging label no topo direito */}
      <div className="flex items-center gap-1 absolute top-1 right-1 pointer-events-none">
        <span className={cn('w-1.5 h-1.5 rounded-full', touchDot)} title={`Última atividade há ${daysInStage}d`} />
        {daysInStage > 7 && (
          <span className={cn('text-[8px] font-bold px-1 rounded',
            daysInStage > 14 ? 'bg-rose-500/30 text-rose-200' : 'bg-amber-500/30 text-amber-200')}>
            {daysInStage}d
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="text-xs font-bold text-slate-900 dark:text-white truncate flex-1">{lead.contactName}</p>
        <span className={cn('shrink-0 px-1 py-0.5 rounded text-[9px] font-bold border', scoreCls[scoreColor])}>{score}</span>
      </div>
      {lead.companyName && (
        <p className="text-[10px] text-slate-400 truncate">{lead.companyName}</p>
      )}
      <div className="flex items-center gap-1 mt-1.5 text-[9px] text-slate-500 flex-wrap">
        <span className={cn('px-1 py-0.5 rounded',
          lead.kind === 'INTEGRADOR' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-violet-500/15 text-violet-300')}>
          {lead.kind === 'INTEGRADOR' ? 'INTG' : 'CF'}
        </span>
        {lead.cameraVolume && <span>· {lead.cameraVolume}</span>}
        {lead.assignedToUserId
          ? <span className="text-emerald-400/80" title="Atribuído a vendedor">· 👤 atribuído</span>
          : <span className="text-amber-400/80 font-bold" title="Lead sem dono — atribuir antes de mover">· ⚠ sem dono</span>}
      </div>

      {/* Atalhos diretos — clica e abre app nativo + auto-log */}
      <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1 mt-1.5">
        {lead.contactPhone && (
          <button onClick={(e) => { e.stopPropagation(); openCall(lead); logChannelAttempt(lead.id, 'CALL') }}
            className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" title={`Ligar para ${lead.contactPhone}`}>
            <Phone className="w-2.5 h-2.5" />
          </button>
        )}
        {lead.contactEmail && (
          <button onClick={(e) => { e.stopPropagation(); openEmail(lead); logChannelAttempt(lead.id, 'EMAIL') }}
            className="p-1 rounded hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300" title={`Email para ${lead.contactEmail}`}>
            <Mail className="w-2.5 h-2.5" />
          </button>
        )}
        {lead.contactPhone && (
          <button onClick={(e) => { e.stopPropagation(); openWhatsapp(lead); logChannelAttempt(lead.id, 'WHATSAPP') }}
            className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300" title="WhatsApp com mensagem-template">
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
      className="bg-white/[0.03] hover:bg-white/[0.06] border border-slate-200 dark:border-white/10 hover:border-white/20 rounded p-2 cursor-grab active:cursor-grabbing transition group"
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="text-xs font-bold text-slate-900 dark:text-white truncate flex-1">{opp.title}</p>
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
        <p className="text-xs text-slate-500">Para: <strong className="text-slate-600 dark:text-slate-300">{data.targetName}</strong></p>

        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Vendedor *</label>
          <select value={salesUserId} onChange={e => setSalesUserId(e.target.value)}
            className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
            {team.length === 0 && <option value="">Nenhum vendedor cadastrado</option>}
            {team.map(m => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
          </select>
        </div>

        {data.channel === 'CALL' && (
          <div>
            <label className="text-[10px] uppercase text-slate-500 mb-1 block">Duração (min)</label>
            <input type="number" value={duration} onChange={e => setDuration(e.target.value)} placeholder="5"
              className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white" />
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
                    : 'bg-slate-50 dark:bg-white/5 text-slate-400 border-slate-200 dark:border-white/10')}>
                {o}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Notas</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Resumo do contato, próximos passos..."
            className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white h-20 resize-none" />
        </div>

        {/* Atalho para abrir app externo */}
        <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300">
          💡 Abra o {data.channel === 'CALL' ? 'discador' : data.channel === 'EMAIL' ? 'email' : 'WhatsApp'} em paralelo,
          faça o contato, e registre aqui.
        </div>

        {err && <p className="text-xs text-rose-300">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={save} disabled={busy || !salesUserId}
            className="flex-1 px-3 py-2 rounded bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Registrar
          </button>
        </div>
      </div>
    </div>
  )
}
