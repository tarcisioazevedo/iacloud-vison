/**
 * MinhasAssinaturasPage — gestão detalhada das assinaturas do cliente final.
 *
 * Cards expandidos com:
 *  - status com cor semântica (ATIVA=verde, GRACE=amarelo, SUSPENDED=vermelho,
 *    PENDING/TRIAL=azul/cyan — fixa P1-07 do audit 35)
 *  - configuração legível (câmeras, retention, resolution quando aplicável)
 *  - sites cobertos (resolvido via /cameras lookup)
 *  - próxima cobrança / dias na graça
 *  - botões contextuais: Ajustar, Detalhes, Cancelar (cores semânticas)
 *
 * Plano: docs/29-PLAN-MARKETPLACE-UNIFICADO.md mockup 3 + Pacote D do audit 35.
 *
 * Botões com `disabled + title="em breve"` foram REMOVIDOS conforme P0-07 —
 * recursos não implementados não devem aparecer mentindo pro cliente.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingBag, Loader2, X, Check, AlertCircle, AlertTriangle,
  HardDrive, Timer, Cpu, RefreshCw, TrendingUp, TrendingDown,
  Settings2, MapPin, Plus, Calendar, BarChart3, Download, User as UserIcon,
} from 'lucide-react'
import { api, formatApiError, useCameras } from '../api/client'
import { cn } from '../lib/utils'
import { useUiToast } from '../components/Toast'
import { QuickPurchaseModal, type MarketplaceCatalogProduct } from '../components/marketplace/QuickPurchaseModal'

// ─── Types ───────────────────────────────────────────────────────────────────
type SubscriptionStatus = 'ACTIVE' | 'GRACE' | 'CANCELED' | 'SUSPENDED' | 'PENDING' | 'TRIAL'

interface Subscription {
  id: string
  productName: string
  productSlug: string
  productCategory: 'STORAGE' | 'TIMELAPSE' | 'AI' | 'ADDON'
  status: SubscriptionStatus
  cameraIds: string[]
  cameraCount: number
  monthlyPrice: number
  startedAt: string
  graceDaysRemaining?: number
  expiresAt?: string
}

interface CancelImpact {
  recordingGigabytes?: number
  cameraCount?: number
  gracePeriodDays?: number
  expiresAt?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE:    'ATIVA',
  GRACE:     'PERÍODO DE GRAÇA',
  CANCELED:  'CANCELADA',
  SUSPENDED: 'SUSPENSA',
  PENDING:   'PENDENTE',
  TRIAL:     'TRIAL',
}

const STATUS_STYLES: Record<SubscriptionStatus, string> = {
  ACTIVE:    'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
  GRACE:     'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
  CANCELED:  'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
  SUSPENDED: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
  PENDING:   'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
  TRIAL:     'bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-700',
}

const STATUS_BORDER: Record<SubscriptionStatus, string> = {
  ACTIVE:    'border-l-emerald-500',
  GRACE:     'border-l-amber-500',
  CANCELED:  'border-l-slate-400',
  SUSPENDED: 'border-l-red-500',
  PENDING:   'border-l-blue-500',
  TRIAL:     'border-l-cyan-500',
}

const PRODUCT_ICONS: Record<string, React.FC<{ className?: string }>> = {
  STORAGE:   HardDrive,
  TIMELAPSE: Timer,
  AI:        Cpu,
  ADDON:     ShoppingBag,
}

const PRODUCT_GRADIENT: Record<string, string> = {
  STORAGE:   'from-cyan-500 to-blue-500',
  TIMELAPSE: 'from-pink-500 to-orange-500',
  AI:        'from-violet-500 to-pink-500',
  ADDON:     'from-slate-500 to-slate-700',
}

const fetcher = (url: string) => api.get(url).then(r => r.data)

// ─── Upgrade Modal ────────────────────────────────────────────────────────────
interface StorageProduct {
  id: string
  slug: string
  name: string
  pricePerCameraMonth?: number
  priceUsd?: number
  retentionDays?: number
  features?: string[]
}

function UpgradeModal({
  subscription,
  onClose,
  onUpgraded,
}: {
  subscription: Subscription
  onClose: () => void
  onUpgraded: (decision: string) => void
}) {
  const [products, setProducts] = useState<StorageProduct[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [selected, setSelected] = useState<StorageProduct | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ products: StorageProduct[] }>('/marketplace/products')
      .then(r => setProducts((r.data.products ?? []).filter((p: any) =>
        // Filtra na categoria correspondente quando vier no payload
        !p.category || p.category === subscription.productCategory,
      )))
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false))
  }, [subscription.productCategory])

  async function handleConfirm() {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const r = await api.post(`/marketplace/subscriptions/${subscription.id}/upgrade`, {
        newProductId: selected.id,
      })
      onUpgraded(r.data?.decision ?? 'AUTO_APPROVED')
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setLoading(false)
    }
  }

  const currentPrice = subscription.monthlyPrice / Math.max(subscription.cameraCount, 1)

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
        className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              Alterar plano — {subscription.productName}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Plano atual: R$ {currentPrice.toFixed(2).replace('.', ',')}/câm/mês
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loadingProducts ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : products.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">
              Nenhum plano alternativo disponível nesta categoria.
            </p>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    {['Plano', 'Retenção', 'Preço/câm', 'Δ mensal', ''].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {products.map(p => {
                    const planPrice = p.pricePerCameraMonth ?? p.priceUsd ?? 0
                    const delta = (planPrice - currentPrice) * subscription.cameraCount
                    const isUp = planPrice > currentPrice
                    const isSame = Math.abs(delta) < 0.01
                    const isSelected = selected?.id === p.id

                    return (
                      <tr
                        key={p.id}
                        onClick={() => !isSame && setSelected(p)}
                        className={cn(
                          'transition-colors',
                          isSame
                            ? 'bg-slate-50/50 dark:bg-slate-800/30 cursor-default'
                            : isSelected
                              ? 'bg-cyan-50 dark:bg-cyan-900/10 cursor-pointer'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer',
                        )}
                      >
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                          {p.name}
                          {isSame && (
                            <span className="ml-2 text-[10px] font-bold text-slate-400 dark:text-slate-500">
                              ATUAL
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {p.retentionDays ? `${p.retentionDays}d` : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          R$ {planPrice.toFixed(2).replace('.', ',')}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {isSame ? (
                            <span className="text-slate-400 text-xs">—</span>
                          ) : (
                            <span className={cn(
                              'flex items-center gap-1 text-xs font-semibold',
                              isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                            )}>
                              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {delta >= 0 ? '+' : ''}R$ {delta.toFixed(2).replace('.', ',')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {!isSame && (
                            <div className={cn(
                              'w-4 h-4 rounded-full border-2 flex items-center justify-center transition',
                              isSelected
                                ? 'border-cyan-500 bg-cyan-500'
                                : 'border-slate-300 dark:border-slate-600',
                            )}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 shrink-0">
          <button onClick={onClose} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
            Cancelar
          </button>
          <button
            disabled={!selected || loading}
            onClick={handleConfirm}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700 disabled:opacity-50 transition"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Confirmar alteração
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Cancel Modal ─────────────────────────────────────────────────────────────
function CancelModal({
  subscription,
  onClose,
  onCanceled,
}: {
  subscription: Subscription
  onClose: () => void
  onCanceled: (expiresAt?: string) => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [impact, setImpact] = useState<CancelImpact | null>(null)
  const [loadingImpact, setLoadingImpact] = useState(true)
  const [cancelMode, setCancelMode] = useState<'soft' | 'immediate'>('soft')
  const [confirmText, setConfirmText] = useState('')
  const [checkA, setCheckA] = useState(false)
  const [checkB, setCheckB] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<CancelImpact>(`/marketplace/subscriptions/${subscription.id}/impact`)
      .then(r => setImpact(r.data))
      .catch(() => setImpact({}))
      .finally(() => setLoadingImpact(false))
  }, [subscription.id])

  async function handleCancel() {
    setLoading(true)
    setError(null)
    try {
      const r = await api.post(`/marketplace/subscriptions/${subscription.id}/cancel`, {
        downgradeBehavior: cancelMode,
        confirmedText: confirmText,
        reason: `Cancelamento solicitado pelo cliente. Modo: ${cancelMode}`,
      })
      onCanceled(r.data?.cancelGraceUntil ?? impact?.expiresAt)
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setLoading(false)
    }
  }

  // Esconde bloco de impactos vazios (fix P1-23): só renderiza se houver
  // pelo menos um campo populado. Card amber "Atenção" sumiria sozinho.
  const hasAnyImpact =
    (impact?.cameraCount && impact.cameraCount > 0) ||
    (impact?.recordingGigabytes && impact.recordingGigabytes > 0) ||
    (impact?.gracePeriodDays && impact.gracePeriodDays > 0)

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
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="font-semibold text-slate-900 dark:text-white">
            Cancelar assinatura
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <div>
              {loadingImpact ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : (
                <>
                  {hasAnyImpact && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 mb-4">
                      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <div className="text-sm text-amber-700 dark:text-amber-300">
                        <p className="font-semibold mb-1">Atenção — impacto do cancelamento</p>
                        <ul className="space-y-1 text-xs">
                          {!!impact?.cameraCount && (
                            <li>• {impact.cameraCount} câmera{impact.cameraCount !== 1 ? 's' : ''} perderão gravação em nuvem</li>
                          )}
                          {!!impact?.recordingGigabytes && (
                            <li>• {impact.recordingGigabytes} GB de gravações serão deletados</li>
                          )}
                          {!!impact?.gracePeriodDays && (
                            <li>• Período de graça de {impact.gracePeriodDays} dias após cancelamento</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  )}
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Deseja prosseguir com o cancelamento da assinatura{' '}
                    <strong>{subscription.productName}</strong>?
                  </p>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                  Tipo de cancelamento
                </p>
                {[
                  { value: 'soft', label: 'No fim do período', desc: 'Você continua usando até o final do ciclo de cobrança atual' },
                  { value: 'immediate', label: 'Imediato', desc: 'Gravações param agora e o período de graça começa imediatamente' },
                ].map(opt => (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition mb-2',
                      cancelMode === opt.value
                        ? 'border-red-400/50 bg-red-50 dark:bg-red-900/10'
                        : 'border-slate-200 dark:border-slate-700',
                    )}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      checked={cancelMode === opt.value as 'soft' | 'immediate'}
                      onChange={() => setCancelMode(opt.value as 'soft' | 'immediate')}
                    />
                    <div className={cn(
                      'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition',
                      cancelMode === opt.value ? 'border-red-500 bg-red-500' : 'border-slate-300 dark:border-slate-600',
                    )}>
                      {cancelMode === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{opt.label}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Digite <strong>CANCELAR</strong> para confirmar
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  placeholder="CANCELAR"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {[
                { key: 'A', checked: checkA, onChange: setCheckA, text: 'Entendo que após o período de graça todos os dados armazenados serão deletados permanentemente e não haverá como recuperá-los.' },
                { key: 'B', checked: checkB, onChange: setCheckB, text: 'Confirmo que desejo cancelar esta assinatura e estou ciente das consequências descritas acima.' },
              ].map(t => (
                <label
                  key={t.key}
                  className={cn(
                    'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition',
                    t.checked ? 'border-red-400/50 bg-red-50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700',
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={t.checked} onChange={e => t.onChange(e.target.checked)} />
                  <div className={cn(
                    'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition',
                    t.checked ? 'border-red-500 bg-red-500' : 'border-slate-300 dark:border-slate-600',
                  )}>
                    {t.checked && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{t.text}</p>
                </label>
              ))}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <button onClick={step > 1 ? () => setStep(s => (s - 1) as 1 | 2 | 3) : onClose} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
            {step > 1 ? 'Voltar' : 'Não cancelar'}
          </button>
          {step < 3 ? (
            <button
              disabled={step === 2 && confirmText !== 'CANCELAR'}
              onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)}
              className="px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition"
            >
              Continuar
            </button>
          ) : (
            <button
              disabled={!checkA || !checkB || loading}
              onClick={handleCancel}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Cancelar assinatura
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Subscription Card ─────────────────────────────────────────────────────────
function SubscriptionCard({
  sub,
  cameraIndex,
  onReactivate,
  onCancel,
  onUpgrade,
  onShowUsage,
}: {
  sub: Subscription
  /** Lookup id→{name, siteName} resolvido na página */
  cameraIndex: Record<string, { name: string; siteName?: string }>
  onReactivate: (id: string) => void
  onCancel: (sub: Subscription) => void
  onUpgrade: (sub: Subscription) => void
  onShowUsage: (sub: Subscription) => void
}) {
  const Icon = PRODUCT_ICONS[sub.productCategory] ?? ShoppingBag
  const gradient = PRODUCT_GRADIENT[sub.productCategory] ?? 'from-slate-500 to-slate-700'

  // Sites cobertos = distinct(camera.siteName) de cameraIds.
  const sitesCovered = useMemo(() => {
    const sites = new Map<string, number>()
    for (const camId of sub.cameraIds) {
      const cam = cameraIndex[camId]
      const siteName = cam?.siteName ?? 'Sem site'
      sites.set(siteName, (sites.get(siteName) ?? 0) + 1)
    }
    return Array.from(sites.entries())
  }, [sub.cameraIds, cameraIndex])

  const isActive = sub.status === 'ACTIVE'
  const isGrace = sub.status === 'GRACE'
  const isSuspended = sub.status === 'SUSPENDED'

  return (
    <div className={cn(
      'rounded-2xl border-l-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden',
      STATUS_BORDER[sub.status],
    )}>
      {/* Header */}
      <div className="px-5 py-4 flex items-start gap-3">
        <div className={cn(
          'w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0',
          gradient,
        )}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-900 dark:text-white">
                  {sub.productName}
                </h3>
                <span className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap',
                  STATUS_STYLES[sub.status],
                )}>
                  ● {STATUS_LABELS[sub.status]}
                </span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Desde {new Date(sub.startedAt).toLocaleDateString('pt-BR')}
                {isGrace && sub.expiresAt && (
                  <> · cancela em {new Date(sub.expiresAt).toLocaleDateString('pt-BR')}</>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className={cn(
                'text-lg font-bold',
                isGrace ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white',
              )}>
                R$ {sub.monthlyPrice.toFixed(2).replace('.', ',')}
                <span className="text-xs text-slate-400 font-normal">/mês</span>
              </div>
              {isGrace && (
                <div className="text-[10px] text-amber-600 dark:text-amber-400">não será cobrado</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Detalhes em grid */}
      <div className="px-5 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-slate-500 dark:text-slate-500 mb-1">Configuração</div>
          <div className="font-semibold text-slate-700 dark:text-slate-200">
            {sub.cameraCount} {sub.cameraCount === 1 ? 'câmera' : 'câmeras'}
          </div>
        </div>
        <div>
          <div className="text-slate-500 dark:text-slate-500 mb-1 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            Sites cobertos
          </div>
          <div className="font-semibold text-slate-700 dark:text-slate-200">
            {sitesCovered.length === 0
              ? '—'
              : sitesCovered.map(([name, count]) => `${name} (${count})`).join(', ')}
          </div>
        </div>
        <div>
          <div className="text-slate-500 dark:text-slate-500 mb-1 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {isGrace ? 'Restante' : 'Próxima cobrança'}
          </div>
          <div className="font-semibold text-slate-700 dark:text-slate-200">
            {isGrace && sub.graceDaysRemaining !== undefined
              ? `${sub.graceDaysRemaining} dias na graça`
              : sub.expiresAt
                ? new Date(sub.expiresAt).toLocaleDateString('pt-BR')
                : 'mensal'}
          </div>
        </div>
      </div>

      {/* Grace warning */}
      {isGrace && (
        <div className="mx-5 mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs">
          <div className="font-semibold text-amber-700 dark:text-amber-300 mb-0.5">
            ⚠ Período de graça LGPD
          </div>
          <div className="text-amber-700/80 dark:text-amber-300/80">
            Os dados desta assinatura serão excluídos permanentemente quando o período acabar.
            Reative a assinatura para mantê-los.
          </div>
        </div>
      )}

      {/* Suspended warning */}
      {isSuspended && (
        <div className="mx-5 mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs">
          <div className="font-semibold text-red-700 dark:text-red-300 mb-0.5">
            ⚠ Assinatura suspensa
          </div>
          <div className="text-red-700/80 dark:text-red-300/80">
            Entre em contato com seu integrador para regularizar.
          </div>
        </div>
      )}

      {/* Footer com ações contextuais */}
      {sub.status !== 'CANCELED' && (
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
          {(isActive || isGrace || isSuspended) && (
            <button
              onClick={() => onShowUsage(sub)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 transition"
            >
              <BarChart3 className="w-3 h-3" />
              Extrato de uso
            </button>
          )}
          {isActive && sub.productCategory === 'STORAGE' && (
            <button
              onClick={() => onUpgrade(sub)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition"
            >
              <Settings2 className="w-3 h-3" />
              Ajustar plano
            </button>
          )}
          {isGrace && (
            <button
              onClick={() => onReactivate(sub.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 transition"
            >
              <RefreshCw className="w-3 h-3" />
              Reativar assinatura
            </button>
          )}
          {isActive && (
            <button
              onClick={() => onCancel(sub)}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
            >
              ✕ Cancelar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Usage Drawer ─────────────────────────────────────────────────────────────
// Extrato de uso da assinatura — período · site · usuário · eventos detalhados.
// Funciona pra AI (eventos de SemanticRuleFire) e STORAGE (gravações por dia).

interface UsageResponse {
  category: 'AI' | 'STORAGE' | 'TIMELAPSE' | 'ADDON'
  period: { from: string; to: string }
  filters: {
    sites: Array<{ id: string; name: string }>
    users: Array<{ id: string; name: string; email: string }>
    applied: { siteId?: string | null; userId?: string | null }
  }
  kpis: Record<string, string | number>
  daily: Array<{ day: string; count?: number; bytes?: string; segments?: number }>
  events: Array<{
    id: string
    ruleId?: string
    cameraId?: string
    ts: string
    cameraName: string
    siteName: string
    rulePrompt?: string
    reason?: string
    severity?: string
    verdict?: string | null
    userName?: string
    userEmail?: string | null
    durationSec?: number
    sizeBytes?: string
  }>
  message?: string
}

type PresetRange = '7d' | '30d' | '90d' | 'custom'

type EventDetail = UsageResponse['events'][number]

function UsageDrawer({ sub, onClose }: { sub: Subscription; onClose: () => void }) {
  const toast = useUiToast()
  const [data, setData] = useState<UsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<PresetRange>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [siteId, setSiteId] = useState<string>('')
  const [userId, setUserId] = useState<string>('')
  // Lightbox flutuante: evento selecionado pra ver snapshot sem fechar o drawer.
  // ESLint detecta como unused (falso positivo — usado em JSX nas linhas ~1007 e ~1073).
  const selectedEventState = useState<EventDetail | null>(null)
  const selectedEvent = selectedEventState[0]
  const setSelectedEvent = selectedEventState[1]

  const range = useMemo(() => {
    const now = new Date()
    if (preset === 'custom' && customFrom && customTo) {
      return { from: new Date(customFrom).toISOString(), to: new Date(customTo).toISOString() }
    }
    const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    return { from: from.toISOString(), to: now.toISOString() }
  }, [preset, customFrom, customTo])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    const params = new URLSearchParams({ from: range.from, to: range.to })
    if (siteId) params.set('siteId', siteId)
    if (userId) params.set('userId', userId)
    api.get<UsageResponse>(`/marketplace/subscriptions/${sub.id}/usage?${params}`)
      .then(r => { if (!cancelled) setData(r.data) })
      .catch(e => { if (!cancelled) setError(formatApiError(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sub.id, range.from, range.to, siteId, userId])

  function downloadCsv() {
    if (!data || data.events.length === 0) { toast.error('Sem eventos para exportar'); return }
    const header = data.category === 'AI'
      ? ['data_hora_brt', 'site', 'camera', 'severidade', 'usuario', 'motivo']
      : ['data_hora_brt', 'site', 'camera', 'duracao_seg', 'tamanho_bytes']
    const rows = data.events.map(e => {
      const ts = new Date(e.ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      if (data.category === 'AI') {
        return [ts, e.siteName, e.cameraName, e.severity ?? '', e.userName ?? '', (e.reason ?? '').replace(/[\r\n,]/g, ' ')]
      }
      return [ts, e.siteName, e.cameraName, String(e.durationSec ?? 0), String(e.sizeBytes ?? 0)]
    })
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `extrato-${sub.productSlug}-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function fmtBytes(s: string | number) {
    const n = Number(s)
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
    return `${(n / 1024 ** 3).toFixed(2)} GB`
  }

  const maxDaily = useMemo(() => {
    if (!data) return 1
    const vals = data.daily.map(d =>
      data.category === 'STORAGE' ? Number(d.bytes ?? 0) : Number(d.count ?? 0)
    )
    return Math.max(1, ...vals)
  }, [data])

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 dark:bg-black/80 flex items-stretch justify-end"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.25 }}
        className="relative w-full max-w-3xl bg-white dark:bg-slate-950 shadow-2xl overflow-hidden flex flex-col border-l border-slate-200 dark:border-slate-800"
      >
        {/* Header (fixo) */}
        <div className="shrink-0 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-5 py-4 z-10">
          <div className="flex items-start justify-between mb-1">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Extrato de uso</div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{sub.productName}</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Filtros */}
          <div className="mt-3 flex flex-wrap gap-2 items-end">
            {/* Período */}
            <div>
              <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Período</label>
              <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800">
                {(['7d', '30d', '90d', 'custom'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-semibold rounded-md transition',
                      preset === p ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                    )}
                  >
                    {p === '7d' ? '7 dias' : p === '30d' ? '30 dias' : p === '90d' ? '90 dias' : 'Custom'}
                  </button>
                ))}
              </div>
            </div>

            {preset === 'custom' && (
              <>
                <div>
                  <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">De</label>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Até</label>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs" />
                </div>
              </>
            )}

            {/* Site */}
            {data?.filters.sites && data.filters.sites.length > 1 && (
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Site</label>
                <select value={siteId} onChange={e => setSiteId(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs">
                  <option value="">Todos os sites</option>
                  {data.filters.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            {/* Usuário */}
            {data?.filters.users && data.filters.users.length > 0 && (
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Usuário</label>
                <select value={userId} onChange={e => setUserId(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs">
                  <option value="">Todos os usuários</option>
                  {data.filters.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}

            {/* Export CSV */}
            <button onClick={downloadCsv}
              className="ml-auto flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
              <Download className="w-3 h-3" />
              CSV
            </button>
          </div>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {data && !loading && (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {data.category === 'AI' && (
                  <>
                    <Kpi label="Disparos" value={String(data.kpis.totalEvents ?? 0)} accent="cyan" />
                    <Kpi label="Chamadas IA" value={String(data.kpis.totalCalls ?? 0)} accent="violet" />
                    <Kpi label="Tokens (in/out)" value={`${data.kpis.tokensIn ?? 0}/${data.kpis.tokensOut ?? 0}`} accent="slate" />
                    <Kpi label="Custo IA" value={`R$ ${data.kpis.totalCostBrl ?? '0,00'}`} accent="emerald" />
                  </>
                )}
                {data.category === 'STORAGE' && (
                  <>
                    <Kpi label="Segmentos" value={String(data.kpis.totalSegs ?? 0)} accent="cyan" />
                    <Kpi label="Total gravado" value={fmtBytes(String(data.kpis.totalBytes ?? '0'))} accent="violet" />
                    <Kpi label="Horas" value={String(data.kpis.totalHours ?? '0')} accent="emerald" />
                    <Kpi label="Câmeras" value={String(sub.cameraIds.length)} accent="slate" />
                  </>
                )}
              </div>

              {/* Mini gráfico diário */}
              {data.daily.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">Por dia</div>
                  <div className="flex items-end gap-1 h-16">
                    {data.daily.map(d => {
                      const v = data.category === 'STORAGE' ? Number(d.bytes ?? 0) : Number(d.count ?? 0)
                      const h = Math.max(2, (v / maxDaily) * 100)
                      return (
                        <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.day}: ${data.category === 'STORAGE' ? fmtBytes(v) : v}`}>
                          <div className="w-full bg-cyan-500/60 rounded-t" style={{ height: `${h}%` }} />
                          <div className="text-[8px] text-slate-400">{d.day.slice(5)}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Lista de eventos */}
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">
                  Eventos ({data.events.length}{data.events.length === 500 ? ' · limitado' : ''})
                </div>
                {data.events.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-sm">
                    Nenhum evento no período selecionado.
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="max-h-[400px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-slate-500 text-[10px] uppercase">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Quando</th>
                            <th className="px-3 py-2 text-left font-semibold">Site</th>
                            <th className="px-3 py-2 text-left font-semibold">Câmera</th>
                            {data.category === 'AI' ? (
                              <>
                                <th className="px-3 py-2 text-left font-semibold">Usuário</th>
                                <th className="px-3 py-2 text-left font-semibold">Motivo</th>
                              </>
                            ) : (
                              <>
                                <th className="px-3 py-2 text-right font-semibold">Duração</th>
                                <th className="px-3 py-2 text-right font-semibold">Tamanho</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {data.events.map(e => {
                            const clickable = data.category === 'AI' && !!e.ruleId
                            return (
                            <tr
                              key={e.id}
                              onClick={clickable ? () => setSelectedEvent(e) : undefined}
                              className={cn(
                                'transition',
                                clickable
                                  ? 'cursor-pointer hover:bg-cyan-50 dark:hover:bg-cyan-900/10'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                              )}
                            >
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {new Date(e.ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{e.siteName}</span>
                              </td>
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{e.cameraName}</td>
                              {data.category === 'AI' ? (
                                <>
                                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                    {e.userName && e.userName !== '—' ? (
                                      <span className="inline-flex items-center gap-1" title={e.userEmail ?? ''}>
                                        <UserIcon className="w-3 h-3" />{e.userName}
                                      </span>
                                    ) : <span className="text-slate-400">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400 max-w-[260px] truncate" title={e.reason}>
                                    {e.severity && (
                                      <span className={cn('inline-block px-1 mr-1 rounded text-[9px] font-bold',
                                        e.severity === 'critical' ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300' :
                                        e.severity === 'warning'  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' :
                                                                    'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                                      )}>{e.severity}</span>
                                    )}
                                    {e.reason}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-right whitespace-nowrap">
                                    {Math.floor((e.durationSec ?? 0) / 60)}m {(e.durationSec ?? 0) % 60}s
                                  </td>
                                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-right whitespace-nowrap">
                                    {fmtBytes(e.sizeBytes ?? '0')}
                                  </td>
                                </>
                              )}
                            </tr>
                          )})}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {data.message && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 text-xs text-slate-500">
                  {data.message}
                </div>
              )}
            </>
          )}
        </div>

        {/* Lightbox flutuante dentro do drawer — preview do disparo sem sair do extrato */}
        <AnimatePresence>
          {selectedEvent && (
            <EventLightbox event={selectedEvent} onClose={() => setSelectedEvent(null)} />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

/**
 * Overlay flutuante dentro do drawer mostrando o snapshot + detalhes do disparo.
 * Fica posicionado absoluto dentro do drawer (não cobre a sidebar/page).
 */
function EventLightbox({ event, onClose }: { event: EventDetail; onClose: () => void }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [loadingImg, setLoadingImg] = useState(true)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    if (!event.ruleId) { setLoadingImg(false); setImgError(true); return }
    let cancelled = false
    let blobUrl: string | null = null
    setLoadingImg(true); setImgError(false)
    api.get(`/semantic-rules/${event.ruleId}/fires/${event.id}/snapshot`, { responseType: 'blob' })
      .then(r => {
        if (cancelled) return
        blobUrl = URL.createObjectURL(r.data as Blob)
        setImgUrl(blobUrl)
      })
      .catch(() => { if (!cancelled) setImgError(true) })
      .finally(() => { if (!cancelled) setLoadingImg(false) })
    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [event.id, event.ruleId])

  // ESC fecha
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ts = new Date(event.ts).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-20 bg-slate-950/85 flex items-center justify-center p-5"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {event.severity && (
                <span className={cn('inline-block px-1.5 py-0.5 rounded text-[9px] font-bold',
                  event.severity === 'critical' ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300' :
                  event.severity === 'warning'  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' :
                                                  'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                )}>{event.severity.toUpperCase()}</span>
              )}
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Disparo</span>
              {event.verdict === 'false_positive' && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-500/20 text-slate-600 dark:text-slate-400">FP</span>
              )}
              {event.verdict === 'correct' && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">✓ Correto</span>
              )}
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {event.rulePrompt || 'Alerta semântico'}
            </h3>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Snapshot */}
        <div className="bg-slate-100 dark:bg-slate-950 aspect-video flex items-center justify-center relative">
          {loadingImg && (
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
          )}
          {!loadingImg && imgError && (
            <div className="text-xs text-slate-500 text-center px-4">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-60" />
              Snapshot não disponível
            </div>
          )}
          {!loadingImg && !imgError && imgUrl && (
            <img
              src={imgUrl}
              alt={`Disparo ${event.id}`}
              className="w-full h-full object-contain"
            />
          )}
        </div>

        {/* Detalhes */}
        <div className="px-4 py-3 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <Detail icon={Calendar} label="Quando" value={ts} />
            <Detail icon={MapPin}   label="Site"   value={event.siteName} />
            <Detail icon={Cpu}      label="Câmera" value={event.cameraName} />
            <Detail icon={UserIcon} label="Criado por" value={event.userName ?? '—'} hint={event.userEmail ?? undefined} />
          </div>
          {event.reason && (
            <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Análise da IA</div>
              <div className="text-xs text-slate-700 dark:text-slate-300 italic leading-relaxed">"{event.reason}"</div>
            </div>
          )}
          {event.cameraId && (
            <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-800">
              <Link
                to={`/recordings?cameraId=${event.cameraId}&at=${encodeURIComponent(event.ts)}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/25 transition"
              >
                🎬 Ver gravação no momento do disparo →
              </Link>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function Detail({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[9px] uppercase font-bold text-slate-500 mb-0.5">{label}</div>
      <div className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200 font-medium">
        <Icon className="w-3 h-3 text-slate-400 shrink-0" />
        <span className="truncate">{value}</span>
      </div>
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: 'cyan' | 'violet' | 'emerald' | 'slate' }) {
  const colors = {
    cyan:    'text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800',
    violet:  'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800',
    emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
    slate:   'text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
  } as const
  return (
    <div className={cn('rounded-lg border p-2.5', colors[accent])}>
      <div className="text-[9px] uppercase font-bold opacity-70 mb-0.5">{label}</div>
      <div className="text-base font-bold leading-tight">{value}</div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function MinhasAssinaturasPage() {
  const toast = useUiToast()
  const [error, setError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null)
  const [upgradeTarget, setUpgradeTarget] = useState<Subscription | null>(null)
  const [usageTarget, setUsageTarget] = useState<Subscription | null>(null)
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)
  const [contractModalOpen, setContractModalOpen] = useState<MarketplaceCatalogProduct | null>(null)

  const { data: subsData, isLoading: loading, mutate: refreshSubs } = useSWR<{ subscriptions: Subscription[]; totalMonthlyBrl: number }>(
    '/marketplace/subscriptions',
    fetcher,
    { revalidateOnFocus: false },
  )
  const subscriptions = subsData?.subscriptions ?? []

  // Lookup pra resolver site das câmeras de cada assinatura (P0-08 do plano)
  const { data: camerasData } = useCameras()
  const cameraIndex = useMemo<Record<string, { name: string; siteName?: string }>>(() => {
    const idx: Record<string, { name: string; siteName?: string }> = {}
    for (const c of (camerasData?.cameras ?? []) as any[]) {
      idx[c.id] = { name: c.name, siteName: c.site?.name ?? undefined }
    }
    return idx
  }, [camerasData])

  const totalMonthly = subscriptions
    .filter(s => s.status === 'ACTIVE')
    .reduce((acc, s) => acc + s.monthlyPrice, 0)
  const grayedTotal = subscriptions
    .filter(s => s.status === 'GRACE')
    .reduce((acc, s) => acc + s.monthlyPrice, 0)

  const load = useCallback(() => {
    setError(null)
    refreshSubs()
  }, [refreshSubs])

  async function handleReactivate(id: string) {
    setReactivatingId(id)
    try {
      await api.post(`/marketplace/subscriptions/${id}/reactivate`)
      toast.success('Assinatura reativada com sucesso!')
      load()
    } catch (e) {
      const msg = formatApiError(e)
      setError(msg)
      toast.error({ title: 'Não foi possível reativar', description: msg })
    } finally {
      setReactivatingId(null)
    }
  }

  function handleUpgraded(decision: string) {
    setUpgradeTarget(null)
    load()
    if (decision === 'AUTO_APPROVED') {
      toast.success('Plano atualizado!')
    } else if (decision === 'PENDING_INTEGRADOR') {
      toast.info({ title: 'Solicitação enviada', description: 'Aguardando aprovação do integrador.' })
    } else {
      toast.info('Solicitação de alteração registrada.')
    }
  }

  function handleCanceled(expiresAt?: string) {
    setCancelTarget(null)
    load()
    if (expiresAt) {
      const date = new Date(expiresAt).toLocaleDateString('pt-BR')
      toast.warning({
        title: 'Cancelamento registrado',
        description: `Seus dados ficam disponíveis até ${date}.`,
      })
    } else {
      toast.success('Cancelamento realizado com sucesso.')
    }
  }

  return (
    <>
    <div className="p-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <ShoppingBag className="w-7 h-7 text-cyan-500" />
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Minhas Assinaturas
              </h1>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 ml-10">
              Gerencie todos os serviços contratados, veja uso e custos.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Atualizar"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <Link
              to="/marketplace"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-bold hover:opacity-90 transition shadow-lg shadow-cyan-500/30"
            >
              <Plus className="w-4 h-4" />
              Contratar serviço
            </Link>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-500"><X className="w-3 h-3" /></button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-7 h-7 animate-spin text-slate-400" />
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
            <ShoppingBag className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
              Você ainda não tem assinaturas.
            </p>
            <Link
              to="/marketplace"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-bold hover:opacity-90 transition"
            >
              <Plus className="w-4 h-4" />
              Explorar Marketplace
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 items-start">
            {/* Coluna principal: cards de assinaturas (1 col em md, 2 em xl+) */}
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
              {subscriptions.map(sub => (
                <div key={sub.id} className="relative">
                  {reactivatingId === sub.id && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-slate-900/60 rounded-2xl">
                      <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
                    </div>
                  )}
                  <SubscriptionCard
                    sub={sub}
                    cameraIndex={cameraIndex}
                    onReactivate={handleReactivate}
                    onCancel={setCancelTarget}
                    onUpgrade={setUpgradeTarget}
                    onShowUsage={setUsageTarget}
                  />
                </div>
              ))}
            </div>

            {/* Sidebar: Resumo financeiro (sticky em telas largas) */}
            <aside className="xl:sticky xl:top-4 space-y-4">
              <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 via-violet-500/5 to-transparent p-5">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
                  📊 Resumo financeiro
                </h3>

                {/* KPIs visuais */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="p-3 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-cyan-500/20">
                    <p className="text-2xl font-bold text-cyan-700 dark:text-cyan-300 leading-none">{subscriptions.length}</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">Assinaturas</p>
                  </div>
                  <div className="p-3 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-emerald-500/20">
                    <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 leading-none">
                      {subscriptions.filter(s => s.status === 'ACTIVE').length}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">Ativas</p>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">
                      Mensalidade atual
                    </span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      R$ {(totalMonthly + grayedTotal).toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                  {grayedTotal > 0 && (
                    <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                      <span>(-) Em graça (não cobra)</span>
                      <span className="font-mono">- R$ {grayedTotal.toFixed(2).replace('.', ',')}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700 font-bold">
                    <span className="text-slate-900 dark:text-white">Próxima fatura</span>
                    <span className="text-cyan-600 dark:text-cyan-400 text-xl">
                      R$ {totalMonthly.toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dica útil só em xl+ — preenche o espaço lateral abaixo do resumo */}
              <div className="hidden xl:block p-4 rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-slate-500/15">
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  💡 Para reduzir custos, você pode cancelar uma assinatura a
                  qualquer momento. Você continua tendo acesso até o fim do
                  período já pago.
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>

      <AnimatePresence>
        {cancelTarget && (
          <CancelModal
            subscription={cancelTarget}
            onClose={() => setCancelTarget(null)}
            onCanceled={handleCanceled}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {upgradeTarget && (
          <UpgradeModal
            subscription={upgradeTarget}
            onClose={() => setUpgradeTarget(null)}
            onUpgraded={handleUpgraded}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {usageTarget && (
          <UsageDrawer
            sub={usageTarget}
            onClose={() => setUsageTarget(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contractModalOpen && (
          <QuickPurchaseModal
            product={contractModalOpen}
            onClose={() => setContractModalOpen(null)}
            onContracted={() => { setContractModalOpen(null); load() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
