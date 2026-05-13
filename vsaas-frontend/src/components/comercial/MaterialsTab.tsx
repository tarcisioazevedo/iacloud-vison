/**
 * MaterialsTab — Biblioteca de materiais comerciais + Pricing como sub-tab.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText, Plus, ExternalLink, Loader2, Mic, Presentation, Video, Mail, BookOpen,
  DollarSign, CheckCircle,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { useSalesAssets, createSalesAsset, formatApiError, type SalesAsset } from '../../api/client'
import { cn } from '../../lib/utils'

const TYPE_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  SCRIPT:     { color: 'cyan',    icon: Mic,         label: 'Script' },
  DECK:       { color: 'violet',  icon: Presentation, label: 'Apresentação' },
  VIDEO:      { color: 'rose',    icon: Video,        label: 'Vídeo' },
  PDF:        { color: 'amber',   icon: FileText,    label: 'PDF' },
  TEMPLATE:   { color: 'emerald', icon: Mail,        label: 'Template' },
  CASE_STUDY: { color: 'cyan',    icon: BookOpen,    label: 'Case Study' },
}

type SubTab = 'biblioteca' | 'pricing'

export function MaterialsTab() {
  const { data, isLoading, mutate } = useSalesAssets()
  const [showAdd, setShowAdd] = useState(false)
  const [sub, setSub] = useState<SubTab>('biblioteca')

  if (isLoading) return <div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />

  const assets = data?.assets ?? []
  const byType: Record<string, SalesAsset[]> = {}
  for (const a of assets) {
    if (!byType[a.type]) byType[a.type] = []
    byType[a.type].push(a)
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs Biblioteca | Pricing */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-white/10">
        <button onClick={() => setSub('biblioteca')}
          className={cn('flex items-center gap-2 px-4 py-2 -mb-px border-b-2 transition text-sm',
            sub === 'biblioteca'
              ? 'border-cyan-500 text-cyan-300'
              : 'border-transparent text-slate-500 hover:text-slate-600 dark:text-slate-300')}>
          <FileText className="w-3.5 h-3.5" /> Biblioteca
        </button>
        <button onClick={() => setSub('pricing')}
          className={cn('flex items-center gap-2 px-4 py-2 -mb-px border-b-2 transition text-sm',
            sub === 'pricing'
              ? 'border-amber-500 text-amber-300'
              : 'border-transparent text-slate-500 hover:text-slate-600 dark:text-slate-300')}>
          <DollarSign className="w-3.5 h-3.5" /> Pricing
        </button>
      </div>

      {sub === 'pricing' ? <PricingSection /> : <>
      <GlassCard className="p-4 border-cyan-500/30 bg-cyan-500/5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <FileText className="w-6 h-6 text-cyan-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Materiais Comerciais</h3>
              <p className="text-xs text-slate-400 mt-1">Scripts de call, apresentações, vídeos demo, templates de email/WhatsApp, case studies.</p>
            </div>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Novo material
          </button>
        </div>
      </GlassCard>

      {assets.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-400">Nenhum material cadastrado.</p>
          <p className="text-xs text-slate-500 mt-1">Equipe comercial usa scripts e decks para padronizar e agilizar abordagens.</p>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
            const items = byType[type] ?? []
            if (items.length === 0) return null
            const Icon = cfg.icon
            return (
              <div key={type}>
                <h4 className={cn('text-xs uppercase font-bold mb-2 flex items-center gap-2', `text-${cfg.color}-300`)}>
                  <Icon className="w-3.5 h-3.5" /> {cfg.label}s ({items.length})
                </h4>
                <div className="grid gap-2 md:grid-cols-2">
                  {items.map(a => (
                    <GlassCard key={a.id} className="p-3 hover:bg-white/[0.02] transition">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{a.title}</p>
                          {a.description && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{a.description}</p>}
                          {a.funnelStage && <p className="text-[10px] text-cyan-400 mt-1">etapa: {a.funnelStage}</p>}
                        </div>
                        {a.url && (
                          <a href={a.url} target="_blank" rel="noreferrer"
                            className="p-1.5 rounded hover:bg-slate-100 dark:bg-white/10 text-slate-400 hover:text-slate-900 dark:text-white">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </GlassCard>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddAssetModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); mutate() }} />}
      </>}
    </div>
  )
}

// Pricing como sub-tab interna (consolida tab antiga "Pricing")
function PricingSection() {
  return (
    <div className="space-y-4">
      <GlassCard className="p-4 border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <DollarSign className="w-5 h-5 text-amber-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Tabela de Preços</h3>
            <p className="text-xs text-slate-400 mt-1">Vitrine para apresentações comerciais. Edição de preços por módulo em <Link to="/admin/catalog" className="text-amber-300 hover:underline">Catálogo</Link>.</p>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-4 md:grid-cols-3">
        <PricingCard tier="STARTER" price="R$ 99" perMonth perCamera color="violet"
          features={['Gravação 7 dias', 'Live multi-câmera', '1 site', 'Email support']} />
        <PricingCard tier="PROFESSIONAL" price="R$ 199" perMonth perCamera color="cyan" highlighted
          features={['Tudo do Starter', 'Faces + Placas', 'Heatmap', 'Smart City', 'WhatsApp alerts', '5 sites']} />
        <PricingCard tier="ENTERPRISE" price="Sob consulta" color="emerald"
          features={['Tudo do PRO', 'White-label completo', 'Edge boxes ilimitadas', 'SLA dedicado', 'Federation']} />
      </div>

      <Link to="/pricing" target="_blank"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-sm font-bold">
        <ExternalLink className="w-4 h-4" /> Ver página pública /pricing
      </Link>
    </div>
  )
}

function PricingCard({ tier, price, perMonth, perCamera, color, features, highlighted }: {
  tier: string; price: string; perMonth?: boolean; perCamera?: boolean; color: string
  features: string[]; highlighted?: boolean
}) {
  return (
    <GlassCard className={cn('p-5', highlighted && `border-${color}-500/50 shadow-lg`)}>
      <p className={`text-[10px] uppercase tracking-wider font-bold text-${color}-300`}>{tier}</p>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-900 dark:text-white">{price}</span>
        {perMonth && <span className="text-xs text-slate-500">/mês</span>}
        {perCamera && <span className="text-xs text-slate-500">por câmera</span>}
      </div>
      <ul className="mt-4 space-y-1.5">
        {features.map(f => (
          <li key={f} className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
            <CheckCircle className={`w-3.5 h-3.5 text-${color}-400 shrink-0 mt-0.5`} />
            {f}
          </li>
        ))}
      </ul>
    </GlassCard>
  )
}

function AddAssetModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: '', type: 'SCRIPT', funnelStage: '', url: '', description: '', body: '' })
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try { await createSalesAsset(form); onSaved() }
    catch (e) { alert(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-white dark:bg-space-900 border border-cyan-500/30 rounded-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Novo material comercial</h3>
        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Título *" className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white" />
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
          className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
          {Object.entries(TYPE_CONFIG).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
        </select>
        <input value={form.funnelStage} onChange={e => setForm(f => ({ ...f, funnelStage: e.target.value }))}
          placeholder="Etapa (NEW, CONTACTED, DEMO_SENT...)" className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white" />
        <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
          placeholder="URL (opcional)" className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white" />
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Descrição" className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white h-16 resize-none" />
        <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          placeholder="Conteúdo (script/template)" className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white h-24 resize-none font-mono" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={save} disabled={busy || !form.title}
            className="flex-1 px-3 py-2 rounded bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Criar
          </button>
        </div>
      </div>
    </div>
  )
}
