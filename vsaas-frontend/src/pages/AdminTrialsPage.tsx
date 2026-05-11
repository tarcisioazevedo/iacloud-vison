/**
 * AdminTrialsPage — SUPER_ADMIN gerencia trials ativos.
 *
 * Funções:
 *   - Lista todos com countdown + cameras used/limit
 *   - Estende +N dias
 *   - Converte em pagante
 *   - Cancela
 *   - Cria trial novo (escolhe integrador existente)
 *   - Force cron (debug)
 */
import { useState } from 'react'
import { Sparkles, AlertCircle, Clock, Camera, RefreshCw, Plus, Check, X, Calendar, Play } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'
import { api, useAdminTrials, type AdminTrialItem } from '../api/client'
import useSWR from 'swr'

const fetcher = (url: string) => api.get(url).then(r => r.data)

export function AdminTrialsPage() {
  const { data: trials, mutate, isLoading, error } = useAdminTrials()
  const [creating, setCreating] = useState(false)
  const [running, setRunning] = useState(false)

  async function runCron() {
    setRunning(true)
    try {
      const r = await api.post('/admin/trials/cron-run')
      const total = (r.data.notified ?? []).reduce((s: number, n: any) => s + n.count, 0)
      alert(`Cron executado: ${r.data.processed} trials processados · ${r.data.expired} expirados · ${total} notificações enviadas`)
      mutate()
    } catch (e: any) {
      alert(e?.response?.data?.error ?? e.message)
    } finally { setRunning(false) }
  }

  const summary = {
    total: trials?.length ?? 0,
    active: trials?.filter(t => t.status.isActive).length ?? 0,
    expiringSoon: trials?.filter(t => t.status.isActive && t.status.daysRemaining <= 3).length ?? 0,
    expired: trials?.filter(t => !t.status.isActive).length ?? 0,
    overlimit: trials?.filter(t => t.status.camerasOverLimit).length ?? 0,
  }

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-amber-500/10 via-cyan-500/5 to-transparent border-amber-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Trials</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Período de avaliação (default 14 dias + 5 câmeras). Cron a cada 6h envia
                lembretes T-7/T-3/T-1/T-0 e suspende ao expirar.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={runCron} disabled={running} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5">
              {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Force cron
            </button>
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold">
              <Plus className="w-3.5 h-3.5" /> Novo trial
            </button>
          </div>
        </div>
      </GlassCard>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KpiCard label="Total" value={summary.total} />
        <KpiCard label="Ativos" value={summary.active} tone="cyan" />
        <KpiCard label="Expira em ≤ 3d" value={summary.expiringSoon} tone="amber" />
        <KpiCard label="Expirados" value={summary.expired} tone="rose" />
        <KpiCard label="Acima do limite" value={summary.overlimit} tone="violet" />
      </div>

      {isLoading && <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando…</GlassCard>}
      {error && (
        <GlassCard className="p-6 text-center">
          <AlertCircle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
          <p className="text-sm text-rose-600 dark:text-rose-400">Falha ao carregar trials.</p>
        </GlassCard>
      )}

      {trials && trials.length === 0 && !isLoading && (
        <GlassCard className="p-8 text-center">
          <Sparkles className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nenhum trial ativo. Clique em "Novo trial" para criar um.</p>
        </GlassCard>
      )}

      {/* Lista */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {trials?.map(t => <TrialCard key={t.id} trial={t} onChange={mutate} />)}
      </div>

      {creating && <CreateTrialModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); mutate() }} />}
    </div>
  )
}

function KpiCard({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'cyan' | 'amber' | 'rose' | 'violet' }) {
  return (
    <GlassCard className="p-3">
      <p className="text-[10px] uppercase font-semibold text-slate-500">{label}</p>
      <p className={cn('text-2xl font-bold mt-1',
        tone === 'cyan' && 'text-cyan-600 dark:text-cyan-400',
        tone === 'amber' && 'text-amber-600 dark:text-amber-400',
        tone === 'rose' && 'text-rose-600 dark:text-rose-400',
        tone === 'violet' && 'text-violet-600 dark:text-violet-400',
        tone === 'slate' && 'text-slate-900 dark:text-white',
      )}>{value}</p>
    </GlassCard>
  )
}

