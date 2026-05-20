import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingBag, Loader2, X, Check, AlertCircle, AlertTriangle,
  HardDrive, Timer, Cpu, RefreshCw, Download, TrendingUp, TrendingDown,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────
interface Subscription {
  id: string
  productName: string
  productSlug: string
  productCategory: 'STORAGE' | 'TIMELAPSE' | 'AI'
  status: 'ACTIVE' | 'GRACE' | 'CANCELED' | 'SUSPENDED'
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
const STATUS_LABELS: Record<Subscription['status'], string> = {
  ACTIVE:    'Ativo',
  GRACE:     'Período de Graça',
  CANCELED:  'Cancelado',
  SUSPENDED: 'Suspenso',
}

const STATUS_STYLES: Record<Subscription['status'], string> = {
  ACTIVE:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  GRACE:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  CANCELED:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const PRODUCT_ICONS: Record<string, React.FC<{ className?: string }>> = {
  STORAGE:   HardDrive,
  TIMELAPSE: Timer,
  AI:        Cpu,
}

const PRODUCT_COLORS: Record<string, string> = {
  STORAGE:   'text-cyan-500',
  TIMELAPSE: 'text-amber-500',
  AI:        'text-violet-500',
}

const PRODUCT_BG: Record<string, string> = {
  STORAGE:   'bg-cyan-50 dark:bg-cyan-900/20',
  TIMELAPSE: 'bg-amber-50 dark:bg-amber-900/20',
  AI:        'bg-violet-50 dark:bg-violet-900/20',
}

// ─── Upgrade Plan ─────────────────────────────────────────────────────────────
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
    api.get<{ products: StorageProduct[] }>('/marketplace/products?category=STORAGE')
      .then(r => setProducts(r.data.products ?? []))
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false))
  }, [])

  async function handleConfirm() {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const r = await api.post(`/marketplace/subscriptions/${subscription.id}/upgrade`, {
        newProductId: selected.id,
      })
      onUpgraded(r.data?.decision ?? 'AUTO_APPROVED')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Erro ao processar upgrade.')
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
          <button
            onClick={onClose}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
          >
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
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Erro ao cancelar. Tente novamente.')
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
          {/* Passo 1 — Impacto */}
          {step === 1 && (
            <div>
              {loadingImpact ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 mb-4">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-700 dark:text-amber-300">
                      <p className="font-semibold mb-1">Atenção — impacto do cancelamento</p>
                      <ul className="space-y-1 text-xs">
                        {impact?.cameraCount && (
                          <li>• {impact.cameraCount} câmera{impact.cameraCount !== 1 ? 's' : ''} perderão gravação em nuvem</li>
                        )}
                        {impact?.recordingGigabytes && (
                          <li>• {impact.recordingGigabytes} GB de gravações serão deletados</li>
                        )}
                        {impact?.gracePeriodDays && (
                          <li>• Período de graça de {impact.gracePeriodDays} dias após cancelamento</li>
                        )}
                      </ul>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Deseja prosseguir com o cancelamento da assinatura{' '}
                    <strong>{subscription.productName}</strong>?
                  </p>
                </>
              )}
            </div>
          )}

          {/* Passo 2 — Modo + confirmação de texto */}
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

          {/* Passo 3 — Checkboxes finais */}
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
  onReactivate,
  onCancel,
  onUpgrade,
}: {
  sub: Subscription
  onReactivate: (id: string) => void
  onCancel: (sub: Subscription) => void
  onUpgrade: (sub: Subscription) => void
}) {
  const Icon = PRODUCT_ICONS[sub.productCategory] ?? ShoppingBag
  const iconColor = PRODUCT_COLORS[sub.productCategory] ?? 'text-slate-400'
  const iconBg = PRODUCT_BG[sub.productCategory] ?? 'bg-slate-50 dark:bg-slate-800'

  return (
    <div className={cn(
      'rounded-2xl border bg-white dark:bg-slate-900 overflow-hidden',
      sub.status === 'SUSPENDED' ? 'border-red-200 dark:border-red-900/50' : 'border-slate-200 dark:border-slate-800',
    )}>
      {/* Grace Banner */}
      {sub.status === 'GRACE' && (
        <div className="px-5 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">
              {sub.graceDaysRemaining ?? '?'} dias para deleção dos dados
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onReactivate(sub.id)}
              className="px-3 py-1 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition"
            >
              Reativar
            </button>
            <button
              disabled
              title="Exportação de dados disponível em breve"
              className="flex items-center gap-1 px-3 py-1 rounded-lg border border-amber-200 dark:border-amber-800 text-amber-400 dark:text-amber-600 text-xs font-medium opacity-50 cursor-not-allowed"
            >
              <Download className="w-3 h-3" />
              Baixar dados
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-5 py-4 flex items-start gap-3">
        <div className={cn('p-2.5 rounded-xl shrink-0', iconBg)}>
          <Icon className={cn('w-5 h-5', iconColor)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-slate-900 dark:text-white truncate">
              {sub.productName}
            </h3>
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0', STATUS_STYLES[sub.status])}>
              {STATUS_LABELS[sub.status]}
            </span>
          </div>
          <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>{sub.cameraCount} câmera{sub.cameraCount !== 1 ? 's' : ''}</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              R$ {sub.monthlyPrice.toFixed(2).replace('.', ',')}/mês
            </span>
            <span>Desde {new Date(sub.startedAt).toLocaleDateString('pt-BR')}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      {sub.status !== 'CANCELED' && (
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
          <button
            disabled
            title="Gerenciamento de câmeras por assinatura em breve"
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-600 opacity-50 cursor-not-allowed"
          >
            Gerenciar câmeras
          </button>
          {sub.productCategory === 'STORAGE' && sub.status === 'ACTIVE' && (
            <button
              onClick={() => onUpgrade(sub)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition"
            >
              <TrendingUp className="w-3 h-3" />
              Upgrade
            </button>
          )}
          <button
            disabled
            title="Histórico de alterações em breve"
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-600 opacity-50 cursor-not-allowed"
          >
            Histórico
          </button>
          {sub.status === 'ACTIVE' && (
            <button
              onClick={() => onCancel(sub)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition ml-auto"
            >
              Cancelar assinatura
            </button>
          )}
          {sub.status === 'GRACE' && (
            <button
              onClick={() => onReactivate(sub.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition ml-auto"
            >
              Reativar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function MinhasAssinaturasPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null)
  const [upgradeTarget, setUpgradeTarget] = useState<Subscription | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ subscriptions: Subscription[] }>('/marketplace/subscriptions')
      .then(r => setSubscriptions(r.data.subscriptions ?? []))
      .catch(() => setError('Não foi possível carregar as assinaturas.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const totalMonthly = subscriptions
    .filter(s => s.status === 'ACTIVE' || s.status === 'GRACE')
    .reduce((acc, s) => acc + s.monthlyPrice, 0)

  async function handleReactivate(id: string) {
    setReactivatingId(id)
    try {
      await api.post(`/marketplace/subscriptions/${id}/reactivate`)
      setSuccessMsg('Assinatura reativada com sucesso!')
      load()
    } catch {
      setError('Não foi possível reativar a assinatura.')
    } finally {
      setReactivatingId(null)
    }
  }

  function handleUpgraded(decision: string) {
    setUpgradeTarget(null)
    load()
    if (decision === 'AUTO_APPROVED') {
      setSuccessMsg('Plano atualizado!')
    } else if (decision === 'PENDING_INTEGRADOR') {
      setSuccessMsg('Solicitação enviada ao integrador. Aguarde aprovação.')
    } else {
      setSuccessMsg('Solicitação de alteração registrada.')
    }
  }

  function handleCanceled(expiresAt?: string) {
    setCancelTarget(null)
    load()
    if (expiresAt) {
      const date = new Date(expiresAt).toLocaleDateString('pt-BR')
      setSuccessMsg(`Cancelamento registrado. Seus dados ficam disponíveis até ${date}.`)
    } else {
      setSuccessMsg('Cancelamento realizado com sucesso.')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <ShoppingBag className="w-7 h-7 text-cyan-500" />
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Minhas Assinaturas
            </h1>
          </div>
          {totalMonthly > 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400 ml-10">
              Total mensal:{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                R$ {totalMonthly.toFixed(2).replace('.', ',')}
              </span>
            </p>
          )}
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          title="Atualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Feedback */}
      <AnimatePresence>
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 mb-4"
          >
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <Check className="w-4 h-4 shrink-0" />
              {successMsg}
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700 transition">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="text-center py-16">
          <ShoppingBag className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Você ainda não tem assinaturas.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {subscriptions.map(sub => (
            <div key={sub.id} className="relative">
              {reactivatingId === sub.id && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-slate-900/60 rounded-2xl">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
                </div>
              )}
              <SubscriptionCard
                sub={sub}
                onReactivate={handleReactivate}
                onCancel={setCancelTarget}
                onUpgrade={setUpgradeTarget}
              />
            </div>
          ))}
        </div>
      )}

      {/* Cancel Modal */}
      <AnimatePresence>
        {cancelTarget && (
          <CancelModal
            subscription={cancelTarget}
            onClose={() => setCancelTarget(null)}
            onCanceled={handleCanceled}
          />
        )}
      </AnimatePresence>

      {/* Upgrade Modal */}
      <AnimatePresence>
        {upgradeTarget && (
          <UpgradeModal
            subscription={upgradeTarget}
            onClose={() => setUpgradeTarget(null)}
            onUpgraded={handleUpgraded}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
