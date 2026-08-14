/**
 * QuickPurchaseModal — modal universal de compra do marketplace.
 *
 * Renderiza dinamicamente baseado em `product.metadata.configSchema`:
 *  Step 1 — Seletor de câmeras (todas vs manual)
 *  Step 2 — Opções específicas do produto (retention/resolution pra STORAGE,
 *           cron pra TIMELAPSE, nada pra AI/ADDON simples)
 *  Step 3 — Confirmação com preço calculado em tempo real via POST /calculate-price
 *
 * Botão "Contratar R$ X/mês" chama POST /marketplace/subscriptions
 * (endpoint existente, reutilizado — não reinventa checkout).
 *
 * Bloqueio capability: se o produto requer capability que cliente já não
 * tem prerequisito, mostra <CapabilityBlockedView> ao invés do form.
 *
 * Plano: docs/29-PLAN-MARKETPLACE-UNIFICADO.md mockup 2
 */
import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  X, Loader2, AlertCircle, Check, Camera as CameraIcon,
  HardDrive, Cpu, Timer, ShoppingBag, ArrowRight,
} from 'lucide-react'
import { api, formatApiError, useCameras } from '../../api/client'
import { useUiToast } from '../Toast'
import { cn } from '../../lib/utils'

export interface MarketplaceCatalogProduct {
  id: string
  slug: string
  name: string
  tagline?: string | null
  description?: string | null
  category: 'STORAGE' | 'AI' | 'TIMELAPSE' | 'ADDON'
  features?: string[]
  pricingModel?: 'PER_CAMERA_MONTH' | 'PER_GENERATION' | 'FLAT_MONTH'
  comingSoon?: boolean
  finalPriceBrl: number
  fromPriceBrl?: number
  capabilities?: string[]
  metadata?: Record<string, unknown> | null
  subscribed?: boolean
  /** Trial self-service habilitado pelo fabricante (botão "Iniciar trial"). */
  allowSelfTrial?: boolean
  /** Duração default do trial em dias quando concedido. */
  trialDays?: number
}

interface CalcPriceResponse {
  productId: string
  productName: string
  finalPriceBrl: number
  pricePerCameraBrl: number
  cameraCount: number
  breakdown: Record<string, unknown> & { formula?: string }
}

interface CameraOption {
  id: string
  name: string
  site?: { name?: string | null } | null
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  STORAGE:   HardDrive,
  AI:        Cpu,
  TIMELAPSE: Timer,
  ADDON:     ShoppingBag,
}

const CATEGORY_COLORS: Record<string, string> = {
  STORAGE:   'from-cyan-500 to-blue-500',
  AI:        'from-violet-500 to-pink-500',
  TIMELAPSE: 'from-pink-500 to-orange-500',
  ADDON:     'from-slate-500 to-slate-700',
}

interface Props {
  product: MarketplaceCatalogProduct
  onClose: () => void
  onContracted?: (subscriptionId: string) => void
}

