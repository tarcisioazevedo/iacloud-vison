/**
 * BillingPage — Painel de margem de storage (Sprint 4 do plano).
 *
 * 3 modos de renderização baseados em role:
 *   - SUPER_ADMIN/ADMIN_GLOBAL: visão global plataforma + todos integradores
 *   - INTEGRADOR_*: visão própria (sem custo R2 nem margem fabricante)
 *   - CLIENTE_*: redirecionado para /storage (não tem painel próprio aqui)
 *
 * Endpoints consumidos:
 *   GET /billing/platform        → SA
 *   GET /billing/integrador/:id  → INT
 *   GET /retention/upgrade-requests?status=PENDING_INTEGRADOR → INT (aprovações)
 *   POST /retention/upgrade-requests/:id/decide → INT
 */
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  ArrowLeft, DollarSign, TrendingUp, AlertTriangle, CheckCircle2, XCircle,
  Loader2, RefreshCw, Building2, Layers, Settings2, Zap,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api, formatApiError } from '../api/client'
import { cn } from '../lib/utils'

const userRole = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const isSuperAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN_GLOBAL'
const isIntegrador = userRole === 'INTEGRADOR_ADMIN' || userRole === 'INTEGRADOR_TECNICO' || isSuperAdmin
const isClienteFinal = userRole.startsWith('CLIENTE_')

function currentYearMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Histórico mensal · plataforma — 12 meses
 * Consome GET /billing/platform/history?months=12 (S4).
 * Renderiza barras (receita/custo) + linha de margem % em SVG inline.
 */
