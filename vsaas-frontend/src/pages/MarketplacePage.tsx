/**
 * MarketplacePage — vitrine unificada do VSaaS.
 *
 * Substitui as 3 páginas paralelas (Storage / Timelapse / "Em breve IA")
 * por um único shopping com:
 *   - busca livre + filtro de categoria (chip horizontal, estado no URL `?cat=`)
 *   - grid dinâmico de cards (ProductCard) consumindo /marketplace/catalog
 *   - modal universal de compra (QuickPurchaseModal) renderizado a partir
 *     do `metadata.configSchema` do produto
 *   - preview de "Minhas Assinaturas" no rodapé com link para a página completa
 *
 * Deep-link: `?suggest=<capability>&autoOpen=1` abre o modal direto no
 * produto que entrega aquela capability. Origem: CapabilityBlockedView CTA
 * (Pacote C.2 do audit 35) — cliente bloqueado clica "Contratar X" e cai
 * exatamente aqui pronto pra fechar.
 *
 * Plano: docs/29-PLAN-MARKETPLACE-UNIFICADO.md Fase 1+2 (Pacote D do audit 35).
 */
import { useState, useMemo, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { AnimatePresence } from 'framer-motion'
import {
  ShoppingBag, Search, Loader2, AlertCircle, HardDrive, Cpu, Timer,
  LayoutGrid, List,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'
import { ProductCard, ProductListItem } from '../components/marketplace/ProductCard'
import { QuickPurchaseModal, type MarketplaceCatalogProduct } from '../components/marketplace/QuickPurchaseModal'

type Category = 'all' | 'STORAGE' | 'AI' | 'TIMELAPSE' | 'ADDON'
type ViewMode = 'grid' | 'list'
const VIEW_MODE_KEY = 'icv_marketplace_view'

interface CatalogResponse {
  products: MarketplaceCatalogProduct[]
}

interface SubscriptionSummary {
  id: string
  productName: string
  productSlug: string
  productCategory: 'STORAGE' | 'TIMELAPSE' | 'AI'
  status: 'ACTIVE' | 'GRACE' | 'CANCELED' | 'SUSPENDED' | 'PENDING' | 'TRIAL'
  cameraCount: number
  monthlyPrice: number
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  GRACE:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  CANCELED:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  PENDING:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  TRIAL:     'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE:    'Ativa',
  GRACE:     'Em graça',
  CANCELED:  'Cancelada',
  SUSPENDED: 'Suspensa',
  PENDING:   'Pendente',
  TRIAL:     'Trial',
}

const CATEGORY_TABS: { value: Category; label: string; icon?: React.ComponentType<{ className?: string }> }[] = [
  { value: 'all',       label: 'Tudo' },
  { value: 'STORAGE',   label: 'Storage',   icon: HardDrive },
  { value: 'AI',        label: 'IA',        icon: Cpu },
  { value: 'TIMELAPSE', label: 'Vídeo',     icon: Timer },
]

const fetcher = (url: string) => api.get(url).then(r => r.data)

export function MarketplacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialCat = (searchParams.get('cat') ?? 'all').toUpperCase() as Category
  const [category, setCategory] = useState<Category>(
    CATEGORY_TABS.some(t => t.value === initialCat) ? initialCat : 'all',
  )
  const [search, setSearch] = useState('')
  const [activeProduct, setActiveProduct] = useState<MarketplaceCatalogProduct | null>(null)
  // Modo de visualização (grid/list). Persiste por usuário em localStorage.
  // Default = 'list' (densidade alta facilita comparar preços lado-a-lado).
  // Usuário pode trocar pra 'grid' e a escolha fica gravada.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'list'
    return (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) === 'grid' ? 'grid' : 'list'
  })
  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode) } catch { /* ignore */ }
  }, [viewMode])

  const catalogUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (category !== 'all') params.set('category', category)
    return `/marketplace/catalog${params.toString() ? `?${params.toString()}` : ''}`
  }, [category])

  const { data: catalog, error: catalogError, isLoading: loadingCatalog, mutate: refreshCatalog } =
    useSWR<CatalogResponse>(catalogUrl, fetcher, { revalidateOnFocus: false })

  const { data: subsData, isLoading: loadingSubs, mutate: refreshSubs } =
    useSWR<{ subscriptions: SubscriptionSummary[]; totalMonthlyBrl: number }>(
      '/marketplace/subscriptions',
      fetcher,
      { revalidateOnFocus: false },
    )

  const filteredProducts = useMemo(() => {
    const arr = catalog?.products ?? []
    if (!search.trim()) return arr
    const q = search.toLowerCase().trim()
    return arr.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.tagline ?? '').toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q),
    )
  }, [catalog, search])

  // Mantém URL sincronizada com category state (sem replaceAll pra preservar outros params).
  useEffect(() => {
    const current = (searchParams.get('cat') ?? 'all').toUpperCase()
    const desired = category.toUpperCase()
    if (current !== desired) {
      const next = new URLSearchParams(searchParams)
      if (category === 'all') next.delete('cat')
      else next.set('cat', category)
      setSearchParams(next, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  // Deep-link: ?suggest=<cap>&autoOpen=1 → abre o modal direto no produto que
  // entrega a capability. Usado pelo CapabilityBlockedView pra fechar venda
  // sem fricção (cliente bloqueado em /faces clica "Contratar Faces" e cai
  // aqui já com o modal aberto).
  useEffect(() => {
    if (searchParams.get('autoOpen') !== '1') return
    if (!catalog?.products?.length) return
    const cap = searchParams.get('suggest')
    if (!cap) return
    const match = catalog.products.find(p =>
      (p.capabilities ?? []).includes(cap),
    )
    if (match && !activeProduct) {
      setActiveProduct(match)
      // Limpa a URL pra não reabrir ao montar de novo
      const next = new URLSearchParams(searchParams)
      next.delete('autoOpen')
      next.delete('suggest')
      setSearchParams(next, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog?.products])

  const subscriptions = subsData?.subscriptions ?? []
  const activeSubs = subscriptions.filter(s => s.status === 'ACTIVE' || s.status === 'GRACE')

  function handleContracted() {
    refreshCatalog()
    refreshSubs()
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <ShoppingBag className="w-7 h-7 text-cyan-500" />
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Marketplace</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 ml-10">
            Contrate, gerencie e expanda seus serviços de segurança — preços já com markup do seu integrador.
          </p>
        </div>

        {/* Filtros */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar produto (ex: gravação, IA, timelapse…)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            />
          </div>

          <div className="flex gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1 overflow-x-auto">
            {CATEGORY_TABS.map(t => {
              const TabIcon = t.icon
              const active = category === t.value
              return (
                <button
                  key={t.value}
                  onClick={() => setCategory(t.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition',
                    active
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white',
                  )}
                >
                  {TabIcon && <TabIcon className="w-3.5 h-3.5" />}
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Grid/Lista de produtos */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Catálogo · {filteredProducts.length} {filteredProducts.length === 1 ? 'produto' : 'produtos'}
            </h2>

            {/* Toggle Grid / Lista */}
            <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5" role="tablist" aria-label="Modo de visualização">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                title="Visualizar em grade"
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition',
                  viewMode === 'grid'
                    ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Grade</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                title="Visualizar em lista"
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition',
                  viewMode === 'list'
                    ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Lista</span>
              </button>
            </div>
          </div>

          {loadingCatalog ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : catalogError ? (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Não foi possível carregar o catálogo.
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-slate-500 dark:text-slate-400 text-sm">
              Nenhum produto encontrado{search ? ` para "${search}"` : ''}.
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.map(p => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onSelect={setActiveProduct}
                  onTrialStarted={() => handleContracted()}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredProducts.map(p => (
                <ProductListItem
                  key={p.id}
                  product={p}
                  onSelect={setActiveProduct}
                  onTrialStarted={() => handleContracted()}
                />
              ))}
            </div>
          )}
        </section>

        {/* Preview de assinaturas ativas */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-slate-400" />
              Minhas Assinaturas
              <span className="text-xs text-slate-500 font-normal">
                · {activeSubs.length} {activeSubs.length === 1 ? 'ativa' : 'ativas'}
              </span>
            </h2>
            <Link
              to="/marketplace/minhas-assinaturas"
              className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline font-semibold"
            >
              Ver todas →
            </Link>
          </div>

          {loadingSubs ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">
              Você ainda não tem assinaturas. Explore os produtos acima.
            </div>
          ) : (
            <div className="space-y-2">
              {subscriptions.slice(0, 4).map(sub => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{sub.productName}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {sub.cameraCount} {sub.cameraCount === 1 ? 'câmera' : 'câmeras'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      R$ {sub.monthlyPrice.toFixed(2).replace('.', ',')}
                      <span className="text-xs text-slate-400 font-normal">/mês</span>
                    </div>
                    <span className={cn(
                      'inline-block mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full',
                      STATUS_STYLES[sub.status] ?? STATUS_STYLES.ACTIVE,
                    )}>
                      ● {STATUS_LABELS[sub.status] ?? sub.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {subsData?.totalMonthlyBrl !== undefined && subscriptions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Total mensal atual</span>
              <span className="font-bold text-slate-900 dark:text-white">
                R$ {subsData.totalMonthlyBrl.toFixed(2).replace('.', ',')}/mês
              </span>
            </div>
          )}
        </section>
      </div>

      {/* Modal universal de compra */}
      <AnimatePresence>
        {activeProduct && (
          <QuickPurchaseModal
            product={activeProduct}
            onClose={() => setActiveProduct(null)}
            onContracted={() => handleContracted()}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
