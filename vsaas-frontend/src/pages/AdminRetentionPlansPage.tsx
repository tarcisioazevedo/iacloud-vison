/**
 * AdminRetentionPlansPage — gerência do catálogo de planos de retenção
 * (Sprint 2 do plano docs/STORAGE-ARCHITECTURE.md).
 *
 * Restrito a SUPER_ADMIN. Permite:
 *   - Ver todos os planos do catálogo (ativos e inativos)
 *   - Editar inline o preço por câmera/mês (USD)
 *   - Ativar/desativar planos sem deletar
 *   - Criar novo plano via modal
 *
 * O catálogo é exposto a todos os roles via GET /retention/plans (apenas
 * leitura). A modificação aqui afeta o que Integradores e Clientes vão ver.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Plus, Save, Loader2, Power, PowerOff, X,
  DollarSign, Filter, RefreshCw,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api, formatApiError } from '../api/client'
import { cn } from '../lib/utils'

const userRole = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const RESOLUTIONS = ['ANY', 'VGA', 'HD', 'FHD', 'UHD_4K'] as const

interface RetentionPlan {
  id: string
  slug: string
  name: string
  retainDays: number
  resolution: typeof RESOLUTIONS[number]
  pricePerCameraMonthUsd: string | number
  costR2EstimatedUsd?: string | number | null
  description?: string | null
  active: boolean
  sortOrder: number
}

export function AdminRetentionPlansPage() {
  const [plans, setPlans]       = useState<RetentionPlan[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE')
  const [resFilter, setRes]     = useState<'ALL' | typeof RESOLUTIONS[number]>('ALL')
  const [edits, setEdits]       = useState<Record<string, Partial<RetentionPlan>>>({})
  const [saving, setSaving]     = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Cotação dólar cartão ao vivo (câmbio comercial × 1.038 IOF)
  const [usdCartao, setUsdCartao]     = useState<number | null>(null)
  const [rateLoading, setRateLoading] = useState(false)
  const [rateError, setRateError]     = useState(false)

  function fetchRate() {
    setRateLoading(true)
    setRateError(false)
    fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL')
      .then(r => r.json())
      .then(d => {
        const bid = Number(d?.USDBRL?.bid)
        if (!isNaN(bid) && bid > 0) setUsdCartao(bid * 1.038)
        else setRateError(true)
      })
      .catch(() => setRateError(true))
      .finally(() => setRateLoading(false))
  }

  useEffect(() => { fetchRate() }, [])

  if (userRole !== 'SUPER_ADMIN' && userRole !== 'ADMIN_GLOBAL') {
    return (
      <div className="p-6 text-center text-rose-600">
        Acesso restrito ao Super Admin.
      </div>
    )
  }

  function reload() {
    setLoading(true)
    api.get('/retention/plans?includeInactive=true')
      .then(r => setPlans(r.data?.plans ?? []))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => plans.filter(p => {
    if (filter === 'ACTIVE'   && !p.active)  return false
    if (filter === 'INACTIVE' && p.active)   return false
    if (resFilter !== 'ALL' && p.resolution !== resFilter) return false
    return true
  }), [plans, filter, resFilter])

  function setEdit(planId: string, field: keyof RetentionPlan, value: any) {
    setEdits(e => ({ ...e, [planId]: { ...e[planId], [field]: value } }))
  }

  async function savePlan(plan: RetentionPlan) {
    const patch = edits[plan.id]
    if (!patch || Object.keys(patch).length === 0) return
    setSaving(plan.id)
    try {
      await api.put(`/retention/plans/${plan.id}`, patch)
      setEdits(e => { const ne = { ...e }; delete ne[plan.id]; return ne })
      reload()
    } catch (err) {
      alert(formatApiError(err))
    } finally {
      setSaving(null)
    }
  }

  async function toggleActive(plan: RetentionPlan) {
    setSaving(plan.id)
    try {
      if (plan.active) {
        await api.delete(`/retention/plans/${plan.id}`)
      } else {
        await api.put(`/retention/plans/${plan.id}`, { active: true } as any)
      }
      reload()
    } catch (err) {
      alert(formatApiError(err))
    } finally {
      setSaving(null)
    }
  }

  function getValue(plan: RetentionPlan, field: keyof RetentionPlan) {
    return edits[plan.id]?.[field] ?? plan[field]
  }
  function isDirty(planId: string) {
    return edits[planId] && Object.keys(edits[planId]).length > 0
  }

  const rate = usdCartao ?? 5.30  // fallback se a API ainda não respondeu
  const margemPct = (price: number, cost: number) =>
    cost > 0 ? Math.round(((price - cost) / price) * 100) : null

  // ── KPIs do catálogo (sobre planos ativos) ─────────────────────────────────
  const activePlans = plans.filter(p => p.active)
  const planMargins = activePlans.map(p => {
    const price = Number(p.pricePerCameraMonthUsd)
    const costUsd = Number(p.costR2EstimatedUsd ?? 0)
    const costBrl = costUsd > 0 ? costUsd * rate : 0
    return { plan: p, price, costBrl, margem: margemPct(price, costBrl) }
  })
  const validMargins = planMargins.filter(m => m.margem != null) as Array<{ plan: RetentionPlan; price: number; costBrl: number; margem: number }>
  // Margem média ponderada por preço (planos mais caros pesam mais)
  const weightedMargin = (() => {
    if (validMargins.length === 0) return null
    const sumPrice  = validMargins.reduce((s, m) => s + m.price, 0)
    const sumWeighted = validMargins.reduce((s, m) => s + m.margem * m.price, 0)
    return sumPrice > 0 ? Math.round(sumWeighted / sumPrice) : null
  })()
  const lowMarginCount  = validMargins.filter(m => m.margem < 50).length
  const dirtyCount      = Object.keys(edits).length

  // ── Bulk: reajustar todos os preços em N% (mantém margem mesmo com câmbio em alta) ──
  function bulkReprice(pct: number) {
    if (!confirm(`Aplicar +${pct}% em TODOS os planos ativos? Edição vira pendente — você confirma com "Salvar" em cada linha.`)) return
    setEdits(prev => {
      const next = { ...prev }
      for (const p of activePlans) {
        const cur = Number(p.pricePerCameraMonthUsd)
        const newPrice = Number((cur * (1 + pct / 100)).toFixed(2))
        next[p.id] = { ...next[p.id], pricePerCameraMonthUsd: newPrice }
      }
      return next
    })
  }

  async function saveAllDirty() {
    const ids = Object.keys(edits)
    if (ids.length === 0) return
    if (!confirm(`Salvar ${ids.length} mudança(s) de preço?`)) return
    for (const id of ids) {
      const plan = plans.find(p => p.id === id)
      if (plan) await savePlan(plan)
    }
  }

  function exportCSV() {
    const header = ['slug', 'name', 'resolution', 'retainDays', 'pricePerCameraMonthBrl', 'costR2EstimatedUsd', 'costR2EstimatedBrl', 'marginPct', 'active']
    const rows = plans.map(p => {
      const price = Number(p.pricePerCameraMonthUsd)
      const costUsd = Number(p.costR2EstimatedUsd ?? 0)
      const costBrl = costUsd > 0 ? costUsd * rate : 0
      const m = margemPct(price, costBrl)
      return [p.slug, p.name, p.resolution, p.retainDays, price, costUsd, costBrl.toFixed(4), m ?? '', p.active]
    })
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `catalogo-retencao-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Catálogo de Planos de Retenção</h1>
          <p className="text-xs text-slate-500">
            {plans.filter(p => p.active).length} ativos · {plans.length} total
          </p>
        </div>
        {/* Badge cotação dólar cartão ao vivo */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs">
          <DollarSign className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          {rateLoading ? (
            <span className="text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> buscando…</span>
          ) : rateError ? (
            <span className="text-rose-500 flex items-center gap-1 cursor-pointer" onClick={fetchRate}>
              <RefreshCw className="w-3 h-3" /> erro — retry
            </span>
          ) : usdCartao != null ? (
            <span className="text-slate-700 dark:text-slate-200">
              Dólar cartão: <span className="font-bold text-emerald-600 dark:text-emerald-400">R$ {usdCartao.toFixed(4)}</span>
              <span className="text-[10px] text-slate-400 ml-1">(comercial × 1.038 IOF)</span>
            </span>
          ) : null}
          <button onClick={fetchRate} className="ml-1 p-0.5 hover:text-cyan-500 text-slate-400" title="Atualizar cotação">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white"
        >
          <Plus className="w-4 h-4" /> Novo plano
        </button>
      </div>

      {/* KPIs do catálogo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard className="p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Planos ativos</p>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{activePlans.length}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">de {plans.length} cadastrados</p>
        </GlassCard>
        <GlassCard className={cn(
          'p-3',
          weightedMargin == null         ? '' :
          weightedMargin >= 60           ? 'dark:border-emerald-500/30' :
          weightedMargin >= 40           ? 'dark:border-amber-500/30' :
                                           'dark:border-rose-500/30'
        )}>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Margem ponderada</p>
          <p className={cn(
            'text-2xl font-black mt-1',
            weightedMargin == null ? 'text-slate-400' :
            weightedMargin >= 60   ? 'text-emerald-600 dark:text-emerald-300' :
            weightedMargin >= 40   ? 'text-amber-600 dark:text-amber-300' :
                                     'text-rose-600 dark:text-rose-300'
          )}>{weightedMargin != null ? `${weightedMargin}%` : '—'}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">peso = preço · USD/BRL R$ {rate.toFixed(2)}</p>
        </GlassCard>
        <GlassCard className={cn('p-3', lowMarginCount > 0 ? 'dark:border-rose-500/30 bg-gradient-to-br from-rose-500/5 to-transparent' : '')}>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Planos &lt; 50%</p>
          <p className={cn(
            'text-2xl font-black mt-1',
            lowMarginCount > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-slate-900 dark:text-white'
          )}>{lowMarginCount}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">margem abaixo da meta</p>
        </GlassCard>
        <GlassCard className={cn('p-3', dirtyCount > 0 ? 'dark:border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-transparent' : '')}>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Mudanças pendentes</p>
          <p className={cn(
            'text-2xl font-black mt-1',
            dirtyCount > 0 ? 'text-cyan-600 dark:text-cyan-300' : 'text-slate-900 dark:text-white'
          )}>{dirtyCount}</p>
          {dirtyCount > 0 ? (
            <button onClick={saveAllDirty} className="text-[10px] text-cyan-600 dark:text-cyan-400 hover:underline mt-0.5">
              Salvar todas →
            </button>
          ) : (
            <p className="text-[10px] text-slate-400 mt-0.5">edits inline aguardando Save</p>
          )}
        </GlassCard>
      </div>

      {/* Filtros + Bulk actions */}
      <GlassCard className="p-3 flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-slate-400" />
        {(['ACTIVE', 'INACTIVE', 'ALL'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1 text-xs rounded-md font-medium transition',
              filter === f
                ? 'bg-cyan-500 text-white'
                : 'bg-slate-100 dark:bg-white/5 text-slate-600 hover:bg-slate-200',
            )}
          >
            {f === 'ACTIVE' ? 'Ativos' : f === 'INACTIVE' ? 'Inativos' : 'Todos'}
          </button>
        ))}
        <span className="mx-2 text-slate-600 dark:text-slate-300 dark:text-white/20">|</span>
        {(['ALL', ...RESOLUTIONS] as const).map(r => (
          <button
            key={r}
            onClick={() => setRes(r)}
            className={cn(
              'px-3 py-1 text-xs rounded-md font-medium transition',
              resFilter === r
                ? 'bg-cyan-500 text-white'
                : 'bg-slate-100 dark:bg-white/5 text-slate-600 hover:bg-slate-200',
            )}
          >
            {r === 'UHD_4K' ? '4K' : r === 'ALL' ? 'Todas resoluções' : r}
          </button>
        ))}

        {/* Bulk actions */}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => bulkReprice(5)}
            className="px-2.5 py-1 text-[11px] rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold"
            title="Aplica +5% no preço de todos os planos ativos (pendente até Save)">
            ↑ +5% em massa
          </button>
          <button onClick={() => bulkReprice(10)}
            className="px-2.5 py-1 text-[11px] rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold"
            title="Aplica +10% no preço de todos os planos ativos (pendente até Save)">
            ↑↑ +10% em massa
          </button>
          <button onClick={exportCSV}
            className="px-2.5 py-1 text-[11px] rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 font-semibold">
            📤 CSV
          </button>
        </div>
      </GlassCard>

      {/* Tabela */}
      <GlassCard className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-white/5 text-slate-500">
                <tr>
                  <th className="text-left p-3">Plano</th>
                  <th className="text-left p-3">Resolução</th>
                  <th className="text-right p-3">Dias</th>
                  <th className="text-right p-3">Preço integrador (R$)</th>
                  <th className="text-right p-3">Custo R2 (USD)</th>
                  <th className="text-right p-3">Custo R2 (R$) ↗</th>
                  <th className="text-right p-3">Margem</th>
                  <th className="text-right p-3">~ R$ revenda INT*</th>
                  <th className="text-center p-3">Status</th>
                  <th className="text-center p-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const priceBrl = Number(getValue(p, 'pricePerCameraMonthUsd'))
                  const costUsd  = Number(p.costR2EstimatedUsd ?? 0)
                  const costBrl  = costUsd > 0 ? costUsd * rate : 0
                  const margem   = margemPct(priceBrl, costBrl)
                  const costBrlFmt  = costUsd > 0 ? costBrl.toFixed(4) : null
                  // ao CF = preço integrador (já em R$) × markup estimado do integrador
                  const finalBrl = (priceBrl * 1.30).toFixed(2)
                  return (
                    <tr key={p.id} className={cn(
                      'border-t border-slate-200 dark:border-white/5',
                      !p.active && 'opacity-50',
                    )}>
                      <td className="p-3">
                        <div className="font-medium text-slate-900 dark:text-white">{p.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{p.slug}</div>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 font-mono text-[10px]">
                          {p.resolution === 'UHD_4K' ? '4K' : p.resolution}
                        </span>
                      </td>
                      <td className="p-3 text-right font-medium">{p.retainDays}d</td>
                      {/* Preço integrador — fixo em R$, você absorve variação cambial */}
                      <td className="p-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <span className="text-slate-400 text-[10px]">R$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={String(getValue(p, 'pricePerCameraMonthUsd'))}
                            onChange={e => setEdit(p.id, 'pricePerCameraMonthUsd', Number(e.target.value))}
                            className={cn(
                              'w-20 px-2 py-1 text-right rounded border font-semibold',
                              'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white',
                              isDirty(p.id) && 'border-amber-400',
                            )}
                          />
                        </div>
                      </td>
                      {/* Custo R2 — o que você paga à Cloudflare em USD */}
                      <td className="p-3 text-right text-slate-500 font-mono">
                        {p.costR2EstimatedUsd != null ? `$ ${Number(p.costR2EstimatedUsd).toFixed(4)}` : '—'}
                      </td>
                      {/* Mesmo custo convertido ao dólar cartão ao vivo */}
                      <td className="p-3 text-right font-mono">
                        {costBrlFmt != null ? (
                          <span className={usdCartao ? 'text-rose-400 dark:text-rose-300' : 'text-slate-400 italic'}>
                            R$ {costBrlFmt}
                          </span>
                        ) : '—'}
                      </td>
                      {/* Margem = (preço R$ − custo R$) / preço R$ */}
                      <td className="p-3 text-right">
                        {margem != null ? (
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] font-semibold',
                            margem >= 70 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                            margem >= 50 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' :
                                           'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400',
                          )}>
                            {margem}%
                          </span>
                        ) : '—'}
                      </td>
                      {/* Estimativa preço cliente final = preço integrador × markup estimado 1.30 */}
                      <td className="p-3 text-right text-slate-600 dark:text-slate-400 font-medium">
                        R$ {finalBrl}
                      </td>
                      <td className="p-3 text-center">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium',
                          p.active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                            : 'bg-slate-200 text-slate-500',
                        )}>
                          {p.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => savePlan(p)}
                            disabled={!isDirty(p.id) || saving === p.id}
                            className={cn(
                              'p-1.5 rounded transition',
                              isDirty(p.id)
                                ? 'bg-cyan-500 text-white hover:bg-cyan-600'
                                : 'bg-slate-100 text-slate-600 dark:text-slate-300 cursor-not-allowed',
                            )}
                            title="Salvar"
                          >
                            {saving === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          </button>
                          <button
                            onClick={() => toggleActive(p)}
                            disabled={saving === p.id}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10"
                            title={p.active ? 'Desativar' : 'Ativar'}
                          >
                            {p.active ? <PowerOff className="w-3 h-3 text-rose-500" /> : <Power className="w-3 h-3 text-emerald-500" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <div className="text-[10px] text-slate-500 px-1 space-y-0.5">
        <p>
          <span className="font-semibold text-slate-400">Preço integrador (R$)</span> — valor fixo que você cobra do integrador.
          Você absorve a variação cambial; o integrador sempre paga o mesmo em reais.
        </p>
        <p>
          <span className="font-semibold text-slate-400">Custo R2 (R$) ↗</span> — custo Cloudflare convertido pelo dólar cartão ao vivo
          {usdCartao
            ? <span className="text-emerald-600 dark:text-emerald-400 font-medium"> (R$ {usdCartao.toFixed(4)} = comercial × 1.038 IOF)</span>
            : <span className="italic"> (fallback R$ 5.30)</span>
          }. Sobe e desce com o câmbio — o preço integrador não.
        </p>
        <p>
          <span className="font-semibold text-slate-400">Margem</span> — calculada em R$: (preço integrador − custo R2 em R$) ÷ preço integrador.
          {' '}* "Revenda INT" = preço integrador × 1.30 (markup padrão estimado que o integrador aplica na revenda).
          Markup real definido em IntegradorRetentionContract.
        </p>
      </div>

      {/* Simulador flutuante — só aparece quando há edits pendentes */}
      {dirtyCount > 0 && (() => {
        // Calcula impacto consolidado das edições pendentes
        const items = Object.keys(edits).map(id => {
          const plan = plans.find(p => p.id === id)!
          const oldPrice = Number(plan.pricePerCameraMonthUsd)
          const newPrice = Number(edits[id]?.pricePerCameraMonthUsd ?? oldPrice)
          const costUsd  = Number(plan.costR2EstimatedUsd ?? 0)
          const costBrl  = costUsd > 0 ? costUsd * rate : 0
          const oldMargin = margemPct(oldPrice, costBrl)
          const newMargin = margemPct(newPrice, costBrl)
          return { plan, oldPrice, newPrice, oldMargin, newMargin, delta: newPrice - oldPrice }
        })
        const totalDelta = items.reduce((s, i) => s + i.delta, 0)
        // Em planos com piora de margem
        const margemWorse = items.filter(i => i.oldMargin != null && i.newMargin != null && i.newMargin < i.oldMargin).length

        return (
          <div className="fixed bottom-4 right-4 z-40 w-96 max-w-[95vw]">
            <GlassCard className="p-3 border-cyan-500/40 shadow-2xl bg-white dark:bg-slate-950">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-md bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">🧮</div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-slate-900 dark:text-white">Simulador · impacto pendente</div>
                  <div className="text-[10px] text-slate-500">{dirtyCount} plano(s) editado(s) · ainda não salvo(s)</div>
                </div>
                <button onClick={() => setEdits({})} className="text-[10px] text-slate-400 hover:text-rose-300" title="Descartar">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="rounded bg-slate-50 dark:bg-white/5 p-2 mb-2 space-y-1 text-[11px]">
                {items.slice(0, 3).map(i => (
                  <div key={i.plan.id} className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300 truncate flex-1 mr-2">{i.plan.name}</span>
                    <span className="font-mono text-slate-400">R$ {i.oldPrice.toFixed(2)}</span>
                    <span className="text-slate-500 mx-1">→</span>
                    <span className="font-mono text-slate-900 dark:text-white font-bold">R$ {i.newPrice.toFixed(2)}</span>
                    {i.oldMargin != null && i.newMargin != null && (
                      <span className={cn(
                        'ml-2 text-[10px] font-bold px-1 rounded',
                        i.newMargin > i.oldMargin ? 'text-emerald-500' :
                        i.newMargin < i.oldMargin ? 'text-rose-500' : 'text-slate-500'
                      )}>
                        {i.newMargin > i.oldMargin ? '↑' : i.newMargin < i.oldMargin ? '↓' : '='} {i.newMargin}%
                      </span>
                    )}
                  </div>
                ))}
                {items.length > 3 && (
                  <div className="text-[10px] text-slate-500 italic text-center pt-1">+ {items.length - 3} outro(s)</div>
                )}
              </div>
              <div className="flex items-center justify-between mb-2 text-[11px]">
                <span className="text-slate-500">Δ preço médio:</span>
                <span className={cn(
                  'font-mono font-bold',
                  totalDelta > 0 ? 'text-emerald-500' : totalDelta < 0 ? 'text-rose-500' : 'text-slate-500'
                )}>
                  {totalDelta > 0 ? '+' : ''}R$ {(totalDelta / items.length).toFixed(2)} / plano
                </span>
              </div>
              {margemWorse > 0 && (
                <div className="text-[10px] text-rose-400 mb-2 flex items-center gap-1">
                  ⚠ {margemWorse} plano(s) piora{margemWorse > 1 ? 'm' : ''} margem após mudança
                </div>
              )}
              <div className="flex gap-1.5">
                <button onClick={saveAllDirty}
                  className="flex-1 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-white rounded text-xs font-bold">
                  Salvar {dirtyCount} mudança(s)
                </button>
                <button onClick={() => setEdits({})}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-500 rounded text-xs">
                  Descartar
                </button>
              </div>
              {/* Sensibilidade ao câmbio */}
              <div className="mt-3 pt-2 border-t border-white/5">
                <div className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mb-1">Margem ponderada @ câmbios</div>
                <div className="space-y-1 text-[11px]">
                  {[4.80, rate, 5.80, 6.50].map((r, i) => {
                    const m = activePlans.map(p => {
                      const price = Number(edits[p.id]?.pricePerCameraMonthUsd ?? p.pricePerCameraMonthUsd)
                      const cost = Number(p.costR2EstimatedUsd ?? 0) * r
                      return margemPct(price, cost)
                    }).filter((x): x is number => x != null)
                    const avg = m.length > 0 ? Math.round(m.reduce((s, n) => s + n, 0) / m.length) : null
                    const isCurrent = Math.abs(r - rate) < 0.001
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className={cn('font-mono w-12 text-[10px]', isCurrent ? 'text-cyan-500 dark:text-cyan-300 font-bold' : 'text-slate-500')}>
                          R$ {r.toFixed(2)}
                        </span>
                        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                          <div className={cn(
                            'h-full rounded-full',
                            avg == null     ? 'bg-slate-400'   :
                            avg >= 60       ? 'bg-emerald-500' :
                            avg >= 40       ? 'bg-amber-500'   :
                                              'bg-rose-500'
                          )} style={{ width: `${Math.max(0, Math.min(100, avg ?? 0))}%` }} />
                        </div>
                        <span className={cn(
                          'font-mono w-10 text-right text-[10px]',
                          avg == null     ? 'text-slate-500' :
                          avg >= 60       ? 'text-emerald-500 dark:text-emerald-300' :
                          avg >= 40       ? 'text-amber-500 dark:text-amber-300' :
                                            'text-rose-500 dark:text-rose-300'
                        )}>{avg != null ? `${avg}%` : '—'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </GlassCard>
          </div>
        )
      })()}

      {creating && (
        <CreatePlanModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload() }} />
      )}
    </div>
  )
}

// ─── Modal de criação de plano ──────────────────────────────────────────────
function CreatePlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    slug: '',
    name: '',
    retainDays: 30,
    resolution: 'HD' as typeof RESOLUTIONS[number],
    pricePerCameraMonthUsd: 5.0,
    costR2EstimatedUsd: 0,
    description: '',
    sortOrder: 100,
  })
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    try {
      await api.post('/retention/plans', form)
      onCreated()
    } catch (err) {
      alert(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 dark:border-white/10">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-lg font-semibold">Novo plano de retenção</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <Field label="Slug (identificador, lowercase, hifens)" value={form.slug}
                 onChange={v => setForm(f => ({ ...f, slug: v }))} placeholder="hd-30d-promo" />
          <Field label="Nome" value={form.name}
                 onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="HD · 30 dias (Promo)" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Resolução" type="select" value={form.resolution}
                   onChange={v => setForm(f => ({ ...f, resolution: v as any }))}
                   options={RESOLUTIONS as unknown as string[]} />
            <Field label="Dias de retenção" type="number" value={String(form.retainDays)}
                   onChange={v => setForm(f => ({ ...f, retainDays: Number(v) }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço integrador R$/cam/mês (fixo — você absorve câmbio)" type="number" value={String(form.pricePerCameraMonthUsd)}
                   onChange={v => setForm(f => ({ ...f, pricePerCameraMonthUsd: Number(v) }))} />
            <Field label="Custo R2 estimado USD (opcional)" type="number" value={String(form.costR2EstimatedUsd)}
                   onChange={v => setForm(f => ({ ...f, costR2EstimatedUsd: Number(v) }))} />
          </div>
          <Field label="Descrição (opcional)" value={form.description}
                 onChange={v => setForm(f => ({ ...f, description: v }))} />
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 dark:border-white/10">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!form.slug || !form.name || saving}
            className={cn(
              'px-4 py-2 text-sm rounded-lg font-medium',
              !form.slug || !form.name || saving
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-cyan-500 text-white hover:bg-cyan-600',
            )}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CustomSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
      >
        <span>{value === 'UHD_4K' ? '4K' : value}</span>
        <svg className={cn('w-4 h-4 text-slate-400 transition-transform', open && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 shadow-xl overflow-hidden">
          {options.map(o => (
            <li key={o}>
              <button
                type="button"
                onClick={() => { onChange(o); setOpen(false) }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm text-white hover:bg-slate-700 transition-colors',
                  o === value && 'bg-cyan-600 hover:bg-cyan-500',
                )}
              >
                {o === 'UHD_4K' ? '4K' : o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, options }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: 'text' | 'number' | 'select'; placeholder?: string; options?: string[];
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {type === 'select' ? (
        <CustomSelect value={value} onChange={onChange} options={options ?? []} />
      ) : (
        <input
          type={type} value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
        />
      )}
    </label>
  )
}