function PlatformHistoryChart() {
  const [series, setSeries] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    api.get('/billing/platform/history', { params: { months: 12 } })
      .then(r => { if (alive) setSeries(r.data?.series ?? []) })
      .catch(() => { if (alive) setSeries([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) {
    return <GlassCard className="p-4 flex items-center justify-center h-32"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></GlassCard>
  }
  if (!series || series.length === 0) {
    return (
      <GlassCard className="p-4">
        <div className="text-sm font-bold text-slate-900 dark:text-white mb-1">Histórico mensal · 12m</div>
        <div className="text-xs text-slate-500">Sem snapshots fechados. Rode "snapshot diário" no mês corrente para começar a alimentar.</div>
      </GlassCard>
    )
  }

  const maxReceita = Math.max(1, ...series.map(s => s.receitaBrl))
  const totalReceita = series.reduce((acc, s) => acc + s.receitaBrl, 0)
  const totalCusto   = series.reduce((acc, s) => acc + s.custoR2Brl, 0)
  const totalMargem  = totalReceita - totalCusto
  const avgMarginPct = totalReceita > 0 ? Math.round((totalMargem / totalReceita) * 100) : 0
  const monthLabels = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

  // viewBox 600x200 — eixo Y: 20..170 (150px de altura útil)
  const W = 600, H = 200, padL = 40, padR = 10, padT = 10, padB = 30
  const inner = { w: W - padL - padR, h: H - padT - padB }
  const barWidth = Math.max(8, Math.min(28, (inner.w / series.length) * 0.6))
  const slot = inner.w / series.length

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-bold text-slate-900 dark:text-white">Histórico mensal · receita vs. custo</div>
          <div className="text-[10px] text-slate-500">{series.length}m · valores em BRL · câmbio congelado por snapshot</div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-violet-400 rounded"></span>Receita</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-400 rounded"></span>Custo R2</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400 rounded"></span>Margem %</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" preserveAspectRatio="none">
        {/* gridlines (Y) */}
        {[0, 0.25, 0.5, 0.75, 1].map(p => (
          <line key={p} x1={padL} y1={padT + inner.h * (1 - p)} x2={W - padR} y2={padT + inner.h * (1 - p)}
                stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        ))}
        {/* axis labels (Y) — receita */}
        {[0, 0.5, 1].map(p => (
          <text key={p} x={padL - 4} y={padT + inner.h * (1 - p) + 3} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="end">
            {Math.round(maxReceita * p / 1000)}k
          </text>
        ))}
        {/* bars per month */}
        {series.map((s, i) => {
          const x = padL + slot * i + (slot - barWidth) / 2
          const hReceita = (s.receitaBrl / maxReceita) * inner.h
          const hCusto   = (s.custoR2Brl / maxReceita) * inner.h
          const isLast   = i === series.length - 1
          const monthNum = Number(s.period.slice(5, 7)) - 1
          return (
            <g key={s.period}>
              <rect x={x} y={padT + inner.h - hReceita} width={barWidth} height={hReceita}
                    fill="#a78bfa" opacity={isLast ? 1 : 0.7} rx="1" />
              <rect x={x} y={padT + inner.h - hCusto} width={barWidth} height={hCusto}
                    fill="#f87171" opacity={isLast ? 1 : 0.7} rx="1" />
              <text x={x + barWidth / 2} y={H - padB + 14} fill={isLast ? '#a78bfa' : 'rgba(255,255,255,0.3)'}
                    fontSize="9" textAnchor="middle" fontWeight={isLast ? 'bold' : 'normal'}>
                {monthLabels[monthNum]}
              </text>
            </g>
          )
        })}
        {/* margin line */}
        <polyline fill="none" stroke="#34d399" strokeWidth="2"
                  points={series.map((s, i) => {
                    const x = padL + slot * i + slot / 2
                    const y = padT + inner.h * (1 - ((s.margemPct ?? 0) / 100))
                    return `${x},${y}`
                  }).join(' ')} />
        {series.map((s, i) => {
          const x = padL + slot * i + slot / 2
          const y = padT + inner.h * (1 - ((s.margemPct ?? 0) / 100))
          return <circle key={s.period} cx={x} cy={y} r={i === series.length - 1 ? 3 : 2} fill="#34d399" />
        })}
      </svg>

      <div className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
        <div className="px-2 py-1.5 bg-white/5 rounded">
          <div className="text-[9px] text-slate-500 uppercase font-bold">Receita 12m</div>
          <div className="text-sm font-mono font-bold text-violet-700 dark:text-violet-300">R$ {brl(totalReceita)}</div>
        </div>
        <div className="px-2 py-1.5 bg-white/5 rounded">
          <div className="text-[9px] text-slate-500 uppercase font-bold">Custo R2 12m</div>
          <div className="text-sm font-mono font-bold text-rose-700 dark:text-rose-300">R$ {brl(totalCusto)}</div>
        </div>
        <div className="px-2 py-1.5 bg-white/5 rounded">
          <div className="text-[9px] text-slate-500 uppercase font-bold">Margem total</div>
          <div className="text-sm font-mono font-bold text-emerald-700 dark:text-emerald-300">R$ {brl(totalMargem)} · {avgMarginPct}%</div>
        </div>
        <div className="px-2 py-1.5 bg-white/5 rounded">
          <div className="text-[9px] text-slate-500 uppercase font-bold">Mês mais recente</div>
          <div className="text-sm font-mono font-bold text-slate-900 dark:text-white">{series[series.length - 1].period}</div>
        </div>
      </div>
    </GlassCard>
  )
}

export function BillingPage() {
  if (isClienteFinal) return <Navigate to="/storage" replace />
  if (!isIntegrador)  return <div className="p-6 text-rose-600">Sem acesso ao Billing.</div>

  return isSuperAdmin
    ? <PlatformView />
    : <IntegradorView />
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPER ADMIN — visão plataforma
// ═══════════════════════════════════════════════════════════════════════════
function PlatformView() {
  const [period, setPeriod] = useState(currentYearMonth())
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)
  const [reconcilingSnapshot, setReconcilingSnapshot] = useState<any | null>(null)

  function reload() {
    setLoading(true)
    api.get('/billing/platform', { params: { period } })
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [period])

  async function runTick(kind: 'daily' | 'reconciliation') {
    setRunning(kind)
    try {
      await api.post(`/billing/run-${kind === 'daily' ? 'daily' : 'reconciliation'}`)
      reload()
    } catch (err) {
      alert(formatApiError(err))
    } finally {
      setRunning(null)
    }
  }

  if (loading) return <div className="p-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>

  const totals = data?.totals ?? { receitaBrl: 0, custoR2Brl: 0, margemBrl: 0, margemPct: 0, integradoresAtivos: 0 }
  const snapshots = data?.snapshots ?? []

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">💰 Billing — Plataforma</h1>
          <p className="text-xs text-slate-500">Visão global de margem · todos os integradores</p>
        </div>
        <input
          type="month" value={period}
          onChange={e => setPeriod(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border bg-white dark:bg-white/5 dark:border-white/10 dark:text-white"
        />
        <button
          onClick={reload}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10"
          title="Recarregar"
        >
          <RefreshCw className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {/* Cards principais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Receita" value={`R$ ${brl(totals.receitaBrl)}`} icon={DollarSign} accent="emerald" />
        <KpiCard label="Custo Cloudflare" value={`R$ ${brl(totals.custoR2Brl)}`} icon={Layers} accent="amber" />
        <KpiCard label="Margem IACloud" value={`R$ ${brl(totals.margemBrl)}`} icon={TrendingUp} accent="cyan" />
        <KpiCard label="Margem %" value={`${totals.margemPct.toFixed(1)}%`} icon={Zap} accent={totals.margemPct >= 40 ? 'emerald' : totals.margemPct >= 20 ? 'amber' : 'rose'} />
      </div>

      {/* Histórico mensal — 12m */}
      <PlatformHistoryChart />

      {/* Ações de debug Super Admin */}
      <GlassCard className="p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Ações</span>
        <button
          onClick={() => runTick('daily')}
          disabled={running !== null}
          className="px-3 py-1.5 text-xs rounded-lg bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50"
        >
          {running === 'daily' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Rodar snapshot diário agora'}
        </button>
        <button
          onClick={() => runTick('reconciliation')}
          disabled={running !== null}
          className="px-3 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-white/10 hover:bg-slate-200 disabled:opacity-50"
        >
          {running === 'reconciliation' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Reconciliar com Cloudflare'}
        </button>
        <span className="ml-auto text-xs text-slate-500">{totals.integradoresAtivos} integradores · {snapshots.length} snapshots</span>
      </GlassCard>

      {/* Tabela de integradores */}
      <GlassCard className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-white/5 text-slate-500">
              <tr>
                <th className="text-left p-3">INTEGRADOR</th>
                <th className="text-right p-3">CUSTO R2</th>
                <th className="text-right p-3">RECEITA</th>
                <th className="text-right p-3">MARGEM IACLOUD</th>
                <th className="text-right p-3">MARGEM %</th>
                <th className="text-center p-3">DRIFT CF</th>
                <th className="text-center p-3">FATURA</th>
                <th className="text-center p-3">STATUS</th>
                <th className="text-center p-3">AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s: any) => (
                <tr key={s.id} className="border-t border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5">
                  <td className="p-3">
                    <Link to={`/billing/integrador/${s.integradorId}`} className="font-medium text-cyan-600 hover:underline">
                      {s.integradorName}
                    </Link>
                    <div className="text-[10px] text-slate-500">{s.bucketName}</div>
                  </td>
                  <td className="p-3 text-right text-slate-700 dark:text-slate-300">R$ {brl(s.costTotalBrl ?? 0)}</td>
                  <td className="p-3 text-right text-slate-900 dark:text-white">R$ {brl(s.priceToIntegradorBrl ?? 0)}</td>
                  <td className="p-3 text-right font-semibold text-emerald-600">R$ {brl(s.marginIACloudBrl ?? 0)}</td>
                  <td className="p-3 text-right">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-semibold',
                      (s.marginIACloudPct ?? 0) >= 40 ? 'bg-emerald-100 text-emerald-700' :
                      (s.marginIACloudPct ?? 0) >= 20 ? 'bg-amber-100 text-amber-700' :
                                                       'bg-rose-100 text-rose-700',
                    )}>
                      {(s.marginIACloudPct ?? 0).toFixed(1)}%
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {s.cloudflareInvoiceUsd != null ? (
                      <span className="font-mono text-[10px] text-slate-600 dark:text-slate-300" title="Fatura Cloudflare registrada">
                        $ {Number(s.cloudflareInvoiceUsd).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px] italic">não enviada</span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {s.reconciliationDriftPct != null ? (
                      <span className={cn(
                        'text-[10px] font-semibold',
                        Math.abs(s.reconciliationDriftPct) < 5 ? 'text-emerald-600' : 'text-rose-600'
                      )}>
                        {s.reconciliationDriftPct > 0 ? '+' : ''}{s.reconciliationDriftPct.toFixed(1)}%
                      </span>
                    ) : <span className="text-slate-600 dark:text-slate-300">—</span>}
                  </td>
                  <td className="p-3 text-center">
                    <span className={cn(
                      'inline-block px-2 py-0.5 rounded text-[10px] uppercase font-medium',
                      s.status === 'CLOSED'      ? 'bg-emerald-100 text-emerald-700' :
                      s.status === 'RECONCILED'  ? 'bg-cyan-100 text-cyan-700' :
                      s.status === 'INVOICED'    ? 'bg-purple-100 text-purple-700' :
                                                   'bg-slate-100 text-slate-500',
                    )}>
                      {s.status === 'PRELIMINARY' ? 'preliminar' :
                       s.status === 'CLOSED'      ? 'fechado' :
                       s.status === 'RECONCILED'  ? 'conciliado' : 'faturado'}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => setReconcilingSnapshot(s)}
                      className={cn(
                        'px-2 py-1 text-[10px] rounded font-semibold transition',
                        s.status === 'RECONCILED'
                          ? 'bg-cyan-100 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-200 dark:hover:bg-cyan-500/20'
                          : 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/20'
                      )}
                      title={s.status === 'RECONCILED' ? 'Re-enviar fatura' : 'Importar fatura Cloudflare'}
                    >
                      {s.status === 'RECONCILED' ? '↻ Atualizar' : '📋 Reconciliar'}
                    </button>
                  </td>
                </tr>
              ))}
              {snapshots.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-sm text-slate-500">
                  Sem snapshots no período. Rode "snapshot diário" para gerar.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {reconcilingSnapshot && (
        <ReconcileSnapshotModal
          snapshot={reconcilingSnapshot}
          onClose={() => setReconcilingSnapshot(null)}
          onSaved={() => { setReconcilingSnapshot(null); reload() }}
        />
      )}
    </div>
  )
}

