import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Loader2, X, Check, AlertCircle, AlertTriangle,
  ChevronRight, RefreshCw, Settings2, Camera, DollarSign, Clock,
  ChevronDown, PauseCircle, PlayCircle,
  ShoppingBag, Package, ToggleLeft, ToggleRight, Pencil,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
interface IntegradorStats {
  receita: number
  camerasComStorage: number
  pendentes: number
  emGraca: number
}

interface PendingApproval {
  id: string
  clienteFinalName: string
  productFromName: string
  productToName: string
  deltaBrl: number
  cameraCount: number
  requestedAt: string
}

interface ClienteSubscription {
  id: string
  clienteFinalId: string
  clienteFinalName: string
  productName: string
  productCategory: string
  cameraCount: number
  monthlyPrice: number
  status: 'ACTIVE' | 'GRACE' | 'CANCELED' | 'SUSPENDED'
}

interface ContractConfig {
  markupPercent: number
  limiteBrl: number
  maxResolution: string
  maxDays: number
  exigirAprovacaoCancelamento: boolean
}

interface DrawerSub extends ClienteSubscription {
  cameraIds?: string[]
  startedAt?: string
}

interface CatalogItem {
  id: string
  slug: string
  category: 'STORAGE' | 'TIMELAPSE' | 'AI' | 'ADDON'
  name: string
  tagline: string | null
  description: string | null
  features: string[]
  pricingModel: string
  comingSoon: boolean
  basePriceUsd: number
  markupPct: number
  finalPriceBrl: number
  enabled: boolean
  enabledAt: string | null
  disabledAt: string | null
}

interface CatalogResponse {
  catalog: CatalogItem[]
  globalMarkup: number
  usdBrl: number
}

const CATEGORY_LABELS: Record<string, string> = {
  STORAGE:   'Storage',
  TIMELAPSE: 'Timelapse',
  AI:        'Inteligência Artificial',
  ADDON:     'Add-on',
}

const CATEGORY_STYLES: Record<string, string> = {
  STORAGE:   'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  TIMELAPSE: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  AI:        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  ADDON:     'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

// ─── Markup Edit Inline ───────────────────────────────────────────────────────
function MarkupInlineEdit({
  productId,
  currentMarkup,
  globalMarkup,
  onSaved,
}: {
  productId: string
  currentMarkup: number
  globalMarkup: number
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(currentMarkup))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const num = Number(value)
    if (isNaN(num) || num < 0 || num > 500) {
      setErr('Markup deve ser entre 0 e 500')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await api.patch(`/marketplace/integrador/products/${productId}/markup`, {
        markupPct: num,
      })
      setEditing(false)
      onSaved()
    } catch {
      setErr('Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function resetToGlobal() {
    setSaving(true)
    setErr(null)
    try {
      await api.patch(`/marketplace/integrador/products/${productId}/markup`, { markupPct: null })
      setEditing(false)
      onSaved()
    } catch {
      setErr('Falha ao redefinir')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setValue(String(currentMarkup)); setEditing(true) }}
        className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition"
        title="Editar markup deste produto"
      >
        <span>{currentMarkup}%</span>
        <Pencil className="w-3 h-3" />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input
        type="number"
        min={0}
        max={500}
        step={1}
        value={value}
        onChange={e => setValue(e.target.value)}
        className="w-16 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
      />
      <span className="text-xs text-slate-500">%</span>
      <button
        onClick={save}
        disabled={saving}
        className="px-2 py-0.5 rounded bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-700 disabled:opacity-50 transition"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'OK'}
      </button>
      <button
        onClick={() => { setEditing(false); setErr(null) }}
        disabled={saving}
        className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
      >
        Cancelar
      </button>
      <button
        onClick={resetToGlobal}
        disabled={saving}
        className="text-xs text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition"
        title={`Redefinir para markup global (${globalMarkup}%)`}
      >
        Usar global
      </button>
      {err && <span className="text-xs text-red-500">{err}</span>}
    </div>
  )
}

