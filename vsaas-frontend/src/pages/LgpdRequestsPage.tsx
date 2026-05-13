/**
 * LgpdRequestsPage — Centro de gestão LGPD do DPO/SUPER_ADMIN.
 *
 * FCB-016 (frontend) — admin processa solicitações LGPD Art. 18:
 *   - ACCESS / PORTABILITY → gera pacote JSON, presigned URL R2
 *   - DELETION / ANONYMIZATION → soft-delete + anonimiza PII
 *   - CORRECTION → ação manual
 *
 * SLA legal: 15 dias (Art. 19). Painel destaca SLA vencido / próximo do prazo.
 *
 * Auto-refresh 60s. Filtros por status. Detalhes em modal lateral.
 */
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import {
  Shield, AlertTriangle, CheckCircle2, Clock, Loader2, Mail,
  ChevronRight, RefreshCw, FileDown, Trash2, FileText, X, AlertOctagon,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api } from '../api/client'
import { cn } from '../lib/utils'

const fetcher = (u: string) => api.get(u).then(r => r.data)

type RequestType    = 'ACCESS' | 'PORTABILITY' | 'DELETION' | 'CORRECTION' | 'ANONYMIZATION'
type RequestStatus  = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED'
type SlaStatus      = 'OK' | 'WARNING' | 'OVERDUE'

interface LgpdRequest {
  id:             string
  requestType:    RequestType
  requestorEmail: string
  clienteFinalId: string | null
  description:    string | null
  status:         RequestStatus
  requestedAt:    string
  completedAt:    string | null
  responseNotes:  string | null
  handledBy:      string | null
  slaDaysLeft:    number
  slaStatus:      SlaStatus
}

const TYPE_LABELS: Record<RequestType, string> = {
  ACCESS:        'Acesso (Art. 18 II)',
  PORTABILITY:   'Portabilidade (Art. 18 V)',
  DELETION:      'Eliminação (Art. 18 VI)',
  CORRECTION:    'Retificação (Art. 18 III)',
  ANONYMIZATION: 'Anonimização (Art. 18 IV)',
}

const TYPE_ICONS: Record<RequestType, typeof FileDown> = {
  ACCESS:        FileText,
  PORTABILITY:   FileDown,
  DELETION:      Trash2,
  CORRECTION:    FileText,
  ANONYMIZATION: Shield,
}