function TrialCard({ trial, onChange }: { trial: AdminTrialItem; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function extend() {
    const days = prompt('Estender quantos dias?', '7')
    if (!days || !Number.isFinite(Number(days))) return
    setBusy(true); setErr(null)
    try { await api.post(`/admin/trials/${trial.id}/extend`, { addDays: Number(days) }); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }
  async function convert() {
    if (!confirm(`Converter "${trial.name}" em pagante? Isso remove o limite de trial.`)) return
    setBusy(true); setErr(null)
    try { await api.post(`/admin/trials/${trial.id}/convert`); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }
  async function cancel() {
    if (!confirm(`Cancelar trial de "${trial.name}"? O integrador será suspenso.`)) return
    setBusy(true); setErr(null)
    try { await api.post(`/admin/trials/${trial.id}/cancel`); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }

  const days = trial.status.daysRemaining
  const expired = !trial.status.isActive
  const tone = expired ? 'rose' : days <= 1 ? 'orange' : days <= 3 ? 'amber' : days <= 7 ? 'amber' : 'cyan'
  const sentStages = Object.keys(trial.trialNotificationsSent ?? {})

  return (
    <GlassCard className={cn('p-4', expired && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{trial.tradeName ?? trial.name}</p>
            <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold',
              tone === 'rose' && 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30',
              tone === 'orange' && 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/30',
              tone === 'amber' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
              tone === 'cyan' && 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border border-cyan-500/30',
            )}>
              {expired ? 'EXPIRADO' : `${days}d restantes`}
            </span>
          </div>
          <p className="text-[10px] text-slate-500">{trial.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3 text-xs">
        <div>
          <p className="text-[10px] uppercase text-slate-500">Vencimento</p>
          <p className="font-mono text-slate-700 dark:text-slate-300">
            <Calendar className="w-3 h-3 inline mr-0.5" />
            {new Date(trial.trialEndsAt).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-slate-500">Câmeras</p>
          <p className={cn('font-mono', trial.status.camerasOverLimit ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-700 dark:text-slate-300')}>
            <Camera className="w-3 h-3 inline mr-0.5" />
            {trial.status.camerasUsed}/{trial.trialMaxCameras}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-slate-500">Lembretes</p>
          <p className="font-mono text-slate-700 dark:text-slate-300 text-[10px]">
            {sentStages.length > 0 ? sentStages.join(', ') : '—'}
          </p>
        </div>
      </div>

      <div className="flex gap-1">
        <button disabled={busy || expired} onClick={extend} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold border border-cyan-500/40 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-30">
          <Clock className="w-3 h-3 inline mr-0.5" />Estender
        </button>
        <button disabled={busy} onClick={convert} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
          <Check className="w-3 h-3 inline mr-0.5" />Converter
        </button>
        <button disabled={busy} onClick={cancel} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30">
          <X className="w-3 h-3 inline mr-0.5" />Cancelar
        </button>
      </div>

      {err && <div className="mt-2 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}
    </GlassCard>
  )
}

function CreateTrialModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: integradores } = useSWR<{ integradores: any[]; total: number }>('/admin/integradores', fetcher)
  const [integradorId, setIntegradorId] = useState('')
  const [days, setDays] = useState(14)
  const [maxCameras, setMaxCameras] = useState(5)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!integradorId) { setErr('Escolha um integrador'); return }
    setBusy(true); setErr(null)
    try { await api.post('/admin/trials', { integradorId, days, maxCameras, activate: true }); onCreated() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md mt-12 bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Novo trial</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-xl leading-none">×</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Integrador</label>
            <select value={integradorId} onChange={e => setIntegradorId(e.target.value)} className="w-full input-base">
              <option value="">— escolha —</option>
              {integradores?.integradores?.map(i => (
                <option key={i.id} value={i.id}>{i.tradeName ?? i.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Dias</label>
              <input type="number" min={1} max={365} value={days} onChange={e => setDays(Number(e.target.value))} className="w-full input-base" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Máx câmeras</label>
              <input type="number" min={1} max={100} value={maxCameras} onChange={e => setMaxCameras(Number(e.target.value))} className="w-full input-base" />
            </div>
          </div>
        </div>
        {err && <div className="mt-3 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs">Cancelar</button>
          <button onClick={save} disabled={busy || !integradorId} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-semibold">
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin inline" /> : 'Criar trial'}
          </button>
        </div>
      </div>
    </div>
  )
}