// ─── Modal de reconciliação manual da fatura Cloudflare (B2) ────────────────
function ReconcileSnapshotModal({ snapshot, onClose, onSaved }: { snapshot: any; onClose: () => void; onSaved: () => void }) {
  const measuredUsd = Number(snapshot.costTotalUsd ?? 0)
  const [invoiceStr, setInvoiceStr] = useState(
    snapshot.cloudflareInvoiceUsd != null ? String(snapshot.cloudflareInvoiceUsd) : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const invoiceUsd = Number(invoiceStr)
  const validNumber = isFinite(invoiceUsd) && invoiceUsd >= 0 && invoiceStr.trim() !== ''
  const driftPct = validNumber && measuredUsd > 0 ? ((invoiceUsd - measuredUsd) / measuredUsd) * 100 : null
  const driftClass =
    driftPct == null              ? 'text-slate-400' :
    Math.abs(driftPct) < 3        ? 'text-emerald-600 dark:text-emerald-300' :
    Math.abs(driftPct) < 7        ? 'text-amber-600 dark:text-amber-300' :
                                    'text-rose-600 dark:text-rose-300'

  async function save() {
    if (!validNumber) return
    setSaving(true); setError(null)
    try {
      await api.post(`/billing/snapshots/${snapshot.id}/reconcile`, { cloudflareInvoiceUsd: invoiceUsd })
      onSaved()
    } catch (e) {
      setError(formatApiError(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-950 border border-amber-500/30 rounded-xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">📋</div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Reconciliar com fatura Cloudflare</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{snapshot.integradorName} · {snapshot.periodYearMonth ?? ''}</p>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-white/5 rounded-lg p-3 space-y-1 text-[11px]">
          <div className="flex justify-between"><span className="text-slate-400">Nosso event consumer</span><span className="font-mono text-slate-900 dark:text-white">$ {measuredUsd.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Snapshot status</span><span className="text-slate-900 dark:text-white">{snapshot.status}</span></div>
          {snapshot.cloudflareInvoiceUsd != null && (
            <div className="flex justify-between"><span className="text-slate-400">Fatura registrada</span><span className="font-mono text-slate-900 dark:text-white">$ {Number(snapshot.cloudflareInvoiceUsd).toFixed(2)}</span></div>
          )}
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Total da fatura Cloudflare (USD)</label>
          <input
            type="number"
            step="0.01"
            value={invoiceStr}
            onChange={e => setInvoiceStr(e.target.value)}
            placeholder="ex: 292.57"
            className="mt-1 w-full bg-white dark:bg-white/5 border border-amber-500/30 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white font-mono font-bold focus:outline-none focus:border-amber-500/60"
            autoFocus
          />
        </div>

        {validNumber && driftPct != null && (
          <div className={cn('rounded-lg p-3 text-[11px] border',
            Math.abs(driftPct) < 3 ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500/30' :
            Math.abs(driftPct) < 7 ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-500/30' :
                                     'bg-rose-50 dark:bg-rose-500/10 border-rose-500/30'
          )}>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Drift calculado</span>
              <span className={cn('font-mono font-bold text-sm', driftClass)}>
                {driftPct > 0 ? '+' : ''}{driftPct.toFixed(2)}%
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              {Math.abs(driftPct) < 3 ? '✓ Drift dentro do aceitável (<3%)' :
               Math.abs(driftPct) < 7 ? '⚠ Drift em alerta (3-7%) — recomendado investigar' :
                                        '🚨 Drift crítico (>7%) — investigar consumo divergente'}
            </div>
          </div>
        )}

        {error && <div className="text-xs text-rose-500">{error}</div>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 px-3 py-2 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10">
            Cancelar
          </button>
          <button onClick={save} disabled={!validNumber || saving}
            className={cn(
              'flex-1 px-3 py-2 rounded-md text-xs font-bold transition flex items-center justify-center gap-2',
              validNumber && !saving
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-900'
                : 'bg-amber-500/30 text-amber-200 cursor-not-allowed'
            )}>
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            {snapshot.status === 'RECONCILED' ? 'Atualizar fatura' : 'Marcar como RECONCILIADO'}
          </button>
        </div>
        <p className="text-[10px] text-slate-500 text-center">
          Política: drift &gt;3% recomenda revisão · &gt;7% gera alerta P0 (futuramente automático)
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRADOR — visão própria
// ═══════════════════════════════════════════════════════════════════════════
function IntegradorView() {
  const [period, setPeriod] = useState(currentYearMonth())
  const [data, setData] = useState<any>(null)
  const [pendingRequests, setPendingRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [decidingId, setDecidingId] = useState<string | null>(null)

  function reload() {
    setLoading(true)
    Promise.all([
      api.get('/billing/integrador', { params: { period } }).then(r => r.data).catch(() => null),
      api.get('/retention/upgrade-requests').then(r => r.data?.items ?? []).catch(() => []),
    ]).then(([d, items]) => {
      setData(d)
      setPendingRequests(items.filter((it: any) => it.status === 'PENDING_INTEGRADOR'))
    }).finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [period])

  async function decide(id: string, decision: 'APPROVED' | 'DENIED') {
    setDecidingId(id)
    try {
      await api.post(`/retention/upgrade-requests/${id}/decide`, { decision })
      reload()
    } catch (err) {
      alert(formatApiError(err))
    } finally {
      setDecidingId(null)
    }
  }

  if (loading) return <div className="p-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>

  const snap = data?.snapshot
  const contract = data?.contract
  const clientes = data?.clientes ?? []

  // INT vê sua margem (preço CF cobrado - preço atacado IACloud)
  const youPay      = snap?.priceToIntegradorBrl ?? 0
  const sumPriceCF  = clientes.reduce((acc: number, c: any) => acc + (c.priceToClienteFinalBrl ?? 0), 0)
  const yourMargin  = sumPriceCF - youPay
  const yourMarginPct = sumPriceCF > 0 ? (yourMargin / sumPriceCF) * 100 : 0

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">💼 Meu negócio com IACloud</h1>
          <p className="text-xs text-slate-500">Sua margem · contrato · pedidos pendentes</p>
        </div>
        <input
          type="month" value={period}
          onChange={e => setPeriod(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border bg-white dark:bg-white/5 dark:border-white/10 dark:text-white"
        />
      </div>

      {/* Pedidos pendentes — em destaque */}
      {pendingRequests.length > 0 && (
        <GlassCard className="p-4 border-amber-300 dark:border-amber-500/40">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-slate-900 dark:text-white">
              {pendingRequests.length} pedido{pendingRequests.length > 1 ? 's' : ''} aguardando sua aprovação
            </h2>
          </div>
          <div className="space-y-2">
            {pendingRequests.map((r: any) => (
              <div key={r.id} className="p-3 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 text-xs">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {r.camera?.name ?? r.clienteFinal?.name ?? '—'}
                    </p>
                    <p className="text-slate-500 mt-0.5">
                      <span className="line-through">{r.fromPlano?.name ?? 'sem plano'}</span>
                      {' → '}
                      <span className="text-cyan-600 font-medium">{r.toPlano.name}</span>
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{r.decisionNote}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => decide(r.id, 'APPROVED')}
                      disabled={decidingId === r.id}
                      className="px-3 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Aprovar
                    </button>
                    <button
                      onClick={() => decide(r.id, 'DENIED')}
                      disabled={decidingId === r.id}
                      className="px-3 py-1.5 text-xs rounded-lg bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 flex items-center gap-1"
                    >
                      <XCircle className="w-3 h-3" /> Negar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Cards de margem do INT */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard label="Você paga IACloud" value={`R$ ${brl(youPay)}`} icon={DollarSign} accent="amber" />
        <KpiCard label="Clientes finais pagam você" value={`R$ ${brl(sumPriceCF)}`} icon={Building2} accent="emerald" />
        <KpiCard label={`Sua margem (${yourMarginPct.toFixed(0)}%)`} value={`R$ ${brl(yourMargin)}`} icon={TrendingUp} accent="cyan" />
      </div>

      {/* Contrato */}
      {contract && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Settings2 className="w-4 h-4 text-cyan-500" />
            <h2 className="font-semibold text-slate-900 dark:text-white">Seu contrato com IACloud</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Field label="Plano default" value={contract.defaultPlano?.name ?? '—'} />
            <Field label="Markup" value={`${contract.markupPct}%`} />
            <Field label="Auto-aprovar até" value={contract.autoApproveUpgradeLimitBrl != null ? `R$ ${brl(contract.autoApproveUpgradeLimitBrl)}/mês` : '—'} />
            <Field label="Resolução máx" value={contract.autoApproveResolutionMax ?? '—'} />
          </div>
        </GlassCard>
      )}

      {/* Lista de clientes */}
      <GlassCard className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-white/5 text-slate-500">
              <tr>
                <th className="text-left p-3">CLIENTE FINAL</th>
                <th className="text-right p-3">CONSUMO</th>
                <th className="text-right p-3">VOCÊ PAGA</th>
                <th className="text-right p-3">CLIENTE FINAL PAGA</th>
                <th className="text-right p-3">SUA MARGEM</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c: any) => (
                <tr key={c.clienteFinalId} className="border-t border-slate-200 dark:border-white/5">
                  <td className="p-3 font-medium text-slate-900 dark:text-white font-mono text-[10px]">{c.clienteFinalId.slice(0, 8)}…</td>
                  <td className="p-3 text-right text-slate-600 dark:text-slate-400">{c.avgStorageGb.toFixed(2)} GB</td>
                  <td className="p-3 text-right text-slate-700 dark:text-slate-300">R$ {brl(c.priceToIntegradorBrl)}</td>
                  <td className="p-3 text-right text-slate-900 dark:text-white">R$ {brl(c.priceToClienteFinalBrl)}</td>
                  <td className="p-3 text-right font-semibold text-emerald-600">R$ {brl(c.marginIntegradorBrl)}</td>
                </tr>
              ))}
              {clientes.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-sm text-slate-500">Sem dados de clientes finais neste período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function KpiCard({ label, value, icon: Icon, accent }: {
  label: string; value: string; icon: any; accent: 'emerald' | 'amber' | 'cyan' | 'rose'
}) {
  const accentColor = {
    emerald: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-500/20',
    amber:   'text-amber-600 bg-amber-100 dark:bg-amber-500/20',
    cyan:    'text-cyan-600 bg-cyan-100 dark:bg-cyan-500/20',
    rose:    'text-rose-600 bg-rose-100 dark:bg-rose-500/20',
  }[accent]
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
        <div className={cn('p-1.5 rounded-lg', accentColor)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-xl font-bold text-slate-900 dark:text-white mt-2">{value}</p>
    </GlassCard>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-sm text-slate-900 dark:text-white mt-0.5">{value}</p>
    </div>
  )
}