export function LgpdRequestsPage() {
  const [filterStatus, setFilterStatus] = useState<RequestStatus | 'all'>('all')
  const [selected, setSelected] = useState<LgpdRequest | null>(null)
  const [processing, setProcessing] = useState(false)

  const url = filterStatus === 'all' ? '/lgpd/data-requests' : `/lgpd/data-requests?status=${filterStatus}`
  const { data, error, isLoading, mutate } = useSWR<{ requests: LgpdRequest[]; total: number }>(
    url, fetcher, { refreshInterval: 60_000 },
  )

  const requests = data?.requests ?? []

  const stats = useMemo(() => {
    return {
      total:    requests.length,
      pending:  requests.filter(r => r.status === 'PENDING').length,
      progress: requests.filter(r => r.status === 'IN_PROGRESS').length,
      done:     requests.filter(r => r.status === 'COMPLETED').length,
      overdue:  requests.filter(r => r.slaStatus === 'OVERDUE').length,
      warning:  requests.filter(r => r.slaStatus === 'WARNING').length,
    }
  }, [requests])

  async function processRequest(req: LgpdRequest) {
    if (!confirm(`Processar solicitação ${TYPE_LABELS[req.requestType]} de ${req.requestorEmail}?\n\nIsso é IRREVERSÍVEL para DELETION/ANONYMIZATION.`)) {
      return
    }
    setProcessing(true)
    try {
      await api.post(`/lgpd/data-requests/${req.id}/process`)
      await mutate()
      setSelected(null)
      alert('Solicitação processada com sucesso. Solicitante recebeu e-mail.')
    } catch (e: any) {
      alert(`Falha: ${e?.response?.data?.message ?? e?.message ?? 'erro desconhecido'}`)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Hero + KPIs */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Solicitações LGPD
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-mono uppercase">
                  DPO
                </span>
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Lei Geral de Proteção de Dados (LGPD) Art. 18 — direitos do titular.
                <span className="font-semibold text-violet-600 dark:text-violet-300"> SLA: 15 dias.</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => mutate()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 text-xs font-mono"
          >
            <RefreshCw className="w-3 h-3" /> Atualizar
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <KpiCard icon={FileText}      value={stats.total}    label="Total"        color="violet" />
          <KpiCard icon={Clock}         value={stats.pending}  label="Pendentes"    color="amber" />
          <KpiCard icon={Loader2}       value={stats.progress} label="Em curso"     color="cyan" />
          <KpiCard icon={CheckCircle2}  value={stats.done}     label="Concluídas"   color="emerald" />
          <KpiCard icon={AlertOctagon}  value={stats.overdue}  label="SLA vencido"  color={stats.overdue > 0 ? 'rose' : 'slate'} />
          <KpiCard icon={AlertTriangle} value={stats.warning}  label="< 5d restantes" color={stats.warning > 0 ? 'amber' : 'slate'} />
        </div>
      </GlassCard>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition',
              filterStatus === s
                ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30'
                : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10',
            )}
          >
            {s === 'all' ? 'Todas' : s}
          </button>
        ))}
      </div>

      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
            <div>
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Falha ao carregar</p>
              <p className="text-xs text-slate-500">{(error as any)?.message}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {isLoading && !data && (
        <GlassCard className="p-12 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Carregando solicitações...</p>
        </GlassCard>
      )}

      {data && requests.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Shield className="w-12 h-12 text-emerald-500 mx-auto mb-3 opacity-50" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Nenhuma solicitação {filterStatus !== 'all' ? `${filterStatus.toLowerCase()}` : ''}</p>
          <p className="text-xs text-slate-500 mt-1">Solicitações aparecem aqui quando clientes finais usam botão "LGPD" no portal</p>
        </GlassCard>
      )}

      {/* Lista */}
      <div className="space-y-2">
        {requests.map(r => <RequestRow key={r.id} req={r} onClick={() => setSelected(r)} />)}
      </div>

      {/* Detail modal */}
      <AnimatePresence>
        {selected && (
          <DetailModal
            req={selected}
            onClose={() => setSelected(null)}
            onProcess={() => processRequest(selected)}
            processing={processing}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, value, label, color }: {
  icon: typeof FileDown
  value: number | string
  label: string
  color: 'violet' | 'cyan' | 'amber' | 'emerald' | 'rose' | 'slate'
}) {
  const colorClasses: Record<typeof color, string> = {
    violet:  'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20',
    cyan:    'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20',
    amber:   'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    rose:    'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
    slate:   'bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-500/10',
  }
  return (
    <div className={cn('rounded-lg p-3 border flex items-center gap-2', colorClasses[color])}>
      <Icon className="w-4 h-4 shrink-0" />
      <div className="min-w-0">
        <div className="text-lg font-bold leading-none">{value}</div>
        <div className="text-[10px] uppercase tracking-wider opacity-70 mt-0.5 truncate">{label}</div>
      </div>
    </div>
  )
}

