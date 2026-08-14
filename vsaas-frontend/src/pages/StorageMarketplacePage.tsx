// @deprecated — pendente migração para Pacote D (consolidação do marketplace).
// Mantido vivo porque ainda é o único ponto de compra de storage (MarketplacePage
// apenas linka pra esta rota). Não duplicar lógica em MarketplacePage — esperar
// o Pacote D unificar tudo em FabricanteMarketplacePage / IntegradorMarketplacePage.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  HardDrive, Loader2, X, Check, AlertCircle, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, ChevronDown, SlidersHorizontal, Search,
  ArrowUpDown, RotateCcw, Sparkles,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────
interface RetentionPlan {
  id: string
  name: string
  slug: string
  resolution: string
  retentionDays: number
  pricePerCameraMonth: number
  features: string[]
  popular?: boolean
  description?: string | null
}

interface Camera {
  id: string
  name: string
  status: string
  currentPlanSlug?: string
}

interface MarketplaceProduct {
  id: string
  slug: string
  category: string
}

interface ProductDetail {
  id: string
  slug: string
  name: string
  pricePerCameraMonth: number
  markupPct: number
}

interface ActiveSubscription {
  id: string
  productSlug: string
  productCategory: string
  status: string
  monthlyPrice: number
}

// ─── Constants ───────────────────────────────────────────────────────────────
const RESOLUTION_ORDER = ['ANY', 'VGA', 'SD', 'HD', 'FHD', 'UHD_4K', '4K']

const RES_LABELS: Record<string, string> = {
  ANY: 'Live Only', VGA: 'VGA (480p)', SD: 'SD (576p)',
  HD: 'HD (720p)', FHD: 'Full HD (1080p)', UHD_4K: '4K Ultra HD', '4K': '4K Ultra HD',
}
const RES_COLORS: Record<string, string> = {
  ANY: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  VGA: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  SD:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  HD:  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  FHD: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  UHD_4K: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  '4K': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
}
const SORT_OPTIONS = [
  { value: 'res-asc',   label: 'Qualidade: menor → maior' },
  { value: 'res-desc',  label: 'Qualidade: maior → menor' },
  { value: 'days-asc',  label: 'Retenção: menor → maior' },
  { value: 'days-desc', label: 'Retenção: maior → menor' },
  { value: 'price-asc', label: 'Preço: menor → maior' },
  { value: 'price-desc',label: 'Preço: maior → menor' },
]
const PRICE_RANGES = [
  { label: 'Até R$2/cam', min: 0,  max: 2 },
  { label: 'R$2 – R$5',   min: 2,  max: 5 },
  { label: 'R$5 – R$10',  min: 5,  max: 10 },
  { label: 'Acima de R$10', min: 10, max: Infinity },
]

