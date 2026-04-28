/**
 * ModulosAdminPage — SuperAdmin gerencia quais módulos cada Integrador pode usar.
 * Rota: /admin/modulos
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Puzzle, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Users, Building2, Zap, Shield, Search, Save, AlertCircle,
  Smile, Tag, Award, Crosshair, Activity, ShieldCheck, Truck,
  AlignJustify, Users2, Eye, BarChart3,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useModuleCatalog, useAdminIntegradoresModules,
  updateIntegradorModules,
} from '../api/client'
import { mutate } from 'swr'

// Mapa de ícones por nome
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Smile, Tag, Award, Crosshair, Shield, Users, Activity,
  ShieldCheck, Truck, AlignJustify, Users2, Eye, Puzzle, Zap,
}

// Cores dos módulos
const COLOR_MAP: Record<string, string> = {
  cyan:    'bg-cyan-100 border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:border-cyan-500/30 dark:text-cyan-400',
  violet:  'bg-violet-100 border-violet-200 text-violet-700 dark:bg-violet-500/15 dark:border-violet-500/30 dark:text-violet-400',
  emerald: 'bg-emerald-100 border-emerald-200 text-emerald-700 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-400',
  rose:    'bg-rose-100 border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-400',
  amber:   'bg-amber-100 border-amber-200 text-amber-700 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-400',
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  vision_api: { label: 'Cloud Vision API', color: 'text-violet-700 dark:text-violet-400' },
  vertex:     { label: 'Vertex AI Vision', color: 'text-cyan-700 dark:text-cyan-400'   },
  edge:       { label: 'Edge (YOLOv8)',    color: 'text-emerald-700 dark:text-emerald-400' },
}

export function ModulosAdminPage() {
  const { data: catalog = [] }       = useModuleCatalog()
  const { data: integradores = [], mutate: refetch } = useAdminIntegradoresModules()
  const [expanded, setExpanded]      = useState<string | null>(null)
  const [saving, setSaving]          = useState<string | null>(null)
  const [dirty, setDirty]            = useState<Record<string, Record<string, boolean>>>({})
  const [search, setSearch]          = useState('')
  const [feedback, setFeedback]      = useState<Record<string, { ok: boolean; msg: string }>>({})

  const filtered = (integradores as any[]).filter((i: any) =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.email.toLowerCase().includes(search.toLowerCase())
  )

  function getEnabled(integradorId: string, moduleId: string): boolean {
    // dirty state tem prioridade
    if (dirty[integradorId]?.[moduleId] !== undefined) return dirty[integradorId][moduleId]
    const integ = (integradores as any[]).find((i: any) => i.id === integradorId)
    return integ?.enabledModules?.includes(moduleId) ?? false
  }

  function toggle(integradorId: string, moduleId: string) {
    const current = getEnabled(integradorId, moduleId)
    setDirty(prev => ({
      ...prev,
      [integradorId]: { ...prev[integradorId], [moduleId]: !current },
    }))
  }

  function isDirty(integradorId: string): boolean {
    return Object.keys(dirty[integradorId] ?? {}).length > 0
  }

  async function saveIntegrador(integradorId: string) {
    setSaving(integradorId)
    try {
      const modules = catalog.map((m: any) => ({
        module:  m.id,
        enabled: getEnabled(integradorId, m.id),
      }))
      await updateIntegradorModules(integradorId, modules)
      setDirty(prev => { const n = { ...prev }; delete n[integradorId]; return n })
      setFeedback(prev => ({ ...prev, [integradorId]: { ok: true, msg: 'Salvo com sucesso' } }))
      refetch()
      setTimeout(() => setFeedback(prev => { const n = { ...prev }; delete n[integradorId]; return n }), 3000)
    } catch (err: any) {
      setFeedback(prev => ({ ...prev, [integradorId]: { ok: false, msg: err?.response?.data?.message ?? 'Erro ao salvar' } }))
    } finally {
      setSaving(null)
    }
  }

  function selectAll(integradorId: string) {
    const all: Record<string, boolean> = {}
    catalog.forEach((m: any) => { all[m.id] = true })
    setDirty(prev => ({ ...prev, [integradorId]: all }))
  }

  function deselectAll(integradorId: string) {
    const all: Record<string, boolean> = {}
    catalog.forEach((m: any) => { all[m.id] = false })
    setDirty(prev => ({ ...prev, [integradorId]: all }))
  }

  const groupedModules = catalog.reduce((acc: any, m: any) => {
    if (!acc[m.category]) acc[m.category] = []
    acc[m.category].push(m)
    return acc
  }, {} as Record<string, any[]>)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-cyan-700 dark:text-cyan-400" />
            Gestão de Módulos — Integradores
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">
            Defina quais funcionalidades de IA cada integrador pode oferecer aos seus clientes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/modulos/utilization"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-100 border border-violet-200 text-violet-700 hover:bg-violet-200 hover:text-violet-800 dark:bg-violet-500/10 dark:border-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/20 dark:hover:text-violet-200 text-sm font-medium transition"
            title="Cruzamento Contratado × Utilizado por integrador"
          >
            <BarChart3 className="w-4 h-4" />
            Contratado × Utilizado
          </Link>
          <div className="flex items-center gap-2 bg-cyan-100 border border-cyan-200 dark:bg-cyan-500/10 dark:border-cyan-500/20 rounded-xl px-3 py-2">
            <Building2 className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
            <span className="text-sm text-cyan-700 dark:text-cyan-300 font-medium">{(integradores as any[]).length} integradores</span>
          </div>
        </div>
      </div>

      {/* Legenda de categorias */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-xs">
            <span className={`font-semibold ${v.color}`}>{v.label}</span>
          </div>
        ))}
      </div>

      {/* Busca */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar integrador..."
          className="w-full bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-600 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-cyan-500/40"
        />
      </div>

      {/* Lista de Integradores */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-500 dark:text-slate-600 text-sm">Nenhum integrador encontrado</div>
        )}
        {filtered.map((integ: any) => {
          const isExpanded = expanded === integ.id
          const hasDirty   = isDirty(integ.id)
          const enabledCount = catalog.filter((m: any) => getEnabled(integ.id, m.id)).length

          return (
            <GlassCard key={integ.id} className="overflow-hidden">
              {/* Header da linha */}
              <button
                className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-100 dark:hover:bg-white/2 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : integ.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-slate-200 dark:border-white/10 flex items-center justify-center text-sm font-bold text-slate-900 dark:text-white">
                    {integ.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{integ.name}</p>
                    <p className="text-xs text-slate-500">{integ.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Feedback */}
                  {feedback[integ.id] && (
                    <motion.span
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className={`text-xs flex items-center gap-1 ${feedback[integ.id].ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}
                    >
                      {feedback[integ.id].ok
                        ? <CheckCircle2 className="w-3.5 h-3.5" />
                        : <AlertCircle className="w-3.5 h-3.5" />
                      }
                      {feedback[integ.id].msg}
                    </motion.span>
                  )}

                  {/* Badge de módulos ativos */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-xs">
                    <span className="text-cyan-700 dark:text-cyan-400 font-bold">{enabledCount}</span>
                    <span className="text-slate-500">/ {catalog.length} módulos</span>
                  </div>

                  {/* Clientes */}
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <Users className="w-3.5 h-3.5" />
                    {integ._count?.clienteFinais ?? 0}
                  </div>

                  {/* Dirty indicator */}
                  {hasDirty && (
                    <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />
                  )}

                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-slate-500" />
                    : <ChevronRight className="w-4 h-4 text-slate-500" />
                  }
                </div>
              </button>

              {/* Módulos expandidos */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 border-t border-slate-200 dark:border-white/5 pt-4 space-y-4">
                      {/* Ações rápidas */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => selectAll(integ.id)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-cyan-100 text-cyan-700 hover:bg-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:hover:bg-cyan-500/20 transition-colors border border-cyan-200 dark:border-cyan-500/20"
                        >
                          Selecionar todos
                        </button>
                        <button
                          onClick={() => deselectAll(integ.id)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 transition-colors border border-slate-200 dark:border-white/10"
                        >
                          Desmarcar todos
                        </button>
                        <div className="flex-1" />
                        {hasDirty && (
                          <motion.button
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            onClick={() => saveIntegrador(integ.id)}
                            disabled={saving === integ.id}
                            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white font-semibold transition-colors disabled:opacity-60"
                          >
                            {saving === integ.id ? (
                              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            Salvar alterações
                          </motion.button>
                        )}
                      </div>

                      {/* Grid de módulos por categoria */}
                      {Object.entries(groupedModules).map(([cat, mods]) => (
                        <div key={cat}>
                          <p className={`text-[10px] font-semibold uppercase tracking-widest mb-2 ${CATEGORY_LABELS[cat]?.color ?? 'text-slate-500'}`}>
                            {CATEGORY_LABELS[cat]?.label ?? cat}
                          </p>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                            {(mods as any[]).map((mod: any) => {
                              const enabled = getEnabled(integ.id, mod.id)
                              const IconComp = ICON_MAP[mod.icon] ?? Puzzle
                              const colorClass = COLOR_MAP[mod.color] ?? COLOR_MAP.cyan

                              return (
                                <motion.button
                                  key={mod.id}
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.97 }}
                                  onClick={() => toggle(integ.id, mod.id)}
                                  className={`
                                    relative flex items-start gap-2.5 p-3 rounded-xl border text-left
                                    transition-all duration-200 group
                                    ${enabled
                                      ? colorClass
                                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300 dark:bg-white/3 dark:border-white/8 dark:text-slate-600 dark:hover:border-white/15'
                                    }
                                  `}
                                >
                                  <IconComp className={`w-4 h-4 shrink-0 mt-0.5 ${enabled ? '' : 'opacity-40'}`} />
                                  <div className="min-w-0">
                                    <p className={`text-xs font-semibold leading-tight ${enabled ? '' : 'opacity-50'}`}>
                                      {mod.name}
                                    </p>
                                    <p className="text-[9px] mt-0.5 opacity-60 font-mono">{mod.gcpCost}</p>
                                  </div>
                                  {enabled
                                    ? <CheckCircle2 className="w-3.5 h-3.5 absolute top-2 right-2 shrink-0" />
                                    : <XCircle className="w-3.5 h-3.5 absolute top-2 right-2 shrink-0 opacity-30" />
                                  }
                                </motion.button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          )
        })}
      </div>
    </div>
  )
}
