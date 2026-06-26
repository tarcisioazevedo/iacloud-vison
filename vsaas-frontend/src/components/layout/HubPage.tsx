/**
 * HubPage — container genérico de "hub" que agrupa páginas existentes como abas.
 *
 * Parte da consolidação do sidebar (docs/SIDEBAR-CONSOLIDATION-PLAN.md): em vez
 * de N links soltos no menu, agrupamos páginas relacionadas num hub com abas.
 * Cada aba renderiza a PÁGINA EXISTENTE intacta (com o header dela) — zero
 * reescrita de lógica, só um tab bar fino por cima.
 *
 * IMPORTANTE — param de URL: o hub usa `?section=` (NÃO `?tab=`), porque muitas
 * páginas embedadas (LogAudit, Marketplace, Whitelabel, Settings) usam `?tab=`
 * pras sub-abas internas DELAS. Usar `?tab=` no hub colidiria. `?section=`
 * mantém os dois níveis independentes:
 *   /admin/auditoria?section=logs&tab=ops  → hub na seção Logs, página na sub-aba ops
 *
 * Deep-link e back/forward funcionam: section vai pra query string (replace).
 */
import { Suspense, useState, useEffect, type ComponentType } from 'react'
import { useSearchParams } from 'react-router-dom'
import { type LucideIcon } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

export interface HubSection {
  id: string
  label: string
  icon: LucideIcon
  /** Componente da página (geralmente lazy). Renderizado dentro de Suspense. */
  Component: ComponentType
  /** Cor do accent da aba ativa. */
  color?: 'violet' | 'amber' | 'cyan' | 'emerald' | 'rose' | 'slate'
  /** Descrição curta exibida ao lado do label (≥lg). */
  description?: string
}

interface HubPageProps {
  title: string
  subtitle?: string
  icon: LucideIcon
  /** Gradiente do cabeçalho (Tailwind classes). Default âmbar→cyan. */
  headerGradient?: string
  /** Chips no header (ex: "ALERTAS · RECORDING · GEMINI"). */
  chips?: string[]
  sections: HubSection[]
  /** Seção default quando não há ?section= na URL. Default = primeira. */
  defaultSection?: string
}

const TAB_COLORS: Record<string, string> = {
  violet:  'border-violet-500 text-violet-300',
  amber:   'border-amber-500 text-amber-300',
  cyan:    'border-cyan-500 text-cyan-300',
  emerald: 'border-emerald-500 text-emerald-300',
  rose:    'border-rose-500 text-rose-300',
  slate:   'border-slate-500 text-slate-600 dark:text-slate-300',
}

export function HubPage({
  title, subtitle, icon: Icon, headerGradient, chips, sections, defaultSection,
}: HubPageProps) {
  const [params, setParams] = useSearchParams()
  const valid = new Set(sections.map(s => s.id))
  const fallback = defaultSection && valid.has(defaultSection) ? defaultSection : sections[0]?.id
  const sectionParam = params.get('section')
  const [active, setActive] = useState<string>(
    sectionParam && valid.has(sectionParam) ? sectionParam : fallback,
  )

  // Sincroniza ?section= (preserva ?tab= e demais params da página interna).
  useEffect(() => {
    const next = new URLSearchParams(params)
    if (active === fallback) next.delete('section')
    else next.set('section', active)
    // Trocar de seção zera o ?tab= interno da página anterior (evita aba inválida).
    if (sectionParam !== active) next.delete('tab')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Reage a navegação externa (ex: redirect /admin/trials → ?section=...).
  useEffect(() => {
    const s = params.get('section')
    if (s && valid.has(s) && s !== active) setActive(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const current = sections.find(s => s.id === active) ?? sections[0]
  const Current = current?.Component

  return (
    <div className="space-y-3">
      {/* Header do hub */}
      <GlassCard className={cn(
        'p-4 border-amber-500/30 bg-gradient-to-r',
        headerGradient ?? 'from-amber-500/10 via-cyan-500/5 to-transparent',
      )}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-cyan-500 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold text-white">{title}</h1>
              {chips && chips.length > 0 && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 border border-white/10 rounded px-1.5 py-0.5">
                  {chips.join(' · ')}
                </span>
              )}
            </div>
            {subtitle && <p className="text-xs text-slate-400 mt-1 max-w-3xl">{subtitle}</p>}
          </div>
        </div>
      </GlassCard>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-white/10 overflow-x-auto">
        {sections.map(s => {
          const TabIcon = s.icon
          const isActive = active === s.id
          return (
            <button key={s.id} onClick={() => setActive(s.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 -mb-px border-b-2 transition text-sm whitespace-nowrap',
                isActive
                  ? (TAB_COLORS[s.color ?? 'cyan'])
                  : 'border-transparent text-slate-500 hover:text-slate-600 dark:text-slate-300',
              )}>
              <TabIcon className="w-3.5 h-3.5" />
              {s.label}
              {s.description && <span className="text-[10px] text-slate-600 hidden lg:inline">· {s.description}</span>}
            </button>
          )
        })}
      </div>

      {/* Conteúdo — a página existente, intacta, dentro de Suspense */}
      <div>
        <Suspense fallback={<div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />}>
          {Current && <Current />}
        </Suspense>
      </div>
    </div>
  )
}
