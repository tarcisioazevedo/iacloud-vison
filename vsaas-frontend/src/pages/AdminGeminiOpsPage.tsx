/**
 * AdminGeminiOpsPage — dashboard SUPER_ADMIN para governança Gemini.
 *
 * Endereça P0 #2: rastreabilidade total de chamadas Gemini + caps por integrador.
 *
 * 4 painéis:
 *   1. KPIs (calls, custo, latência, taxa de erro)
 *   2. Por feature (LPR, semantic-rule, captionFrame, etc)
 *   3. Por pagador (fabricante / integrador / cliente)
 *   4. Quota por integrador (utilization vs cap)
 */
import { useState } from 'react'
import useSWR from 'swr'
import {
  Sparkles, DollarSign, Activity, AlertCircle, TrendingUp,
  Building2, Loader2,
} from 'lucide-react'
import { api } from '../api/client'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface SummaryResponse {
  since: string
  byFeature:  Array<{ feature: string;  _count: number; _sum: { estimatedCost: number | null; tokensIn: number | null; tokensOut: number | null } }>
  byPaidBy:   Array<{ paidBy:  string;  _count: number; _sum: { estimatedCost: number | null } }>
  byOutcome:  Array<{ outcome: string;  _count: number }>
  totals:     { _count: number; _sum: { estimatedCost: number | null; tokensIn: number | null; tokensOut: number | null }; _avg: { latencyMs: number | null } }
}

interface QuotaItem {
  paidBy: string
  payerId: string
  payerName: string
  calls: number
  estimatedCost: number | null
  cap: number | null
  byokMode: string | null
  utilization: number | null
}

const WINDOWS = [
  { value: 60,    label: '1h' },
  { value: 360,   label: '6h' },
  { value: 1440,  label: '24h' },
  { value: 10080, label: '7d' },
]

