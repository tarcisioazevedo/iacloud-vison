/**
 * LeadDrawer — drawer lateral rico que substitui necessidade de CRM standalone.
 *
 * Tabs: Resumo · Atividades · Demos · Conversão · Materiais
 * Toda funcionalidade do /admin/leads disponível inline:
 *   - Editar dados, status, atribuição, score
 *   - Follow-ups: criar, editar, completar, deletar
 *   - Demos: aprovar, listar invites, revogar
 *   - Conversão direta em Integrador/ClienteFinal
 *   - Atalhos call/email/whatsapp com modal de registrar atividade
 */
import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import {
  X, Phone, Mail, MessageCircle, CheckCircle, Clock,
  Plus, Trash2, FileText, Sparkles, Award, Building2,
  User, MapPin, Hash, BarChart3, Loader2, ChevronRight,
} from 'lucide-react'
import { api, formatApiError, useLeadScore, logSalesActivity, useSalesTeam } from '../../api/client'
import { cn } from '../../lib/utils'
import { hoverBorder500_40 } from '../../lib/colorClasses'
import { openWhatsapp, openCall, openEmail, logChannelAttempt } from '../../lib/channels'
import { useUiToast } from '../Toast'
import { confirm } from '../ConfirmDialog'

const fetcher = (u: string) => api.get(u).then(r => r.data)

type DrawerTab = 'resumo' | 'atividades' | 'demos' | 'conversao' | 'materiais'

interface Props {
  leadId: string
  onClose: () => void
  onChanged?: () => void
}

const STATUS_OPTIONS = [
  { value: 'NEW',         label: 'Novo',          color: 'cyan' },
  { value: 'CONTACTED',   label: 'Contatado',     color: 'violet' },
  { value: 'DEMO_SENT',   label: 'Demo enviada',  color: 'amber' },
  { value: 'NEGOTIATION', label: 'Negociação',    color: 'fuchsia' },
  { value: 'CONVERTED',   label: 'Convertido',    color: 'emerald' },
  { value: 'LOST',        label: 'Perdido',       color: 'rose' },
]

// Categorias canônicas de perda — alinhadas com o backend (lostCategory enum).
const LOST_REASONS = [
  { value: 'PRICE',            label: '💰 Preço',                hint: 'Cliente disse que está caro' },
  { value: 'TIMING',           label: '⏱️ Timing/Prazo',        hint: 'Não é o momento certo' },
  { value: 'NO_FIT',           label: '🚫 Sem fit',              hint: 'Perfil não bate com nossa proposta' },
  { value: 'NO_BUDGET',        label: '💸 Sem orçamento',        hint: 'Orçamento foi cortado/inexistente' },
  { value: 'CHANGED_DECISOR',  label: '🔄 Decisor mudou',        hint: 'Pessoa de contato saiu/foi substituída' },
  { value: 'COMPETITOR',       label: '⚔️ Concorrente',          hint: 'Foi para outro fornecedor' },
  { value: 'OTHER',            label: '✏️ Outro motivo',         hint: 'Detalhe na observação' },
]

// Funil canônico — espelha o backend para validação client-side.
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
function isBackward(from: string, to: string): boolean {
  if (to === 'LOST') return false
  return (FUNNEL_RANK[to] ?? 0) < (FUNNEL_RANK[from] ?? 0)
}
function isAllowed(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to)
}

