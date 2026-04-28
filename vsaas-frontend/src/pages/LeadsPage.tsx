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
  Send, Zap, Copy, QrCode, Key, Link2,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { api, formatApiError } from '../api/client'

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

export function LeadsPage() {
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-cyan-100 dark:bg-cyan-500/20">
            <Inbox className="w-5 h-5 text-cyan-600 dark:text-cyan-400"/>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Funil de Leads</h1>
            <p className="text-xs text-slate-500">CRM interno — solicitações de acesso pendentes</p>
          </div>
        </div>
        <button
          onClick={() => mutate()}
          className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5"/> Atualizar
        </button>
      </div>

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
            className="w-full pl-10 pr-3 py-2.5 rounded-lg text-sm outline-none border-slate-200 dark:border-white/10 dark:bg-space-900/60 dark:text-white focus:border-cyan-500 transition-colors"
            style={{ borderWidth: '1.5px' }}
          />
        </div>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as LeadKind | '')}
          className="px-3 py-2.5 rounded-lg text-sm outline-none bg-white dark:bg-space-900/60 dark:text-white border-slate-200 dark:border-white/10"
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
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2"/> Carregando…
            </div>
          ) : error ? (
            <div className="px-6 py-10 text-center text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-6 h-6 mx-auto mb-2"/>
              <p className="text-sm">{formatApiError(error)}</p>
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-400 dark:text-slate-500">
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
                      className="w-full text-left px-4 py-3 transition-colors flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-white/5"
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
                      <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600"/>
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
            <div className="text-center py-12 text-slate-400 dark:text-slate-500">
              <Tag className="w-7 h-7 mx-auto mb-2 opacity-50"/>
              <p className="text-sm">Selecione um lead para abrir os detalhes</p>
            </div>
          ) : (
            <LeadDetail lead={selected} onUpdated={() => mutate()} onClose={() => setSelectedId(null)}/>
          )}
        </aside>
      </div>
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
        <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-white/5 rounded">
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
        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        style={{ background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)' }}
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
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
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
                        className="shrink-0 p-1.5 rounded hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
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
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
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
                        className="ml-auto p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10">
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
                    className="w-full py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
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

      <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/10 grid grid-cols-2 gap-2 text-[10px] text-slate-400 dark:text-slate-500">
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
