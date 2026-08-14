/**
 * AdminPlanUpgradeRequestsPage — fabricante aprova/nega solicitações de upgrade.
 * Sprint 0 · Variação B.
 */
import { useState } from 'react'
import useSWR from 'swr'
import {
  Bell, Check, X, Clock, Loader2, ArrowRight, ArrowLeft, MessageSquare,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface UpgradeRequest {
  id: string; status: string; reason: string | null
  decidedAt: string | null; decisionNote: string | null
  createdAt: string
  integrador: { id: string; name: string; tradeName: string | null; email: string }
  fromPlan: { id: string; slug: string; name: string; priceMonthly: number | null; maxClientesFinais: number | null; maxCameras: number | null } | null
  toPlan:   { id: string; slug: string; name: string; priceMonthly: number | null; maxClientesFinais: number | null; maxCameras: number | null } | null
}

function brl(n: number | null) {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function AdminPlanUpgradeRequestsPage() {
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'DENIED' | 'ALL'>('PENDING')
  const [decideOpen, setDecideOpen] = useState<UpgradeRequest | null>(null)
  const { data, isLoading, mutate } = useSWR<UpgradeRequest[]>(
    `/admin/plan-upgrade-requests?status=${status}`, fetcher, { refreshInterval: 30_000 },
  )

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/20 via-violet-500/10 to-transparent border-2 border-cyan-300 dark:border-cyan-500/40">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <Bell className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Solicitações de upgrade</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Integradores pedindo mudança de plano. Aprovar atualiza imediatamente; negar registra audit.
              </p>
            </div>
          </div>
          <Link to="/admin/billing" className="text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Voltar ao billing
          </Link>
        </div>
      </GlassCard>

      <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60 w-fit">
        {(['PENDING', 'APPROVED', 'DENIED', 'ALL'] as const).map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={cn('px-3 py-1.5 rounded-md text-xs font-medium',
              status === s
                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            )}>
            {s === 'PENDING' ? 'Pendentes' : s === 'APPROVED' ? 'Aprovadas' : s === 'DENIED' ? 'Negadas' : 'Todas'}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-600" />
        </div>
      )}

      {!isLoading && data?.length === 0 && (
        <GlassCard className="p-8 text-center">
          <Check className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
          <p className="text-sm text-slate-700 dark:text-slate-300">Nenhuma solicitação {status === 'PENDING' ? 'pendente' : ''}.</p>
        </GlassCard>
      )}

      {data && data.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {data.map(r => (
              <div key={r.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{r.integrador.tradeName ?? r.integrador.name}</p>
                      <StatusPill status={r.status} />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{r.integrador.email}</p>

                    <div className="flex items-center gap-3 mt-3 text-xs">
                      <div className="px-3 py-2 rounded bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-white/10">
                        <p className="text-[10px] uppercase text-slate-500">De</p>
                        <p className="font-semibold">{r.fromPlan?.name ?? '— sem plano —'}</p>
                        <p className="text-slate-500 text-[11px] mt-0.5">R$ {brl(r.fromPlan?.priceMonthly ?? null)}/mês</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                      <div className="px-3 py-2 rounded bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-300 dark:border-cyan-500/30">
                        <p className="text-[10px] uppercase text-cyan-700 dark:text-cyan-300">Para</p>
                        <p className="font-semibold text-cyan-900 dark:text-cyan-100">{r.toPlan?.name}</p>
                        <p className="text-cyan-700 dark:text-cyan-400 text-[11px] mt-0.5">R$ {brl(r.toPlan?.priceMonthly ?? null)}/mês</p>
                      </div>
                    </div>

                    {r.reason && (
                      <div className="mt-3 p-2 rounded bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                        <div className="flex items-center gap-1 mb-1 text-[10px] uppercase tracking-wider text-slate-500"><MessageSquare className="w-3 h-3" /> Motivo do integrador</div>
                        <p className="text-xs text-slate-700 dark:text-slate-300">{r.reason}</p>
                      </div>
                    )}
                    {r.decisionNote && (
                      <div className="mt-2 p-2 rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                        <div className="flex items-center gap-1 mb-1 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300">Nota do fabricante</div>
                        <p className="text-xs text-amber-800 dark:text-amber-200">{r.decisionNote}</p>
                      </div>
                    )}

                    <p className="text-[10px] text-slate-400 mt-2">
                      Solicitada {new Date(r.createdAt).toLocaleString('pt-BR')}
                      {r.decidedAt && ` · decidida ${new Date(r.decidedAt).toLocaleString('pt-BR')}`}
                    </p>
                  </div>

                  {r.status === 'PENDING' && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setDecideOpen({ ...r, status: 'APPROVED' as any })}
                        className="px-3 py-2 rounded-md text-xs font-semibold bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 inline-flex items-center gap-1">
                        <Check className="w-3 h-3" /> Aprovar
                      </button>
                      <button onClick={() => setDecideOpen({ ...r, status: 'DENIED' as any })}
                        className="px-3 py-2 rounded-md text-xs font-semibold border border-rose-300 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 inline-flex items-center gap-1">
                        <X className="w-3 h-3" /> Negar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {decideOpen && (
        <DecideModal
          request={decideOpen}
          onClose={() => setDecideOpen(null)}
          onSuccess={() => { setDecideOpen(null); mutate() }}
        />
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING:  { label: 'Pendente',  cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30' },
    APPROVED: { label: 'Aprovada',  cls: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30' },
    DENIED:   { label: 'Negada',    cls: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30' },
  }
  const m = map[status] ?? map.PENDING
  return <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider', m.cls)}><Clock className="w-2.5 h-2.5 inline mr-0.5" />{m.label}</span>
}

function DecideModal({ request, onClose, onSuccess }: {
  request: UpgradeRequest; onClose: () => void; onSuccess: () => void
}) {
  const decision = request.status as 'APPROVED' | 'DENIED'
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true); setErr(null)
    try {
      await api.patch(`/admin/plan-upgrade-requests/${request.id}`, {
        decision,
        decisionNote: note || undefined,
      })
      onSuccess()
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? e?.response?.data?.error ?? e.message)
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {decision === 'APPROVED' ? 'Aprovar upgrade' : 'Negar solicitação'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {request.integrador.tradeName ?? request.integrador.name}: {request.fromPlan?.name ?? '—'} → <strong>{request.toPlan?.name}</strong>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <label className="text-xs text-slate-700 dark:text-slate-300 mb-1 block">
          Nota da decisão {decision === 'DENIED' ? '(recomendado pra integrador entender)' : '(opcional)'}
        </label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={4}
          placeholder={decision === 'APPROVED' ? 'Ex: aprovado, ativaremos no próximo ciclo.' : 'Ex: por enquanto preferimos manter no Essencial. Tente em 60 dias.'}
          className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm" />

        {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}

        {decision === 'APPROVED' && (
          <div className="mt-3 p-2 rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-800 dark:text-amber-200">
            ⚠ Aprovar troca o plano <strong>imediatamente</strong>. Próxima fatura usará a nova mensalidade (com pro-rata se mid-month).
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-md text-xs border border-slate-300 dark:border-slate-600">Cancelar</button>
          <button onClick={submit} disabled={submitting}
            className={cn('px-3 py-2 rounded-md text-xs font-semibold text-white inline-flex items-center gap-1 disabled:opacity-50',
              decision === 'APPROVED'
                ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600'
                : 'bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600',
            )}>
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : decision === 'APPROVED' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
            Confirmar {decision === 'APPROVED' ? 'aprovação' : 'recusa'}
          </button>
        </div>
      </div>
    </div>
  )
}
