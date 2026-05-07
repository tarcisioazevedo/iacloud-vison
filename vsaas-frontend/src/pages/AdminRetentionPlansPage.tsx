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
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Plus, Save, Loader2, Power, PowerOff, X,
  DollarSign, Calendar, Layers, Filter,
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

  const usdBrl = 5.30
  const margemPct = (price: number, cost: number) =>
    cost > 0 ? Math.round(((price - cost) / price) * 100) : null

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Catálogo de Planos de Retenção</h1>
          <p className="text-xs text-slate-500">
            {plans.filter(p => p.active).length} ativos · {plans.length} total
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white"
        >
          <Plus className="w-4 h-4" /> Novo plano
        </button>
      </div>

      {/* Filtros */}
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
        <span className="mx-2 text-slate-300 dark:text-white/20">|</span>
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
                  <th className="text-right p-3">USD/cam/mês</th>
                  <th className="text-right p-3">Custo R2 (USD)</th>
                  <th className="text-right p-3">Margem</th>
                  <th className="text-right p-3">~ R$ ao CF*</th>
                  <th className="text-center p-3">Status</th>
                  <th className="text-center p-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const price  = Number(getValue(p, 'pricePerCameraMonthUsd'))
                  const cost   = Number(p.costR2EstimatedUsd ?? 0)
                  const margem = margemPct(price, cost)
                  const finalBrl = (price * 1.30 * usdBrl).toFixed(2)
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
                      <td className="p-3 text-right">
                        <input
                          type="number"
                          step="0.0001"
                          value={String(getValue(p, 'pricePerCameraMonthUsd'))}
                          onChange={e => setEdit(p.id, 'pricePerCameraMonthUsd', Number(e.target.value))}
                          className={cn(
                            'w-24 px-2 py-1 text-right rounded border',
                            'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white',
                            isDirty(p.id) && 'border-amber-400',
                          )}
                        />
                      </td>
                      <td className="p-3 text-right text-slate-500 font-mono">
                        {p.costR2EstimatedUsd != null ? Number(p.costR2EstimatedUsd).toFixed(4) : '—'}
                      </td>
                      <td className="p-3 text-right">
                        {margem != null ? (
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] font-semibold',
                            margem >= 60 ? 'bg-emerald-100 text-emerald-700' :
                            margem >= 40 ? 'bg-amber-100 text-amber-700' :
                                           'bg-rose-100 text-rose-700',
                          )}>
                            {margem}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="p-3 text-right text-slate-600 dark:text-slate-400">
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
                                : 'bg-slate-100 text-slate-300 cursor-not-allowed',
                            )}
                            title="Salvar"
                          >
                            {saving === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          </button>
                          <button
                            onClick={() => toggleActive(p)}
                            disabled={saving === p.id}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10"
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

      <p className="text-[10px] text-slate-500 px-1">
        * Estimativa "ao CF" = preço atacado × 1.30 (markup INT default) × R$ {usdBrl.toFixed(2)} (USD/BRL).
        Markup real e câmbio configurados em IntegradorRetentionContract.
      </p>

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
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-lg font-semibold">Novo plano de retenção</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
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
            <Field label="Preço atacado USD/cam/mês" type="number" value={String(form.pricePerCameraMonthUsd)}
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

function Field({ label, value, onChange, type = 'text', placeholder, options }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: 'text' | 'number' | 'select'; placeholder?: string; options?: string[];
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {type === 'select' ? (
        <select
          value={value} onChange={e => onChange(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white"
        >
          {options?.map(o => <option key={o} value={o}>{o === 'UHD_4K' ? '4K' : o}</option>)}
        </select>
      ) : (
        <input
          type={type} value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white"
        />
      )}
    </label>
  )
}