function RequestRow({ req, onClick }: { req: LgpdRequest; onClick: () => void }) {
  const TypeIcon = TYPE_ICONS[req.requestType]
  const slaColor =
    req.slaStatus === 'OVERDUE' ? 'text-rose-600 dark:text-rose-400'
    : req.slaStatus === 'WARNING' ? 'text-amber-600 dark:text-amber-400'
    : 'text-slate-500'

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.995 }}
      className="w-full text-left"
    >
      <GlassCard className={cn(
        'p-3 hover:border-violet-500/40 transition cursor-pointer flex items-center gap-3',
        req.status === 'PENDING'    && 'border-amber-500/30',
        req.status === 'COMPLETED'  && 'border-emerald-500/20 opacity-70',
        req.slaStatus === 'OVERDUE' && req.status !== 'COMPLETED' && 'border-rose-500/40',
      )}>
        <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
          <TypeIcon className="w-5 h-5 text-violet-600 dark:text-violet-300" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {TYPE_LABELS[req.requestType]}
            </span>
            <StatusBadge status={req.status} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Mail className="w-3 h-3" />{req.requestorEmail}
            </span>
            <span>{new Date(req.requestedAt).toLocaleString('pt-BR')}</span>
          </div>
        </div>

        <div className={cn('text-xs font-mono shrink-0 text-right', slaColor)}>
          {req.status === 'COMPLETED' ? (
            <span className="text-emerald-600 dark:text-emerald-400">✓ done</span>
          ) : req.slaDaysLeft <= 0 ? (
            <span>SLA {Math.abs(req.slaDaysLeft)}d atrasado</span>
          ) : (
            <span>{req.slaDaysLeft}d restantes</span>
          )}
        </div>

        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
      </GlassCard>
    </motion.button>
  )
}

function StatusBadge({ status }: { status: RequestStatus }) {
  const map: Record<RequestStatus, { label: string; cls: string }> = {
    PENDING:     { label: 'pendente',  cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
    IN_PROGRESS: { label: 'em curso',  cls: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' },
    COMPLETED:   { label: 'concluída', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
    REJECTED:    { label: 'rejeitada', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  }
  const c = map[status]
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider', c.cls)}>
      {c.label}
    </span>
  )
}

function DetailModal({ req, onClose, onProcess, processing }: {
  req: LgpdRequest
  onClose: () => void
  onProcess: () => void
  processing: boolean
}) {
  const isProcessable = req.status === 'PENDING' || req.status === 'IN_PROGRESS'
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 12 }} animate={{ y: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{TYPE_LABELS[req.requestType]}</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{req.id}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <Field label="Solicitante">{req.requestorEmail}</Field>
          <Field label="Status"><StatusBadge status={req.status} /></Field>
          <Field label="Solicitado em">{new Date(req.requestedAt).toLocaleString('pt-BR')}</Field>
          <Field label="Concluído em">{req.completedAt ? new Date(req.completedAt).toLocaleString('pt-BR') : '—'}</Field>
          <Field label="Cliente Final">{req.clienteFinalId ?? '— (escopo user)'}</Field>
          <Field label="SLA">
            {req.status === 'COMPLETED' ? (
              <span className="text-emerald-600">✓ atendida no prazo</span>
            ) : req.slaDaysLeft <= 0 ? (
              <span className="text-rose-600 font-bold">VENCIDO há {Math.abs(req.slaDaysLeft)} dia(s)</span>
            ) : (
              <span>{req.slaDaysLeft} dia(s) restantes (15d total)</span>
            )}
          </Field>
        </div>

        {req.description && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Descrição</p>
            <p className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-white/5 rounded p-2 whitespace-pre-wrap">
              {req.description}
            </p>
          </div>
        )}

        {req.responseNotes && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Resultado do processamento</p>
            <pre className="text-[10px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-white/5 rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {req.responseNotes}
            </pre>
          </div>
        )}

        {isProcessable && (
          <div className="border-t border-slate-200 dark:border-white/10 pt-3">
            <p className="text-[11px] text-slate-500 mb-3">
              Ao processar:
              <br />• <strong>ACCESS / PORTABILITY:</strong> gera pacote JSON, sobe pra R2, envia link presigned (TTL 7d)
              <br />• <strong>DELETION / ANONYMIZATION:</strong> anonimiza PII, mantém agregados estatísticos. <strong className="text-rose-600">Irreversível</strong>.
              <br />• <strong>CORRECTION:</strong> requer ação manual posterior.
            </p>
            <button
              onClick={onProcess}
              disabled={processing}
              className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 text-white text-sm font-bold shadow-lg shadow-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {processing ? <><Loader2 className="w-4 h-4 animate-spin" />Processando...</> : <>Processar solicitação <ChevronRight className="w-4 h-4" /></>}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</p>
      <div className="text-slate-700 dark:text-slate-200">{children}</div>
    </div>
  )
}
