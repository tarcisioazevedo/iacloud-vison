/**
 * AdminMarketplaceAnalyticsPage — Fase 4 do plano docs/29.
 *
 * Painel de analytics da rede pro SUPER_ADMIN / ADMIN_GLOBAL:
 *   - KPIs: MRR total, churn mensal, top produtos, integradores ativos
 *   - Tabela "Adoção por integrador" (quantos clientes, MRR por produto)
 *   - Gráfico de tendência últimos 6 meses (recharts)
 *
 * Backend: GET /admin/marketplace/analytics
 */
import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, DollarSign, Package, Users,
  RefreshCw, Loader2, AlertCircle, ShoppingBag, BarChart3,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts'
import { api } from '../api/client'
import { cn } from '../lib/utils'

interface AnalyticsResponse {
  mrrTotalBrl: string
  activeSubscriptions: number
  churnPctMensal: number
  canceledLast30d: number
  activeProductsCount: number
  totalProductsCount: number
  integradoresAtivos: number
  topProducts: Array<{
    productId: string; productName: string; slug: string | null
    category: string | null
    activeSubscriptions: number
    mrrBrl: number
  }>
  monthlyTrend: Array<{ month: string; newSubs: number; addedMrrBrl: number }>
  integradorAdoption: Array<{
    productId: string; productName: string; slug: string | null
    integradoresAtivos: number; integradoresTotal: number
    adoptionPct: number
  }>
}

const BRL = (v: string | number) =>
  `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const CATEGORY_STYLES: Record<string, string> = {
  STORAGE:   'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  TIMELAPSE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  AI:        'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  ADDON:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
}

function Kpi({
  icon: Icon, label, value, sub, accent = 'violet', trend,
}: {
  icon: React.FC<{ className?: string }>; label: string; value: string; sub?: string
  accent?: 'violet' | 'green' | 'cyan' | 'amber' | 'red'
  trend?: 'up' | 'down' | 'neutral'
}) {
  const colors: Record<string, string> = {
    violet: 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400',
    green:  'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    cyan:   'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400',
    amber:  'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    red:    'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  }
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('p-2 rounded-lg', colors[accent])}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        {trend && (
          <span className="ml-auto">
            {trend === 'up'   && <TrendingUp   className="w-3.5 h-3.5 text-green-500" />}
            {trend === 'down' && <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export function AdminMarketplaceAnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get<AnalyticsResponse>('/admin/marketplace/analytics')
      setData(r.data)
    } catch {
      setError('Não foi possível carregar os analytics do marketplace.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {error ?? 'Erro desconhecido'}
      </div>
    )
  }

  const churnTrend: 'up' | 'down' | 'neutral' =
    data.churnPctMensal > 5 ? 'up' : data.churnPctMensal > 0 ? 'neutral' : 'down'

  return (
    <div className="p-1 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-violet-600" />
            Marketplace — Analytics da Rede
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            MRR, churn, adoção por integrador e tendência de novas assinaturas
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          icon={DollarSign}
          label="MRR total (rede)"
          value={BRL(data.mrrTotalBrl)}
          accent="violet"
        />
        <Kpi
          icon={Package}
          label="Assinaturas ativas"
          value={String(data.activeSubscriptions)}
          accent="green"
        />
        <Kpi
          icon={TrendingDown}
          label="Churn mensal"
          value={`${data.churnPctMensal.toFixed(2)}%`}
          sub={`${data.canceledLast30d} cancelamentos em 30d`}
          accent={data.churnPctMensal > 5 ? 'red' : 'cyan'}
          trend={churnTrend}
        />
        <Kpi
          icon={ShoppingBag}
          label="Produtos ativos"
          value={`${data.activeProductsCount} / ${data.totalProductsCount}`}
          sub={`${data.integradoresAtivos} integrador${data.integradoresAtivos === 1 ? '' : 'es'} ativ${data.integradoresAtivos === 1 ? 'o' : 'os'}`}
          accent="amber"
        />
      </div>

      {/* Grid: Top produtos + Tendência */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top 3 produtos */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-violet-500" />
            Top 3 produtos por MRR
          </h3>
          {data.topProducts.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">Nenhuma assinatura ativa</p>
          ) : (
            <div className="space-y-3">
              {data.topProducts.slice(0, 3).map((p, i) => {
                const pct = data.topProducts[0]?.mrrBrl
                  ? (p.mrrBrl / data.topProducts[0].mrrBrl) * 100
                  : 0
                return (
                  <div key={p.productId}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <span className="text-slate-400 font-bold">{i + 1}.</span>
                        {p.productName}
                        {p.category && (
                          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold', CATEGORY_STYLES[p.category])}>
                            {p.category}
                          </span>
                        )}
                      </span>
                      <span className="font-semibold text-violet-600 dark:text-violet-400">{BRL(p.mrrBrl)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500 to-pink-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {p.activeSubscriptions} assinatura{p.activeSubscriptions === 1 ? '' : 's'} ativa{p.activeSubscriptions === 1 ? '' : 's'}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Gráfico de tendência */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            Tendência últimos 6 meses
          </h3>
          {data.monthlyTrend.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">Sem histórico</p>
          ) : (
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={data.monthlyTrend} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    stroke="#94a3b8"
                    tickFormatter={(v: string) => {
                      const [y, m] = v.split('-')
                      return `${m}/${y.slice(2)}`
                    }}
                  />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15,23,42,0.95)', border: 'none',
                      borderRadius: 8, fontSize: 11, color: '#fff',
                    }}
                    formatter={(value: number, name: string) =>
                      name === 'addedMrrBrl' ? [BRL(value), 'MRR adicionado'] : [value, 'Novas assinaturas']
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="addedMrrBrl"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#mrrGrad)"
                    name="addedMrrBrl"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Tabela: Adoção por produto */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-500" />
            Adoção por integrador (% que habilitou cada produto)
          </h3>
        </div>
        {data.integradorAdoption.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-12">Nenhum integrador ativou produtos</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Produto</th>
                  <th className="px-4 py-2 text-right font-medium">Integradores ativos</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-left font-medium">% Adoção</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.integradorAdoption.map(row => (
                  <tr key={row.productId} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                    <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                      {row.productName}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300 font-semibold">
                      {row.integradoresAtivos}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{row.integradoresTotal}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden max-w-[180px]">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-violet-500"
                            style={{ width: `${row.adoptionPct}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 w-12 text-right">
                          {row.adoptionPct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bar chart: top produtos */}
      {data.topProducts.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
            Comparativo MRR — Top {Math.min(10, data.topProducts.length)} produtos
          </h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart
                data={data.topProducts.slice(0, 10)}
                margin={{ top: 10, right: 5, left: 0, bottom: 50 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis
                  dataKey="productName"
                  tick={{ fontSize: 10 }}
                  stroke="#94a3b8"
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                  height={60}
                />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15,23,42,0.95)', border: 'none',
                    borderRadius: 8, fontSize: 11, color: '#fff',
                  }}
                  formatter={(v: number) => [BRL(v), 'MRR']}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="mrrBrl" fill="#8b5cf6" name="MRR/mês" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