// ─── Dropdown primitive ───────────────────────────────────────────────────────
function Dropdown({
  label, count, icon, children,
}: {
  label: string; count?: number; icon?: React.ReactNode; children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(p => !p)}
        className={cn(
          'flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all duration-150',
          open || (count && count > 0)
            ? 'bg-cyan-600 border-cyan-600 text-white shadow-md shadow-cyan-500/20'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-400',
        )}
      >
        {icon}
        <span>{label}</span>
        {count ? (
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white/20 text-xs font-bold">
            {count}
          </span>
        ) : null}
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 z-50 min-w-[220px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl shadow-slate-900/10 dark:shadow-slate-900/40 overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── FilterBar ────────────────────────────────────────────────────────────────
interface FilterBarProps {
  plans: RetentionPlan[]
  resFilter: Set<string>
  daysFilter: Set<number>
  priceRange: { min: number; max: number } | null
  sortKey: string
  search: string
  onToggleRes: (r: string) => void
  onToggleDays: (d: number) => void
  onSetPriceRange: (r: { min: number; max: number } | null) => void
  onSetSort: (s: string) => void
  onSetSearch: (s: string) => void
  onReset: () => void
  resultCount: number
}

function FilterBar({
  plans, resFilter, daysFilter, priceRange, sortKey, search,
  onToggleRes, onToggleDays, onSetPriceRange, onSetSort, onSetSearch,
  onReset, resultCount,
}: FilterBarProps) {
  const activeResolutions = useMemo(
    () => [...new Set(plans.map(p => p.resolution))].sort(
      (a, b) => RESOLUTION_ORDER.indexOf(a) - RESOLUTION_ORDER.indexOf(b)
    ),
    [plans],
  )
  const activeDays = useMemo(
    () => [...new Set(plans.map(p => p.retentionDays))].sort((a, b) => a - b),
    [plans],
  )
  const hasFilters = resFilter.size > 0 || daysFilter.size > 0 || priceRange !== null || search !== ''

  return (
    <div className="mb-8">
      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          value={search}
          onChange={e => onSetSearch(e.target.value)}
          placeholder="Buscar plano por nome, resolução ou retenção..."
          className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500 transition shadow-sm"
        />
        {search && (
          <button
            onClick={() => onSetSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Resolução */}
        <Dropdown
          label="Resolução"
          count={resFilter.size}
          icon={<Sparkles className="w-3.5 h-3.5" />}
        >
          <div className="p-2">
            <p className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Qualidade de vídeo
            </p>
            {activeResolutions.map(r => (
              <button
                key={r}
                onClick={() => onToggleRes(r)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all',
                  resFilter.has(r)
                    ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
                )}
              >
                <div className={cn(
                  'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition',
                  resFilter.has(r)
                    ? 'bg-cyan-600 border-cyan-600'
                    : 'border-slate-300 dark:border-slate-600',
                )}>
                  {resFilter.has(r) && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <span className="flex-1 text-left font-medium">{RES_LABELS[r] ?? r}</span>
                <span className={cn('text-xs px-1.5 py-0.5 rounded font-bold', RES_COLORS[r] ?? RES_COLORS['HD'])}>
                  {r === 'UHD_4K' ? '4K' : r}
                </span>
              </button>
            ))}
          </div>
        </Dropdown>

        {/* Retenção */}
        <Dropdown
          label="Retenção"
          count={daysFilter.size}
          icon={<HardDrive className="w-3.5 h-3.5" />}
        >
          <div className="p-2">
            <p className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Período de armazenamento
            </p>
            {activeDays.map(d => {
              const label = d === 0 ? 'Somente live' : d === 1 ? '1 dia' : `${d} dias`
              const sub   = d === 0 ? 'Sem gravação' : d <= 7 ? 'Curto prazo' : d <= 30 ? 'Médio prazo' : 'Longo prazo'
              return (
                <button
                  key={d}
                  onClick={() => onToggleDays(d)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all',
                    daysFilter.has(d)
                      ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <div className={cn(
                    'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition',
                    daysFilter.has(d)
                      ? 'bg-cyan-600 border-cyan-600'
                      : 'border-slate-300 dark:border-slate-600',
                  )}>
                    {daysFilter.has(d) && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">{sub}</div>
                  </div>
                  {d > 0 && (
                    <span className="text-xs text-slate-400 tabular-nums">{d}d</span>
                  )}
                </button>
              )
            })}
          </div>
        </Dropdown>

        {/* Preço */}
        <Dropdown
          label="Preço"
          count={priceRange ? 1 : 0}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
        >
          <div className="p-2">
            <p className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Faixa de preço / câm / mês
            </p>
            {PRICE_RANGES.map(pr => (
              <button
                key={pr.label}
                onClick={() => onSetPriceRange(
                  priceRange?.min === pr.min && priceRange?.max === pr.max ? null : pr
                )}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all',
                  priceRange?.min === pr.min && priceRange?.max === pr.max
                    ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
                )}
              >
                <div className={cn(
                  'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition',
                  priceRange?.min === pr.min && priceRange?.max === pr.max
                    ? 'bg-cyan-600 border-cyan-600'
                    : 'border-slate-300 dark:border-slate-600',
                )}>
                  {priceRange?.min === pr.min && priceRange?.max === pr.max && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </div>
                <span className="flex-1 text-left font-medium">{pr.label}</span>
              </button>
            ))}
          </div>
        </Dropdown>

        {/* Ordenação */}
        <Dropdown
          label={SORT_OPTIONS.find(s => s.value === sortKey)?.label.split(':')[0] ?? 'Ordenar'}
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
        >
          <div className="p-2">
            <p className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Ordenar por
            </p>
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => onSetSort(opt.value)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all',
                  sortKey === opt.value
                    ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
                )}
              >
                {sortKey === opt.value
                  ? <Check className="w-4 h-4 text-cyan-600" />
                  : <div className="w-4 h-4" />}
                {opt.label}
              </button>
            ))}
          </div>
        </Dropdown>

        {/* Separador + Reset + Contagem */}
        {hasFilters && (
          <>
            <div className="w-px h-8 bg-slate-200 dark:bg-slate-700 mx-1" />
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Limpar filtros
            </button>
          </>
        )}

        {/* Active filter chips */}
        {resFilter.size > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {[...resFilter].map(r => (
              <span
                key={r}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 text-xs font-semibold"
              >
                {RES_LABELS[r] ?? r}
                <button onClick={() => onToggleRes(r)} className="hover:text-red-500 transition">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {daysFilter.size > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {[...daysFilter].sort((a, b) => a - b).map(d => (
              <span
                key={d}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-xs font-semibold"
              >
                {d === 0 ? 'Live only' : `${d}d`}
                <button onClick={() => onToggleDays(d)} className="hover:text-red-500 transition">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {priceRange && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
            {PRICE_RANGES.find(p => p.min === priceRange.min && p.max === priceRange.max)?.label ?? 'Faixa de preço'}
            <button onClick={() => onSetPriceRange(null)} className="hover:text-red-500 transition">
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
      </div>

      {/* Result count */}
      <div className="flex items-center gap-2 mt-4">
        <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-xs text-slate-400 dark:text-slate-500">
          <span className="font-semibold text-slate-600 dark:text-slate-300">{resultCount}</span>
          {' '}plano{resultCount !== 1 ? 's' : ''} encontrado{resultCount !== 1 ? 's' : ''}
          {hasFilters && (
            <span className="text-slate-400"> · com filtros ativos</span>
          )}
        </span>
      </div>
    </div>
  )
}

// ─── Wizard Modal ─────────────────────────────────────────────────────────────
function WizardModal({
  plan,
  cameras,
  products,
  onClose,
  onSuccess,
}: {
  plan: RetentionPlan
  cameras: Camera[]
  products: MarketplaceProduct[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [step, setStep] = useState(1)
  const [selectedCamIds, setSelectedCamIds] = useState<string[]>([])
  const [termA, setTermA] = useState(false)
  const [termB, setTermB] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [protocol, setProtocol] = useState<string | null>(null)
  const [productDetail, setProductDetail] = useState<ProductDetail | null>(null)

  const matchedProduct = useMemo(
    () => products.find(p => p.slug === plan.slug || p.slug === `storage-${plan.slug}`),
    [products, plan.slug],
  )

  useEffect(() => {
    if (!matchedProduct) return
    api.get<ProductDetail>(`/marketplace/products/${matchedProduct.slug}`)
      .then(r => setProductDetail(r.data))
      .catch(() => { /* usa plan.pricePerCameraMonth como fallback */ })
  }, [matchedProduct])

  const effectivePrice = productDetail?.pricePerCameraMonth ?? plan.pricePerCameraMonth

  const toggleCam = (id: string) =>
    setSelectedCamIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id],
    )

  const proRata = useMemo(() => {
    const today = new Date()
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    const remaining = daysInMonth - today.getDate() + 1
    return (effectivePrice * selectedCamIds.length * remaining) / daysInMonth
  }, [effectivePrice, selectedCamIds.length])

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      if (matchedProduct) {
        const body: Record<string, unknown> = {
          productId: matchedProduct.id,
          cameraIds: selectedCamIds,
          acceptedTermsVersion: 'v1',
        }
        if (productDetail?.markupPct !== undefined) body.markupPct = productDetail.markupPct
        const r = await api.post('/marketplace/subscriptions', body)
        setProtocol(r.data?.protocol ?? r.data?.id ?? 'OK')
      } else {
        // Fallback: rota legada por câmera
        await Promise.all(
          selectedCamIds.map(id =>
            api.post(`/retention/cameras/${id}/plan`, { planSlug: plan.slug }),
          ),
        )
        setProtocol('LEGACY-OK')
      }
      setStep(4)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Erro ao processar. Tente novamente.')
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
      onClick={e => { if (e.target === e.currentTarget && step !== 4) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">
              Contratar — {plan.name}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              {[1, 2, 3].map(s => (
                <div
                  key={s}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    step > s ? 'w-6 bg-cyan-500' : step === s ? 'w-6 bg-cyan-400' : 'w-3 bg-slate-200 dark:bg-slate-700',
                  )}
                />
              ))}
            </div>
          </div>
          {step !== 4 && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Etapa 1 — Câmeras */}
          {step === 1 && (
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Selecione as câmeras que receberão o plano <strong>{plan.name}</strong>.
              </p>
              {cameras.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">
                  Nenhuma câmera encontrada.
                </p>
              ) : (
                <div className="space-y-2">
                  {cameras.map(cam => (
                    <label
                      key={cam.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition',
                        selectedCamIds.includes(cam.id)
                          ? 'border-cyan-500/50 bg-cyan-50 dark:bg-cyan-900/10'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={selectedCamIds.includes(cam.id)}
                        onChange={() => toggleCam(cam.id)}
                      />
                      <div className={cn(
                        'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition',
                        selectedCamIds.includes(cam.id)
                          ? 'border-cyan-500 bg-cyan-500'
                          : 'border-slate-300 dark:border-slate-600',
                      )}>
                        {selectedCamIds.includes(cam.id) && (
                          <Check className="w-2.5 h-2.5 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {cam.name}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          {cam.currentPlanSlug ? `Plano atual: ${cam.currentPlanSlug}` : 'Sem plano'}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Etapa 2 — Resumo financeiro */}
          {step === 2 && (
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Resumo da contratação para {selectedCamIds.length} câmera{selectedCamIds.length !== 1 ? 's' : ''}.
              </p>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Item</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    <tr>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">Plano {plan.name}</td>
                      <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">
                        R$ {effectivePrice.toFixed(2).replace('.', ',')} /câm/mês
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        Câmeras selecionadas
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">
                        {selectedCamIds.length}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        Total mensal
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-white">
                        R$ {(effectivePrice * selectedCamIds.length).toFixed(2).replace('.', ',')}
                      </td>
                    </tr>
                    <tr className="bg-cyan-50 dark:bg-cyan-900/10">
                      <td className="px-4 py-3 text-cyan-700 dark:text-cyan-400 font-medium">
                        Cobrança hoje (pró-rata)
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-cyan-700 dark:text-cyan-400">
                        R$ {proRata.toFixed(2).replace('.', ',')}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Etapa 3 — Termos */}
          {step === 3 && (
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Leia e aceite os termos para concluir a contratação.
              </p>
              <div className="space-y-3">
                {[
                  {
                    key: 'A',
                    checked: termA,
                    onChange: setTermA,
                    text: 'Estou ciente de que a gravação em nuvem fica disponível pelo período de retenção contratado. Após o vencimento da assinatura, os dados serão mantidos por 30 dias em período de graça e então excluídos permanentemente.',
                  },
                  {
                    key: 'B',
                    checked: termB,
                    onChange: setTermB,
                    text: 'Autorizo a cobrança mensal recorrente no valor informado no resumo financeiro e declaro ter poderes para contratar em nome da organização.',
                  },
                ].map(t => (
                  <label
                    key={t.key}
                    className={cn(
                      'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition',
                      t.checked
                        ? 'border-cyan-500/50 bg-cyan-50 dark:bg-cyan-900/10'
                        : 'border-slate-200 dark:border-slate-700',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={t.checked}
                      onChange={e => t.onChange(e.target.checked)}
                    />
                    <div className={cn(
                      'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition',
                      t.checked ? 'border-cyan-500 bg-cyan-500' : 'border-slate-300 dark:border-slate-600',
                    )}>
                      {t.checked && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                      {t.text}
                    </p>
                  </label>
                ))}
              </div>
              {error && (
                <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Etapa 4 — Sucesso */}
          {step === 4 && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
                <Check className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                Contratação realizada!
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                Suas câmeras serão configuradas em instantes.
              </p>
              {protocol && (
                <p className="text-xs font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1.5 rounded-lg inline-block">
                  Protocolo: {protocol}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 4 ? (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
            {step > 1 ? (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
              >
                <ChevronLeft className="w-4 h-4" />
                Voltar
              </button>
            ) : <div />}
            {step < 3 ? (
              <button
                disabled={step === 1 && selectedCamIds.length === 0}
                onClick={() => setStep(s => s + 1)}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700 disabled:opacity-50 transition"
              >
                Continuar
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                disabled={!termA || !termB || loading}
                onClick={handleConfirm}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700 disabled:opacity-50 transition"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar contratação
              </button>
            )}
          </div>
        ) : (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
            <button
              onClick={onSuccess}
              className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition"
            >
              Concluído
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ─── Plan Card ────────────────────────────────────────────────────────────────
function PlanCard({
  plan,
  onContract,
  currentPlan,
}: {
  plan: RetentionPlan
  onContract: (plan: RetentionPlan) => void
  currentPlan?: RetentionPlan | null
}) {
  const isCurrent = currentPlan?.slug === plan.slug
  const isUpgrade = currentPlan && plan.pricePerCameraMonth > currentPlan.pricePerCameraMonth
  const isDowngrade = currentPlan && !isCurrent && plan.pricePerCameraMonth < currentPlan.pricePerCameraMonth

  const downgradeTooltip = isDowngrade
    ? `Atenção: gravações além de ${plan.retentionDays} dias poderão ser deletadas`
    : undefined

  return (
    <motion.div
      whileHover={{ scale: 1.015 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={cn(
        'relative rounded-2xl border bg-white dark:bg-slate-900 p-5 flex flex-col',
        isCurrent
          ? 'border-emerald-500/60 shadow-lg shadow-emerald-500/10'
          : plan.popular
            ? 'border-cyan-500/60 shadow-lg shadow-cyan-500/10'
            : 'border-slate-200 dark:border-slate-800 shadow-sm',
      )}
    >
      {isCurrent && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-[10px] font-bold rounded-full bg-emerald-500 text-white shadow flex items-center gap-1">
          <Check className="w-2.5 h-2.5" />
          ATIVO
        </span>
      )}
      {!isCurrent && plan.popular && !isUpgrade && !isDowngrade && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-[10px] font-bold rounded-full bg-cyan-500 text-white shadow">
          POPULAR
        </span>
      )}
      {isUpgrade && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-[10px] font-bold rounded-full bg-emerald-500 text-white shadow flex items-center gap-1">
          <TrendingUp className="w-2.5 h-2.5" />
          UPGRADE
        </span>
      )}
      {isDowngrade && (
        <span
          title={downgradeTooltip}
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-[10px] font-bold rounded-full bg-amber-500 text-white shadow flex items-center gap-1 cursor-help"
        >
          <TrendingDown className="w-2.5 h-2.5" />
          DOWNGRADE
        </span>
      )}

      <div className="flex items-center justify-between mb-3">
        <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', RES_COLORS[plan.resolution])}>
          {plan.resolution}
        </span>
        <HardDrive className="w-4 h-4 text-slate-400" />
      </div>
      <div className="mb-1">
        <span className="text-3xl font-bold text-cyan-600 dark:text-cyan-400">
          {plan.retentionDays}
        </span>
        <span className="text-sm text-slate-500 dark:text-slate-400 ml-1">dias</span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 font-medium">
        {plan.name}
      </p>
      <ul className="space-y-1.5 flex-1 mb-5">
        {(plan.features ?? []).map((f, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-auto">
        <p className="text-center text-sm font-semibold text-slate-900 dark:text-white mb-3">
          R$ {plan.pricePerCameraMonth.toFixed(2).replace('.', ',')}{' '}
          <span className="text-xs font-normal text-slate-400">/câm/mês</span>
        </p>
        {isCurrent ? (
          <button
            disabled
            className="w-full py-2.5 rounded-lg text-sm font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 cursor-not-allowed opacity-80"
          >
            Plano atual
          </button>
        ) : (
          <button
            onClick={() => onContract(plan)}
            title={isDowngrade ? downgradeTooltip : undefined}
            className={cn(
              'w-full py-2.5 rounded-lg text-sm font-semibold transition',
              isUpgrade
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : isDowngrade
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-700'
                  : plan.popular
                    ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700',
            )}
          >
            {isUpgrade ? 'Fazer upgrade' : isDowngrade ? 'Fazer downgrade' : 'Contratar'}
          </button>
        )}
      </div>
    </motion.div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export function StorageMarketplacePage() {
  const navigate = useNavigate()
  const [plans, setPlans] = useState<RetentionPlan[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [products, setProducts] = useState<MarketplaceProduct[]>([])
  const [activeSubscriptions, setActiveSubscriptions] = useState<ActiveSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [resFilter, setResFilter] = useState<Set<string>>(new Set())
  const [daysFilter, setDaysFilter] = useState<Set<number>>(new Set())
  const [priceRange, setPriceRange] = useState<{ min: number; max: number } | null>(null)
  const [sortKey, setSortKey] = useState('res-asc')
  const [search, setSearch] = useState('')

  const [wizardPlan, setWizardPlan] = useState<RetentionPlan | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<{ plans: RetentionPlan[] }>('/retention/plans'),
      api.get<{ cameras: Camera[] }>('/cameras?limit=200'),
      api.get<{ products: MarketplaceProduct[] }>('/marketplace/products?category=STORAGE').catch(() => ({ data: { products: [] } })),
      api.get<{ subscriptions: ActiveSubscription[] }>('/marketplace/subscriptions').catch(() => ({ data: { subscriptions: [] } })),
    ])
      .then(([plansR, camsR, prodsR, subsR]) => {
        const rawPlans: any[] = plansR.data.plans ?? []
        setPlans(rawPlans.map(p => ({
          ...p,
          retentionDays: p.retainDays ?? p.retentionDays ?? 0,
          pricePerCameraMonth: Number(p.pricePerCameraMonthUsd ?? p.pricePerCameraMonth ?? 0),
          features: p.features ?? (p.description ? [p.description] : []),
        })))
        setCameras(camsR.data.cameras ?? [])
        setProducts(prodsR.data.products ?? [])
        const activeSubs = (subsR.data.subscriptions ?? []).filter(
          s => s.productCategory === 'STORAGE' && s.status === 'ACTIVE',
        )
        setActiveSubscriptions(activeSubs)
      })
      .catch(() => setError('Não foi possível carregar os planos.'))
      .finally(() => setLoading(false))
  }, [])

  const currentStoragePlan = useMemo<RetentionPlan | null>(() => {
    if (activeSubscriptions.length === 0) return null
    const sub = activeSubscriptions[0]
    return plans.find(p => p.slug === sub.productSlug || `storage-${p.slug}` === sub.productSlug) ?? null
  }, [activeSubscriptions, plans])

  const toggleRes = (r: string) =>
    setResFilter(prev => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n })

  const toggleDays = (d: number) =>
    setDaysFilter(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n })

  const resetFilters = () => {
    setResFilter(new Set()); setDaysFilter(new Set())
    setPriceRange(null); setSearch('')
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return plans.filter(p => {
      const okRes   = resFilter.size === 0 || resFilter.has(p.resolution)
      const okDays  = daysFilter.size === 0 || daysFilter.has(p.retentionDays)
      const okPrice = !priceRange || (p.pricePerCameraMonth >= priceRange.min && p.pricePerCameraMonth < priceRange.max)
      const okSearch = !q || p.name.toLowerCase().includes(q) || p.resolution.toLowerCase().includes(q) || String(p.retentionDays).includes(q)
      return okRes && okDays && okPrice && okSearch
    }).sort((a, b) => {
      switch (sortKey) {
        case 'res-asc':   return RESOLUTION_ORDER.indexOf(a.resolution) - RESOLUTION_ORDER.indexOf(b.resolution) || a.retentionDays - b.retentionDays
        case 'res-desc':  return RESOLUTION_ORDER.indexOf(b.resolution) - RESOLUTION_ORDER.indexOf(a.resolution) || a.retentionDays - b.retentionDays
        case 'days-asc':  return a.retentionDays - b.retentionDays
        case 'days-desc': return b.retentionDays - a.retentionDays
        case 'price-asc': return a.pricePerCameraMonth - b.pricePerCameraMonth
        case 'price-desc':return b.pricePerCameraMonth - a.pricePerCameraMonth
        default: return 0
      }
    })
  }, [plans, resFilter, daysFilter, priceRange, sortKey, search])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <HardDrive className="w-7 h-7 text-cyan-500" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            VMS em Nuvem
          </h1>
        </div>
        <p className="text-slate-500 dark:text-slate-400 ml-10">
          Gravação contínua na nuvem — escolha a resolução e o período de retenção
        </p>
      </div>

      {/* Filtros premium */}
      <FilterBar
        plans={plans}
        resFilter={resFilter}
        daysFilter={daysFilter}
        priceRange={priceRange}
        sortKey={sortKey}
        search={search}
        onToggleRes={toggleRes}
        onToggleDays={toggleDays}
        onSetPriceRange={setPriceRange}
        onSetSort={setSortKey}
        onSetSearch={setSearch}
        onReset={resetFilters}
        resultCount={filtered.length}
      />

      {/* Grid de Planos */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-16 text-slate-400 text-sm">
          Nenhum plano encontrado para os filtros selecionados.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pt-4">
          {filtered.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onContract={setWizardPlan}
              currentPlan={currentStoragePlan}
            />
          ))}
        </div>
      )}

      {/* Wizard Modal */}
      <AnimatePresence>
        {wizardPlan && (
          <WizardModal
            plan={wizardPlan}
            cameras={cameras}
            products={products}
            onClose={() => setWizardPlan(null)}
            onSuccess={() => navigate('/marketplace/minhas-assinaturas')}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
