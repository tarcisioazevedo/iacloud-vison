/**
 * ApprovalsPage — `/approvals` (SUPER_ADMIN)
 *
 * Lote 6 (D14): Fila de aprovação para ações sensíveis do Admin global.
 * Super Admin pode aprovar ou rejeitar requests pendentes.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, ShieldX, Clock, CheckCircle2, XCircle, AlertTriangle,
  Loader2, ChevronRight, X, RefreshCw, Eye,
} from 'lucide-react'
import { api, formatApiError } from '../api/client'

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'EXPIRED'
type ApprovalAction =
  | 'CREATE_INTEGRADOR' | 'DELETE_INTEGRADOR' | 'CONVERT_LEAD'
  | 'DELETE_CLIENTE_FINAL' | 'DELETE_USER' | 'CHANGE_BILLING' | 'RESET_USER_PASSWORD'

interface ApprovalRequest {
  id:               string
  action:           ApprovalAction
  status:           ApprovalStatus
  requestedByUserId: string
  payloadJson:      Record<string, unknown>
  resultJson:       Record<string, unknown> | null
  reason:           string | null
  rejectedReason:   string | null
  decidedByUserId:  string | null
  decidedAt:        string | null
  executedAt:       string | null
  expiresAt:        string
  createdAt:        string
  updatedAt:        string
}

const ACTION_LABEL: Record<ApprovalAction, string> = {
  CREATE_INTEGRADOR:   'Criar Integrador',
  DELETE_INTEGRADOR:   'Deletar Integrador',
  CONVERT_LEAD:        'Converter Lead',
  DELETE_CLIENTE_FINAL:'Deletar Cliente Final',
  DELETE_USER:         'Deletar Usuário',
  CHANGE_BILLING:      'Alterar Billing',
  RESET_USER_PASSWORD: 'Redefinir Senha',
}

const ACTION_SEVERITY: Record<ApprovalAction, 'low' | 'medium' | 'high'> = {
  CREATE_INTEGRADOR:    'low',
  CONVERT_LEAD:         'low',
  CHANGE_BILLING:       'medium',
  RESET_USER_PASSWORD:  'medium',
  DELETE_USER:          'high',
  DELETE_INTEGRADOR:    'high',
  DELETE_CLIENTE_FINAL: 'high',
}

const STATUS_CONFIG: Record<ApprovalStatus, { label: string; color: string; icon: React.FC<any> }> = {
  PENDING:  { label: 'Pendente',  color: 'text-amber-600  bg-amber-50  dark:bg-amber-900/20  dark:text-amber-300  border-amber-200  dark:border-amber-700/40',  icon: Clock },
  APPROVED: { label: 'Aprovado',  color: 'text-blue-600   bg-blue-50   dark:bg-blue-900/20   dark:text-blue-300   border-blue-200   dark:border-blue-700/40',   icon: CheckCircle2 },
  REJECTED: { label: 'Rejeitado', color: 'text-rose-600   bg-rose-50   dark:bg-rose-900/20   dark:text-rose-300   border-rose-200   dark:border-rose-700/40',   icon: XCircle },
  EXECUTED: { label: 'Executado', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/40', icon: CheckCircle2 },
  EXPIRED:  { label: 'Expirado',  color: 'text-slate-500  bg-slate-100 dark:bg-white/5        dark:text-slate-400  border-slate-200  dark:border-white/10',      icon: AlertTriangle },
}

const SEVERITY_STYLE: Record<'low' | 'medium' | 'high', string> = {
  low:    'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400',
  medium: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  high:   'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400',
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// ── Detail / action modal ─────────────────────────────────────────────────────
interface DetailModalProps {
  item: ApprovalRequest
  onClose: () => void
  onRefresh: () => void
}

function DetailModal({ item, onClose, onRefresh }: DetailModalProps) {
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject]     = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')

  const isPending = item.status === 'PENDING'
  const severity  = ACTION_SEVERITY[item.action]

  const handleApprove = async () => {
    setLoading(true); setError('')
    try {
      await api.post(`/approvals/${item.id}/approve`)
      onRefresh()
      onClose()
    } catch (e: any) {
      setError(formatApiError(e))
    } finally { setLoading(false) }
  }

  const handleReject = async () => {
    if (!rejectReason.trim() || rejectReason.trim().length < 5) {
      setError('Informe um motivo com ao menos 5 caracteres'); return
    }
    setLoading(true); setError('')
    try {
      await api.post(`/approvals/${item.id}/reject`, { reason: rejectReason })
      onRefresh()
      onClose()
    } catch (e: any) {
      setError(formatApiError(e))
    } finally { setLoading(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        className="bg-white dark:bg-space-900 rounded-2xl border border-slate-200 dark:border-white/10 w-full max-w-lg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-white/8">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">{ACTION_LABEL[item.action]}</h2>
            <p className="text-xs text-slate-500 mt-0.5">ID: {item.id.slice(0, 8)}…</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={item.status} />
            <button onClick={onClose}><X className="w-4 h-4 text-slate-400" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Severity */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Severidade:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SEVERITY_STYLE[severity]}`}>
              {{ low: 'Baixa', medium: 'Média', high: 'Alta' }[severity]}
            </span>
          </div>

          {/* Reason */}
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

          {/* Result (if executed) */}
          {item.resultJson && (
            <div>
              <p className="text-xs text-slate-500 mb-1 font-medium">Resultado da execução</p>
              <pre className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 overflow-auto max-h-32">
                {JSON.stringify(item.resultJson, null, 2)}
              </pre>
            </div>
          )}

          {/* Rejected reason */}
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
            <div><span className="font-medium">Criado:</span> {fmtDate(item.createdAt)}</div>
            <div><span className="font-medium">Expira:</span> {fmtDate(item.expiresAt)}</div>
            {item.decidedAt && <div><span className="font-medium">Decidido:</span> {fmtDate(item.decidedAt)}</div>}
          </div>

          {error && <p className="text-xs text-rose-500 font-medium">{error}</p>}

          {/* Reject form */}
          {showReject && isPending && (
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Motivo da rejeição *
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Descreva por que esta ação não pode ser aprovada..."
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
              />
            </div>
          )}
        </div>

        {/* Footer */}
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
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Aprovar
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setShowReject(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/5 transition">
                  Cancelar
                </button>
                <button
                  onClick={handleReject}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldX className="w-4 h-4" />}
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

// ── Main page ─────────────────────────────────────────────────────────────────

const FILTERS: { label: string; value: ApprovalStatus | '' }[] = [
  { label: 'Todos',      value: ''         },
  { label: 'Pendentes',  value: 'PENDING'  },
  { label: 'Aprovados',  value: 'APPROVED' },
  { label: 'Executados', value: 'EXECUTED' },
  { label: 'Rejeitados', value: 'REJECTED' },
  { label: 'Expirados',  value: 'EXPIRED'  },
]

export function ApprovalsPage() {
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | ''>('PENDING')
  const [selected, setSelected]         = useState<ApprovalRequest | null>(null)

  const { data, error, isLoading, mutate } = useSWR<{
    items: ApprovalRequest[]
    total: number
    byStatus: Record<ApprovalStatus, number>
  }>(
    `/approvals${statusFilter ? `?status=${statusFilter}` : ''}`,
    (url: string) => api.get(url).then(r => r.data),
    { refreshInterval: 30_000 },
  )

  const pending = data?.byStatus?.PENDING ?? 0

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-indigo-500" />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Fila de Aprovações</h1>
          {pending > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-bold">
              {pending} pendente{pending > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ações sensíveis do Admin global aguardando aprovação do Super Admin.
        </p>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {(['PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'EXPIRED'] as ApprovalStatus[]).map(s => {
            const cfg  = STATUS_CONFIG[s]
            const Icon = cfg.icon
            const count = data.byStatus[s] ?? 0
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s === statusFilter ? '' : s)}
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

      {/* Filters + refresh */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value as any)}
              className={[
                'px-3 py-1 rounded-full text-xs font-medium transition border',
                statusFilter === f.value
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-xs hover:bg-slate-50 dark:hover:bg-white/5 transition"
        >
          <RefreshCw className="w-3 h-3" />
          Atualizar
        </button>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-900/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Erro ao carregar aprovações.
        </div>
      )}

      {!isLoading && data?.items.length === 0 && (
        <div className="text-center py-16 text-slate-400 dark:text-slate-500">
          <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhuma solicitação{statusFilter ? ` com status "${STATUS_CONFIG[statusFilter as ApprovalStatus]?.label}"` : ''}.</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="space-y-2">
          {data.items.map(item => {
            const severity = ACTION_SEVERITY[item.action]
            return (
              <motion.button
                key={item.id}
                layout
                onClick={() => setSelected(item)}
                className={[
                  'w-full text-left rounded-xl border p-4 flex items-center gap-4 transition',
                  'bg-white dark:bg-space-900',
                  item.status === 'PENDING'
                    ? 'border-amber-200 dark:border-amber-700/30 hover:border-amber-400 dark:hover:border-amber-500'
                    : 'border-slate-200 dark:border-white/8 hover:border-indigo-300 dark:hover:border-indigo-700',
                ].join(' ')}
              >
                {/* Severity dot */}
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  severity === 'high' ? 'bg-rose-500' :
                  severity === 'medium' ? 'bg-amber-500' : 'bg-slate-400'
                }`} />

                {/* Action */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-slate-900 dark:text-white text-sm">
                      {ACTION_LABEL[item.action]}
                    </span>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>Solicitado em {fmtDate(item.createdAt)}</span>
                    {item.reason && (
                      <span className="truncate max-w-xs">• {item.reason}</span>
                    )}
                  </div>
                </div>

                <Eye className="w-4 h-4 text-slate-400 shrink-0" />
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </motion.button>
            )
          })}
        </div>
      )}

      {/* Total */}
      {data && data.total > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 text-right">
          {data.total} solicitaç{data.total === 1 ? 'ão' : 'ões'} encontrada{data.total === 1 ? '' : 's'}
        </p>
      )}

      {/* Detail modal */}
      <AnimatePresence>
        {selected && (
          <DetailModal
            item={selected}
            onClose={() => setSelected(null)}
            onRefresh={() => mutate()}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
