/**
 * ComercialPage — Hub Comercial completo do SUPER_ADMIN.
 *
 * 11 tabs organizadas pelo funil + gestão da equipe:
 *   1. 🏠 Visão Executiva    — dashboard CCO/diretor (MRR, pipeline, win rate, top performers)
 *   2. 🎯 Pipeline           — Kanban drag-and-drop por status do lead
 *   3. 👥 Leads (CRM)        — LeadsPage existente integrada
 *   4. 🎬 Demos              — DemosTab (gestão de demos enviadas)
 *   5. ✅ Aprovações Demo    — fila de demos aguardando aprovação SLA 1d
 *   6. 📞 Atividades         — feed cronológico de toda a equipe
 *   7. 💎 Oportunidades      — cross-sell/upsell na base instalada
 *   8. 🏆 Equipe & Metas     — gestão de SDRs/AEs (admin/gerente)
 *   9. 📋 Materiais          — playbooks, scripts, apresentações
 *  10. 💰 Pricing            — vitrine
 *  11. 💵 Faturamento        — placeholder M3+
 *  12. 📈 Contratado×Utilizado — BI commercial
 */
import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Briefcase, BarChart3, Sparkles,
  Activity, Target, Award, FileText, Layers, Settings,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useMySalesPermissions } from '../api/client'
import { cn } from '../lib/utils'

import { ExecutiveTab } from '../components/comercial/ExecutiveTab'
import { PipelineTab } from '../components/comercial/PipelineTab'
import { DemosTab } from '../components/comercial/DemosTab'
import { ActivitiesTab } from '../components/comercial/ActivitiesTab'
import { OpportunitiesTab } from '../components/comercial/OpportunitiesTab'
import { TeamTab } from '../components/comercial/TeamTab'
import { MaterialsTab } from '../components/comercial/MaterialsTab'

type TabId =
  | 'executive' | 'pipeline' | 'demos'
  | 'activities' | 'opportunities' | 'team' | 'materials'

// Mapeia tab visual → screen RBAC
const TAB_SCREEN: Record<TabId, string> = {
  executive: 'executive',
  pipeline: 'pipeline',
  demos: 'demos',
  activities: 'activities',
  opportunities: 'opportunities',
  team: 'team',
  materials: 'materials',
}

// Reorganização Key Account (Sprint K1):
//   Estratégico: Visão Executiva + Pipeline (mesa de trabalho)
//   Execução:    Demos · Oportunidades · Atividades
//   Ferramentas: Equipe · Materiais (com Pricing como sub-tab interna)
// Removidos: Leads (CRM redundante com Pipeline+LeadDrawer), Faturamento (placeholder),
//            BI link (virou bloco na Visão Executiva).
const TABS: { id: TabId; label: string; icon: any; color: string; group: string }[] = [
  // Estratégico
  { id: 'executive',     label: 'Visão Executiva',  icon: BarChart3,    color: 'violet',  group: 'Estratégico' },
  { id: 'pipeline',      label: 'Pipeline',         icon: Target,       color: 'cyan',    group: 'Estratégico' },
  // Execução
  { id: 'demos',         label: 'Demos',            icon: Sparkles,     color: 'amber',   group: 'Execução' },
  { id: 'opportunities', label: 'Oportunidades',    icon: Layers,       color: 'emerald', group: 'Execução' },
  { id: 'activities',    label: 'Atividades',       icon: Activity,     color: 'violet',  group: 'Execução' },
  // Ferramentas
  { id: 'team',          label: 'Equipe & Metas',   icon: Award,        color: 'rose',    group: 'Ferramentas' },
  { id: 'materials',     label: 'Materiais & Pricing', icon: FileText,  color: 'cyan',    group: 'Ferramentas' },
]

