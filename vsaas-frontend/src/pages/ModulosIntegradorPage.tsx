/**
 * ModulosIntegradorPage — Integrador gerencia quais módulos cada Cliente Final pode usar.
 * Só pode conceder módulos que o próprio integrador possui.
 * Rota: /modulos
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Puzzle, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Users, MapPin, Save, AlertCircle, Search, Info, Lock,
  Smile, Tag, Award, Crosshair, Shield, Activity, ShieldCheck,
  Truck, AlignJustify, Users2, Eye,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useModuleCatalog, useMyModules, useClientesModules,
  updateClienteFinalModules,
} from '../api/client'

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Smile, Tag, Award, Crosshair, Shield, Users, Activity,
  ShieldCheck, Truck, AlignJustify, Users2, Eye, Puzzle,
}

const COLOR_MAP: Record<string, string> = {
  cyan:    'bg-cyan-100 border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:border-cyan-500/30 dark:text-cyan-400',
  violet:  'bg-violet-100 border-violet-200 text-violet-700 dark:bg-violet-500/15 dark:border-violet-500/30 dark:text-violet-400',
  emerald: 'bg-emerald-100 border-emerald-200 text-emerald-700 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-400',
  rose:    'bg-rose-100 border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-400',
  amber:   'bg-amber-100 border-amber-200 text-amber-700 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-400',
}

const VERTICAL_LABELS: Record<string, string> = {
  RETAIL: '🛍️ Varejo', SHOPPING_MALL: '🏬 Shopping', CONDOMINIUM: '🏘️ Condomínio',
  INDUSTRIAL: '🏭 Indústria', OFFICE: '🏢 Escritório', SCHOOL: '🏫 Escola',
  HEALTHCARE: '🏥 Saúde', HOSPITALITY: '🏨 Hotelaria', LOGISTICS: '📦 Logística',
  PARKING: '🅿️ Estacionamento', BANK: '🏦 Banco', OTHER: '🏢 Outro',
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  vision_api: { label: 'Cloud Vision API', color: 'text-violet-700 dark:text-violet-400' },
  vertex:     { label: 'Vertex AI Vision', color: 'text-cyan-700 dark:text-cyan-400'   },
  edge:       { label: 'Edge (YOLOv8)',    color: 'text-emerald-700 dark:text-emerald-400' },
}

export function ModulosIntegradorPage() {
  const { data: catalog = [] }         = useModuleCatalog()
  const { data: myModulesData }        = useMyModules()
  const { data: clientesData, mutate: refetch } = useClientesModules()

  const [expanded, setExpanded]  = useState<string | null>(null)
  const [saving, setSaving]      = useState<string | null>(null)
  const [dirty, setDirty]        = useState<Record<string, Record<string, boolean>>>({})
  const [search, setSearch]      = useState('')
  const [feedback, setFeedback]  = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [hoveredModule, setHoveredModule] = useState<string | null>(null)

  const myModuleIds: string[] = myModulesData?.modules?.map((m: any) => m.module) ?? []
  const clientes: any[]       = clientesData?.clientes ?? []
  const availableModules: string[] = clientesData?.availableModules ?? myModuleIds

  const filtered = clientes.filter((c: any) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  )

  function getEnabled(clienteId: string, moduleId: string): boolean {
    if (dirty[clienteId]?.[moduleId] !== undefined) return dirty[clienteId][moduleId]
    const cli = clientes.find(c => c.id === clienteId)
    return cli?.enabledModules?.includes(moduleId) ?? false
  }

  function toggle(clienteId: string, moduleId: string) {
    // Só pode ativar módulos que o integrador possui
    if (!availableModules.includes(moduleId)) return
    const current = getEnabled(clienteId, moduleId)
    setDirty(prev => ({
      ...prev,
      [clienteId]: { ...prev[clienteId], [moduleId]: !current },
    }))
  }

  function isDirty(clienteId: string) {
    return Object.keys(dirty[clienteId] ?? {}).length > 0
  }

  async function saveCliente(clienteId: string) {
    setSaving(clienteId)
    try {
      const modules = catalog
        .filter((m: any) => availableModules.includes(m.id))
        .map((m: any) => ({ module: m.id, enabled: getEnabled(clienteId, m.id) }))
      await updateClienteFinalModules(clienteId, modules)
      setDirty(prev => { const n = { ...prev }; delete n[clienteId]; return n })
      setFeedback(prev => ({ ...prev, [clienteId]: { ok: true, msg: 'Salvo' } }))
      refetch()
      setTimeout(() => setFeedback(prev => { const n = { ...prev }; delete n[clienteId]; return n }), 3000)
    } catch (err: any) {
      setFeedback(prev => ({ ...prev, [clienteId]: { ok: false, msg: err?.response?.data?.message ?? 'Erro' } }))
    } finally {
      setSaving(null)
    }
  }

  function selectAll(clienteId: string) {
    const all: Record<string, boolean> = {}
    availableModules.forEach(m => { all[m] = true })
    setDirty(prev => ({ ...prev, [clienteId]: all }))
  }

  function deselectAll(clienteId: string) {
    const all: Record<string, boolean> = {}
    catalog.forEach((m: any) => { all[m.id] = false })
    setDirty(prev => ({ ...prev, [clienteId]: all }))
  }

  const groupedModules = catalog.reduce((acc: any, m: any) => {
    if (!acc[m.category]) acc[m.category] = []
    acc[m.category].push(m)
    return acc
  }, {} as Record<string, any[]>)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-violet-700 dark:text-violet-400" />
            Módulos dos Clientes
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">
            Selecione quais funcionalidades cada cliente pode acessar no painel.
          </p>
        </div>

        {/* Meus módulos disponíveis */}
        <div className="shrink-0">
          <p className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-widest">Seus módulos ativos</p>
          <div className="flex flex-wrap gap-1.5 max-w-sm">
            {availableModules.length === 0 ? (
              <span className="text-xs text-slate-500 dark:text-slate-600 italic">Nenhum módulo disponível</span>
            ) : (
              availableModules.map((modId: string) => {
                const mod = catalog.find((m: any) => m.id === modId)
                const colorClass = mod ? (COLOR_MAP[mod.color] ?? COLOR_MAP.cyan) : 'bg-slate-100 border-slate-200 text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-slate-400'
                return (
                  <span key={modId} className={`text-[9px] font-medium px-2 py-0.5 rounded-full border ${colorClass}`}>
                    {mod?.name ?? modId}
                  </span>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Info box se sem módulos */}
      {availableModules.length === 0 && (
        <GlassCard className="p-4">
          <div className="flex items-start gap-3 text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Nenhum módulo disponível</p>
              <p className="text-xs text-slate-700 dark:text-slate-400 mt-1">
                O SuperAdmin ainda não liberou módulos para o seu plano. Entre em contato para habilitar funcionalidades.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Busca */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente..."
          className="w-full bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-600 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-violet-500/40"
        />
      </div>

      {/* Lista de Clientes */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-500 dark:text-slate-600 text-sm">Nenhum cliente cadastrado</div>
        )}

        {filtered.map((cliente: any) => {
          const isExpanded    = expanded === cliente.id
          const hasDirty      = isDirty(cliente.id)
          const enabledCount  = availableModules.filter(m => getEnabled(cliente.id, m)).length

          return (
            <GlassCard key={cliente.id} className="overflow-hidden">
              {/* Header */}
              <button
                className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-100 dark:hover:bg-white/2 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : cliente.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-slate-200 dark:border-white/10 flex items-center justify-center text-sm font-bold text-slate-900 dark:text-white">
                    {cliente.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{cliente.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-slate-500">
                        {VERTICAL_LABELS[cliente.vertical] ?? cliente.vertical}
                      </span>
                      {(cliente.city || cliente.state) && (
                        <span className="flex items-center gap-0.5 text-[10px] text-slate-500 dark:text-slate-600">
                          <MapPin className="w-2.5 h-2.5" />
                          {cliente.city}{cliente.state ? `, ${cliente.state}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {feedback[cliente.id] && (
                    <motion.span
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`text-xs flex items-center gap-1 ${feedback[cliente.id].ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}
                    >
                      {feedback[cliente.id].ok
                        ? <CheckCircle2 className="w-3.5 h-3.5" />
                        : <AlertCircle className="w-3.5 h-3.5" />
                      }
                      {feedback[cliente.id].msg}
                    </motion.span>
                  )}

                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-xs">
                    <span className="text-violet-700 dark:text-violet-400 font-bold">{enabledCount}</span>
                    <span className="text-slate-500">/ {availableModules.length} módulos</span>
                  </div>

                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="w-3 h-3" />
                    {cliente._count?.sites ?? 0} sites
                  </div>

                  {hasDirty && <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />}

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
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => selectAll(cliente.id)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:hover:bg-violet-500/20 transition-colors border border-violet-200 dark:border-violet-500/20"
                        >
                          Selecionar disponíveis
                        </button>
                        <button
                          onClick={() => deselectAll(cliente.id)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 transition-colors border border-slate-200 dark:border-white/10"
                        >
                          Desmarcar todos
                        </button>
                        <div className="flex-1" />
                        {hasDirty && (
                          <motion.button
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            onClick={() => saveCliente(cliente.id)}
                            disabled={saving === cliente.id}
                            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-white font-semibold transition-colors disabled:opacity-60"
                          >
                            {saving === cliente.id ? (
                              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            Salvar
                          </motion.button>
                        )}
                      </div>

                      {/* Módulos por categoria */}
                      {Object.entries(groupedModules).map(([cat, mods]) => (
                        <div key={cat}>
                          <p className={`text-[10px] font-semibold uppercase tracking-widest mb-2 ${CATEGORY_LABELS[cat]?.color ?? 'text-slate-500'}`}>
                            {CATEGORY_LABELS[cat]?.label ?? cat}
                          </p>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                            {(mods as any[]).map((mod: any) => {
                              const available = availableModules.includes(mod.id)
                              const enabled   = getEnabled(cliente.id, mod.id)
                              const IconComp  = ICON_MAP[mod.icon] ?? Puzzle
                              const colorClass = COLOR_MAP[mod.color] ?? COLOR_MAP.cyan

                              return (
                                <div
                                  key={mod.id}
                                  className="relative"
                                  onMouseEnter={() => setHoveredModule(mod.id)}
                                  onMouseLeave={() => setHoveredModule(null)}
                                >
                                  <motion.button
                                    whileHover={available ? { scale: 1.02 } : {}}
                                    whileTap={available ? { scale: 0.97 } : {}}
                                    onClick={() => available && toggle(cliente.id, mod.id)}
                                    disabled={!available}
                                    className={`
                                      w-full relative flex items-start gap-2.5 p-3 rounded-xl border text-left
                                      transition-all duration-200
                                      ${!available
                                        ? 'bg-slate-100 border-slate-200 dark:bg-white/2 dark:border-white/5 opacity-40 cursor-not-allowed'
                                        : enabled
                                          ? colorClass
                                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300 dark:bg-white/3 dark:border-white/8 dark:text-slate-600 dark:hover:border-white/15 cursor-pointer'
                                      }
                                    `}
                                  >
                                    {!available && (
                                      <Lock className="w-3 h-3 absolute top-1.5 right-1.5 text-slate-500 dark:text-slate-600" />
                                    )}
                                    <IconComp className={`w-4 h-4 shrink-0 mt-0.5 ${enabled && available ? '' : 'opacity-40'}`} />
                                    <div className="min-w-0">
                                      <p className={`text-xs font-semibold leading-tight ${enabled && available ? '' : 'opacity-50'}`}>
                                        {mod.name}
                                      </p>
                                      <p className="text-[9px] mt-0.5 opacity-60 font-mono">{mod.gcpCost}</p>
                                    </div>
                                    {available && (
                                      enabled
                                        ? <CheckCircle2 className="w-3.5 h-3.5 absolute top-2 right-2 shrink-0" />
                                        : <XCircle className="w-3.5 h-3.5 absolute top-2 right-2 shrink-0 opacity-30" />
                                    )}
                                  </motion.button>

                                  {/* Tooltip descrição */}
                                  {hoveredModule === mod.id && (
                                    <motion.div
                                      initial={{ opacity: 0, y: 4 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      className="absolute bottom-full left-0 right-0 mb-1 z-50 pointer-events-none"
                                    >
                                      <div className="bg-white border border-slate-200 dark:bg-space-800 dark:border-white/10 rounded-xl p-2.5 shadow-glass text-xs text-slate-700 dark:text-slate-300">
                                        {mod.description}
                                        {!available && (
                                          <p className="text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                                            <Lock className="w-3 h-3" />
                                            Não disponível no seu plano
                                          </p>
                                        )}
                                      </div>
                                    </motion.div>
                                  )}
                                </div>
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
