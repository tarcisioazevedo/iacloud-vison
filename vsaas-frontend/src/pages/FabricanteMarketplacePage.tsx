/**
 * FabricanteMarketplacePage — Painel global de marketplace para SUPER_ADMIN.
 *
 * 4 abas:
 *   Visão Geral    — KPIs globais + gráfico de receita por status
 *   Catálogo       — Grade de produtos com CRUD completo
 *   Integradores   — tabela por integrador (receita, clientes, subs, health)
 *   Timelapse Jobs — monitor global de jobs com filtros por status/integrador
 */
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp, Users, Package, AlertTriangle, PauseCircle,
  RefreshCw, Loader2, ChevronDown, ChevronUp, Activity,
  CheckCircle, XCircle, Clock, Film, ShoppingBag,
  Plus, Search, AlertCircle, X, Pencil, Trash2,
  DollarSign, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'

// ─── Types (Visão Geral / Integradores / Jobs) ────────────────────────────────
interface Totals {
  integradores: number; clientes: number; active: number
  grace: number; suspended: number; revenueBrl: string
}
interface TlJobs24h { pending: number; processing: number; done: number; failed: number }
interface IntegradorRow {
  integradorId: string; name: string
  totalClientes: number; activeSubscriptions: number; graceSubscriptions: number
  suspendedSubscriptions: number; canceledSubscriptions: number
  monthlyRevenueBrl: string; storageCount: number; timelapseCount: number; iaCount: number
  tlJobs24h: TlJobs24h
}

interface GlobalStats { totals: Totals; integradores: IntegradorRow[] }

interface TlJobItem {
  id: string; cameraId: string; integradorId: string | null; clienteFinalId: string
  type: string; status: string; attempts: number
  periodStart: string; periodEnd: string
  speedFactor: number; durationSec: number | null; fileSizeBytes: string | null
  generatedAt: string | null; expiresAt: string | null; errorMessage: string | null
  createdAt: string
  camera: { name: string }
}

// ─── Types (Catálogo) ─────────────────────────────────────────────────────────
type Category = 'STORAGE' | 'TIMELAPSE' | 'AI' | 'ADDON'
type PriceModel = 'PER_CAMERA_MONTH' | 'FLAT_MONTH' | 'USAGE'

interface Product {
  id: string
  slug: string
  name: string
  tagline?: string
  category: Category
  priceModel: PriceModel
  priceUsd: number
  sortOrder: number
  active: boolean
  comingSoon: boolean
  features: string[]
  metadata?: Record<string, unknown>
}

interface AdminStats {
  totalActive: number
  totalReceitaBrl: number
  totalProducts: number
  gracePeriodCount: number
}

interface FormState {
  slug: string
  name: string
  tagline: string
  category: Category
  priceModel: PriceModel
  priceUsd: string
  sortOrder: string
  active: boolean
  comingSoon: boolean
  features: string[]
  metadata: string
}

const BLANK_FORM: FormState = {
  slug: '',
  name: '',
  tagline: '',
  category: 'STORAGE',
  priceModel: 'PER_CAMERA_MONTH',
  priceUsd: '0',
  sortOrder: '0',
  active: true,
  comingSoon: false,
  features: [],
  metadata: '{}',
}

const CATEGORY_LABELS: Record<Category, string> = {
  STORAGE:   'Storage',
  TIMELAPSE: 'Timelapse',
  AI:        'IA',
  ADDON:     'Add-on',
}

const PRICE_MODEL_LABELS: Record<PriceModel, string> = {
  PER_CAMERA_MONTH: 'Por câmera/mês',
  FLAT_MONTH:       'Fixo/mês',
  USAGE:            'Por uso',
}