export function ComercialPage() {
  const [params, setParams] = useSearchParams()
  const initialTab = (params.get('tab') as TabId) || 'executive'
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const { data: permsData } = useMySalesPermissions()

  // Onda 9 hardening: /admin/comercial é só para fabricante (super-admin).
  // Integrador/cliente que chegar aqui via URL direta vai pra raiz.
  // Backend já bloqueia (requireRole), mas redirect frontend evita tela vazia.
  if (typeof window !== 'undefined') {
    const role = localStorage.getItem('icv_role') ?? ''
    if (!['SUPER_ADMIN', 'ADMIN_GLOBAL'].includes(role)) {
      window.location.replace('/')
      return null
    }
  }

  // Filtragem multi-camada (defensiva contra bug observado em 2026-05-05):
  // - SUPER_ADMIN/ADMIN_GLOBAL: bypass total (backend já garante 'ADMIN' em tudo).
  // - Outras roles SEM SalesUser cadastrado: backend retorna 'NONE' para TODAS as
  //   screens. Em vez de mostrar página vazia, fail-open mostra todas as tabs
  //   e cada handler protegido pelo backend retorna 403 se realmente não pode.
  // - Outras roles COM SalesUser: filtro fino só esconde tabs explicitamente NONE.
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const isAdminGlobal = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
  const perms = permsData?.permissions as Record<string, string> | undefined
  const allNone = perms && Object.values(perms).every(v => v === 'NONE')
  const visibleTabs = (isAdminGlobal || !perms || allNone)
    ? TABS
    : TABS.filter(t => perms[TAB_SCREEN[t.id]] !== 'NONE')
  const canConfig = isAdminGlobal || !perms || allNone || perms.config !== 'NONE'

  useEffect(() => { setActiveTab((params.get('tab') as TabId) || 'executive') }, [params])

  // Se a tab atual ficou invisível pela perm, joga para a primeira disponível.
  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.find(t => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsData])

  function changeTab(t: TabId) {
    setActiveTab(t)
    setParams(p => { const np = new URLSearchParams(p); np.set('tab', t); return np }, { replace: true })
  }

  return (
    <div className="space-y-4">
      {/* Hero rico */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/15 via-cyan-500/10 to-amber-500/5 border-violet-500/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 via-cyan-500 to-amber-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Briefcase className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Hub Comercial
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-mono uppercase">
                  CRM · Pipeline · Equipe · Cross-sell
                </span>
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
                Centro de comando comercial: funil de leads, demos, aprovações, atividades da equipe,
                oportunidades de cross-sell/upsell em base instalada, metas e BI.
              </p>
            </div>
          </div>
          {canConfig && (
            <Link to="/admin/comercial/config"
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-300 hover:text-white transition"
              title="Configurações do Hub Comercial">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Configurações</span>
            </Link>
          )}
        </div>
      </GlassCard>

      {/* Tabs agrupadas por seção — restaurado GlassCard com motion. Botões mantêm
          bg-slate-800 sólido para garantir contraste mesmo com glass background. */}
      <GlassCard className="p-2 border-slate-700/60">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {visibleTabs.map((tab, idx) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            const prevGroup = idx > 0 ? visibleTabs[idx - 1].group : null
            const showSeparator = prevGroup && prevGroup !== tab.group
            const colorClass: Record<string, string> = {
              violet:  isActive ? 'bg-violet-500/20 text-violet-200 border-violet-500/50 shadow-lg shadow-violet-500/20' : '',
              cyan:    isActive ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50 shadow-lg shadow-cyan-500/20' : '',
              amber:   isActive ? 'bg-amber-500/20 text-amber-200 border-amber-500/50 shadow-lg shadow-amber-500/20' : '',
              emerald: isActive ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50 shadow-lg shadow-emerald-500/20' : '',
              rose:    isActive ? 'bg-rose-500/20 text-rose-200 border-rose-500/50 shadow-lg shadow-rose-500/20' : '',
            }
            return (
              <div key={tab.id} className="flex items-center">
                {showSeparator && <div className="w-px h-6 bg-slate-700 mx-1" />}
                <button onClick={() => changeTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded-lg whitespace-nowrap transition-all border text-sm font-bold',
                    isActive
                      ? colorClass[tab.color]
                      // INATIVAS: bg sólido + text-white garante visibilidade sobre qualquer fundo
                      : 'text-slate-700 dark:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-300 dark:border-slate-700',
                  )}>
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              </div>
            )
          })}
        </div>
      </GlassCard>

      {/* Tab content */}
      <div className="min-h-[400px]">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}>
            {activeTab === 'executive'    && <ExecutiveTab />}
            {activeTab === 'pipeline'     && <PipelineTab />}
            {activeTab === 'demos'        && <DemosTab />}
            {activeTab === 'activities'   && <ActivitiesTab />}
            {activeTab === 'opportunities' && <OpportunitiesTab />}
            {activeTab === 'team'         && <TeamTab />}
            {activeTab === 'materials'    && <MaterialsTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