export function QuickPurchaseModal({ product, onClose, onContracted }: Props) {
  const toast = useUiToast()
  const { data: camerasData, isLoading: loadingCameras } = useCameras()
  const cameras: CameraOption[] = useMemo(
    () => (camerasData?.cameras ?? []) as CameraOption[],
    [camerasData],
  )

  // Step state
  const [mode, setMode] = useState<'all' | 'manual'>('manual')
  const [selectedCameraIds, setSelectedCameraIds] = useState<string[]>([])
  const [retentionDays, setRetentionDays] = useState<number>(() => {
    const fromSchema = (product.metadata as any)?.retainDays
    return typeof fromSchema === 'number' ? fromSchema : 30
  })
  const [resolution, setResolution] = useState<string>(() => {
    const fromSchema = (product.metadata as any)?.resolution
    return typeof fromSchema === 'string' ? fromSchema : 'HD'
  })

  const [calcLoading, setCalcLoading] = useState(false)
  const [calc, setCalc] = useState<CalcPriceResponse | null>(null)
  const [calcError, setCalcError] = useState<string | null>(null)

  const [contracting, setContracting] = useState(false)
  const [contractError, setContractError] = useState<string | null>(null)

  // Câmeras efetivas (modo "all" usa todas, "manual" só as marcadas).
  const effectiveCameraIds = useMemo(() => {
    if (mode === 'all') return cameras.map(c => c.id)
    return selectedCameraIds
  }, [mode, cameras, selectedCameraIds])

  // Recalcula preço quando muda config relevante (debounce 250ms).
  useEffect(() => {
    if (product.comingSoon) return
    let cancelled = false
    setCalcError(null)
    setCalcLoading(true)
    const handle = setTimeout(() => {
      api.post<CalcPriceResponse>('/marketplace/calculate-price', {
        productId: product.id,
        config: {
          cameraIds: effectiveCameraIds,
          retentionDays,
          resolution,
        },
      }).then(r => {
        if (!cancelled) setCalc(r.data)
      }).catch(e => {
        if (!cancelled) setCalcError(formatApiError(e))
      }).finally(() => {
        if (!cancelled) setCalcLoading(false)
      })
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [product.id, product.comingSoon, effectiveCameraIds, retentionDays, resolution])

  function toggleCamera(id: string) {
    setSelectedCameraIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  }

  async function handleContract() {
    if (effectiveCameraIds.length === 0) {
      setContractError('Selecione ao menos 1 câmera.')
      return
    }
    setContracting(true)
    setContractError(null)
    try {
      const r = await api.post<{ subscription: { id: string }; decision: { status: string } }>(
        '/marketplace/subscriptions',
        {
          productId: product.id,
          cameraIds: effectiveCameraIds,
          acceptedTermsVersion: 'v1',
        },
      )
      const subId = r.data?.subscription?.id
      const decision = r.data?.decision?.status
      toast.success({
        title: 'Assinatura ativada',
        description: decision === 'PENDING_INTEGRADOR'
          ? 'Solicitação enviada ao integrador para aprovação.'
          : `${product.name} ativo em ${effectiveCameraIds.length} câmera(s).`,
      })
      onContracted?.(subId)
      onClose()
    } catch (e) {
      const msg = formatApiError(e)
      setContractError(msg)
      toast.error({ title: 'Falha ao contratar', description: msg })
    } finally {
      setContracting(false)
    }
  }

  const Icon = CATEGORY_ICONS[product.category] ?? ShoppingBag
  const gradient = CATEGORY_COLORS[product.category] ?? 'from-slate-500 to-slate-700'
  const totalBrl = calc?.finalPriceBrl ?? product.finalPriceBrl
  const pricePerCam = calc?.pricePerCameraBrl ?? product.finalPriceBrl

  // ─── configSchema dinâmico — descobre quais steps mostrar ────────────────
  const schema = (product.metadata as any)?.configSchema ?? {}
  const productHasFixedRetention  = typeof (product.metadata as any)?.retainDays === 'number'
  const productHasFixedResolution = typeof (product.metadata as any)?.resolution === 'string'

  // Só mostra step quando o produto NÃO tem essa dimensão fixada na metadata.
  // Catálogo atual: cada produto já é uma combinação específica (ex: "HD · 30d"),
  // então metadata já contém retainDays e resolution — modal pula esses steps
  // e só pede a câmera/site. Produtos legados ou genéricos seguem mostrando.
  const showRetention =
    (product.category === 'STORAGE' || schema.retention === true) && !productHasFixedRetention
  const showResolution =
    (product.category === 'STORAGE' || schema.resolution === true) && !productHasFixedResolution

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-white',
              gradient,
            )}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-base">
                Contratar {product.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {product.tagline ?? 'Configure as opções e veja o preço em tempo real'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {product.comingSoon ? (
            <div className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-6 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Produto ainda não disponível para contratação. Você será notificado quando lançarmos.
              </p>
            </div>
          ) : (
            <>
              {/* Resumo do plano selecionado (quando as dimensões estão fixas) */}
              {(productHasFixedResolution || productHasFixedRetention) && (
                <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Plano escolhido</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{product.name}</p>
                    {product.tagline && (
                      <p className="text-[11px] text-slate-500 truncate">{product.tagline}</p>
                    )}
                  </div>
                  {/* Pílulas das dimensões fixas */}
                  <div className="flex flex-col gap-1 items-end shrink-0">
                    {productHasFixedResolution && (
                      <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 text-[10px] font-bold uppercase">
                        {(product.metadata as any).resolution === 'FHD' ? 'Full HD' :
                         (product.metadata as any).resolution === 'UHD' ? '4K' :
                         (product.metadata as any).resolution}
                      </span>
                    )}
                    {productHasFixedRetention && (
                      <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[10px] font-bold uppercase">
                        {(product.metadata as any).retainDays} dias
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Step 1 — Câmeras */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-5 h-5 rounded-full bg-cyan-500 text-white flex items-center justify-center text-[10px] font-bold">1</div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Selecione as câmeras</h3>
                </div>
                <div className="space-y-2 ml-7">
                  <label className={cn(
                    'flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition',
                    mode === 'all'
                      ? 'bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-500/40'
                      : 'border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50',
                  )}>
                    <input type="radio" name="mode" checked={mode === 'all'} onChange={() => setMode('all')} className="text-cyan-500" />
                    <span className="text-sm text-slate-700 dark:text-slate-200">
                      Todas as câmeras <span className="text-xs text-slate-500">({cameras.length})</span>
                    </span>
                  </label>
                  <label className={cn(
                    'flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition',
                    mode === 'manual'
                      ? 'bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-500/40'
                      : 'border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50',
                  )}>
                    <input type="radio" name="mode" checked={mode === 'manual'} onChange={() => setMode('manual')} className="text-cyan-500" />
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Escolher manualmente
                    </span>
                  </label>

                  {mode === 'manual' && (
                    <div className="ml-4 mt-2 max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                      {loadingCameras ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                        </div>
                      ) : cameras.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400 px-3 py-4 text-center">
                          Nenhuma câmera cadastrada.
                        </p>
                      ) : (
                        cameras.map(c => {
                          const checked = selectedCameraIds.includes(c.id)
                          return (
                            <label
                              key={c.id}
                              className={cn(
                                'flex items-center gap-2 px-3 py-2 cursor-pointer text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 transition',
                                checked && 'bg-cyan-50/50 dark:bg-cyan-900/10',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCamera(c.id)}
                                className="text-cyan-500"
                              />
                              <CameraIcon className="w-3 h-3 text-slate-400" />
                              <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{c.name}</span>
                              {c.site?.name && (
                                <span className="text-slate-400 dark:text-slate-500 text-[10px]">{c.site.name}</span>
                              )}
                            </label>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* Step 2 — Resolução (só pra STORAGE) */}
              {showResolution && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-cyan-500 text-white flex items-center justify-center text-[10px] font-bold">2</div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Qualidade de gravação</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2 ml-7">
                    {[
                      { value: 'SD',  label: 'SD',  detail: '480p · 2 GB/dia/câm' },
                      { value: 'HD',  label: 'HD',  detail: '720p · 5 GB/dia/câm' },
                      { value: 'FHD', label: 'Full HD', detail: '1080p · 10 GB/dia' },
                    ].map(opt => (
                      <label
                        key={opt.value}
                        className={cn(
                          'p-3 rounded-lg border cursor-pointer text-center transition',
                          resolution === opt.value
                            ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20'
                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
                        )}
                      >
                        <input
                          type="radio"
                          name="resolution"
                          checked={resolution === opt.value}
                          onChange={() => setResolution(opt.value)}
                          className="sr-only"
                        />
                        <div className={cn('text-sm font-bold', resolution === opt.value ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300')}>
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{opt.detail}</div>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {/* Step 3 — Retenção (só pra STORAGE) */}
              {showRetention && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-cyan-500 text-white flex items-center justify-center text-[10px] font-bold">3</div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Tempo de retenção</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2 ml-7">
                    {[
                      { value: 7,  label: '7 dias',  detail: 'Histórico curto' },
                      { value: 30, label: '30 dias', detail: 'Recomendado', popular: true },
                      { value: 90, label: '90 dias', detail: 'Conformidade' },
                    ].map(opt => (
                      <label
                        key={opt.value}
                        className={cn(
                          'relative p-3 rounded-lg border cursor-pointer text-center transition',
                          retentionDays === opt.value
                            ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20'
                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
                        )}
                      >
                        {opt.popular && (
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-amber-500 text-[9px] font-bold text-white">
                            POPULAR
                          </span>
                        )}
                        <input
                          type="radio"
                          name="retention"
                          checked={retentionDays === opt.value}
                          onChange={() => setRetentionDays(opt.value)}
                          className="sr-only"
                        />
                        <div className={cn('text-sm font-bold', retentionDays === opt.value ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300')}>
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{opt.detail}</div>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {contractError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {contractError}
                </div>
              )}
              {calcError && !contractError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {calcError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Resumo + ações */}
        {!product.comingSoon && (
          <>
            <div className="px-5 py-4 bg-gradient-to-r from-cyan-500/5 to-blue-500/5 dark:from-cyan-500/10 dark:to-blue-500/10 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">Cálculo do preço</span>
                <span className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                  {calcLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin inline" />
                  ) : (
                    calc?.breakdown?.formula ?? `R$ ${pricePerCam.toFixed(2)}/câm`
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Total mensal</span>
                <span className="text-lg font-bold text-cyan-600 dark:text-cyan-400">
                  R$ {totalBrl.toFixed(2).replace('.', ',')}
                  <span className="text-xs text-slate-400 font-normal">/mês</span>
                </span>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 shrink-0">
              <button
                onClick={onClose}
                className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                disabled={contracting || effectiveCameraIds.length === 0}
                onClick={handleContract}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {contracting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Contratar · R$ {totalBrl.toFixed(2).replace('.', ',')}/mês
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}
