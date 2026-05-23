/**
 * ProductCard — card uniforme pra qualquer produto do marketplace.
 *
 * Usado no grid de `MarketplacePage`. Mostra:
 *  - ícone + categoria + nome + tagline
 *  - badges contextuais (NOVO / BETA / EM BREVE / CONTRATADO)
 *  - preço "a partir de" (com markup do integrador já embutido)
 *  - CTA contextual (Configurar / Gerenciar / Avise-me / Solicitar acesso)
 *
 * Plano: docs/29 mockup 1
 */
import { useState } from 'react'
import { HardDrive, Cpu, Timer, ShoppingBag, ArrowRight, Mail, ChevronRight, Sparkles, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { api } from '../../api/client'
import { useUiToast } from '../Toast'
import type { MarketplaceCatalogProduct } from './QuickPurchaseModal'

interface Props {
  product: MarketplaceCatalogProduct
  onSelect: (p: MarketplaceCatalogProduct) => void
  onTrialStarted?: () => void
}

const CATEGORY_META: Record<string, { icon: React.ComponentType<{ className?: string }>; gradient: string; label: string; color: string }> = {
  STORAGE:   { icon: HardDrive,   gradient: 'from-cyan-500 to-blue-500',     label: 'Storage', color: 'text-cyan-600 dark:text-cyan-400' },
  AI:        { icon: Cpu,         gradient: 'from-violet-500 to-pink-500',   label: 'IA',      color: 'text-violet-600 dark:text-violet-400' },
  TIMELAPSE: { icon: Timer,       gradient: 'from-pink-500 to-orange-500',   label: 'Vídeo',   color: 'text-pink-600 dark:text-pink-400' },
  ADDON:     { icon: ShoppingBag, gradient: 'from-slate-500 to-slate-700',   label: 'Add-on',  color: 'text-slate-600 dark:text-slate-400' },
}

export function ProductCard({ product, onSelect, onTrialStarted }: Props) {
  const meta = CATEGORY_META[product.category] ?? CATEGORY_META.ADDON
  const Icon = meta.icon
  const isContracted = product.subscribed === true
  const isComingSoon = product.comingSoon === true
  const canSelfTrial = !!product.allowSelfTrial && !isContracted && !isComingSoon
  const toast = useUiToast()
  const [trialBusy, setTrialBusy] = useState(false)

  async function startTrial(e: React.MouseEvent) {
    e.stopPropagation()
    if (trialBusy) return
    setTrialBusy(true)
    try {
      await api.post(`/me/cliente/start-trial/${product.id}`)
      toast.success(`Trial de ${product.trialDays ?? 14} dias iniciado!`)
      onTrialStarted?.()
    } catch (err: any) {
      const code = err?.response?.data?.error
      if (code === 'already_has_subscription') {
        toast.error('Você já tem assinatura ativa deste produto.')
      } else if (code === 'self_trial_not_allowed') {
        toast.error('Trial self-service desabilitado pelo fabricante.')
      } else {
        toast.error(code ?? err?.message ?? 'Falha ao iniciar trial.')
      }
    } finally { setTrialBusy(false) }
  }

  return (
    <div
      onClick={() => !isComingSoon && onSelect(product)}
      className={cn(
        'group relative rounded-2xl border bg-white dark:bg-slate-900 p-5 transition-all',
        isComingSoon
          ? 'opacity-60 cursor-not-allowed border-slate-200 dark:border-slate-800'
          : 'cursor-pointer border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 hover:shadow-lg dark:hover:shadow-cyan-500/10',
        isContracted && 'ring-1 ring-emerald-500/40 border-emerald-500/30',
      )}
    >
      {/* Badge contextual */}
      <div className="absolute top-3 right-3">
        {isContracted ? (
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] font-bold border border-emerald-200 dark:border-emerald-800">
            ● CONTRATADO
          </span>
        ) : isComingSoon ? (
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-bold border border-slate-200 dark:border-slate-700">
            ⏳ EM BREVE
          </span>
        ) : null}
      </div>

      <div className={cn('w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white mb-3', meta.gradient)}>
        <Icon className="w-5 h-5" />
      </div>

      <div className={cn('text-[10px] uppercase tracking-wider font-bold mb-1', meta.color)}>
        {meta.label}
      </div>

      <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{product.name}</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed line-clamp-3">
        {product.tagline ?? product.description ?? ''}
      </p>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] text-slate-500 dark:text-slate-500">
            {isContracted ? 'você paga' : 'a partir de'}
          </div>
          <div className={cn('text-lg font-bold', meta.color)}>
            R$ {(product.fromPriceBrl ?? product.finalPriceBrl).toFixed(0)}
            <span className="text-xs text-slate-400 font-normal">
              {product.pricingModel === 'FLAT_MONTH' ? '/mês' : '/câm/mês'}
            </span>
          </div>
        </div>

        {isComingSoon ? (
          <button
            disabled
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-bold cursor-not-allowed"
          >
            <Mail className="w-3 h-3" />
            Avise-me
          </button>
        ) : isContracted ? (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(product) }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 dark:bg-white/10 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Gerenciar
            <ChevronRight className="w-3 h-3" />
          </button>
        ) : (
          <div className="flex flex-col items-end gap-1.5">
            <button
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-xs font-bold bg-gradient-to-r transition group-hover:opacity-90',
                meta.gradient,
              )}
            >
              Configurar
              <ArrowRight className="w-3 h-3" />
            </button>
            {canSelfTrial && (
              <button
                onClick={startTrial}
                disabled={trialBusy}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 text-[11px] font-semibold hover:bg-cyan-500/10 disabled:opacity-50 transition"
              >
                {trialBusy
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Sparkles className="w-3 h-3" />}
                Trial de {product.trialDays ?? 14}d
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * ProductListItem — variante compacta horizontal do ProductCard.
 *
 * Mesma informação essencial (ícone, categoria, nome, tagline, preço, CTA, badges)
 * num layout de linha — ideal pra densidade alta quando o catálogo cresce.
 * Comparação lado-a-lado fica mais fácil que no grid.
 */
export function ProductListItem({ product, onSelect, onTrialStarted }: Props) {
  const meta = CATEGORY_META[product.category] ?? CATEGORY_META.ADDON
  const Icon = meta.icon
  const isContracted = product.subscribed === true
  const isComingSoon = product.comingSoon === true
  const canSelfTrial = !!product.allowSelfTrial && !isContracted && !isComingSoon
  const toast = useUiToast()
  const [trialBusy, setTrialBusy] = useState(false)

  async function startTrial(e: React.MouseEvent) {
    e.stopPropagation()
    if (trialBusy) return
    setTrialBusy(true)
    try {
      await api.post(`/me/cliente/start-trial/${product.id}`)
      toast.success(`Trial de ${product.trialDays ?? 14} dias iniciado!`)
      onTrialStarted?.()
    } catch (err: any) {
      const code = err?.response?.data?.error
      if (code === 'already_has_subscription') {
        toast.error('Você já tem assinatura ativa deste produto.')
      } else if (code === 'self_trial_not_allowed') {
        toast.error('Trial self-service desabilitado pelo fabricante.')
      } else {
        toast.error(code ?? err?.message ?? 'Falha ao iniciar trial.')
      }
    } finally { setTrialBusy(false) }
  }

  return (
    <div
      onClick={() => !isComingSoon && onSelect(product)}
      className={cn(
        'group relative flex items-center gap-4 rounded-xl border bg-white dark:bg-slate-900 px-4 py-3 transition-all',
        isComingSoon
          ? 'opacity-60 cursor-not-allowed border-slate-200 dark:border-slate-800'
          : 'cursor-pointer border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 hover:shadow-md dark:hover:shadow-cyan-500/10',
        isContracted && 'ring-1 ring-emerald-500/40 border-emerald-500/30',
      )}
    >
      {/* Ícone */}
      <div className={cn('shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-white', meta.gradient)}>
        <Icon className="w-5 h-5" />
      </div>

      {/* Categoria + nome + tagline */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-[9px] uppercase tracking-wider font-bold', meta.color)}>
            {meta.label}
          </span>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{product.name}</h3>
          {isContracted && (
            <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[9px] font-bold border border-emerald-200 dark:border-emerald-800">
              ● CONTRATADO
            </span>
          )}
          {isComingSoon && (
            <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[9px] font-bold border border-slate-200 dark:border-slate-700">
              ⏳ EM BREVE
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
          {product.tagline ?? product.description ?? ''}
        </p>
      </div>

      {/* Preço */}
      <div className="shrink-0 text-right hidden sm:block">
        <div className="text-[9px] text-slate-500 dark:text-slate-500 uppercase">
          {isContracted ? 'você paga' : 'a partir de'}
        </div>
        <div className={cn('text-base font-bold leading-tight', meta.color)}>
          R$ {(product.fromPriceBrl ?? product.finalPriceBrl).toFixed(0)}
          <span className="text-[10px] text-slate-400 font-normal">
            {product.pricingModel === 'FLAT_MONTH' ? '/mês' : '/câm/mês'}
          </span>
        </div>
      </div>

      {/* CTA */}
      <div className="shrink-0 flex items-center gap-1.5">
        {canSelfTrial && (
          <button
            onClick={startTrial}
            disabled={trialBusy}
            className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 text-[11px] font-semibold hover:bg-cyan-500/10 disabled:opacity-50 transition"
            title={`Iniciar trial de ${product.trialDays ?? 14} dias`}
          >
            {trialBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Trial {product.trialDays ?? 14}d
          </button>
        )}
        {isComingSoon ? (
          <button
            disabled
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-bold cursor-not-allowed"
          >
            <Mail className="w-3 h-3" />
            <span className="hidden sm:inline">Avise-me</span>
          </button>
        ) : isContracted ? (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(product) }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 dark:bg-white/10 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Gerenciar
            <ChevronRight className="w-3 h-3" />
          </button>
        ) : (
          <button
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-xs font-bold bg-gradient-to-r transition group-hover:opacity-90',
              meta.gradient,
            )}
          >
            Configurar
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}
