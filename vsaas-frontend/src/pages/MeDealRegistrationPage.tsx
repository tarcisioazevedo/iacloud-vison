/**
 * Deal Registration — view do INTEGRADOR.
 *
 * Lista deals próprios, permite criar novo (com check de CNPJ em tempo real),
 * registrar atividade comercial (+15d) ou marcar como perdido.
 */
import { useState } from 'react'
import { Shield, Plus, Calendar, Clock, RefreshCw, Save, X, Check, AlertTriangle } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'
import { api, useMyDealRegistrations, checkCnpjAvailability, type DealRegistration, type DealRegStatus } from '../api/client'

const STATUS_COLORS: Record<DealRegStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  APPROVED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30',
  WON: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border border-violet-500/30',
  LOST: 'bg-slate-200 dark:bg-space-800 text-slate-500',
  EXPIRED: 'bg-slate-200 dark:bg-space-800 text-slate-500',
}

const STATUS_LABEL: Record<DealRegStatus, string> = {
  PENDING: 'Pendente aprovação',
  APPROVED: 'Aprovado · exclusividade ativa',
  REJECTED: 'Rejeitado',
  WON: 'Convertido em contrato',
  LOST: 'Perdido',
  EXPIRED: 'Expirado',
}

export function MeDealRegistrationPage() {
  const { data: deals, mutate, isLoading } = useMyDealRegistrations()
  const [creating, setCreating] = useState(false)

  const summary = {
    total: deals?.length ?? 0,
    pending: deals?.filter(d => d.status === 'PENDING').length ?? 0,
    approved: deals?.filter(d => d.status === 'APPROVED').length ?? 0,
    won: deals?.filter(d => d.status === 'WON').length ?? 0,
  }

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Deal Registration</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Registre prospects para garantir <strong>30 dias de exclusividade</strong>.
                Após aprovação do fabricante, o CNPJ fica travado pra outros integradores.
              </p>
            </div>
          </div>
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold whitespace-nowrap">
            <Plus className="w-3.5 h-3.5" /> Registrar prospect
          </button>
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total" value={summary.total} />
        <KpiCard label="Pendentes" value={summary.pending} tone="amber" />
        <KpiCard label="Aprovados ativos" value={summary.approved} tone="emerald" />
        <KpiCard label="Convertidos" value={summary.won} tone="violet" />
      </div>

      {isLoading && <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando…</GlassCard>}

      {deals && deals.length === 0 && !isLoading && (
        <GlassCard className="p-8 text-center">
          <Shield className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nenhum prospect registrado. Clique em "Registrar prospect" para garantir exclusividade.</p>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {deals?.map(d => <DealCard key={d.id} deal={d} onChange={mutate} />)}
      </div>

      {creating && <CreateDealModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); mutate() }} />}
    </div>
  )
}

function KpiCard({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'amber' | 'emerald' | 'violet' }) {
  return (
    <GlassCard className="p-3">
      <p className="text-[10px] uppercase font-semibold text-slate-500">{label}</p>
      <p className={cn('text-2xl font-bold mt-1',
        tone === 'amber' && 'text-amber-600 dark:text-amber-400',
        tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'violet' && 'text-violet-600 dark:text-violet-400',
        tone === 'slate' && 'text-slate-900 dark:text-white',
      )}>{value}</p>
    </GlassCard>
  )
}

