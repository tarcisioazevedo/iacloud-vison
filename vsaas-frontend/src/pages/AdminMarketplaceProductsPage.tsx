import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package, Loader2, X, Check, AlertCircle, Plus,
  Pencil, Trash2, ShoppingBag, DollarSign, Activity,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: string | number
  icon: React.FC<{ className?: string }>
  accent: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-start gap-3">
      <div className={cn('p-2 rounded-lg shrink-0', accent)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-white leading-tight">{value}</p>
      </div>
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export function AdminMarketplaceProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalProduct, setModalProduct] = useState<Product | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [prodsR, statsR] = await Promise.all([
        api.get<{ products: Product[] }>('/admin/marketplace/products'),
        api.get<AdminStats>('/admin/marketplace/stats').catch(() => ({
          data: { totalActive: 0, totalReceitaBrl: 0, totalProducts: 0, gracePeriodCount: 0 },
        })),
      ])
      setProducts(prodsR.data.products ?? [])
      setStats(statsR.data)
    } catch {
      setError('Não foi possível carregar os produtos.')
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

  function closeModal() {
    setShowModal(false)
  }

  async function handleSaved() {
    closeModal()
    await load()
  }

  async function handleDeleted() {
    setDeleteTarget(null)
    await load()
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="w-6 h-6 text-violet-500" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Produtos do Marketplace</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Gerenciar catálogo de produtos</p>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition"
        >
          <Plus className="w-4 h-4" />
          Novo produto
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Assinaturas ativas"
            value={stats.totalActive}
            icon={Activity}
            accent="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
          />
          <StatCard
            label="Receita total (BRL)"
            value={`R$ ${stats.totalReceitaBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
            icon={DollarSign}
            accent="bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400"
          />
          <StatCard
            label="Produtos ativos"
            value={stats.totalProducts}
            icon={Package}
            accent="bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400"
          />
          <StatCard
            label="Em período de graça"
            value={stats.gracePeriodCount}
            icon={ShoppingBag}
            accent={stats.gracePeriodCount > 0
              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
              : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}
          />
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-7 h-7 animate-spin text-slate-400" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16">
            <Package className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum produto cadastrado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                <tr>
                  {['Slug', 'Nome', 'Categoria', 'Preço (USD)', 'Status', 'Ações'].map(h => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {products.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {p.slug}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                      {p.name}
                      {p.comingSoon && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                          EM BREVE
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-bold',
                        CATEGORY_STYLES[p.category] ?? '',
                      )}>
                        {CATEGORY_LABELS[p.category] ?? p.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      $ {p.priceUsd.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-bold',
                        p.active
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
                      )}>
                        {p.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                          title="Editar"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(p)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                          title="Remover"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <ProductModal
            initial={modalProduct ?? undefined}
            onClose={closeModal}
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
