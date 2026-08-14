/**
 * AdminDealRegistrationPage — SUPER_ADMIN aprova/rejeita deals + vê pipeline.
 */
import { useState } from 'react'
import { Shield, AlertCircle, RefreshCw, Calendar, Check, X, Trophy, Play } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'
import { api, useAdminDealRegistrations, type DealRegistration, type DealRegStatus } from '../api/client'
import { useUiToast } from '../components/Toast'
import { confirm } from '../components/ConfirmDialog'

const STATUS_COLORS: Record<DealRegStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  APPROVED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30',
  WON: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border border-violet-500/30',
  LOST: 'bg-slate-200 dark:bg-space-800 text-slate-500',
  EXPIRED: 'bg-slate-200 dark:bg-space-800 text-slate-500',
}

export function AdminDealRegistrationPage() {
  const [filter, setFilter] = useState<DealRegStatus | 'ALL'>('PENDING')
  const { data: deals, mutate, isLoading, error } = useAdminDealRegistrations(filter === 'ALL' ? undefined : { status: filter })
  const [running, setRunning] = useState(false)
  const toast = useUiToast()

  async function runCron() {
    setRunning(true)
    try {
      const r = await api.post('/admin/deal-registration/cron-run')
      toast.success(`Cron executado: ${r.data.expired} deals expirados`)
      mutate()
    } catch (e: any) { toast.error(e?.response?.data?.error ?? e.message) }
    finally { setRunning(false) }
  }

  // summary removido — variável calculada mas nunca lida no JSX

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-amber-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-amber-500 flex items-center justify-center shadow-lg">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Deal Registration · Admin</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Pipeline de prospects registrados pelos integradores. Aprovar trava o CNPJ
                por 30 dias para outros integradores. Conversão em contrato vira métrica de canal.
              </p>
            </div>
          </div>
          <button onClick={runCron} disabled={running} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5">
            {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Force expirar
          </button>
        </div>
      </GlassCard>

      <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 w-fit">
        {(['ALL', 'PENDING', 'APPROVED', 'WON', 'LOST', 'EXPIRED', 'REJECTED'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)} className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-semibold transition',
            filter === s
              ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
          )}>{s}</button>
        ))}
      </div>

      {isLoading && <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando…</GlassCard>}
      {error && (
        <GlassCard className="p-6 text-center">
          <AlertCircle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
          <p className="text-sm text-rose-600 dark:text-rose-400">Falha ao carregar.</p>
        </GlassCard>
      )}

      {deals && deals.length === 0 && !isLoading && (
        <GlassCard className="p-8 text-center">
          <Shield className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nenhum deal {filter !== 'ALL' && filter.toLowerCase()}.</p>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {deals?.map(d => <DealCard key={d.id} deal={d} onChange={mutate} />)}
      </div>
    </div>
  )
}

function DealCard({ deal, onChange }: { deal: DealRegistration; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function approve() {
    setBusy(true); setErr(null)
    try { await api.post(`/admin/deal-registration/${deal.id}/approve`); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }
  async function reject() {
    const reason = prompt('Motivo da rejeição (opcional):')
    setBusy(true); setErr(null)
    try { await api.post(`/admin/deal-registration/${deal.id}/reject`, { reason }); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }
  async function won() {
    const ok = await confirm({
      title: `Marcar "${deal.companyName}" como contrato fechado?`,
      confirmLabel: 'Confirmar',
    })
    if (!ok) return
    setBusy(true); setErr(null)
    try { await api.post(`/admin/deal-registration/${deal.id}/won`); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }

  const expiresAt = deal.expiresAt ? new Date(deal.expiresAt) : null
  const daysRemaining = expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null

  return (
    <GlassCard className={cn('p-4', (deal.status === 'EXPIRED' || deal.status === 'LOST' || deal.status === 'REJECTED') && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{deal.companyName}</p>
          <p className="text-[10px] text-slate-500 font-mono">CNPJ: {deal.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}</p>
          <p className="text-[10px] text-violet-600 dark:text-violet-400 mt-0.5">
            por <strong>{deal.integrador?.tradeName ?? deal.integrador?.name}</strong>
          </p>
        </div>
        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold', STATUS_COLORS[deal.status])}>
          {deal.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div>
          <p className="text-[10px] uppercase text-slate-500">Contato</p>
          <p className="text-slate-700 dark:text-slate-300">{deal.contactName}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-slate-500">MRR estim.</p>
          <p className="font-mono text-slate-700 dark:text-slate-300">
            {deal.estimatedMrrBrl ? `R$ ${Number(deal.estimatedMrrBrl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
          </p>
        </div>
        {expiresAt && deal.status === 'APPROVED' && (
          <div className="col-span-2">
            <p className="text-[10px] uppercase text-slate-500"><Calendar className="w-2.5 h-2.5 inline mr-0.5" />Exclusividade até</p>
            <p className="font-mono text-slate-700 dark:text-slate-300">{expiresAt.toLocaleDateString('pt-BR')} ({daysRemaining}d)</p>
          </div>
        )}
      </div>

      {deal.notes && (
        <p className="mt-3 text-[11px] text-slate-600 dark:text-slate-400 leading-snug border-l-2 border-slate-300 dark:border-white/10 pl-2 italic">
          {deal.notes}
        </p>
      )}

      <div className="mt-3 flex gap-1">
        {deal.status === 'PENDING' && (
          <>
            <button disabled={busy} onClick={approve} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
              <Check className="w-3 h-3 inline mr-0.5" />Aprovar (30d)
            </button>
            <button disabled={busy} onClick={reject} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30">
              <X className="w-3 h-3 inline mr-0.5" />Rejeitar
            </button>
          </>
        )}
        {deal.status === 'APPROVED' && (
          <button disabled={busy} onClick={won} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">
            <Trophy className="w-3 h-3 inline mr-0.5" />Marcar como contrato fechado
          </button>
        )}
      </div>

      {err && <div className="mt-2 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}
    </GlassCard>
  )
}
