/**
 * LeadsPage — `/admin/leads` (SUPER_ADMIN | ADMIN_GLOBAL)
 *
 * Funil comercial do Fabricante (Lote 0). Lista de leads capturados pelo
 * RegisterLeadPage com filtros, troca de status inline e detail panel.
 *
 * Conversão real (Lead → Integrador / ClienteFinal) virá no Lote 1 via
 * fluxo de DemoInvite + ApprovalRequest. Por ora, o Admin pode mover pra
 * CONVERTED manualmente após criar o tenant em outra tela.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Inbox, Phone, Mail, Building2, MapPin, Search, ChevronRight,
  X, Loader2, AlertTriangle, Check, RefreshCw, ExternalLink, Tag, FileText,
  Send, Zap, Copy, Key, Link2,
  LinkIcon, Ban, Clock, CheckCircle2, XCircle,
  Plus, Trash2, Shield, Calendar, MessageSquare, Eye,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  api, formatApiError,
  useDemoInvites, revokeDemoInvite, type DemoInvite,
  useLeadFollowUps, createFollowUp, updateFollowUp, deleteFollowUp, type LeadFollowUp, type FollowUpType,
  useApprovals, approveRequest, rejectRequest, type ApprovalRequest,
} from '../api/client'
import { confirm } from '../components/ConfirmDialog'

type LeadStatus = 'NEW' | 'CONTACTED' | 'DEMO_SENT' | 'CONVERTED' | 'LOST'
type LeadKind   = 'INTEGRADOR' | 'CLIENTE_FINAL'

interface Lead {
  id:            string
  kind:          LeadKind
  status:        LeadStatus
  contactName:   string
  contactEmail:  string
  contactPhone:  string | null
  contactRole:   string | null
  companyName:   string | null
  companyTradeName: string | null
  cnpj:          string | null
  city:          string | null
  state:         string | null
  alarmCentral:  string | null
  cameraVolume:  string | null
  projectStage:  string | null
  message:       string | null
  notes:         string | null
  source:        string
  contactedAt:   string | null
  demoSentAt:    string | null
  convertedAt:   string | null
  lostReason:    string | null
  createdAt:     string
  updatedAt:     string
}

interface LeadsResponse {
  items:    Lead[]
  total:    number
  limit:    number
  offset:   number
  byStatus: Record<LeadStatus, number>
}

const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW:       'Novos',
  CONTACTED: 'Contatados',
  DEMO_SENT: 'Demo enviada',
  CONVERTED: 'Convertidos',
  LOST:      'Perdidos',
}

const STATUS_COLOR: Record<LeadStatus, { bg: string; text: string; border: string }> = {
  NEW:       { bg: '#dbeafe', text: '#1d4ed8', border: '#bfdbfe' },
  CONTACTED: { bg: '#fef3c7', text: '#a16207', border: '#fde68a' },
  DEMO_SENT: { bg: '#ede9fe', text: '#6d28d9', border: '#ddd6fe' },
  CONVERTED: { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
  LOST:      { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0' },
}

const VOLUME_LABEL: Record<string, string> = {
  LT_50:      'Até 50',
  '50_500':   '50–500',
  '500_2000': '500–2.000',
  GT_2000:    '> 2.000',
}

const fetcher = (url: string) => api.get(url).then((r) => r.data)

// ── CRM Metrics panel ─────────────────────────────────────────────────────────
interface Metrics {
  byStatus:         Record<LeadStatus, number>
  byKind:           Record<string, Record<string, number>>
  total:            number
  conversionRate:   number
  lossRate:         number
  avgDaysToConvert: number | null
  avgDaysToContact: number | null
  monthly:          { month: string; total: number; converted: number; lost: number }[]
}

function MetricsPanel() {
  const { data, isLoading } = useSWR<Metrics>('/leads/metrics', fetcher, { refreshInterval: 60_000 })

  if (isLoading) return (
    <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
      <Loader2 className="w-4 h-4 animate-spin" /> Carregando métricas…
    </div>
  )
  if (!data) return null

  const maxMonth = Math.max(...data.monthly.map(m => m.total), 1)

  return (
    <div className="mb-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {/* KPIs */}
      <div className="bg-white dark:bg-space-900/60 rounded-xl border border-slate-200 dark:border-white/10 p-4">
        <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Total de Leads</p>
        <p className="text-3xl font-bold text-slate-900 dark:text-white">{data.total}</p>
        <p className="text-xs text-slate-400 mt-1">
          {data.byKind.INTEGRADOR?.NEW ?? 0 + (data.byKind.INTEGRADOR?.CONTACTED ?? 0)} integradores ·{' '}
          {data.byKind.CLIENTE_FINAL?.NEW ?? 0 + (data.byKind.CLIENTE_FINAL?.CONTACTED ?? 0)} clientes finais
        </p>
      </div>

      <div className="bg-white dark:bg-space-900/60 rounded-xl border border-slate-200 dark:border-white/10 p-4">
        <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Taxa de Conversão</p>
        <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{data.conversionRate}%</p>
        <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${data.conversionRate}%` }} />
        </div>
      </div>

      <div className="bg-white dark:bg-space-900/60 rounded-xl border border-slate-200 dark:border-white/10 p-4">
        <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Taxa de Perda</p>
        <p className="text-3xl font-bold text-rose-600 dark:text-rose-400">{data.lossRate}%</p>
        <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${data.lossRate}%` }} />
        </div>
      </div>

      <div className="bg-white dark:bg-space-900/60 rounded-xl border border-slate-200 dark:border-white/10 p-4">
        <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Tempo Médio</p>
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">1° contato:</span>
            <span className="font-bold text-slate-800 dark:text-white">
              {data.avgDaysToContact != null ? `${data.avgDaysToContact}d` : '–'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Conversão:</span>
            <span className="font-bold text-slate-800 dark:text-white">
              {data.avgDaysToConvert != null ? `${data.avgDaysToConvert}d` : '–'}
            </span>
          </div>
        </div>
      </div>

      {/* Trend chart (last 6 months) */}
      {data.monthly.length > 0 && (
        <div className="md:col-span-2 xl:col-span-4 bg-white dark:bg-space-900/60 rounded-xl border border-slate-200 dark:border-white/10 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Tendência Mensal</p>
          <div className="flex items-end gap-2 h-20">
            {data.monthly.map(m => {
              const heightTotal    = Math.round((m.total    / maxMonth) * 64)
              const heightConverted = Math.round((m.converted / maxMonth) * 64)
              const label = m.month.slice(5) // "MM"
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div className="relative w-full flex items-end justify-center" style={{ height: 64 }}>
                    {/* Total bar */}
                    <div
                      className="absolute bottom-0 w-full rounded-t bg-slate-200 dark:bg-white/10"
                      style={{ height: heightTotal }}
                    />
                    {/* Converted bar */}
                    <div
                      className="absolute bottom-0 w-full rounded-t bg-emerald-400 dark:bg-emerald-500"
                      style={{ height: heightConverted }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400">{label}</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-3 h-2 rounded-sm bg-slate-200 dark:bg-white/10" />
              Total
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-3 h-2 rounded-sm bg-emerald-400" />
              Convertidos
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type PageTab = 'funil' | 'convites' | 'aprovacoes'

// ── Follow-up constants ───────────────────────────────────────────────────────
const FOLLOWUP_TYPE_INFO: Record<FollowUpType, { label: string; emoji: string }> = {
  NOTE:     { label: 'Nota',     emoji: '📝' },
  CALL:     { label: 'Ligação',  emoji: '📞' },
  EMAIL:    { label: 'E-mail',   emoji: '✉️' },
  WHATSAPP: { label: 'WhatsApp', emoji: '💬' },
  MEETING:  { label: 'Reunião',  emoji: '🤝' },
  TASK:     { label: 'Tarefa',   emoji: '✅' },
}

// ── Approval constants ────────────────────────────────────────────────────────
const APPROVAL_ACTION_LABEL: Record<string, string> = {
  CREATE_INTEGRADOR:    'Criar Integrador',
  DELETE_INTEGRADOR:    'Deletar Integrador',
  CONVERT_LEAD:         'Converter Lead',
  DELETE_CLIENTE_FINAL: 'Deletar Cliente Final',
  DELETE_USER:          'Deletar Usuário',
  CHANGE_BILLING:       'Alterar Billing',
  RESET_USER_PASSWORD:  'Redefinir Senha',
}

const APPROVAL_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.FC<{ className?: string }> }> = {
  PENDING:  { label: 'Pendente',  color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-700/40',             icon: Clock },
  APPROVED: { label: 'Aprovado',  color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-700/40',                   icon: CheckCircle2 },
  REJECTED: { label: 'Rejeitado', color: 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-300 border-rose-200 dark:border-rose-700/40',                   icon: XCircle },
  EXECUTED: { label: 'Executado', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/40', icon: CheckCircle2 },
  EXPIRED:  { label: 'Expirado',  color: 'text-slate-500 bg-slate-100 dark:bg-white/5 dark:text-slate-400 border-slate-200 dark:border-white/10',                     icon: AlertTriangle },
}

const APPROVAL_ACTION_SEVERITY: Record<string, 'low' | 'medium' | 'high'> = {
  CREATE_INTEGRADOR:    'low',
  CONVERT_LEAD:         'low',
  CHANGE_BILLING:       'medium',
  RESET_USER_PASSWORD:  'medium',
  DELETE_USER:          'high',
  DELETE_INTEGRADOR:    'high',
  DELETE_CLIENTE_FINAL: 'high',
}

const APPROVAL_SEVERITY_STYLE: Record<'low' | 'medium' | 'high', string> = {
  low:    'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400',
  medium: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  high:   'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400',
}

export function LeadsPage() {
  const [tab, setTab]                   = useState<PageTab>('funil')
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('')
  const [kindFilter,   setKindFilter]   = useState<LeadKind   | ''>('')
  const [q, setQ]                       = useState('')
  const [selectedId, setSelectedId]     = useState<string | null>(null)

  const url = useMemo(() => {
    const p = new URLSearchParams()
    if (statusFilter) p.set('status', statusFilter)
    if (kindFilter)   p.set('kind',   kindFilter)
    if (q.trim())     p.set('q', q.trim())
    return '/leads' + (p.toString() ? `?${p.toString()}` : '')
  }, [statusFilter, kindFilter, q])

  const { data, error, isLoading, mutate } = useSWR<LeadsResponse>(
    url, fetcher, { refreshInterval: 30_000 },
  )

  const selected = data?.items.find((l) => l.id === selectedId) ?? null

  return (
    <div className="px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-cyan-100 dark:bg-cyan-500/20">
            <Inbox className="w-5 h-5 text-cyan-600 dark:text-cyan-400"/>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">CRM Comercial</h1>
            <p className="text-xs text-slate-500">Leads · Convites Demo · Aprovações</p>
          </div>
        </div>
        <button
          onClick={() => mutate()}
          className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5"/> Atualizar
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl w-fit mb-6">
        <button
          onClick={() => setTab('funil')}
          className={[
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition',
            tab === 'funil'
              ? 'bg-white dark:bg-white/10 text-cyan-700 dark:text-cyan-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white',
          ].join(' ')}
        >
          <Inbox className="w-3.5 h-3.5" />
          Funil de Leads
          {(data?.byStatus?.NEW ?? 0) > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-[10px] font-bold">
              {data?.byStatus?.NEW}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('convites')}
          className={[
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition',
            tab === 'convites'
              ? 'bg-white dark:bg-white/10 text-cyan-700 dark:text-cyan-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white',
          ].join(' ')}
        >
          <LinkIcon className="w-3.5 h-3.5" />
          Convites Demo
        </button>
        <button
          onClick={() => setTab('aprovacoes')}
          className={[
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition',
            tab === 'aprovacoes'
              ? 'bg-white dark:bg-white/10 text-cyan-700 dark:text-cyan-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white',
          ].join(' ')}
        >
          <Shield className="w-3.5 h-3.5" />
          Aprovações
        </button>
      </div>

      {tab === 'convites'   && <DemoInvitesTab />}
      {tab === 'aprovacoes' && <ApprovalsTab />}

      {tab === 'funil' && <>
      {/* CRM Metrics (Lote 6) */}
      <MetricsPanel />

      {/* Status badges (cards) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => {
          const c = STATUS_COLOR[s]
          const count = data?.byStatus?.[s] ?? 0
          const active = statusFilter === s
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(active ? '' : s)}
              className="text-left rounded-xl p-3 transition-all border-2"
              style={{
                background: active ? c.bg : 'white',
                borderColor: active ? c.text : '#e2e8f0',
              }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5"
                style={{ color: c.text }}>
                {STATUS_LABEL[s]}
              </p>
              <p className="text-2xl font-bold" style={{ color: c.text }}>{count}</p>
            </button>
          )
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, e-mail, empresa ou CNPJ"
            className="w-full pl-10 pr-3 py-2.5 rounded-lg text-sm outline-none bg-white text-slate-900 border-slate-200 dark:bg-space-900/60 dark:border-white/10 dark:text-white focus:border-cyan-500 transition-colors"
            style={{ borderWidth: '1.5px' }}
          />
        </div>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as LeadKind | '')}
          className="px-3 py-2.5 rounded-lg text-sm outline-none bg-white text-slate-900 dark:bg-space-900/60 dark:text-white border-slate-200 dark:border-white/10"
          style={{ borderWidth: '1.5px' }}
        >
          <option value="">Tipo: todos</option>
          <option value="INTEGRADOR">Integradores</option>
          <option value="CLIENTE_FINAL">Clientes finais</option>
        </select>
      </div>

      {/* Lista + Painel detalhe (split) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
        {/* Lista */}
        <div className="bg-white dark:bg-space-900/60 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2"/> Carregando…
            </div>
          ) : error ? (
            <div className="px-6 py-10 text-center text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-6 h-6 mx-auto mb-2"/>
              <p className="text-sm">{formatApiError(error)}</p>
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-400 dark:text-slate-500">
              <Inbox className="w-8 h-8 mx-auto mb-3 opacity-50"/>
              <p className="text-sm font-medium">Nenhum lead com esses filtros</p>
              <p className="text-xs mt-1">Quando alguém solicitar acesso, aparecerá aqui.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {data.items.map((l) => {
                const c = STATUS_COLOR[l.status]
                const active = selectedId === l.id
                return (
                  <li key={l.id}>
                    <button
                      onClick={() => setSelectedId(l.id)}
                      className="w-full text-left px-4 py-3 transition-colors flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5"
                      style={{ background: active ? '#f0f9ff' : undefined }}
                    >
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: c.bg }}>
                        <Building2 className="w-4 h-4" style={{ color: c.text }}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {l.companyName || l.contactName}
                          </p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
                            style={{ background: c.bg, color: c.text }}>
                            {l.kind === 'INTEGRADOR' ? 'INTEG.' : 'CLIENTE'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {l.contactName} · {l.contactEmail}
                          {l.cameraVolume && ` · ${VOLUME_LABEL[l.cameraVolume]} câm.`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                          {STATUS_LABEL[l.status]}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">{formatRelative(l.createdAt)}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-300 dark:text-slate-600"/>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Painel direito */}
        <aside className="bg-white dark:bg-space-900/60 rounded-xl border border-slate-200 dark:border-white/10 p-5 h-fit sticky top-4">
          {!selected ? (
            <div className="text-center py-8 text-slate-400 dark:text-slate-500">
              <Tag className="w-7 h-7 mx-auto mb-2 opacity-50"/>
              <p className="text-sm">Selecione um lead para abrir os detalhes</p>
            </div>
          ) : (
            <LeadDetail lead={selected} onUpdated={() => mutate()} onClose={() => setSelectedId(null)}/>
          )}
        </aside>
      </div>
      </>}
    </div>
  )
}

// ── Lead detail ─────────────────────────────────────────────────────────────

function LeadDetail({
  lead, onUpdated, onClose,
}: {
  lead: Lead
  onUpdated: () => void
  onClose:   () => void
}) {
  const [status, setStatus]       = useState<LeadStatus>(lead.status)
  const [notes,  setNotes]        = useState(lead.notes ?? '')
  const [lostReason, setLostReason] = useState(lead.lostReason ?? '')
  const [saving, setSaving]       = useState(false)
  const [savedAt, setSavedAt]     = useState<Date | null>(null)
  const [error, setError]         = useState('')

  // Follow-up CRM state
  const { data: followUpData, mutate: mutateFollowUps } = useLeadFollowUps(lead.id)
  const followUps = followUpData?.items ?? []
  const [fuContent,  setFuContent]  = useState('')
  const [fuType,     setFuType]     = useState<FollowUpType>('NOTE')
  const [fuDue,      setFuDue]      = useState('')
  const [fuAdding,   setFuAdding]   = useState(false)

  async function addFollowUp() {
    if (!fuContent.trim()) return
    setFuAdding(true)
    try {
      await createFollowUp(lead.id, {
        type: fuType,
        content: fuContent.trim(),
        dueDate: fuDue ? new Date(fuDue).toISOString() : null,
      })
      setFuContent('')
      setFuDue('')
      mutateFollowUps()
    } catch { /* silent */ }
    setFuAdding(false)
  }

  async function toggleFollowUp(fu: LeadFollowUp) {
    try { await updateFollowUp(lead.id, fu.id, { completed: !fu.completed }); mutateFollowUps() } catch { /* silent */ }
  }

  async function removeFollowUp(fu: LeadFollowUp) {
    const ok = await confirm({
      title: 'Remover esta entrada do histórico?',
      destructive: true,
      confirmLabel: 'Remover',
    })
    if (!ok) return
    try { await deleteFollowUp(lead.id, fu.id); mutateFollowUps() } catch { /* silent */ }
  }

  // Invite modal state
  const [showInviteModal, setShowInviteModal]       = useState(false)
  const [inviting,  setInviting]                    = useState(false)
  const [inviteResult, setInviteResult]             = useState<{ magicLink: string; expiresAt: string } | null>(null)
  const [inviteError, setInviteError]               = useState('')
  const [copied, setCopied]                         = useState(false)

  // Convert modal state
  const [showConvertModal, setShowConvertModal]     = useState(false)
  const [convertKind, setConvertKind]               = useState<'INTEGRADOR' | 'CLIENTE_FINAL'>(lead.kind)
  const [converting, setConverting]                 = useState(false)
  const [convertResult, setConvertResult]           = useState<{
    integradorId: string | null; clienteFinalId: string | null;
    user: { email: string; tempPassword: string }
  } | null>(null)
  const [convertError, setConvertError]             = useState('')

  // Reset quando muda lead selecionado
  useMemo(() => {
    setStatus(lead.status)
    setNotes(lead.notes ?? '')
    setLostReason(lead.lostReason ?? '')
    setSavedAt(null)
    setError('')
    setInviteResult(null)
    setConvertResult(null)
    setFuContent('')
    setFuDue('')
    setFuType('NOTE')
  }, [lead.id])

  async function emitirConvite() {
    setInviting(true)
    setInviteError('')
    try {
      const r = await api.post(`/leads/${lead.id}/invite`, { targetKind: lead.kind })
      setInviteResult({ magicLink: r.data.invite.magicLink, expiresAt: r.data.invite.expiresAt })
      onUpdated()
    } catch (err) {
      setInviteError(formatApiError(err))
    } finally {
      setInviting(false)
    }
  }

  async function converterDireto() {
    setConverting(true)
    setConvertError('')
    try {
      const r = await api.post(`/leads/${lead.id}/convert`, { targetKind: convertKind })
      setConvertResult(r.data)
      onUpdated()
    } catch (err) {
      setConvertError(formatApiError(err))
    } finally {
      setConverting(false)
    }
  }

  function copyLink(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const c = STATUS_COLOR[lead.status]

  async function save() {
    setSaving(true)
    setError('')
    try {
      await api.patch(`/leads/${lead.id}`, {
        status,
        notes: notes || null,
        lostReason: status === 'LOST' ? (lostReason || null) : null,
      })
      setSavedAt(new Date())
      onUpdated()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
              style={{ background: c.bg, color: c.text }}>
              {lead.kind === 'INTEGRADOR' ? 'Integrador' : 'Cliente final'}
            </span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">{lead.source}</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
            {lead.companyName || lead.contactName}
          </h2>
          {lead.companyTradeName && (
            <p className="text-xs text-slate-500">{lead.companyTradeName}</p>
          )}
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 rounded">
          <X className="w-4 h-4 text-slate-400"/>
        </button>
      </div>

      <div className="space-y-2.5 mb-5 text-sm">
        <Row icon={Mail}     label="E-mail">
          <a href={`mailto:${lead.contactEmail}`} className="text-cyan-600 dark:text-cyan-400 hover:underline">
            {lead.contactEmail}
          </a>
        </Row>
        {lead.contactPhone && (
          <Row icon={Phone} label="Telefone">
            <a href={`https://wa.me/55${lead.contactPhone.replace(/\D+/g, '')}`}
              target="_blank" rel="noopener noreferrer"
              className="text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1">
              {lead.contactPhone} <ExternalLink className="w-3 h-3"/>
            </a>
          </Row>
        )}
        <Row icon={Building2} label="Contato">
          {lead.contactName}{lead.contactRole && ` — ${lead.contactRole}`}
        </Row>
        {lead.cnpj && (
          <Row icon={FileText} label="CNPJ">
            <span className="font-mono text-xs">{formatCnpj(lead.cnpj)}</span>
          </Row>
        )}
        {(lead.city || lead.state) && (
          <Row icon={MapPin} label="Local">
            {[lead.city, lead.state].filter(Boolean).join(' / ')}
          </Row>
        )}
        {lead.cameraVolume && (
          <Row icon={Tag} label="Volume">
            {VOLUME_LABEL[lead.cameraVolume] ?? lead.cameraVolume} câmeras
          </Row>
        )}
        {lead.alarmCentral && (
          <Row icon={Tag} label="Central">
            {lead.alarmCentral === 'YES' ? 'Já tem' : lead.alarmCentral === 'BUILDING' ? 'Montando' : 'Não tem'}
          </Row>
        )}
      </div>

      {lead.message && (
        <div className="mb-5 p-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Mensagem</p>
          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{lead.message}</p>
        </div>
      )}

      <div className="border-t border-slate-100 dark:border-white/10 pt-4 mb-4">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Mudar status
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => {
            const sc = STATUS_COLOR[s]
            const active = status === s
            return (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className="text-[10px] font-semibold py-2 rounded transition-all border-2"
                style={{
                  background:  active ? sc.bg : 'white',
                  borderColor: active ? sc.text : '#e2e8f0',
                  color:       active ? sc.text : '#64748b',
                }}
              >
                {STATUS_LABEL[s]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
          Notas internas
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Próximos passos, contexto interno, link de proposta…"
          className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none bg-white dark:bg-space-900/60 dark:text-white border-slate-200 dark:border-white/10 focus:border-cyan-500"
          style={{ borderWidth: '1.5px' }}
        />
      </div>

      {status === 'LOST' && (
        <div className="mb-3">
          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Motivo da perda
          </label>
          <input
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="Ex.: preço, fechou com concorrente, fora do ICP…"
            className="w-full rounded-lg px-3 py-2 text-xs outline-none bg-white dark:bg-space-900/60 dark:text-white border-slate-200 dark:border-white/10 focus:border-cyan-500"
            style={{ borderWidth: '1.5px' }}
          />
        </div>
      )}

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs flex items-start gap-2"
          style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48' }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5"/> {error}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving || (status === lead.status && notes === (lead.notes ?? '') && lostReason === (lead.lostReason ?? ''))}
        className="w-full py-2.5 rounded-lg text-sm font-semibold text-slate-900 dark:text-white flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        style={{ background: 'linear-gradient(135deg, #0090D8 0%, #00C0D0 52%, #00D0A8 100%)' }}
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
        Salvar alterações
      </button>

      {/* Ações Lote 1 */}
      {lead.status !== 'CONVERTED' && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => { setShowInviteModal(true); setInviteResult(null); setInviteError('') }}
            className="py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border-2 border-violet-300 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors"
          >
            <Send className="w-3.5 h-3.5"/> Emitir Convite
          </button>
          <button
            onClick={() => { setShowConvertModal(true); setConvertResult(null); setConvertError('') }}
            className="py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border-2 border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
          >
            <Zap className="w-3.5 h-3.5"/> Converter Agora
          </button>
        </div>
      )}

      {/* Modal: Emitir Convite */}
      <AnimatePresence>
        {showInviteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={() => setShowInviteModal(false)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-space-900 rounded-2xl shadow-2xl p-6 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center">
                    <Send className="w-4 h-4 text-violet-600 dark:text-violet-400"/>
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Emitir Convite Demo</h3>
                </div>
                <button onClick={() => setShowInviteModal(false)}>
                  <X className="w-4 h-4 text-slate-400"/>
                </button>
              </div>

              {!inviteResult ? (
                <>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Será gerado um magic link de 14 dias para <strong>{lead.contactEmail}</strong> criar o acesso.
                  </p>
                  {inviteError && (
                    <div className="mb-3 px-3 py-2 rounded-lg text-xs flex gap-2"
                      style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48' }}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5"/> {inviteError}
                    </div>
                  )}
                  <button
                    onClick={emitirConvite}
                    disabled={inviting}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-slate-900 dark:text-white flex items-center justify-center gap-2 disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)' }}
                  >
                    {inviting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4"/>}
                    Gerar magic link
                  </button>
                </>
              ) : (
                <>
                  <div className="flex justify-center mb-4 p-3 bg-white rounded-xl border border-slate-200">
                    <QRCodeSVG value={inviteResult.magicLink} size={160} level="M"/>
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3 mb-3">
                    <div className="flex items-center gap-2">
                      <Link2 className="w-3.5 h-3.5 text-violet-500 shrink-0"/>
                      <p className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate flex-1">
                        {inviteResult.magicLink}
                      </p>
                      <button
                        onClick={() => copyLink(inviteResult.magicLink)}
                        className="shrink-0 p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10 transition-colors"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500"/> : <Copy className="w-3.5 h-3.5 text-slate-400"/>}
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center">
                    Expira em {new Date(inviteResult.expiresAt).toLocaleDateString('pt-BR')}
                  </p>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Converter Agora */}
      <AnimatePresence>
        {showConvertModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={() => setShowConvertModal(false)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-space-900 rounded-2xl shadow-2xl p-6 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400"/>
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Converter Lead em Tenant</h3>
                </div>
                <button onClick={() => setShowConvertModal(false)}>
                  <X className="w-4 h-4 text-slate-400"/>
                </button>
              </div>

              {!convertResult ? (
                <>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Cria o tenant imediatamente com senha temporária (mustChangePassword = true).
                  </p>
                  <div className="mb-4">
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                      Tipo de tenant
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['INTEGRADOR', 'CLIENTE_FINAL'] as const).map((k) => (
                        <button
                          key={k}
                          onClick={() => setConvertKind(k)}
                          className="py-2 rounded-lg text-xs font-semibold border-2 transition-all"
                          style={{
                            borderColor: convertKind === k ? '#10b981' : '#e2e8f0',
                            background:  convertKind === k ? '#d1fae5' : 'white',
                            color:       convertKind === k ? '#065f46' : '#64748b',
                          }}
                        >
                          {k === 'INTEGRADOR' ? 'Integrador' : 'Cliente Final'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {convertError && (
                    <div className="mb-3 px-3 py-2 rounded-lg text-xs flex gap-2"
                      style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48' }}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5"/> {convertError}
                    </div>
                  )}
                  <button
                    onClick={converterDireto}
                    disabled={converting}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-slate-900 dark:text-white flex items-center justify-center gap-2 disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
                  >
                    {converting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Zap className="w-4 h-4"/>}
                    Criar tenant agora
                  </button>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                    <Check className="w-4 h-4 text-emerald-600"/>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">Tenant criado com sucesso!</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Mail className="w-3.5 h-3.5 text-slate-400"/>
                      <span className="text-slate-500">E-mail:</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{convertResult.user.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Key className="w-3.5 h-3.5 text-slate-400"/>
                      <span className="text-slate-500">Senha temporária:</span>
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{convertResult.user.tempPassword}</span>
                      <button onClick={() => copyLink(convertResult!.user.tempPassword)}
                        className="ml-auto p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10">
                        <Copy className="w-3 h-3 text-slate-400"/>
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5"/>
                    Copie a senha agora — ela não será exibida novamente.
                  </p>
                  <button
                    onClick={() => setShowConvertModal(false)}
                    className="w-full py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5"
                  >
                    Fechar
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {savedAt && (
        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 text-center mt-2">
          Salvo às {savedAt.toLocaleTimeString('pt-BR')}
        </p>
      )}

      {/* ── Follow-up / Activity Timeline ── */}
      <div className="mt-5 border-t border-slate-100 dark:border-white/10 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-3.5 h-3.5 text-slate-400"/>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Histórico de atividades
          </p>
          {followUps.length > 0 && (
            <span className="ml-auto text-[10px] text-slate-400">{followUps.length} registro{followUps.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Type selector + input */}
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(FOLLOWUP_TYPE_INFO) as FollowUpType[]).map(t => (
              <button
                key={t}
                onClick={() => setFuType(t)}
                className={[
                  'px-2 py-0.5 rounded text-[10px] font-semibold transition-colors border',
                  fuType === t
                    ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/40'
                    : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5',
                ].join(' ')}
              >
                {FOLLOWUP_TYPE_INFO[t].emoji} {FOLLOWUP_TYPE_INFO[t].label}
              </button>
            ))}
          </div>
          <textarea
            value={fuContent}
            onChange={e => setFuContent(e.target.value)}
            rows={2}
            placeholder="Registrar atividade…"
            className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none bg-white dark:bg-space-900/60 dark:text-white border-slate-200 dark:border-white/10 focus:border-cyan-500 transition-colors"
            style={{ borderWidth: '1.5px' }}
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={fuDue}
              onChange={e => setFuDue(e.target.value)}
              title="Data de vencimento (opcional)"
              className="flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none bg-white dark:bg-space-900/60 dark:text-white border-slate-200 dark:border-white/10 focus:border-cyan-500 transition-colors"
              style={{ borderWidth: '1.5px' }}
            />
            <button
              onClick={addFollowUp}
              disabled={!fuContent.trim() || fuAdding}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              style={{ background: 'linear-gradient(135deg, #0090D8 0%, #00C0D0 52%, #00D0A8 100%)' }}
            >
              {fuAdding ? <Loader2 className="w-3 h-3 animate-spin"/> : <Plus className="w-3 h-3"/>}
              Registrar
            </button>
          </div>
        </div>

        {/* Timeline list */}
        {followUps.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-3">Nenhuma atividade ainda</p>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
            {followUps.map(fu => (
              <div
                key={fu.id}
                className={`flex gap-2 p-2.5 rounded-lg border transition-opacity ${fu.completed ? 'opacity-50 bg-slate-50 dark:bg-white/3 border-slate-100 dark:border-white/5' : 'bg-white dark:bg-space-900/40 border-slate-200 dark:border-white/10'}`}
              >
                <span className="text-base shrink-0 mt-0.5 leading-none">{FOLLOWUP_TYPE_INFO[fu.type]?.emoji ?? '📝'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs whitespace-pre-wrap break-words leading-relaxed ${fu.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-300'}`}>
                    {fu.content}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-slate-400">{formatRelative(fu.createdAt)}</span>
                    {fu.dueDate && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                        <Calendar className="w-2.5 h-2.5"/>
                        {new Date(fu.dueDate).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-0.5 shrink-0">
                  <button
                    onClick={() => toggleFollowUp(fu)}
                    title={fu.completed ? 'Marcar como pendente' : 'Marcar como concluído'}
                    className={`p-1 rounded transition-colors ${fu.completed ? 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10' : 'text-slate-600 dark:text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'}`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5"/>
                  </button>
                  <button
                    onClick={() => removeFollowUp(fu)}
                    title="Remover"
                    className="p-1 rounded text-slate-600 dark:text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5"/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer timestamps */}
      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-white/10 grid grid-cols-2 gap-2 text-[10px] text-slate-400 dark:text-slate-500">
        <div>Recebido: {new Date(lead.createdAt).toLocaleString('pt-BR')}</div>
        {lead.contactedAt && <div>Contatado: {new Date(lead.contactedAt).toLocaleDateString('pt-BR')}</div>}
        {lead.demoSentAt  && <div>Demo enviada: {new Date(lead.demoSentAt).toLocaleDateString('pt-BR')}</div>}
        {lead.convertedAt && <div>Convertido: {new Date(lead.convertedAt).toLocaleDateString('pt-BR')}</div>}
      </div>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function Row({
  icon: Icon, label, children,
}: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-3.5 h-3.5 mt-1 text-slate-400 dark:text-slate-500 shrink-0"/>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
        <div className="text-xs text-slate-700 dark:text-slate-300">{children}</div>
      </div>
    </div>
  )
}

function formatCnpj(d: string): string {
  if (d.length !== 14) return d
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `há ${d}d`
  return new Date(iso).toLocaleDateString('pt-BR')
}

// ── ApprovalsTab ─────────────────────────────────────────────────────────────

function ApprovalStatusBadge({ status }: { status: string }) {
  const cfg = APPROVAL_STATUS_CONFIG[status] ?? APPROVAL_STATUS_CONFIG.EXPIRED
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

// ── Modal de detalhe completo (portado da ApprovalsPage) ─────────────────────
function ApprovalDetailModal({
  item, onClose, onRefresh,
}: {
  item: ApprovalRequest
  onClose: () => void
  onRefresh: () => void
}) {
  const [rejectReason, setRejectReason] = useState('')
  const [showReject,   setShowReject]   = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  const isPending = item.status === 'PENDING'
  const severity  = APPROVAL_ACTION_SEVERITY[item.action] ?? 'low'
  const cfg       = APPROVAL_STATUS_CONFIG[item.status] ?? APPROVAL_STATUS_CONFIG.EXPIRED

  async function handleApprove() {
    setLoading(true); setError('')
    try { await approveRequest(item.id); onRefresh(); onClose() }
    catch (e: any) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  async function handleReject() {
    if (!rejectReason.trim() || rejectReason.trim().length < 5) {
      setError('Informe um motivo com ao menos 5 caracteres'); return
    }
    setLoading(true); setError('')
    try { await rejectRequest(item.id, rejectReason); onRefresh(); onClose() }
    catch (e: any) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        className="bg-white dark:bg-space-900 rounded-2xl border border-slate-200 dark:border-white/10 w-full max-w-lg shadow-2xl overflow-y-auto max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-white/8">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">
              {APPROVAL_ACTION_LABEL[item.action] ?? item.action}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">ID: {item.id.slice(0, 8)}…</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cfg.color}`}>
              {cfg.label}
            </span>
            <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition-colors">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Severidade */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">Severidade:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${APPROVAL_SEVERITY_STYLE[severity]}`}>
              {{ low: 'Baixa', medium: 'Média', high: 'Alta' }[severity]}
            </span>
          </div>

          {/* Motivo da solicitação */}
          {item.reason && (
            <div>
              <p className="text-xs text-slate-500 mb-1 font-medium">Motivo da solicitação</p>
              <p className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-white/5 rounded-lg px-3 py-2">
                {item.reason}
              </p>
            </div>
          )}

          {/* Payload */}
          <div>
            <p className="text-xs text-slate-500 mb-1 font-medium">Payload</p>
            <pre className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-white/5 rounded-lg px-3 py-2 overflow-auto max-h-32">
              {JSON.stringify(item.payloadJson, null, 2)}
            </pre>
          </div>

          {/* Resultado (se executado) */}
          {item.resultJson && (
            <div>
              <p className="text-xs text-slate-500 mb-1 font-medium">Resultado da execução</p>
              <pre className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 overflow-auto max-h-32">
                {JSON.stringify(item.resultJson, null, 2)}
              </pre>
            </div>
          )}

          {/* Motivo de rejeição */}
          {item.rejectedReason && (
            <div className="flex gap-2 p-3 bg-rose-50 dark:bg-rose-900/20 rounded-lg">
              <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">Rejeitado</p>
                <p className="text-xs text-rose-600 dark:text-rose-400">{item.rejectedReason}</p>
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div><span className="font-medium">Criado:</span> {new Date(item.createdAt).toLocaleString('pt-BR')}</div>
            <div><span className="font-medium">Expira:</span> {new Date(item.expiresAt).toLocaleString('pt-BR')}</div>
            {item.decidedAt  && <div><span className="font-medium">Decidido:</span>  {new Date(item.decidedAt).toLocaleString('pt-BR')}</div>}
            {item.executedAt && <div><span className="font-medium">Executado:</span> {new Date(item.executedAt).toLocaleString('pt-BR')}</div>}
          </div>

          {error && <p className="text-xs text-rose-500 font-medium">{error}</p>}

          {/* Formulário de rejeição (aparece ao clicar em Rejeitar) */}
          {showReject && isPending && (
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Motivo da rejeição *
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Descreva por que esta ação não pode ser aprovada…"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
              />
            </div>
          )}
        </div>

        {/* Footer com ações */}
        {isPending && (
          <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-white/8">
            {!showReject ? (
              <>
                <button
                  onClick={() => setShowReject(true)}
                  className="px-4 py-2 rounded-xl border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-400 text-sm font-medium hover:bg-rose-50 dark:hover:bg-rose-900/20 transition"
                >
                  Rejeitar
                </button>
                <button
                  onClick={handleApprove}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Aprovar
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowReject(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleReject}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Confirmar Rejeição
                </button>
              </>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ── ApprovalsTab (versão completa, unifica ApprovalsPage) ────────────────────
const APPROVAL_STATUS_FILTERS = [
  { label: 'Todos',      value: '' as const        },
  { label: 'Pendentes',  value: 'PENDING'  as const },
  { label: 'Aprovados',  value: 'APPROVED' as const },
  { label: 'Executados', value: 'EXECUTED' as const },
  { label: 'Rejeitados', value: 'REJECTED' as const },
  { label: 'Expirados',  value: 'EXPIRED'  as const },
]

function ApprovalsTab() {
  const [statusFilter, setStatusFilter] = useState<string>('PENDING')
  const [selected,     setSelected]     = useState<ApprovalRequest | null>(null)

  // Busca com filtro de status ativo
  const { data, isLoading, error, mutate } = useApprovals({
    status: statusFilter || undefined,
    limit: 100,
  })

  const items    = data?.items ?? []
  const byStatus = data?.byStatus ?? {}
  const pending  = byStatus.PENDING ?? 0

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando aprovações…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-900/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        Erro ao carregar aprovações: {formatApiError(error)}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-500" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Fila de Aprovações</p>
          {pending > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
              {pending} pendente{pending !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 text-xs hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5 transition"
        >
          <RefreshCw className="w-3 h-3" /> Atualizar
        </button>
      </div>

      {/* Cards de resumo por status (clicáveis = filtro) */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {(['PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'EXPIRED'] as const).map(s => {
            const cfg   = APPROVAL_STATUS_CONFIG[s]
            const Icon  = cfg.icon
            const count = byStatus[s] ?? 0
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                className={[
                  'rounded-xl border p-3 text-left transition hover:shadow-sm',
                  statusFilter === s
                    ? 'border-indigo-400 dark:border-indigo-500 ring-1 ring-indigo-300 dark:ring-indigo-600'
                    : 'border-slate-200 dark:border-white/8',
                  'bg-white dark:bg-space-900',
                ].join(' ')}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs text-slate-500 dark:text-slate-400">{cfg.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{count}</p>
              </button>
            )
          })}
        </div>
      )}

      {/* Pills de filtro */}
      <div className="flex gap-1 flex-wrap mb-4">
        {APPROVAL_STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={[
              'px-3 py-1 rounded-full text-xs font-medium transition border',
              statusFilter === f.value
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-slate-100 dark:bg-white/10',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {items.length === 0 ? (
        <div className="text-center py-8 text-slate-400 dark:text-slate-500">
          <Shield className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">
            Nenhuma solicitação{statusFilter ? ` "${APPROVAL_STATUS_CONFIG[statusFilter]?.label}"` : ''}
          </p>
          <p className="text-xs mt-1">Ações sensíveis do Admin global aparecem aqui para revisão.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(req => {
            const severity = APPROVAL_ACTION_SEVERITY[req.action] ?? 'low'
            return (
              <motion.button
                key={req.id}
                layout
                onClick={() => setSelected(req)}
                className={[
                  'w-full text-left rounded-xl border p-4 flex items-center gap-4 transition',
                  'bg-white dark:bg-space-900/60',
                  req.status === 'PENDING'
                    ? 'border-amber-200 dark:border-amber-700/30 hover:border-amber-400 dark:hover:border-amber-500'
                    : 'border-slate-200 dark:border-white/8 hover:border-indigo-300 dark:hover:border-indigo-700',
                ].join(' ')}
              >
                {/* Ponto de severidade */}
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  severity === 'high'   ? 'bg-rose-500' :
                  severity === 'medium' ? 'bg-amber-500' : 'bg-slate-400'
                }`} />

                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="font-medium text-slate-900 dark:text-white text-sm">
                      {APPROVAL_ACTION_LABEL[req.action] ?? req.action}
                    </span>
                    <ApprovalStatusBadge status={req.status} />
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${APPROVAL_SEVERITY_STYLE[severity]}`}>
                      {{ low: 'Baixa', medium: 'Média', high: 'Alta' }[severity]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                    <span>{formatRelative(req.createdAt)}</span>
                    {req.reason && <span className="truncate max-w-xs">• {req.reason}</span>}
                  </div>
                </div>

                <Eye className="w-4 h-4 text-slate-400 shrink-0" />
              </motion.button>
            )
          })}
        </div>
      )}

      {/* Rodapé com total */}
      {data && data.total > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 text-right">
          {data.total} solicitaç{data.total === 1 ? 'ão' : 'ões'} encontrada{data.total === 1 ? '' : 's'}
        </p>
      )}

      {/* Modal de detalhe */}
      <AnimatePresence>
        {selected && (
          <ApprovalDetailModal
            item={selected}
            onClose={() => setSelected(null)}
            onRefresh={() => { mutate(); setSelected(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── DemoInvitesTab ───────────────────────────────────────────────────────────

const INVITE_STATUS_CONFIG: Record<DemoInvite['status'], {
  label: string
  color: string
  icon: React.FC<{ className?: string }>
}> = {
  PENDING:  { label: 'Pendente', color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-700/40', icon: Clock },
  ACCEPTED: { label: 'Aceito',   color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/40', icon: CheckCircle2 },
  REVOKED:  { label: 'Revogado', color: 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-300 border-rose-200 dark:border-rose-700/40', icon: XCircle },
  EXPIRED:  { label: 'Expirado', color: 'text-slate-500 bg-slate-100 dark:bg-white/5 dark:text-slate-400 border-slate-200 dark:border-white/10', icon: AlertTriangle },
}

function InviteStatusBadge({ status }: { status: DemoInvite['status'] }) {
  const cfg  = INVITE_STATUS_CONFIG[status]
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

function DemoInvitesTab() {
  const { data, isLoading, error, mutate } = useDemoInvites()
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeErr, setRevokeErr] = useState<string | null>(null)

  const items = data?.items ?? []

  async function handleRevoke(id: string) {
    const ok = await confirm({
      title: 'Revogar este convite?',
      description: 'O link de acesso ficará inativo.',
      destructive: true,
      confirmLabel: 'Revogar',
    })
    if (!ok) return
    setRevoking(id)
    setRevokeErr(null)
    try {
      await revokeDemoInvite(id)
      mutate()
    } catch (e: any) {
      setRevokeErr(formatApiError(e))
    }
    setRevoking(null)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando convites…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-900/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        Erro ao carregar convites: {formatApiError(error)}
      </div>
    )
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {items.length} convite{items.length !== 1 ? 's' : ''} encontrado{items.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-xs hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5 transition"
        >
          <RefreshCw className="w-3 h-3" /> Atualizar
        </button>
      </div>

      {revokeErr && (
        <div className="mb-3 flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-900/20 rounded-lg text-rose-600 dark:text-rose-400 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {revokeErr}
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-slate-400 dark:text-slate-500 gap-3">
          <LinkIcon className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">Nenhum convite emitido</p>
          <p className="text-xs">Selecione um lead e clique em "Emitir Convite" para enviar um magic link.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-space-900/60 rounded-xl border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5">
          {items.map(inv => (
            <div key={inv.id} className="flex items-center gap-4 px-4 py-3">
              {/* Status */}
              <InviteStatusBadge status={inv.status} />

              {/* Lead info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {inv.lead.companyName ?? inv.lead.contactName}
                  </p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400">
                    {inv.targetKind === 'INTEGRADOR' ? 'INTEG.' : 'CLIENTE'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3" /> {inv.lead.contactEmail}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Expira: {new Date(inv.expiresAt).toLocaleDateString('pt-BR')}
                  </span>
                  <span>Emitido: {formatRelative(inv.createdAt)}</span>
                  {inv.consumedAt && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      ✓ Aceito: {new Date(inv.consumedAt).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              {inv.status === 'PENDING' && (
                <button
                  onClick={() => handleRevoke(inv.id)}
                  disabled={revoking === inv.id}
                  title="Revogar convite"
                  className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800/40 text-rose-600 dark:text-rose-400 text-xs hover:bg-rose-50 dark:hover:bg-rose-900/20 transition disabled:opacity-40"
                >
                  {revoking === inv.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Ban className="w-3.5 h-3.5" />
                  }
                  Revogar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