export default function AdminGeminiOpsPage() {
  const [sinceMin, setSinceMin] = useState(1440)

  const { data: summary, isLoading: loadingSummary } = useSWR<SummaryResponse>(
    `/admin/gemini-callogs/summary?sinceMin=${sinceMin}`,
    fetcher,
    { refreshInterval: 30_000 },
  )
  const { data: quotaData } = useSWR<{ items: QuotaItem[] }>(
    '/admin/gemini-callogs/quota',
    fetcher,
    { refreshInterval: 30_000 },
  )

  const totalCalls   = summary?.totals._count ?? 0
  const totalCost    = Number(summary?.totals._sum.estimatedCost ?? 0)
  const avgLatency   = summary?.totals._avg.latencyMs ?? 0
  const errorCount   = summary?.byOutcome.find(o => o.outcome !== 'success')?._count ?? 0
  const errorRate    = totalCalls > 0 ? (errorCount / totalCalls) * 100 : 0

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30">
            <Sparkles className="w-7 h-7 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Governança Gemini IA</h1>
            <p className="text-sm text-slate-400">Custos, quota e anomalias por integrador (SUPER_ADMIN)</p>
          </div>
        </div>

        <div className="flex gap-1 p-1 bg-slate-800/60 rounded-xl">
          {WINDOWS.map(w => (
            <button
              key={w.value}
              onClick={() => setSinceMin(w.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                sinceMin === w.value ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:bg-slate-700'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>

      {loadingSummary && !summary && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI icon={Activity}     label="Chamadas"    value={totalCalls.toLocaleString('pt-BR')} tone="cyan" />
        <KPI icon={DollarSign}   label="Custo est."  value={`R$ ${(totalCost * 5).toFixed(2)}`} sub={`US$ ${totalCost.toFixed(4)}`} tone="emerald" />
        <KPI icon={TrendingUp}   label="Latência avg" value={`${Math.round(avgLatency)}ms`}    tone="violet" />
        <KPI icon={AlertCircle}  label="Taxa de erro" value={`${errorRate.toFixed(1)}%`} sub={`${errorCount} falhas`} tone={errorRate > 5 ? 'rose' : 'slate'} />
      </div>

      {/* Por feature */}
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur p-5">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyan-400" /> Por feature
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-700">
              <tr>
                <th className="text-left py-2">Feature</th>
                <th className="text-right">Chamadas</th>
                <th className="text-right">Tokens in</th>
                <th className="text-right">Tokens out</th>
                <th className="text-right">Custo (USD)</th>
                <th className="text-right">% do total</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.byFeature ?? []).slice().sort((a, b) => b._count - a._count).map(f => {
                const pct = totalCalls > 0 ? (f._count / totalCalls) * 100 : 0
                return (
                  <tr key={f.feature} className="border-b border-slate-800">
                    <td className="py-2 font-medium">{f.feature}</td>
                    <td className="text-right font-mono">{f._count.toLocaleString('pt-BR')}</td>
                    <td className="text-right font-mono text-slate-400">{(f._sum.tokensIn ?? 0).toLocaleString('pt-BR')}</td>
                    <td className="text-right font-mono text-slate-400">{(f._sum.tokensOut ?? 0).toLocaleString('pt-BR')}</td>
                    <td className="text-right font-mono text-emerald-300">${Number(f._sum.estimatedCost ?? 0).toFixed(4)}</td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-mono text-xs text-slate-400 w-10 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {(summary?.byFeature?.length ?? 0) === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-slate-500">Sem dados nesta janela</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Por pagador */}
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur p-5">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-400" /> Quem está pagando
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {['fabricante', 'integrador', 'cliente'].map(who => {
            const row = summary?.byPaidBy.find(p => p.paidBy === who)
            const count = row?._count ?? 0
            const cost  = Number(row?._sum.estimatedCost ?? 0)
            const pct = totalCalls > 0 ? (count / totalCalls) * 100 : 0
            return (
              <div key={who} className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{who}</div>
                <div className="text-2xl font-mono font-bold">{count.toLocaleString('pt-BR')}</div>
                <div className="text-xs text-slate-400 mt-1">
                  <span className="font-mono text-emerald-300">${cost.toFixed(4)}</span>
                  <span className="ml-2">· {pct.toFixed(0)}%</span>
                </div>
                <div className="mt-2 h-1.5 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      who === 'fabricante' ? 'bg-violet-500' :
                      who === 'integrador' ? 'bg-cyan-500'   :
                                             'bg-emerald-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Quota por integrador */}
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur p-5">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-amber-400" /> Quota por integrador · 24h
        </h2>
        <div className="space-y-2">
          {(quotaData?.items ?? []).map(q => {
            const util = q.utilization ?? 0
            const utilPct = util * 100
            const overCap = utilPct >= 90
            return (
              <div key={`${q.paidBy}-${q.payerId}`} className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{q.payerName}</span>
                    {q.byokMode && (
                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                        q.byokMode === 'self' ? 'bg-violet-500/20 text-violet-300' : 'bg-cyan-500/20 text-cyan-300'
                      }`}>
                        {q.byokMode === 'self' ? 'BYOK' : 'pool'}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">{q.paidBy}</span>
                  </div>
                  <div className="text-sm font-mono">
                    {q.calls.toLocaleString('pt-BR')}
                    {q.cap && <span className="text-slate-500"> / {q.cap.toLocaleString('pt-BR')}</span>}
                    {q.cap && (
                      <span className={`ml-2 ${overCap ? 'text-rose-400' : 'text-slate-400'}`}>
                        {utilPct.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
                {q.cap !== null && (
                  <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${overCap ? 'bg-rose-500' : utilPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(utilPct, 100)}%` }}
                    />
                  </div>
                )}
                {q.estimatedCost !== null && (
                  <div className="text-xs text-slate-500 mt-1">
                    Custo estimado: <span className="font-mono text-emerald-300">${Number(q.estimatedCost).toFixed(4)}</span>
                  </div>
                )}
              </div>
            )
          })}
          {(quotaData?.items?.length ?? 0) === 0 && (
            <div className="text-center py-6 text-slate-500">Nenhum integrador com chamadas nas últimas 24h</div>
          )}
        </div>
      </section>

      {/* Outcomes (erros) */}
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur p-5">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-rose-400" /> Outcomes
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(summary?.byOutcome ?? []).map(o => (
            <div key={o.outcome} className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60">
              <div className="text-xs uppercase tracking-wide text-slate-500">{o.outcome}</div>
              <div className={`text-xl font-mono font-bold ${
                o.outcome === 'success' ? 'text-emerald-300' :
                o.outcome === 'gating_blocked' ? 'text-amber-300' :
                'text-rose-300'
              }`}>
                {o._count.toLocaleString('pt-BR')}
              </div>
            </div>
          ))}
          {(summary?.byOutcome?.length ?? 0) === 0 && (
            <div className="col-span-full text-center py-6 text-slate-500">Sem dados</div>
          )}
        </div>
      </section>

      <footer className="text-center text-xs text-slate-500 pt-4">
        Janela: {sinceMin >= 1440 ? `${(sinceMin / 1440).toFixed(0)} dias` : `${(sinceMin / 60).toFixed(0)}h`} ·
        Auto-refresh 30s · Custo Gemini Flash 1.5: $0.075/1M in + $0.30/1M out
      </footer>
    </div>
  )
}

function KPI({ icon: Icon, label, value, sub, tone }: {
  icon: any; label: string; value: string; sub?: string; tone: 'cyan' | 'emerald' | 'violet' | 'rose' | 'slate'
}) {
  const toneClass = {
    cyan:    'border-cyan-500/30    bg-cyan-500/5    text-cyan-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    violet:  'border-violet-500/30  bg-violet-500/5  text-violet-300',
    rose:    'border-rose-500/30    bg-rose-500/5    text-rose-300',
    slate:   'border-slate-700      bg-slate-800/40  text-slate-300',
  }[tone]
  return (
    <div className={`p-4 rounded-xl border ${toneClass}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-2xl font-mono font-bold">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}