const CATEGORY_STYLES: Record<Category, string> = {
  STORAGE:   'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  TIMELAPSE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  AI:        'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  ADDON:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const BRL = (v: string | number) =>
  `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const JOB_STATUS_COLOR: Record<string, string> = {
  PENDING:    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  PROCESSING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  DONE:       'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  FAILED:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const JOB_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Aguardando', PROCESSING: 'Processando', DONE: 'Concluído', FAILED: 'Falha',
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'slate' }: {
  icon: React.FC<{ className?: string }>; label: string; value: string | number; sub?: string; color?: string
}) {
  const colors: Record<string, string> = {
    violet: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20',
    green:  'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
    amber:  'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
    red:    'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
    slate:  'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800',
    cyan:   'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20',
  }
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('p-2 rounded-lg', colors[color] ?? colors.slate)}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Product Modal ────────────────────────────────────────────────────────────
function ProductModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Product
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!initial
  const [form, setForm] = useState<FormState>(() =>
    initial
      ? {
          slug: initial.slug,
          name: initial.name,
          tagline: initial.tagline ?? '',
          category: initial.category,
          priceModel: initial.priceModel,
          priceUsd: String(initial.priceUsd),
          sortOrder: String(initial.sortOrder),
          active: initial.active,
          comingSoon: initial.comingSoon,
          features: [...initial.features],
          metadata: JSON.stringify(initial.metadata ?? {}, null, 2),
        }
      : { ...BLANK_FORM },
  )
  const [newFeature, setNewFeature] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(f => ({ ...f, [key]: val }))
  }

  function addFeature() {
    const f = newFeature.trim()
    if (!f) return
    setForm(prev => ({ ...prev, features: [...prev.features, f] }))
    setNewFeature('')
  }

  function removeFeature(i: number) {
    setForm(prev => ({ ...prev, features: prev.features.filter((_, idx) => idx !== i) }))
  }

  async function handleSubmit() {
    setError(null)

    let meta: Record<string, unknown> = {}
    try {
      meta = JSON.parse(form.metadata)
    } catch {
      setError('Metadata inválido: JSON malformado.')
      return
    }

    if (!form.slug.trim() || !form.name.trim()) {
      setError('Slug e nome são obrigatórios.')
      return
    }

    setLoading(true)
    try {
      const payload = {
        slug: form.slug.trim(),
        name: form.name.trim(),
        tagline: form.tagline.trim() || undefined,
        category: form.category,
        priceModel: form.priceModel,
        priceUsd: parseFloat(form.priceUsd) || 0,
        sortOrder: parseInt(form.sortOrder) || 0,
        active: form.active,
        comingSoon: form.comingSoon,
        features: form.features,
        metadata: meta,
      }
      if (isEdit) {
        await api.put(`/admin/marketplace/products/${initial!.id}`, payload)
      } else {
        await api.post('/admin/marketplace/products', payload)
      }
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Erro ao salvar produto.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="font-semibold text-slate-900 dark:text-white">
            {isEdit ? 'Editar produto' : 'Novo produto'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className={isEdit ? 'col-span-2' : ''}>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Slug {isEdit && <span className="text-slate-400">(somente leitura)</span>}
              </label>
              <input
                type="text"
                value={form.slug}
                readOnly={isEdit}
                onChange={e => set('slug', e.target.value)}
                className={cn(
                  'w-full rounded-lg border bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50',
                  isEdit
                    ? 'border-slate-100 dark:border-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                    : 'border-slate-200 dark:border-slate-700',
                )}
              />
            </div>
            {!isEdit && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Categoria
                </label>
                <select
                  value={form.category}
                  onChange={e => set('category', e.target.value as Category)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  {(Object.keys(CATEGORY_LABELS) as Category[]).map(c => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Nome</label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Tagline</label>
            <input
              type="text"
              value={form.tagline}
              onChange={e => set('tagline', e.target.value)}
              placeholder="Frase curta de apresentação"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Modelo de preço</label>
              <select
                value={form.priceModel}
                onChange={e => set('priceModel', e.target.value as PriceModel)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                {(Object.keys(PRICE_MODEL_LABELS) as PriceModel[]).map(m => (
                  <option key={m} value={m}>{PRICE_MODEL_LABELS[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Preço (USD)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.priceUsd}
                onChange={e => set('priceUsd', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Sort order</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={e => set('sortOrder', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            {([
              { key: 'active', label: 'Ativo' },
              { key: 'comingSoon', label: 'Em breve' },
            ] as { key: 'active' | 'comingSoon'; label: string }[]).map(t => (
              <label key={t.key} className="flex items-center gap-2 cursor-pointer">
                <div
                  onClick={() => set(t.key, !form[t.key])}
                  className={cn(
                    'relative w-9 h-5 rounded-full transition-colors shrink-0',
                    form[t.key] ? 'bg-cyan-600' : 'bg-slate-200 dark:bg-slate-700',
                  )}
                >
                  <div className={cn(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    form[t.key] ? 'translate-x-4' : 'translate-x-0.5',
                  )} />
                </div>
                <span className="text-sm text-slate-700 dark:text-slate-300">{t.label}</span>
              </label>
            ))}
          </div>

          {/* Features */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">Features</label>
            <div className="space-y-1.5 mb-2">
              {form.features.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 truncate">
                    {f}
                  </span>
                  <button
                    onClick={() => removeFeature(i)}
                    className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newFeature}
                onChange={e => setNewFeature(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature() } }}
                placeholder="Adicionar feature…"
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
              <button
                onClick={addFeature}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium transition"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Metadata */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Metadata (JSON)
            </label>
            <textarea
              value={form.metadata}
              onChange={e => set('metadata', e.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700 disabled:opacity-50 transition"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Salvar alterações' : 'Criar produto'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Delete Confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({
  product,
  onClose,
  onDeleted,
}: {
  product: Product
  onClose: () => void
  onDeleted: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setLoading(true)
    try {
      await api.delete(`/admin/marketplace/products/${product.id}`)
      onDeleted()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Erro ao remover produto.')
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6"
      >
        <h3 className="font-semibold text-slate-900 dark:text-white mb-2">Remover produto</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Tem certeza que deseja remover <strong>{product.name}</strong>? A operação é reversível (soft-delete).
        </p>
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Remover
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Tab: Visão Geral ─────────────────────────────────────────────────────────
function OverviewTab({
  stats,
  products,
  marketStats,
  onGoToCatalogo,
}: {
  stats: GlobalStats | null
  products: Product[]
  marketStats: AdminStats | null
  onGoToCatalogo: () => void
}) {
  if (!stats) return <div className="py-12 text-center text-slate-400">Carregando…</div>
  const { totals } = stats

  const healthPct = totals.active > 0
    ? Math.round(totals.active / (totals.active + totals.grace + totals.suspended) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard icon={TrendingUp}    label="Receita Ativa/mês"  value={BRL(totals.revenueBrl)}   color="violet" />
        <KpiCard icon={Package}       label="Assinaturas Ativas" value={totals.active}             color="green"  />
        <KpiCard icon={Users}         label="Clientes Finais"    value={totals.clientes}           color="cyan"   />
        <KpiCard icon={ShoppingBag}   label="Integradores"       value={totals.integradores}       color="slate"  />
        <KpiCard icon={AlertTriangle} label="Em Graça"           value={totals.grace}    sub="aguardando cancelamento" color="amber" />
        <KpiCard icon={PauseCircle}   label="Suspensos"          value={totals.suspended} sub="inadimplência"          color="red"   />
      </div>

      {/* Saúde + Produtos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Saúde da base */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-500" /> Saúde da Base
          </h3>
          <div className="flex items-end gap-4 mb-3">
            <span className="text-3xl font-bold text-slate-900 dark:text-white">{healthPct}%</span>
            <span className="text-sm text-slate-400 mb-1">assinaturas saudáveis</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${healthPct}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Ativas',     value: totals.active,    color: 'text-green-600 dark:text-green-400' },
              { label: 'Em Graça',   value: totals.grace,     color: 'text-amber-600 dark:text-amber-400' },
              { label: 'Suspensas',  value: totals.suspended, color: 'text-red-600 dark:text-red-400' },
            ].map(r => (
              <div key={r.label}>
                <p className={cn('text-lg font-bold', r.color)}>{r.value}</p>
                <p className="text-xs text-slate-400">{r.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Catálogo de produtos */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-violet-500" /> Catálogo Ativo
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {products.filter(p => p.active).slice(0, 10).map(p => (
              <div
                key={p.id}
                onClick={onGoToCatalogo}
                className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1 transition"
              >
                <div>
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-200">{p.name}</p>
                  <p className="text-xs text-slate-400">{CATEGORY_LABELS[p.category] ?? p.category}</p>
                </div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  $ {p.priceUsd.toFixed(2)}
                </p>
              </div>
            ))}
            {products.filter(p => p.active).length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">Nenhum produto ativo</p>
            )}
          </div>
        </div>
      </div>

      {/* Admin stats se disponível */}
      {marketStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Assinaturas ativas</p>
              <p className="text-xl font-bold text-slate-900 dark:text-white">{marketStats.totalActive}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400 shrink-0">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Receita total (BRL)</p>
              <p className="text-xl font-bold text-slate-900 dark:text-white">
                {BRL(marketStats.totalReceitaBrl)}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 shrink-0">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Produtos ativos</p>
              <p className="text-xl font-bold text-slate-900 dark:text-white">{marketStats.totalProducts}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-start gap-3">
            <div className={cn(
              'p-2 rounded-lg shrink-0',
              marketStats.gracePeriodCount > 0
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
            )}>
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Em período de graça</p>
              <p className="text-xl font-bold text-slate-900 dark:text-white">{marketStats.gracePeriodCount}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Catálogo ────────────────────────────────────────────────────────────
function CatalogoTab({
  products,
  onEdit,
  onDelete,
  onNew,
  onToggleActive,
}: {
  products: Product[]
  onEdit: (p: Product) => void
  onDelete: (p: Product) => void
  onNew: () => void
  onToggleActive: (id: string, active: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<Category | 'ALL'>('ALL')

  const categories: { key: Category | 'ALL'; label: string }[] = [
    { key: 'ALL',      label: 'Todos' },
    { key: 'STORAGE',  label: 'Storage' },
    { key: 'TIMELAPSE', label: 'Timelapse' },
    { key: 'AI',       label: 'IA' },
    { key: 'ADDON',    label: 'Add-on' },
  ]

  const filtered = products.filter(p => {
    const matchCat = catFilter === 'ALL' || p.category === catFilter
    const matchSearch = search.trim() === '' || p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <div className="space-y-4">
      {/* Barra de busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar produto por nome…"
          className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
        />
      </div>

      {/* Pills de categoria */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map(c => (
          <button
            key={c.key}
            onClick={() => setCatFilter(c.key)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition',
              catFilter === c.key
                ? 'bg-violet-600 text-white border-violet-600'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Grade de cards */}
      {filtered.length === 0 && products.length > 0 ? (
        <div className="py-12 text-center">
          <Package className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400">Nenhum produto para essa busca/filtro.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(p => (
            <div
              key={p.id}
              className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-3"
            >
              {/* Badge categoria */}
              <span className={cn(
                'absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold',
                CATEGORY_STYLES[p.category],
              )}>
                {CATEGORY_LABELS[p.category]}
              </span>

              {/* Badge Em breve */}
              {p.comingSoon && (
                <span className="absolute top-3 left-3 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  EM BREVE
                </span>
              )}

              {/* Nome e tagline */}
              <div className="mt-3 pr-20">
                <p className="text-base font-bold text-slate-900 dark:text-white leading-tight">{p.name}</p>
                {p.tagline && (
                  <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{p.tagline}</p>
                )}
              </div>

              {/* Preço */}
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-slate-900 dark:text-white">
                  $ {p.priceUsd.toFixed(2)}
                </span>
                <span className="text-xs text-slate-400">{PRICE_MODEL_LABELS[p.priceModel]}</span>
              </div>

              {/* Features (até 3) */}
              {p.features.length > 0 && (
                <ul className="space-y-1">
                  {p.features.slice(0, 3).map((f, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                      <span className="text-emerald-500 font-bold shrink-0 mt-px">✓</span>
                      <span className="line-clamp-1">{f}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Toggle + ações */}
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => onToggleActive(p.id, !p.active)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition"
                  title={p.active ? 'Desativar' : 'Ativar'}
                >
                  {p.active
                    ? <ToggleRight className="w-5 h-5 text-emerald-500" />
                    : <ToggleLeft className="w-5 h-5 text-slate-400" />
                  }
                  {p.active ? 'Ativo' : 'Inativo'}
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onEdit(p)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    title="Editar"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(p)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                    title="Remover"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Card "Novo produto" */}
          <button
            onClick={onNew}
            className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-transparent hover:border-violet-400 dark:hover:border-violet-600 hover:bg-violet-50/30 dark:hover:bg-violet-900/10 p-4 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition min-h-[160px]"
          >
            <div className="w-10 h-10 rounded-full border-2 border-current flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <span className="text-sm font-medium">Novo produto</span>
          </button>
        </div>
      )}

      {/* Estado vazio total */}
      {products.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-3">
          <Package className="w-12 h-12 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">Nenhum produto cadastrado.</p>
          <button
            onClick={onNew}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition"
          >
            <Plus className="w-4 h-4" /> Criar primeiro produto
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Integradores ────────────────────────────────────────────────────────
function IntegradoresTab({ stats }: { stats: GlobalStats | null }) {
  const [sortKey, setSortKey] = useState<'revenue' | 'clients' | 'active'>('revenue')
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!stats) return <div className="py-12 text-center text-slate-400">Carregando…</div>

  const sorted = [...stats.integradores].sort((a, b) => {
    if (sortKey === 'revenue') return Number(b.monthlyRevenueBrl) - Number(a.monthlyRevenueBrl)
    if (sortKey === 'clients') return b.totalClientes - a.totalClientes
    return b.activeSubscriptions - a.activeSubscriptions
  })

  return (
    <div className="space-y-3">
      {/* Sort pills */}
      <div className="flex gap-2 mb-2">
        {[
          { key: 'revenue' as const, label: 'Por Receita' },
          { key: 'clients' as const, label: 'Por Clientes' },
          { key: 'active'  as const, label: 'Por Assinaturas' },
        ].map(opt => (
          <button
            key={opt.key}
            onClick={() => setSortKey(opt.key)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition',
              sortKey === opt.key
                ? 'bg-violet-600 text-white border-violet-600'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800',
            )}
          >{opt.label}</button>
        ))}
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
              <th className="px-4 py-3 text-left font-medium">Integrador</th>
              <th className="px-4 py-3 text-right font-medium">Clientes</th>
              <th className="px-4 py-3 text-right font-medium">Ativas</th>
              <th className="px-4 py-3 text-right font-medium">Graça</th>
              <th className="px-4 py-3 text-right font-medium">Suspen.</th>
              <th className="px-4 py-3 text-right font-medium">Receita/mês</th>
              <th className="px-4 py-3 text-right font-medium">Produtos</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-xs">Nenhum integrador com assinaturas</td></tr>
            )}
            {sorted.map(row => (
              <>
                <tr
                  key={row.integradorId}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/30 cursor-pointer transition"
                  onClick={() => setExpanded(expanded === row.integradorId ? null : row.integradorId)}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-white">{row.name}</p>
                    <p className="text-xs text-slate-400">{row.integradorId.slice(0, 8)}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-300">{row.totalClientes}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold text-green-600 dark:text-green-400">{row.activeSubscriptions}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={row.graceSubscriptions > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400'}>
                      {row.graceSubscriptions}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={row.suspendedSubscriptions > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-400'}>
                      {row.suspendedSubscriptions}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-violet-700 dark:text-violet-400">
                    {BRL(row.monthlyRevenueBrl)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1 text-xs text-slate-500">
                      {row.storageCount > 0 && <span title="Storage">💾{row.storageCount}</span>}
                      {row.timelapseCount > 0 && <span title="Timelapse">🎬{row.timelapseCount}</span>}
                      {row.iaCount > 0 && <span title="IA">🤖{row.iaCount}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-400">
                    {expanded === row.integradorId ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </td>
                </tr>

                {/* Linha expandida — detalhes timelapse 24h */}
                {expanded === row.integradorId && (
                  <tr key={`${row.integradorId}-exp`}>
                    <td colSpan={8} className="px-4 py-3 bg-slate-50 dark:bg-slate-800/40">
                      <div className="flex flex-wrap gap-4 text-xs">
                        <div>
                          <p className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                            <Film className="w-3 h-3" /> Timelapse jobs (24h)
                          </p>
                          <div className="flex gap-3">
                            {[
                              { label: 'Aguardando',  v: row.tlJobs24h.pending,    cls: 'text-slate-500' },
                              { label: 'Processando', v: row.tlJobs24h.processing, cls: 'text-blue-600 dark:text-blue-400' },
                              { label: 'Concluídos',  v: row.tlJobs24h.done,       cls: 'text-green-600 dark:text-green-400' },
                              { label: 'Falhas',      v: row.tlJobs24h.failed,     cls: row.tlJobs24h.failed > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-400' },
                            ].map(s => (
                              <div key={s.label} className="text-center">
                                <p className={cn('text-lg font-bold', s.cls)}>{s.v}</p>
                                <p className="text-slate-400">{s.label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="border-l border-slate-200 dark:border-slate-700 pl-4">
                          <p className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Cancelados acumulados</p>
                          <p className="text-lg font-bold text-slate-500">{row.canceledSubscriptions}</p>
                          <p className="text-slate-400">assinaturas canceladas</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Tab: Timelapse Jobs ──────────────────────────────────────────────────────
function TimelapseJobsTab() {
  const [jobs, setJobs] = useState<TlJobItem[]>([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (statusFilter) params.set('status', statusFilter)
      const r = await api.get<{ jobs: TlJobItem[]; total: number }>(
        `/admin/marketplace/timelapse-jobs?${params}`,
      )
      setJobs(r.data.jobs ?? [])
      setTotal(r.data.total ?? 0)
    } catch {
      // silencioso — UI mostra vazio
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const statuses = ['', 'PENDING', 'PROCESSING', 'DONE', 'FAILED']

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5">
          {statuses.map(s => (
            <button
              key={s || 'all'}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition',
                statusFilter === s
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800',
              )}
            >{s || 'Todos'}</button>
          ))}
        </div>
        <button
          onClick={load}
          className="ml-auto p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
        <span className="text-xs text-slate-400">{total} jobs</span>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : jobs.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">Nenhum job encontrado</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 text-left font-medium">Câmera</th>
                <th className="px-4 py-3 text-left font-medium">Tipo</th>
                <th className="px-4 py-3 text-left font-medium">Período</th>
                <th className="px-4 py-3 text-center font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Duração</th>
                <th className="px-4 py-3 text-right font-medium">Tamanho</th>
                <th className="px-4 py-3 text-right font-medium">Gerado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {jobs.map(job => (
                <tr key={job.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800 dark:text-slate-200">{job.camera.name}</p>
                    {job.errorMessage && (
                      <p className="text-red-500 dark:text-red-400 mt-0.5 truncate max-w-[180px]" title={job.errorMessage}>
                        {job.errorMessage}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{job.type}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {new Date(job.periodStart).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', JOB_STATUS_COLOR[job.status] ?? '')}>
                      {job.status === 'DONE'       && <CheckCircle className="w-3 h-3" />}
                      {job.status === 'FAILED'     && <XCircle className="w-3 h-3" />}
                      {job.status === 'PROCESSING' && <Loader2 className="w-3 h-3 animate-spin" />}
                      {job.status === 'PENDING'    && <Clock className="w-3 h-3" />}
                      {JOB_STATUS_LABEL[job.status] ?? job.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600 dark:text-slate-400">
                    {job.durationSec ? `${job.durationSec.toFixed(0)}s` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600 dark:text-slate-400">
                    {job.fileSizeBytes
                      ? `${(Number(job.fileSizeBytes) / 1_048_576).toFixed(1)} MB`
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{fmt(job.generatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function FabricanteMarketplacePage({ defaultTab = 'overview' }: {
  defaultTab?: 'overview' | 'catalogo' | 'integradores' | 'jobs'
}) {
  const [tab, setTab] = useState<'overview' | 'catalogo' | 'integradores' | 'jobs'>(defaultTab)
  const [stats, setStats]           = useState<GlobalStats | null>(null)
  const [products, setProducts]     = useState<Product[]>([])
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // Modal / delete state
  const [showModal, setShowModal]       = useState(false)
  const [modalProduct, setModalProduct] = useState<Product | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsR, productsR, adminR] = await Promise.all([
        api.get<GlobalStats>('/admin/marketplace/integradores'),
        api.get<{ products: Product[] }>('/admin/marketplace/products'),
        api.get<AdminStats>('/admin/marketplace/stats').catch(() => ({
          data: { totalActive: 0, totalReceitaBrl: 0, totalProducts: 0, gracePeriodCount: 0 },
        })),
      ])
      setStats(statsR.data)
      setProducts(productsR.data.products ?? [])
      setAdminStats(adminR.data)
      setLastRefresh(new Date())
    } catch {
      setError('Não foi possível carregar os dados da plataforma.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() {
    setModalProduct(null)
    setShowModal(true)
  }

  function openEdit(p: Product) {
    setModalProduct(p)
    setShowModal(true)
  }

  async function handleSaved() {
    setShowModal(false)
    await load()
  }

  async function handleDeleted() {
    setDeleteTarget(null)
    await load()
  }

  async function handleToggleActive(id: string, active: boolean) {
    try {
      await api.put(`/admin/marketplace/products/${id}`, { active })
      await load()
    } catch {
      // silencioso — o load() vai manter o estado anterior
    }
  }

  const tabs = [
    { key: 'overview'     as const, label: 'Visão Geral',    icon: TrendingUp },
    { key: 'catalogo'     as const, label: 'Catálogo',        icon: Package },
    { key: 'integradores' as const, label: 'Integradores',   icon: Users },
    { key: 'jobs'         as const, label: 'Timelapse Jobs',  icon: Film },
  ]

  return (
    <div className="space-y-5 p-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-violet-600" />
            Marketplace — Visão Fabricante
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Atualizado em {lastRefresh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Produto
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition -mb-px',
              tab === t.key
                ? 'border-violet-600 text-violet-700 dark:text-violet-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      {loading && tab !== 'jobs' && tab !== 'catalogo' ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <OverviewTab
              stats={stats}
              products={products}
              marketStats={adminStats}
              onGoToCatalogo={() => setTab('catalogo')}
            />
          )}
          {tab === 'catalogo' && (
            <CatalogoTab
              products={products}
              onEdit={openEdit}
              onDelete={p => setDeleteTarget(p)}
              onNew={openNew}
              onToggleActive={handleToggleActive}
            />
          )}
          {tab === 'integradores' && <IntegradoresTab stats={stats} />}
          {tab === 'jobs'         && <TimelapseJobsTab />}
        </>
      )}

      {/* Modal criar/editar */}
      <AnimatePresence>
        {showModal && (
          <ProductModal
            initial={modalProduct ?? undefined}
            onClose={() => setShowModal(false)}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteConfirm
            product={deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onDeleted={handleDeleted}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