export function LeadDrawer({ leadId, onClose, onChanged }: Props) {
  const toast = useUiToast()
  // ─── HOOKS — todos no topo, sempre na mesma ordem ──────────────────────────
  const { data: lead, mutate: mLead } = useSWR<any>(`/leads/${leadId}`, fetcher)
  const { data: scoreData } = useLeadScore(leadId)
  const { data: followUps, mutate: mFups } = useSWR<any>(`/leads/${leadId}/follow-ups`, fetcher)
  const { data: invites } = useSWR<any>(`/demo-invites?leadId=${leadId}`, fetcher)
  const [tab, setTab] = useState<DrawerTab>('resumo')
  const [activityModal, setActivityModal] = useState<{ channel: string } | null>(null)
  const [lostModal, setLostModal] = useState(false)
  const [backwardModal, setBackwardModal] = useState<{ from: string; to: string } | null>(null)

  // ─── Loader (early return só DEPOIS de declarar todos os hooks) ────────────
  if (!lead) return (
    <DrawerShell onClose={onClose}>
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    </DrawerShell>
  )

  function refresh() { mLead(); mFups(); onChanged?.() }

  async function changeStatus(newStatus: string) {
    if (newStatus === lead.status) return
    if (!isAllowed(lead.status, newStatus)) {
      toast.warning({
        title: 'Transição inválida',
        description: `${lead.status} → ${newStatus}.\nA partir de ${lead.status} você pode mover para: ${ALLOWED_TRANSITIONS[lead.status]?.join(', ') || 'nenhuma'}`,
      })
      return
    }
    if (newStatus === 'LOST') { setLostModal(true); return }
    if (isBackward(lead.status, newStatus)) {
      setBackwardModal({ from: lead.status, to: newStatus })
      return
    }
    try { await api.patch(`/leads/${leadId}`, { status: newStatus }); refresh() }
    catch (e) { toast.error(formatApiError(e)) }
  }

  async function confirmLost(category: string, note: string) {
    try {
      await api.patch(`/leads/${leadId}`, {
        status: 'LOST',
        lostCategory: category,
        lostReason: note || undefined,
      })
      setLostModal(false)
      refresh()
    } catch (e) { toast.error(formatApiError(e)) }
  }

  async function confirmBackward(note: string) {
    if (!backwardModal) return
    try {
      await api.patch(`/leads/${leadId}`, {
        status: backwardModal.to,
        transitionNote: note,
      })
      setBackwardModal(null)
      refresh()
    } catch (e) { toast.error(formatApiError(e)) }
  }

  return (
    <DrawerShell onClose={onClose}>
      {/* Header com identidade + score + ações rápidas */}
      <DrawerHeader lead={lead} score={scoreData?.score ?? 50}
        onChannel={(c) => {
          // Abre app nativo com template preenchido + registra atividade.
          if (c === 'WHATSAPP') openWhatsapp(lead)
          else if (c === 'CALL') openCall(lead)
          else if (c === 'EMAIL') openEmail(lead)
          // Auto-log silencioso (não bloqueia UX se falhar).
          logChannelAttempt(lead.id, c as any).then(() => mFups())
          // Modal opcional para anotar resultado da call.
          if (c === 'CALL') setActivityModal({ channel: c })
        }} />

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 border-b border-slate-200 dark:border-white/10 sticky top-[120px] bg-space-900 z-10">
        <DrawerTabBtn active={tab === 'resumo'}      onClick={() => setTab('resumo')}     label="Resumo" />
        <DrawerTabBtn active={tab === 'atividades'}  onClick={() => setTab('atividades')} label="Atividades"
          badge={followUps?.items?.length ?? followUps?.length ?? 0} />
        <DrawerTabBtn active={tab === 'demos'}       onClick={() => setTab('demos')}      label="Demos"
          badge={invites?.items?.length} />
        <DrawerTabBtn active={tab === 'conversao'}   onClick={() => setTab('conversao')}  label="Conversão" />
        <DrawerTabBtn active={tab === 'materiais'}   onClick={() => setTab('materiais')}  label="Materiais" />
      </div>

      {/* Status changer (sempre visível) */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/[0.02]">
        <p className="text-[10px] uppercase text-slate-500 mb-2 tracking-wider">Mover para etapa:</p>
        <div className="flex flex-wrap gap-1">
          {STATUS_OPTIONS.map(s => {
            const isCurrent = lead.status === s.value
            const allowed = isAllowed(lead.status, s.value)
            const backward = isBackward(lead.status, s.value)
            const colorCls: Record<string, string> = {
              cyan:    'bg-cyan-500/30 text-cyan-200 border-cyan-500/50 ring-cyan-500/30',
              violet:  'bg-violet-500/30 text-violet-200 border-violet-500/50 ring-violet-500/30',
              amber:   'bg-amber-500/30 text-amber-200 border-amber-500/50 ring-amber-500/30',
              fuchsia: 'bg-fuchsia-500/30 text-fuchsia-200 border-fuchsia-500/50 ring-fuchsia-500/30',
              emerald: 'bg-emerald-500/30 text-emerald-200 border-emerald-500/50 ring-emerald-500/30',
              rose:    'bg-rose-500/30 text-rose-200 border-rose-500/50 ring-rose-500/30',
            }
            return (
              <button key={s.value} onClick={() => !isCurrent && changeStatus(s.value)}
                disabled={isCurrent || !allowed}
                title={isCurrent ? 'Etapa atual' : !allowed ? 'Transição não permitida do estado atual' : backward ? 'Voltar etapa — exige motivo' : `Avançar para ${s.label}`}
                className={cn('px-2 py-1 rounded text-[10px] font-bold border transition flex items-center gap-1',
                  isCurrent
                    ? `${colorCls[s.color]} ring-2`
                    : !allowed
                      ? 'text-slate-700 border-slate-200 dark:border-white/5 opacity-40 cursor-not-allowed'
                      : backward
                        ? 'text-amber-400 border-amber-500/30 hover:bg-amber-500/10'
                        : cn('text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10', hoverBorder500_40(s.color), 'hover:bg-slate-50 dark:bg-white/5'))}>
                {isCurrent && '✓ '}
                {!isCurrent && backward && '↩ '}
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Conteúdo da tab */}
      <div className="p-4 overflow-y-auto flex-1">
        {tab === 'resumo'     && <ResumoTab lead={lead} score={scoreData} />}
        {tab === 'atividades' && <AtividadesTab leadId={leadId} followUps={followUps?.items ?? followUps ?? []} mutate={mFups} />}
        {tab === 'demos'      && <DemosLeadTab lead={lead} onChanged={refresh} />}
        {tab === 'conversao'  && <ConversaoTab lead={lead} onChanged={refresh} />}
        {tab === 'materiais'  && <MateriaisTab leadStatus={lead.status} />}
      </div>

      {activityModal && (
        <RegisterActivityModal
          leadId={leadId}
          channel={activityModal.channel}
          targetName={lead.contactName}
          contactPhone={lead.contactPhone}
          contactEmail={lead.contactEmail}
          onClose={() => setActivityModal(null)}
          onSaved={() => { setActivityModal(null); refresh() }}
        />
      )}
      {lostModal && <LostModal onClose={() => setLostModal(false)} onConfirm={confirmLost} />}
      {backwardModal && <BackwardModal from={backwardModal.from} to={backwardModal.to}
        onClose={() => setBackwardModal(null)} onConfirm={confirmBackward} />}
    </DrawerShell>
  )
}

function LostModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (code: string, note: string) => void }) {
  const [category, setCategory] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const selected = LOST_REASONS.find(r => r.value === category)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg bg-white dark:bg-slate-900 border border-rose-500/40 rounded-xl shadow-2xl shadow-rose-500/10">
        <div className="p-5 border-b border-slate-200 dark:border-white/5">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="text-rose-400">●</span> Marcar lead como perdido
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Selecione a categoria principal. Esses dados alimentam relatórios de churn e treinamento da equipe.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] uppercase text-slate-500 mb-2 block tracking-wider">Categoria *</label>
            <div className="grid grid-cols-2 gap-2">
              {LOST_REASONS.map(r => (
                <button key={r.value} onClick={() => setCategory(r.value)}
                  className={cn(
                    'text-left p-2.5 rounded-lg border-2 transition',
                    category === r.value
                      ? 'border-rose-500/60 bg-rose-500/15 text-white'
                      : 'border-slate-200 dark:border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:bg-slate-50 dark:bg-white/5',
                  )}>
                  <div className="text-xs font-semibold">{r.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{r.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase text-slate-500 mb-1 block tracking-wider">
              Detalhe {selected?.value === 'OTHER' ? '*' : '(opcional)'}
            </label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder={selected?.value === 'COMPETITOR'
                ? 'Ex: Foi para Monuv — cobraram R$ 35/câmera vs nosso R$ 49'
                : 'Contexto adicional para análise futura...'}
              className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white h-20 resize-none focus:border-rose-500/40 outline-none" />
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-white/5 flex gap-2">
          <button onClick={onClose}
            className="flex-1 px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:bg-white/10">
            Cancelar
          </button>
          <button onClick={() => category && onConfirm(category, note)}
            disabled={!category || (category === 'OTHER' && !note.trim())}
            className="flex-1 px-3 py-2 rounded bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed">
            Confirmar perda
          </button>
        </div>
      </div>
    </div>
  )
}

function BackwardModal({ from, to, onClose, onConfirm }: {
  from: string; to: string; onClose: () => void; onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState('')
  const fromLabel = STATUS_OPTIONS.find(s => s.value === from)?.label ?? from
  const toLabel = STATUS_OPTIONS.find(s => s.value === to)?.label ?? to
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-white dark:bg-slate-900 border border-amber-500/40 rounded-xl shadow-2xl">
        <div className="p-5 border-b border-slate-200 dark:border-white/5">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="text-amber-400">↩</span> Voltar etapa do lead
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Você está movendo de <span className="text-amber-300 font-semibold">{fromLabel}</span> para <span className="text-amber-300 font-semibold">{toLabel}</span>.
            Movimentos para trás precisam de um motivo para histórico e análise.
          </p>
        </div>
        <div className="p-5">
          <label className="text-[10px] uppercase text-slate-500 mb-1 block tracking-wider">Motivo *</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} autoFocus
            placeholder="Ex: Decisor saiu da empresa — retomar prospecção do zero"
            className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white h-20 resize-none focus:border-amber-500/40 outline-none" />
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-white/5 flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-300">Cancelar</button>
          <button onClick={() => note.trim() && onConfirm(note.trim())} disabled={!note.trim()}
            className="flex-1 px-3 py-2 rounded bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-40">
            Confirmar movimento
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function DrawerShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // ESC fecha drawer
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}
        transition={{ type: 'spring', damping: 25, stiffness: 280 }}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-2xl bg-space-900 border-l border-slate-200 dark:border-white/10 flex flex-col shadow-2xl">
        {children}
      </motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function DrawerHeader({ lead, score, onChannel }: {
  lead: any; score: number; onChannel: (c: string) => void
}) {
  const scoreColor = score >= 75 ? 'rose' : score >= 50 ? 'amber' : 'slate'
  const scoreCls: Record<string, string> = {
    rose: 'bg-rose-500/30 text-rose-200 border-rose-500/40',
    amber: 'bg-amber-500/30 text-amber-200 border-amber-500/40',
    slate: 'bg-slate-500/30 text-slate-600 dark:text-slate-300 border-slate-500/40',
  }
  return (
    <div className="p-4 border-b border-slate-200 dark:border-white/10 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent sticky top-0 z-20">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold border', scoreCls[scoreColor])}>
              {score} {score >= 75 ? '🔥' : ''}
            </span>
            <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold border',
              lead.kind === 'INTEGRADOR'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                : 'bg-violet-500/20 text-violet-300 border-violet-500/30')}>
              {lead.kind === 'INTEGRADOR' ? 'Integrador' : 'Cliente Final'}
            </span>
            <span className="text-[10px] text-slate-500 uppercase">{lead.status}</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">{lead.contactName}</h2>
          {lead.companyName && (
            <p className="text-xs text-slate-400 truncate">
              <Building2 className="w-3 h-3 inline mr-1" />{lead.companyName}
            </p>
          )}
        </div>
        <button onClick={() => window.history.back()} className="p-1 text-slate-500 hover:text-slate-900 dark:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Atalhos call/email/whatsapp */}
      <div className="flex items-center gap-2">
        {lead.contactPhone && (
          <button onClick={() => onChannel('CALL')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
            <Phone className="w-3.5 h-3.5" /> Ligar
          </button>
        )}
        {lead.contactPhone && (
          <button onClick={() => onChannel('WHATSAPP')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
          </button>
        )}
        {lead.contactEmail && (
          <button onClick={() => onChannel('EMAIL')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-bold">
            <Mail className="w-3.5 h-3.5" /> Email
          </button>
        )}
      </div>
    </div>
  )
}

function DrawerTabBtn({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button onClick={onClick}
      className={cn('flex items-center gap-1 px-3 py-2 -mb-px border-b-2 text-xs transition',
        active ? 'border-violet-500 text-violet-300 font-bold' : 'border-transparent text-slate-500 hover:text-slate-600 dark:text-slate-300')}>
      {label}
      {badge != null && badge > 0 && (
        <span className={cn('px-1 py-0.5 rounded-full text-[9px] font-bold',
          active ? 'bg-violet-500/30 text-violet-200' : 'bg-slate-50 dark:bg-white/5 text-slate-400')}>{badge}</span>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BANT — chips toggle persistidos em localStorage por lead
const BANT = [
  { key: 'B', label: 'Budget',     full: 'Tem orçamento' },
  { key: 'A', label: 'Authority',  full: 'É decisor' },
  { key: 'N', label: 'Need',       full: 'Tem necessidade real' },
  { key: 'T', label: 'Timeline',   full: 'Tem prazo definido' },
]

function BANTChips({ leadId }: { leadId: string }) {
  const storageKey = `bant_${leadId}`
  const [marks, setMarks] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}') } catch { return {} }
  })
  function toggle(k: string) {
    const next = { ...marks, [k]: !marks[k] }
    setMarks(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
  }
  const score = Object.values(marks).filter(Boolean).length

  return (
    <div className="p-3 rounded bg-cyan-500/5 border border-cyan-500/20">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase text-cyan-300 font-bold">Qualificação BANT</p>
        <span className="text-[10px] text-cyan-400 font-mono">{score}/4</span>
      </div>
      <div className="flex gap-1 flex-wrap">
        {BANT.map(b => (
          <button key={b.key} onClick={() => toggle(b.key)}
            title={b.full}
            className={cn('px-2 py-1 rounded text-[10px] font-bold border transition',
              marks[b.key]
                ? 'bg-emerald-500/30 text-emerald-200 border-emerald-500/50'
                : 'text-slate-400 border-slate-200 dark:border-white/10 hover:border-white/20')}>
            {marks[b.key] ? '✓ ' : ''}{b.key} · {b.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-2">
        {score === 4 ? '🔥 Qualificado completo — partir para proposta' :
         score >= 2 ? '👍 Parcialmente qualificado' :
         '⚠ Precisa qualificar mais antes de avançar'}
      </p>
    </div>
  )
}

function ResumoTab({ lead, score }: { lead: any; score: any }) {
  return (
    <div className="space-y-3 text-xs">
      <Row icon={Mail} label="Email" value={lead.contactEmail} mono />
      {lead.contactPhone && <Row icon={Phone} label="Telefone" value={lead.contactPhone} />}
      {lead.contactRole && <Row icon={User} label="Cargo" value={lead.contactRole} />}
      {lead.cnpj && <Row icon={Hash} label="CNPJ" value={lead.cnpj} mono />}
      {lead.cameraVolume && <Row icon={BarChart3} label="Volume" value={lead.cameraVolume} />}
      {lead.city && <Row icon={MapPin} label="Localização" value={`${lead.city}/${lead.state ?? '—'}`} />}
      <Row icon={Clock} label="Recebido" value={new Date(lead.createdAt).toLocaleString('pt-BR')} />
      {lead.contactedAt && <Row icon={CheckCircle} label="Contatado em" value={new Date(lead.contactedAt).toLocaleString('pt-BR')} />}
      {lead.demoSentAt && <Row icon={Sparkles} label="Demo enviada" value={new Date(lead.demoSentAt).toLocaleString('pt-BR')} />}

      {lead.message && (
        <div className="p-3 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
          <p className="text-[10px] uppercase text-slate-500 mb-1">Mensagem do lead</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 italic">"{lead.message}"</p>
        </div>
      )}

      {/* Score breakdown */}
      {score?.reasonsJson && score.reasonsJson.length > 0 && (
        <div className="p-3 rounded bg-violet-500/5 border border-violet-500/20">
          <p className="text-[10px] uppercase text-violet-300 mb-2">Score: {score.score} pontos</p>
          <ul className="space-y-0.5">
            {score.reasonsJson.map((r: any, i: number) => (
              <li key={i} className="text-[10px] text-slate-400 flex justify-between">
                <span>• {r.label}</span>
                <span className="text-emerald-400">+{r.points}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* BANT Qualification chips */}
      <BANTChips leadId={lead.id} />

      {/* Sugestão IA */}
      {lead.status === 'NEW' && (
        <div className="p-3 rounded bg-cyan-500/5 border border-cyan-500/20">
          <p className="text-[10px] uppercase text-cyan-300 mb-1">💡 Próxima ação sugerida</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Lead com score {score?.score ?? 50}. {score?.score >= 75
              ? 'Alta prioridade — ligue nas próximas horas.'
              : 'Inicie por WhatsApp ou email para qualificar.'}
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ icon: Icon, label, value, mono }: { icon: any; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      <span className="text-[10px] uppercase text-slate-500 w-24 shrink-0">{label}</span>
      <span className={cn('text-slate-200 truncate flex-1', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  NEW: '✨ Novo', CONTACTED: '📞 Contatado', DEMO_SENT: '🎬 Demo enviada',
  NEGOTIATION: '💼 Negociação', CONVERTED: '🏆 Convertido', LOST: '❌ Perdido',
}

function StatusHistoryBlock({ leadId }: { leadId: string }) {
  const { data } = useSWR<{ history: any[]; total: number }>(`/leads/${leadId}/history`, fetcher, { refreshInterval: 30_000 })
  const history = data?.history ?? []
  if (!history.length) return null
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs uppercase text-slate-500 font-bold flex items-center gap-1.5">
        <Clock className="w-3 h-3" /> Histórico de etapas ({history.length})
      </h4>
      <div className="space-y-1">
        {history.map(h => (
          <div key={h.id} className="px-2.5 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {h.fromStatus && (
                  <>
                    <span className="text-slate-400">{STATUS_LABEL[h.fromStatus] ?? h.fromStatus}</span>
                    <ChevronRight className="w-3 h-3 text-slate-600" />
                  </>
                )}
                <span className="font-semibold text-cyan-300">{STATUS_LABEL[h.toStatus] ?? h.toStatus}</span>
              </div>
              <span className="text-[10px] text-slate-500 shrink-0 tabular-nums" title={new Date(h.createdAt).toISOString()}>
                {new Date(h.createdAt).toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                  timeZone: 'America/Sao_Paulo',
                })}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500 flex items-center gap-1">
              <User className="w-2.5 h-2.5" />
              <span>
                {h.changedByName
                  ? h.changedByName
                  : h.changedByRole
                    ? <span className="italic">Usuário {h.changedByRole}</span>
                    : 'sistema'}
              </span>
              {h.changedByRole && h.changedByName && (
                <span className="px-1 py-0.5 rounded bg-slate-50 dark:bg-white/5 text-[9px] uppercase">{h.changedByRole}</span>
              )}
              {h.source && h.source !== 'manual' && <span className="text-amber-400">· {h.source}</span>}
            </div>
            {h.reason && <div className="mt-0.5 text-[10px] text-rose-300 italic">motivo: {h.reason}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function AtividadesTab({ leadId, followUps, mutate }: { leadId: string; followUps: any[]; mutate: () => void }) {
  const toast = useUiToast()
  const [showNew, setShowNew] = useState(false)
  const [newType, setNewType] = useState('NOTE')
  const [newContent, setNewContent] = useState('')
  const [newDue, setNewDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editBusy, setEditBusy] = useState(false)

  async function saveEdit(fupId: string) {
    if (!editContent.trim()) return
    setEditBusy(true)
    try {
      await api.patch(`/leads/${leadId}/follow-ups/${fupId}`, { content: editContent.trim() })
      setEditingId(null); setEditContent(''); mutate()
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setEditBusy(false) }
  }

  async function create(parentId?: string) {
    const isReply = !!parentId
    const content = isReply ? replyContent : newContent
    if (!content.trim()) return
    if (isReply) setReplyBusy(true); else setBusy(true)
    try {
      await api.post(`/leads/${leadId}/follow-ups`, {
        type: isReply ? 'NOTE' : newType,
        content,
        dueDate: !isReply && newDue ? new Date(newDue).toISOString() : null,
        parentId: parentId ?? undefined,
      })
      if (isReply) { setReplyTo(null); setReplyContent('') }
      else { setNewContent(''); setNewDue(''); setShowNew(false) }
      mutate()
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setBusy(false); setReplyBusy(false) }
  }

  async function toggleComplete(fup: any) {
    try { await api.patch(`/leads/${leadId}/follow-ups/${fup.id}`, { completed: !fup.completed }); mutate() }
    catch (e) { toast.error(formatApiError(e)) }
  }
  async function remove(fup: any) {
    const ok = await confirm({
      title: 'Excluir este follow-up?',
      destructive: true,
      confirmLabel: 'Excluir',
    })
    if (!ok) return
    try { await api.delete(`/leads/${leadId}/follow-ups/${fup.id}`); mutate() }
    catch (e) { toast.error(formatApiError(e)) }
  }

  // Separa raízes e respostas
  const roots = followUps.filter((f: any) => !f.parentId)
  const repliesByParent = new Map<string, any[]>()
  for (const f of followUps) {
    if (f.parentId) {
      if (!repliesByParent.has(f.parentId)) repliesByParent.set(f.parentId, [])
      repliesByParent.get(f.parentId)!.push(f)
    }
  }
  // Ordena respostas por data crescente (conversa natural)
  for (const arr of repliesByParent.values()) arr.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))

  function renderItem(f: any, depth = 0) {
    const replies = repliesByParent.get(f.id) ?? []
    const isReplying = replyTo === f.id
    return (
      <div key={f.id} className={cn(depth > 0 && 'ml-5 border-l-2 border-cyan-500/20 pl-3')}>
        <div className={cn('p-2 rounded border',
          f.completed ? 'bg-emerald-500/5 border-emerald-500/20 opacity-60'
                     : depth > 0 ? 'bg-cyan-500/[0.04] border-cyan-500/20'
                                 : 'bg-white/[0.02] border-slate-200 dark:border-white/10')}>
          <div className="flex items-start gap-2">
            <button onClick={() => toggleComplete(f)} className="shrink-0 mt-0.5">
              {f.completed
                ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                : <div className="w-3.5 h-3.5 rounded border-2 border-slate-500" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                <span className="text-[9px] uppercase text-slate-500 font-bold">{f.type}</span>
                {f.createdByName && (
                  <>
                    <span className="text-[9px] text-slate-600">·</span>
                    <span className="text-[9px] text-cyan-400">{f.createdByName}</span>
                  </>
                )}
                <span className="text-[9px] text-slate-600">·</span>
                <span className="text-[9px] text-slate-500 tabular-nums" title={new Date(f.createdAt).toISOString()}>
                  {new Date(f.createdAt).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    timeZone: 'America/Sao_Paulo',
                  })}
                </span>
                {f.dueDate && (
                  <>
                    <span className="text-[9px] text-slate-600">·</span>
                    <span className={cn('text-[9px]', new Date(f.dueDate) < new Date() && !f.completed ? 'text-rose-300 font-bold' : 'text-amber-300')}>
                      ⏰ {new Date(f.dueDate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </>
                )}
              </div>
              {editingId === f.id ? (
                <div className="space-y-1.5 mt-1">
                  <textarea value={editContent} onChange={e => setEditContent(e.target.value)} autoFocus
                    className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-950 border border-cyan-500/40 text-xs text-slate-900 dark:text-white h-20 resize-none focus:outline-none" />
                  <div className="flex justify-end gap-1">
                    <button onClick={() => { setEditingId(null); setEditContent('') }}
                      className="px-2 py-1 rounded bg-slate-50 dark:bg-white/5 text-[10px] text-slate-400">Cancelar</button>
                    <button onClick={() => saveEdit(f.id)} disabled={editBusy || !editContent.trim() || editContent.trim() === f.content}
                      className="px-2 py-1 rounded bg-cyan-500 text-[10px] text-white font-bold disabled:opacity-50">
                      {editBusy ? '…' : 'Salvar'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className={cn('text-xs whitespace-pre-wrap', f.completed ? 'line-through text-slate-500' : 'text-slate-600 dark:text-slate-300')}>{f.content}</p>
              )}
              {editingId !== f.id && (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <button onClick={() => { setReplyTo(isReplying ? null : f.id); setReplyContent('') }}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                    <MessageCircle className="w-3 h-3" /> {isReplying ? 'Cancelar' : 'Responder'}
                  </button>
                  <button onClick={() => { setEditingId(f.id); setEditContent(f.content) }}
                    className="text-[10px] text-slate-500 hover:text-slate-600 dark:text-slate-300 flex items-center gap-1">
                    <Plus className="w-3 h-3 rotate-45" /> Editar
                  </button>
                  {f.updatedAt && f.updatedAt !== f.createdAt && (
                    <span className="text-[9px] text-slate-600 italic" title={new Date(f.updatedAt).toLocaleString('pt-BR')}>(editado)</span>
                  )}
                  {replies.length > 0 && (
                    <span className="text-[10px] text-slate-500">{replies.length} resposta{replies.length > 1 ? 's' : ''}</span>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => remove(f)} className="shrink-0 text-slate-600 hover:text-rose-400">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {isReplying && (
          <div className="mt-1.5 ml-5 p-2 rounded bg-cyan-500/[0.06] border border-cyan-500/30 space-y-1.5">
            <textarea value={replyContent} onChange={e => setReplyContent(e.target.value)}
              autoFocus
              placeholder="Sua resposta…"
              className="w-full px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white h-16 resize-none" />
            <div className="flex justify-end gap-1">
              <button onClick={() => { setReplyTo(null); setReplyContent('') }}
                className="px-2 py-1 rounded bg-slate-50 dark:bg-white/5 text-[10px] text-slate-400">Cancelar</button>
              <button onClick={() => create(f.id)} disabled={replyBusy || !replyContent.trim()}
                className="px-2 py-1 rounded bg-cyan-500 text-[10px] text-white font-bold disabled:opacity-50">
                {replyBusy ? '…' : 'Enviar resposta'}
              </button>
            </div>
          </div>
        )}

        {replies.map(r => renderItem(r, depth + 1))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <StatusHistoryBlock leadId={leadId} />

      <div className="flex items-center justify-between">
        <h4 className="text-xs uppercase text-slate-500 font-bold">Follow-ups & Notas ({followUps.length})</h4>
        <button onClick={() => setShowNew(s => !s)}
          className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Novo
        </button>
      </div>

      {showNew && (
        <div className="p-3 rounded bg-slate-50 dark:bg-white/5 border border-cyan-500/30 space-y-2">
          <select value={newType} onChange={e => setNewType(e.target.value)}
            className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
            <option value="NOTE">📝 Nota</option>
            <option value="CALL">📞 Call</option>
            <option value="EMAIL">✉️ Email</option>
            <option value="WHATSAPP">💬 WhatsApp</option>
            <option value="MEETING">📅 Reunião</option>
            <option value="TASK">✓ Tarefa</option>
          </select>
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)}
            placeholder="Conteúdo / resumo / próxima ação..."
            className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white h-20 resize-none" />
          <input type="datetime-local" value={newDue} onChange={e => setNewDue(e.target.value)}
            placeholder="Data limite (opcional)"
            className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
          <div className="flex gap-1">
            <button onClick={() => setShowNew(false)} className="flex-1 px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 text-[10px] text-slate-400">Cancelar</button>
            <button onClick={() => create()} disabled={busy || !newContent.trim()}
              className="flex-1 px-2 py-1.5 rounded bg-cyan-500 text-[10px] text-white font-bold disabled:opacity-50">
              {busy ? '...' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {followUps.length === 0 && !showNew ? (
        <div className="py-8 text-center text-xs text-slate-500">Nenhuma atividade. Clique em "Novo" para começar.</div>
      ) : (
        <div className="space-y-1.5">
          {roots.map(f => renderItem(f, 0))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function DemosLeadTab({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const toast = useUiToast()
  const [busy, setBusy] = useState(false)
  const [magicLink, setMagicLink] = useState<string | null>(null)

  async function approveDemo() {
    const ok = await confirm({
      title: `Aprovar demo para ${lead.contactName}?`,
      description: 'Magic link será enviado por email.',
      confirmLabel: 'Aprovar',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await api.post(`/leads/${lead.id}/invite`, { ttlDays: 14 })
      setMagicLink(r.data?.invite?.magicLink ?? null)
      onChanged()
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      {lead.status === 'NEW' || lead.status === 'CONTACTED' ? (
        <div className="p-4 rounded bg-amber-500/10 border border-amber-500/30">
          <h4 className="text-sm font-bold text-amber-300 mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Aprovar acesso à demo
          </h4>
          <p className="text-xs text-slate-400 mb-3">
            Gera magic link válido por 14 dias e envia email rico para o lead com tutorial.
          </p>
          <button onClick={approveDemo} disabled={busy}
            className="w-full px-3 py-2 rounded bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Aprovar Demo
          </button>
        </div>
      ) : lead.status === 'DEMO_SENT' ? (
        <div className="p-4 rounded bg-emerald-500/10 border border-emerald-500/30">
          <h4 className="text-sm font-bold text-emerald-300 mb-2 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> Demo ATIVA
          </h4>
          <p className="text-xs text-slate-400 mb-3">
            Demo enviada em {lead.demoSentAt ? new Date(lead.demoSentAt).toLocaleDateString('pt-BR') : '—'}.
            Aguardando uso/conversão.
          </p>
          <button onClick={approveDemo} disabled={busy}
            className="w-full px-3 py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-300 text-xs font-bold">
            {busy ? '...' : 'Reenviar magic link'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500 text-center py-8">
          Lead em status {lead.status}. Para aprovar demo, mude o status para Novo ou Contatado.
        </p>
      )}

      {magicLink && (
        <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30">
          <p className="text-[10px] uppercase text-amber-300 mb-1">🔗 Magic link gerado</p>
          <code className="text-[10px] text-slate-600 dark:text-slate-300 break-all">{magicLink}</code>
          <button onClick={() => navigator.clipboard.writeText(magicLink)}
            className="mt-2 w-full px-2 py-1 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">
            Copiar
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function ConversaoTab({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const toast = useUiToast()
  const [busy, setBusy] = useState(false)
  const [tempPw, setTempPw] = useState('')

  async function convert() {
    const ok = await confirm({
      title: `Converter ${lead.contactName}?`,
      description: `Será criado como ${lead.kind === 'INTEGRADOR' ? 'Integrador' : 'Cliente Final'}.`,
      confirmLabel: 'Converter',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await api.post(`/leads/${lead.id}/convert`, {
        targetKind: lead.kind,
        cnpj: lead.cnpj,
        tempPassword: tempPw || undefined,
      })
      toast.success({
        title: 'Conversão sucesso!',
        description: r.data?.tempPassword ? `Senha temp: ${r.data.tempPassword}` : undefined,
      })
      onChanged()
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setBusy(false) }
  }

  if (lead.status === 'CONVERTED') {
    return (
      <div className="p-4 rounded bg-emerald-500/10 border border-emerald-500/30 text-center">
        <Award className="w-12 h-12 mx-auto text-emerald-400 mb-2" />
        <h4 className="text-sm font-bold text-emerald-300">Lead já convertido!</h4>
        <p className="text-xs text-slate-400 mt-2">
          Em {lead.convertedAt ? new Date(lead.convertedAt).toLocaleDateString('pt-BR') : '—'}
        </p>
        {lead.convertedIntegradorId && (
          <a href={`/admin/tenants/${lead.convertedIntegradorId}`} className="mt-3 inline-block text-xs text-cyan-400 hover:underline">
            Ver tenant criado →
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="p-3 rounded bg-emerald-500/5 border border-emerald-500/20">
        <h4 className="text-sm font-bold text-emerald-300 mb-2 flex items-center gap-2">
          <Award className="w-4 h-4" /> Converter em {lead.kind === 'INTEGRADOR' ? 'Integrador' : 'Cliente Final'}
        </h4>
        <p className="text-xs text-slate-400 mb-3">
          Cria a conta na plataforma. Senha temporária é gerada (ou definida abaixo) e enviada por email.
        </p>
        <input value={tempPw} onChange={e => setTempPw(e.target.value)}
          placeholder="Senha temporária (opcional, mín 8)"
          className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white mb-2" />
        <button onClick={convert} disabled={busy}
          className="w-full px-3 py-2 rounded bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
          Converter agora
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function MateriaisTab({ leadStatus }: { leadStatus: string }) {
  const { data } = useSWR<any>('/sales/assets', fetcher)
  const assets = data?.assets ?? []
  // Sugere materiais relevantes para a etapa atual
  const suggested = assets.filter((a: any) => !a.funnelStage || a.funnelStage === leadStatus)

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase text-slate-500 font-bold">
        💡 Materiais sugeridos para etapa <strong className="text-cyan-300">{leadStatus}</strong>
      </p>
      {suggested.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">
          Nenhum material cadastrado. <br />
          Adicione em <a href="/admin/comercial?tab=materials" className="text-cyan-400">Materiais</a>.
        </p>
      ) : (
        suggested.map((a: any) => (
          <div key={a.id} className="p-2 rounded bg-white/[0.03] border border-slate-200 dark:border-white/10 flex items-start gap-2">
            <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white">{a.title}</p>
              {a.description && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{a.description}</p>}
            </div>
            {a.url && (
              <a href={a.url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:text-cyan-300">
                <ChevronRight className="w-4 h-4" />
              </a>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function RegisterActivityModal({ leadId, channel, targetName, contactPhone, contactEmail, onClose, onSaved }: {
  leadId: string; channel: string; targetName: string; contactPhone?: string; contactEmail?: string
  onClose: () => void; onSaved: () => void
}) {
  const toast = useUiToast()
  const { data: teamData } = useSalesTeam()
  const team = teamData?.team ?? []
  const [salesUserId, setSalesUserId] = useState(team[0]?.id ?? '')
  const [duration, setDuration] = useState('')
  const [outcome, setOutcome] = useState<'positivo' | 'neutro' | 'negativo'>('positivo')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  // Atalho para abrir app externo
  const externalUrl = channel === 'CALL' && contactPhone ? `tel:${contactPhone}`
    : channel === 'WHATSAPP' && contactPhone ? `https://wa.me/${contactPhone.replace(/\D/g, '')}`
    : channel === 'EMAIL' && contactEmail ? `mailto:${contactEmail}` : null

  async function save() {
    if (!salesUserId) { toast.warning('Cadastre vendedores em Equipe & Metas'); return }
    setBusy(true)
    try {
      await logSalesActivity({
        salesUserId, leadId, type: channel,
        durationSec: duration ? parseInt(duration) * 60 : undefined,
        outcome,
        notes: notes || `${channel} com ${targetName}`,
      })
      // Também cria FollowUp para aparecer no CRM nativo
      await api.post(`/leads/${leadId}/follow-ups`, {
        type: channel,
        content: notes || `${channel} com ${targetName}${duration ? ` · ${duration}min` : ''} · ${outcome}`,
      }).catch(() => {})
      onSaved()
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-space-900 border border-violet-500/30 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Registrar {channel}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        <p className="text-xs text-slate-500">Para: <strong className="text-slate-600 dark:text-slate-300">{targetName}</strong></p>

        {externalUrl && (
          <a href={externalUrl} target="_blank" rel="noreferrer"
            className="block px-3 py-2 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-bold text-center">
            🔗 Abrir {channel === 'CALL' ? 'discador' : channel === 'WHATSAPP' ? 'WhatsApp' : 'email'} agora
          </a>
        )}

        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Vendedor *</label>
          <select value={salesUserId} onChange={e => setSalesUserId(e.target.value)}
            className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
            {team.length === 0 && <option value="">Nenhum vendedor cadastrado</option>}
            {team.map(m => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
          </select>
        </div>

        {channel === 'CALL' && (
          <div>
            <label className="text-[10px] uppercase text-slate-500 mb-1 block">Duração (min)</label>
            <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Resultado</label>
          <div className="flex gap-1">
            {(['positivo','neutro','negativo'] as const).map(o => (
              <button key={o} onClick={() => setOutcome(o)}
                className={cn('flex-1 px-2 py-1.5 rounded text-xs border',
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
            placeholder="Resumo + próximos passos..."
            className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white h-20 resize-none" />
        </div>

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
