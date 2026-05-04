/**
 * MaterialsTab — Biblioteca de materiais comerciais (decks, scripts, vídeos).
 */
import { useState } from 'react'
import { FileText, Plus, ExternalLink, Loader2, Mic, Presentation, Video, Mail, BookOpen } from 'lucide-react'
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

export function MaterialsTab() {
  const { data, isLoading, mutate } = useSalesAssets()
  const [showAdd, setShowAdd] = useState(false)

  if (isLoading) return <div className="h-64 rounded-lg bg-white/5 animate-pulse" />

  const assets = data?.assets ?? []
  const byType: Record<string, SalesAsset[]> = {}
  for (const a of assets) {
    if (!byType[a.type]) byType[a.type] = []
    byType[a.type].push(a)
  }

  return (
    <div className="space-y-4">
      <GlassCard className="p-4 border-cyan-500/30 bg-cyan-500/5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <FileText className="w-6 h-6 text-cyan-400" />
            <div>
              <h3 className="text-sm font-bold text-white">Materiais Comerciais</h3>
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
                          <p className="text-sm font-bold text-white truncate">{a.title}</p>
                          {a.description && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{a.description}</p>}
                          {a.funnelStage && <p className="text-[10px] text-cyan-400 mt-1">etapa: {a.funnelStage}</p>}
                        </div>
                        {a.url && (
                          <a href={a.url} target="_blank" rel="noreferrer"
                            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white">
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
    </div>
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
          placeholder="Título *" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-white" />
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
          className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-white">
          {Object.entries(TYPE_CONFIG).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
        </select>
        <input value={form.funnelStage} onChange={e => setForm(f => ({ ...f, funnelStage: e.target.value }))}
          placeholder="Etapa (NEW, CONTACTED, DEMO_SENT...)" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-white" />
        <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
          placeholder="URL (opcional)" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-white" />
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Descrição" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-white h-16 resize-none" />
        <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          placeholder="Conteúdo (script/template)" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-white h-24 resize-none font-mono" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={save} disabled={busy || !form.title}
            className="flex-1 px-3 py-2 rounded bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Criar
          </button>
        </div>
      </div>
    </div>
  )
}
