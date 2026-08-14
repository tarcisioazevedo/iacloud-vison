/**
 * CatalogoTab — produtos do marketplace + markup do integrador.
 * Padrão visual alinhado ao IntegradorCockpit / FabricanteMarketplace.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { Loader2, Check, Package, Pencil, X, TrendingUp } from 'lucide-react'
import { api } from '../../api/client'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface Product {
  id: string; slug: string; name: string; category: string
  basePriceUsd: number; basePriceBrl: number
  markupPct: number; isCustomMarkup: boolean
  finalPriceBrl: number
  enabled: boolean; enabledAt: string | null
}

interface CatalogoResp {
  defaultMarkupPct: number
  products: Product[]
}

function brl(n: number) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

const CATEGORY_META: Record<string, { label: string; emoji: string; color: 'cyan' | 'emerald' | 'amber' | 'violet' }> = {
  STORAGE:   { label: 'Storage',   emoji: '🗄️', color: 'cyan' },
  TIMELAPSE: { label: 'Timelapse', emoji: '🎞', color: 'violet' },
  AI:        { label: 'IA',        emoji: '🤖', color: 'emerald' },
  ADDON:     { label: 'Add-ons',   emoji: '➕', color: 'amber' },
}

export function CatalogoTab() {
  const { data, isLoading, mutate } = useSWR<CatalogoResp>('/me/integrador/billing/catalogo', fetcher)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftMarkup, setDraftMarkup] = useState<string>('')
  const [saving, setSaving] = useState(false)

  async function toggle(p: Product) {
    setSaving(true)
    try {
      await api.put(`/me/integrador/billing/catalogo/${p.id}`, { enabled: !p.enabled, markupPct: p.markupPct })
      mutate()
    } catch (e: any) { alert(e?.response?.data?.message ?? e?.message) }
    finally { setSaving(false) }
  }

  async function saveMarkup(p: Product) {
    const val = Number(draftMarkup)
    if (Number.isNaN(val) || val < 0 || val > 500) { alert('Markup deve ser entre 0 e 500%'); return }
    setSaving(true)
    try {
      await api.put(`/me/integrador/billing/catalogo/${p.id}`, { enabled: p.enabled, markupPct: val })
      setEditing(null); setDraftMarkup(''); mutate()
    } catch (e: any) { alert(e?.response?.data?.message ?? e?.message) }
    finally { setSaving(false) }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-600 dark:text-cyan-400" />
        <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Carregando catálogo…</span>
      </div>
    )
  }

  if (!data) return null

  const grouped = data.products.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {} as Record<string, Product[]>)
  const enabledCount = data.products.filter(p => p.enabled).length

  return (
    <div className="space-y-4">
      {/* Header KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <GlassCard className="p-5 border-emerald-300 dark:border-emerald-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-bold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
              <Package className="w-3.5 h-3.5" /> Produtos habilitados
            </span>
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{enabledCount}<span className="text-base text-slate-500 font-normal"> / {data.products.length}</span></div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">disponíveis aos seus clientes</div>
        </GlassCard>
        <GlassCard className="p-5 border-cyan-300 dark:border-cyan-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-bold flex items-center gap-1.5 text-cyan-700 dark:text-cyan-300">
              <TrendingUp className="w-3.5 h-3.5" /> Markup padrão
            </span>
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{data.defaultMarkupPct}%</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">aplicado quando você não customizar</div>
        </GlassCard>
        <GlassCard className="p-5 border-violet-300 dark:border-violet-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-bold flex items-center gap-1.5 text-violet-700 dark:text-violet-300">
              <Pencil className="w-3.5 h-3.5" /> Markup customizado
            </span>
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{data.products.filter(p => p.isCustomMarkup).length}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">produtos com markup individual</div>
        </GlassCard>
      </div>

      {/* Categorias */}
      {Object.entries(grouped).map(([cat, items]) => {
        const meta = CATEGORY_META[cat] ?? { label: cat, emoji: '📦', color: 'cyan' as const }
        const colorCls = {
          cyan:    'text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/20',
          emerald: 'text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/20',
          violet:  'text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/20',
          amber:   'text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/20',
        }[meta.color]
        return (
          <GlassCard key={cat} className={cn('p-5', colorCls.split(' ').filter(c => c.includes('border')).join(' '))}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">{meta.emoji}</span>
              <h3 className={cn('text-xs uppercase tracking-wider font-bold', colorCls.split(' ').filter(c => c.includes('text')).join(' '))}>
                {meta.label}
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">· {items.length} produto{items.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map(p => (
                <div key={p.id} className={cn('rounded-lg border p-4 transition',
                  p.enabled
                    ? 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5'
                    : 'border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/30 opacity-75',
                )}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{p.name}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{p.slug}</p>
                    </div>
                    <button onClick={() => toggle(p)} disabled={saving}
                      className={cn('text-xs px-2.5 py-1 rounded font-bold flex items-center gap-1 shrink-0 disabled:opacity-50 transition shadow-sm',
                        p.enabled
                          ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600',
                      )}>
                      {p.enabled ? <><Check className="w-3 h-3" /> ON</> : 'OFF'}
                    </button>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <Row label="Atacado USD" value={`$${p.basePriceUsd.toFixed(4)}`} mono />
                    <Row label="Atacado BRL" value={`R$ ${brl(p.basePriceBrl)}`} mono />
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-slate-500 dark:text-slate-400">Markup</span>
                      {editing === p.id ? (
                        <div className="flex items-center gap-1">
                          <input type="number" autoFocus value={draftMarkup}
                            onChange={e => setDraftMarkup(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveMarkup(p); if (e.key === 'Escape') { setEditing(null); setDraftMarkup('') } }}
                            className="w-16 px-2 py-0.5 text-xs rounded border border-cyan-400 dark:border-cyan-500/50 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-cyan-500" />
                          <span className="text-[10px] text-slate-500">%</span>
                          <button onClick={() => saveMarkup(p)} disabled={saving}
                            className="px-2 py-0.5 text-[10px] bg-gradient-to-r from-emerald-500 to-cyan-500 text-white rounded font-bold disabled:opacity-50">OK</button>
                          <button onClick={() => { setEditing(null); setDraftMarkup('') }}
                            className="px-1 py-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditing(p.id); setDraftMarkup(String(p.markupPct)) }}
                          className={cn('font-bold hover:underline inline-flex items-center gap-1',
                            p.isCustomMarkup ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300',
                          )}>
                          {p.markupPct}%{p.isCustomMarkup && <Pencil className="w-2.5 h-2.5" />}
                        </button>
                      )}
                    </div>
                    <div className="flex justify-between items-center pt-2 mt-1 border-t border-slate-200 dark:border-white/10">
                      <span className="text-slate-700 dark:text-slate-300 font-semibold text-xs uppercase tracking-wider">Venda</span>
                      <span className="font-bold text-base text-emerald-700 dark:text-emerald-400 font-mono">R$ {brl(p.finalPriceBrl)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        )
      })}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={cn(mono && 'font-mono', 'text-slate-700 dark:text-slate-300')}>{value}</span>
    </div>
  )
}