// ─── Catalog Tab ──────────────────────────────────────────────────────────────
function CatalogTab() {
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get<CatalogResponse>('/marketplace/catalog')
      setData(r.data)
    } catch {
      setError('Não foi possível carregar o catálogo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleProduct(item: CatalogItem) {
    setToggling(item.id)
    try {
      if (item.enabled) {
        await api.delete(`/marketplace/integrador/products/${item.id}/enable`)
      } else {
        await api.post(`/marketplace/integrador/products/${item.id}/enable`, {})
      }
      await load()
    } catch {
      // silencioso — o usuário verá que nada mudou
    } finally {
      setToggling(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
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

  const enabledCount = data.catalog.filter(p => p.enabled).length

  return (
    <div className="space-y-4">
      {/* Info bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <Package className="w-4 h-4 text-cyan-500" />
          <span>
            <strong className="text-slate-900 dark:text-white">{enabledCount}</strong> de{' '}
            <strong className="text-slate-900 dark:text-white">{data.catalog.length}</strong> produto{data.catalog.length !== 1 ? 's' : ''} habilitado{enabledCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>Markup global: <strong className="text-slate-700 dark:text-slate-300">{data.globalMarkup}%</strong></span>
          <span>USD/BRL: <strong className="text-slate-700 dark:text-slate-300">R$ {data.usdBrl.toFixed(2)}</strong></span>
          <button onClick={load} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition" title="Atualizar">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Product cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.catalog.map(item => (
          <div
            key={item.id}
            className={cn(
              'rounded-xl border bg-white dark:bg-slate-900 p-4 flex flex-col gap-3 transition-opacity',
              item.enabled
                ? 'border-cyan-200 dark:border-cyan-800'
                : 'border-slate-200 dark:border-slate-800 opacity-70',
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', CATEGORY_STYLES[item.category])}>
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </span>
                  {item.comingSoon && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Em breve
                    </span>
                  )}
                </div>
                <p className="font-semibold text-slate-900 dark:text-white text-sm leading-tight">{item.name}</p>
                {item.tagline && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.tagline}</p>
                )}
              </div>

              {/* Toggle */}
              <button
                onClick={() => toggleProduct(item)}
                disabled={toggling === item.id || item.comingSoon}
                className="shrink-0 text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 disabled:opacity-40 transition"
                title={item.enabled ? 'Desabilitar para revenda' : 'Habilitar para revenda'}
              >
                {toggling === item.id
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : item.enabled
                    ? <ToggleRight className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
                    : <ToggleLeft className="w-6 h-6" />
                }
              </button>
            </div>

            {/* Pricing */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Atacado</p>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  US$ {item.basePriceUsd.toFixed(2)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Markup</p>
                {item.enabled ? (
                  <MarkupInlineEdit
                    productId={item.id}
                    currentMarkup={item.markupPct}
                    globalMarkup={data.globalMarkup}
                    onSaved={load}
                  />
                ) : (
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{item.markupPct}%</p>
                )}
              </div>
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-2">
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mb-0.5">Revenda</p>
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  R$ {item.finalPriceBrl.toFixed(2).replace('.', ',')}
                </p>
              </div>
            </div>

            {/* Features */}
            {item.features.length > 0 && (
              <ul className="space-y-1">
                {item.features.slice(0, 3).map((f, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                    {f}
                  </li>
                ))}
                {item.features.length > 3 && (
                  <li className="text-xs text-slate-400 dark:text-slate-500">
                    +{item.features.length - 3} funcionalidade{item.features.length - 3 !== 1 ? 's' : ''}
                  </li>
                )}
              </ul>
            )}

            {/* Enabled date */}
            {item.enabled && item.enabledAt && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Habilitado em {new Date(item.enabledAt).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
        ))}
      </div>

      {data.catalog.length === 0 && (
        <p className="text-center text-sm text-slate-400 dark:text-slate-500 py-12">
          Nenhum produto disponível no catálogo.
        </p>
      )}
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE:    'Ativo',
  GRACE:     'Graça',
  CANCELED:  'Cancelado',
  SUSPENDED: 'Suspenso',
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  GRACE:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  CANCELED:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

// ─── Metric Card ──────────────────────────────────────────────────────────────
function MetricCard({
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
      <div className={cn('p-2.5 rounded-lg shrink-0', accent)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-white leading-tight">{value}</p>
      </div>
    </div>
  )
}

// ─── Approval Card ────────────────────────────────────────────────────────────
function ApprovalCard({
  item,
  onDecide,
}: {
  item: PendingApproval
  onDecide: (id: string, approve: boolean, note?: string) => Promise<void>
}) {
  const [denying, setDenying] = useState(false)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  async function decide(approve: boolean) {
    setLoading(true)
    await onDecide(item.id, approve, approve ? undefined : note)
    setLoading(false)
    setDenying(false)
  }

  return (
    <motion.div
      animate={{ borderColor: ['#f59e0b40', '#f59e0b80', '#f59e0b40'] }}
      transition={{ repeat: Infinity, duration: 2 }}
      className="rounded-xl border bg-white dark:bg-slate-900 p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">
            {item.clienteFinalName}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {item.productFromName} → {item.productToName}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn(
            'text-sm font-bold',
            item.deltaBrl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
          )}>
            {item.deltaBrl >= 0 ? '+' : ''}R$ {item.deltaBrl.toFixed(2).replace('.', ',')}/mês
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {item.cameraCount} câmera{item.cameraCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mb-3">
        Solicitado em {new Date(item.requestedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </p>

      <AnimatePresence>
        {denying && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3"
          >
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Motivo da negação (opcional)"
              rows={2}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2">
        {!denying ? (
          <>
            <button
              onClick={() => decide(true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Aprovar
            </button>
            <button
              onClick={() => setDenying(true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition"
            >
              <X className="w-3 h-3" />
              Negar
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => decide(false)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 transition"
            >
              {loading && <Loader2 className="w-3 h-3 animate-spin" />}
              Confirmar negação
            </button>
            <button
              onClick={() => setDenying(false)}
              disabled={loading}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
            >
              Cancelar
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ─── Cliente Drawer ───────────────────────────────────────────────────────────
function ClienteDrawer({
  sub,
  onClose,
  onStatusChange,
}: {
  sub: DrawerSub
  onClose: () => void
  onStatusChange?: () => void
}) {
  const [acting, setActing] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  async function handleSuspend() {
    if (!confirm('Suspender esta assinatura? O cliente final será notificado por e-mail.')) return
    setActing(true)
    setFeedback(null)
    try {
      await api.post(`/marketplace/subscriptions/${sub.id}/suspend`, { reason: 'Suspensão manual pelo integrador' })
      setFeedback({ ok: true, msg: 'Assinatura suspensa com sucesso.' })
      onStatusChange?.()
    } catch {
      setFeedback({ ok: false, msg: 'Falha ao suspender. Tente novamente.' })
    } finally {
      setActing(false)
    }
  }

  async function handleReactivate() {
    setActing(true)
    setFeedback(null)
    try {
      await api.post(`/marketplace/subscriptions/${sub.id}/reactivate-integrador`, {})
      setFeedback({ ok: true, msg: 'Assinatura reativada com sucesso.' })
      onStatusChange?.()
    } catch {
      setFeedback({ ok: false, msg: 'Falha ao reativar. Tente novamente.' })
    } finally {
      setActing(false)
    }
  }

  const canSuspend   = sub.status === 'ACTIVE' || sub.status === 'GRACE'
  const canReactivate = sub.status === 'SUSPENDED'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">{sub.clienteFinalName}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub.productName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Câmeras', value: sub.cameraCount },
              { label: 'Valor/mês', value: `R$ ${sub.monthlyPrice.toFixed(2).replace('.', ',')}` },
              { label: 'Status', value: STATUS_LABELS[sub.status] ?? sub.status },
              { label: 'Categoria', value: sub.productCategory },
            ].map(row => (
              <div key={row.label} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{row.label}</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{row.value}</p>
              </div>
            ))}
          </div>

          {sub.startedAt && (
            <p className="text-xs text-slate-400">
              Ativo desde {new Date(sub.startedAt).toLocaleDateString('pt-BR')}
            </p>
          )}

          {sub.status === 'SUSPENDED' && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <p className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                <PauseCircle className="w-3.5 h-3.5" />
                Assinatura suspensa
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                Câmeras não estão gravando. Reative após regularizar o pagamento.
              </p>
            </div>
          )}

          {feedback && (
            <div className={cn(
              'rounded-lg p-3 text-xs font-medium flex items-center gap-2',
              feedback.ok
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800',
            )}>
              {feedback.ok ? <Check className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
              {feedback.msg}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0 space-y-2">
          {canSuspend && (
            <button
              onClick={handleSuspend}
              disabled={acting}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition"
            >
              <span>Suspender assinatura</span>
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
            </button>
          )}
          {canReactivate && (
            <button
              onClick={handleReactivate}
              disabled={acting}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition"
            >
              <span>Reativar assinatura</span>
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            </button>
          )}
          <p className="text-xs text-slate-400 text-center">
            Suspender bloqueia gravação imediatamente. O cliente receberá e-mail de notificação.
          </p>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Config Section ───────────────────────────────────────────────────────────
function ConfigSection({ initial }: { initial: ContractConfig }) {
  const [cfg, setCfg] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await api.patch('/retention/contract', cfg)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-slate-400" />
        Configurações do Marketplace
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Markup padrão (%)
          </label>
          <input
            type="number"
            min={0}
            max={500}
            step={1}
            value={cfg.markupPercent}
            onChange={e => setCfg(c => ({ ...c, markupPercent: Number(e.target.value) }))}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Limite auto-aprovação (R$)
          </label>
          <input
            type="number"
            min={0}
            step={10}
            value={cfg.limiteBrl}
            onChange={e => setCfg(c => ({ ...c, limiteBrl: Number(e.target.value) }))}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Resolução máxima auto-aprovação
          </label>
          <select
            value={cfg.maxResolution}
            onChange={e => setCfg(c => ({ ...c, maxResolution: e.target.value }))}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          >
            {['SD', 'HD', 'FHD', '4K'].map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Dias máximos auto-aprovação
          </label>
          <input
            type="number"
            min={1}
            max={365}
            step={1}
            value={cfg.maxDays}
            onChange={e => setCfg(c => ({ ...c, maxDays: Number(e.target.value) }))}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer mb-5">
        <div
          onClick={() => setCfg(c => ({ ...c, exigirAprovacaoCancelamento: !c.exigirAprovacaoCancelamento }))}
          className={cn(
            'relative w-10 h-5 rounded-full transition-colors shrink-0',
            cfg.exigirAprovacaoCancelamento ? 'bg-cyan-600' : 'bg-slate-200 dark:bg-slate-700',
          )}
        >
          <div className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
            cfg.exigirAprovacaoCancelamento ? 'translate-x-5' : 'translate-x-0.5',
          )} />
        </div>
        <span className="text-sm text-slate-700 dark:text-slate-300">
          Exigir aprovação para cancelamentos
        </span>
      </label>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4 text-emerald-400" /> : null}
        {saved ? 'Salvo!' : 'Salvar configurações'}
      </button>
    </div>
  )
}

type Tab = 'gestao' | 'catalogo'

// ─── Main Page ────────────────────────────────────────────────────────────────
export function IntegradorMarketplacePage() {
  const [activeTab, setActiveTab] = useState<Tab>('gestao')
  const [stats, setStats] = useState<IntegradorStats | null>(null)
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [subscriptions, setSubscriptions] = useState<ClienteSubscription[]>([])
  const [config, setConfig] = useState<ContractConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drawerSub, setDrawerSub] = useState<DrawerSub | null>(null)
  const [approvalsExpanded, setApprovalsExpanded] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [subsR, approvalsR, configR] = await Promise.all([
        api.get<{ subscriptions: ClienteSubscription[] }>('/marketplace/subscriptions?allClientes=true'),
        api.get<{ items: PendingApproval[] }>('/marketplace/pending-approvals').catch(() => ({ data: { items: [] } })),
        api.get<ContractConfig>('/retention/contract').catch(() => ({
          data: { markupPercent: 30, limiteBrl: 500, maxResolution: 'FHD', maxDays: 30, exigirAprovacaoCancelamento: false },
        })),
      ])

      const subs = subsR.data.subscriptions ?? []
      setSubscriptions(subs)
      setApprovals(approvalsR.data.items ?? [])
      setConfig(configR.data)

      const receita = subs
        .filter(s => s.status === 'ACTIVE' || s.status === 'GRACE')
        .reduce((a, s) => a + s.monthlyPrice, 0)
      const camerasComStorage = subs
        .filter(s => s.productCategory === 'STORAGE' && s.status === 'ACTIVE')
        .reduce((a, s) => a + s.cameraCount, 0)
      const emGraca = subs.filter(s => s.status === 'GRACE').length

      setStats({
        receita,
        camerasComStorage,
        pendentes: approvalsR.data.items?.length ?? 0,
        emGraca,
      })
    } catch {
      setError('Não foi possível carregar os dados do marketplace.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDecide(requestId: string, approve: boolean, note?: string) {
    await api.post(`/marketplace/subscriptions/${requestId}/decide`, { approve, note })
    await load()
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-6 h-6 text-cyan-500" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Marketplace</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Catálogo, clientes e configurações</p>
          </div>
        </div>
        {activeTab === 'gestao' && (
          <button
            onClick={load}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {([
          { id: 'gestao',   label: 'Gestão de Clientes', icon: LayoutDashboard },
          { id: 'catalogo', label: 'Catálogo Fabricante', icon: ShoppingBag },
        ] as { id: Tab; label: string; icon: React.FC<{ className?: string }> }[]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Aba: Catálogo Fabricante */}
      {activeTab === 'catalogo' && <CatalogTab />}

      {/* Aba: Gestão de Clientes */}
      {activeTab === 'gestao' && <>

      {loading && (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Métricas */}
      {!loading && stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="Receita/mês"
            value={`R$ ${stats.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
            icon={DollarSign}
            accent="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
          />
          <MetricCard
            label="Câmeras com storage"
            value={stats.camerasComStorage}
            icon={Camera}
            accent="bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400"
          />
          <MetricCard
            label="Pendentes aprovação"
            value={stats.pendentes}
            icon={Clock}
            accent={stats.pendentes > 0
              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
              : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}
          />
          <MetricCard
            label="Em período de graça"
            value={stats.emGraca}
            icon={AlertTriangle}
            accent={stats.emGraca > 0
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
              : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}
          />
        </div>
      )}

      {/* Aprovações pendentes */}
      {approvals.length > 0 && (
        <div>
          <button
            onClick={() => setApprovalsExpanded(e => !e)}
            className="flex items-center gap-2 mb-3 w-full group"
          >
            <div className="flex items-center gap-2 flex-1">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h2 className="font-semibold text-slate-900 dark:text-white text-sm">
                Aprovações pendentes
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold">
                {approvals.length}
              </span>
            </div>
            <ChevronDown className={cn(
              'w-4 h-4 text-slate-400 transition-transform',
              approvalsExpanded ? 'rotate-180' : '',
            )} />
          </button>

          <AnimatePresence>
            {approvalsExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-3"
              >
                {approvals.map(a => (
                  <ApprovalCard key={a.id} item={a} onDecide={handleDecide} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Tabela de clientes */}
      <div>
        <h2 className="font-semibold text-slate-900 dark:text-white text-sm mb-3">
          Clientes e assinaturas
        </h2>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          {subscriptions.length === 0 ? (
            <p className="text-center text-sm text-slate-400 dark:text-slate-500 py-12">
              Nenhuma assinatura encontrada.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    {['Cliente Final', 'Produto', 'Câmeras', 'R$/mês', 'Status', ''].map(h => (
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
                  {subscriptions.map(sub => (
                    <tr
                      key={sub.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                        {sub.clienteFinalName}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {sub.productName}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {sub.cameraCount}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        R$ {sub.monthlyPrice.toFixed(2).replace('.', ',')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-[10px] font-bold',
                          STATUS_STYLES[sub.status] ?? '',
                        )}>
                          {STATUS_LABELS[sub.status] ?? sub.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDrawerSub(sub)}
                          className="flex items-center gap-1 text-xs text-cyan-600 dark:text-cyan-400 hover:underline font-medium"
                        >
                          Gerenciar
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Configurações */}
      {config && <ConfigSection initial={config} />}

      {/* Drawer */}
      <AnimatePresence>
        {drawerSub && (
          <ClienteDrawer sub={drawerSub} onClose={() => setDrawerSub(null)} onStatusChange={load} />
        )}
      </AnimatePresence>

      </>}
    </div>
  )
}