function DealCard({ deal, onChange }: { deal: DealRegistration; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function activity() {
    setBusy(true); setErr(null)
    try { await api.post(`/me/integrador/deal-registration/${deal.id}/activity`); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }
  async function lost() {
    if (!confirm(`Marcar "${deal.companyName}" como perdido?`)) return
    setBusy(true); setErr(null)
    try { await api.post(`/me/integrador/deal-registration/${deal.id}/lost`); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }

  const expiresAt = deal.expiresAt ? new Date(deal.expiresAt) : null
  const daysRemaining = expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null
  const isExpiringSoon = daysRemaining !== null && daysRemaining <= 7
  const isActive = deal.status === 'APPROVED' && daysRemaining !== null && daysRemaining > 0

  return (
    <GlassCard className={cn('p-4', (deal.status === 'EXPIRED' || deal.status === 'LOST') && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{deal.companyName}</p>
          <p className="text-[10px] text-slate-500 font-mono">CNPJ: {deal.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}</p>
        </div>
        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', STATUS_COLORS[deal.status])}>
          {STATUS_LABEL[deal.status]}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div>
          <p className="text-[10px] uppercase text-slate-500">Contato</p>
          <p className="text-slate-700 dark:text-slate-300">{deal.contactName}</p>
          <p className="text-[10px] text-slate-500">{deal.contactEmail ?? deal.contactPhone ?? '—'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-slate-500">MRR estimado</p>
          <p className="font-mono text-slate-700 dark:text-slate-300">
            {deal.estimatedMrrBrl ? `R$ ${Number(deal.estimatedMrrBrl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
          </p>
        </div>
        {expiresAt && (
          <div className="col-span-2">
            <p className="text-[10px] uppercase text-slate-500">
              <Calendar className="w-2.5 h-2.5 inline mr-0.5" />Exclusividade até
            </p>
            <p className={cn('font-mono',
              !isActive ? 'text-slate-500' :
              isExpiringSoon ? 'text-amber-700 dark:text-amber-400 font-bold' :
              'text-slate-700 dark:text-slate-300',
            )}>
              {expiresAt.toLocaleDateString('pt-BR')}
              {isActive && ` · ${daysRemaining}d restantes`}
            </p>
          </div>
        )}
      </div>

      {deal.notes && (
        <p className="mt-3 text-[11px] text-slate-600 dark:text-slate-400 leading-snug border-l-2 border-slate-300 dark:border-white/10 pl-2 italic">
          {deal.notes}
        </p>
      )}

      {deal.rejectionReason && (
        <p className="mt-3 text-[11px] text-rose-600 dark:text-rose-400 leading-snug border-l-2 border-rose-500 pl-2">
          <strong>Motivo da rejeição:</strong> {deal.rejectionReason}
        </p>
      )}

      {isActive && (
        <div className="mt-3 flex gap-1">
          <button disabled={busy} onClick={activity} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold border border-cyan-500/40 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-30">
            <Clock className="w-3 h-3 inline mr-0.5" />Registrar atividade (+15d)
          </button>
          <button disabled={busy} onClick={lost} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 disabled:opacity-30">
            <X className="w-3 h-3 inline mr-0.5" />Marcar como perdido
          </button>
        </div>
      )}

      {err && <div className="mt-2 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}
    </GlassCard>
  )
}

function CreateDealModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [cnpj, setCnpj] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyTradeName, setCompanyTradeName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [estimatedMrrBrl, setEstimatedMrrBrl] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [cnpjLocked, setCnpjLocked] = useState<{ locked: boolean; ownerName?: string } | null>(null)

  async function checkCnpj() {
    const clean = cnpj.replace(/\D/g, '')
    if (clean.length !== 14) {
      setCnpjLocked(null)
      return
    }
    try {
      const r = await checkCnpjAvailability(clean)
      setCnpjLocked({ locked: r.locked, ownerName: r.ownedBy?.integradorName })
    } catch { setCnpjLocked(null) }
  }

  async function save() {
    if (!cnpj || !companyName || !contactName) {
      setErr('Preencha CNPJ, razão social e contato')
      return
    }
    setBusy(true); setErr(null)
    try {
      await api.post('/me/integrador/deal-registration', {
        cnpj, companyName,
        companyTradeName: companyTradeName || undefined,
        contactName,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined,
        estimatedMrrBrl: estimatedMrrBrl ? Number(estimatedMrrBrl) : undefined,
        notes: notes || undefined,
      })
      onCreated()
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.response?.data?.error ?? e.message
      setErr(msg)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-xl mt-12 bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Registrar prospect</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">CNPJ *</label>
            <input value={cnpj} onChange={e => { setCnpj(e.target.value); setCnpjLocked(null) }} onBlur={checkCnpj} placeholder="00.000.000/0000-00" className="w-full input-base" />
            {cnpjLocked?.locked && (
              <div className="mt-1 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[10px]">
                <AlertTriangle className="w-3 h-3 inline mr-0.5" />
                CNPJ já em deal aprovado de <strong>{cnpjLocked.ownerName}</strong>
              </div>
            )}
            {cnpjLocked && !cnpjLocked.locked && (
              <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                <Check className="w-3 h-3 inline" /> CNPJ disponível
              </p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Razão social *</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} className="w-full input-base" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Nome fantasia</label>
            <input value={companyTradeName} onChange={e => setCompanyTradeName(e.target.value)} className="w-full input-base" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Contato *</label>
            <input value={contactName} onChange={e => setContactName(e.target.value)} className="w-full input-base" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">MRR estimado (R$)</label>
            <input type="number" step="0.01" value={estimatedMrrBrl} onChange={e => setEstimatedMrrBrl(e.target.value)} className="w-full input-base" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">E-mail</label>
            <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className="w-full input-base" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Telefone</label>
            <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} className="w-full input-base" />
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Notas (briefing, contexto)</label>
            <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} className="w-full input-base" />
          </div>
        </div>

        {err && <div className="mt-3 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs">Cancelar</button>
          <button onClick={save} disabled={busy || cnpjLocked?.locked} className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1">
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Registrar
          </button>
        </div>
      </div>
    </div>
  )
}
