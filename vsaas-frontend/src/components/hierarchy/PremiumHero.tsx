/**
 * PremiumHero — Hero unificado para todas as páginas operacionais.
 *
 * Onda 6.F do docs/13-PLAN-COCKPIT-PREMIUM.md.
 * Garante 100% de coerência visual entre páginas.
 *
 * Uso:
 *   <PremiumHero
 *     emoji="📹"
 *     title="Câmeras"
 *     subtitle="42 câmeras · 38 ativas · 4 com erro"
 *     accent="rose"
 *     tags={[{ label: 'EDGE_BOX', color: 'amber' }, { label: 'CLOUD_DIRECT', color: 'violet' }]}
 *     action={<button>...</button>}
 *   />
 */
import { ReactNode } from 'react'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

export interface PremiumHeroTag {
  label: string
  color?: 'violet' | 'cyan' | 'emerald' | 'amber' | 'rose' | 'slate'
}

export interface PremiumHeroProps {
  /** Emoji grande (decorativo, ex: '📹', '🏭', '👤') */
  emoji: string
  /** Título principal — h1 */
  title: string
  /** Subtítulo descritivo / contadores */
  subtitle?: string
  /** Cor accent (afeta gradient do background e do avatar) */
  accent?: 'violet' | 'cyan' | 'emerald' | 'amber' | 'rose'
  /** Tags/badges abaixo do subtítulo */
  tags?: PremiumHeroTag[]
  /** Botão/ação do canto direito */
  action?: ReactNode
  /** Conteúdo extra no rodapé */
  footer?: ReactNode
  className?: string
}

const ACCENT_MAP = {
  violet:  { bg: 'from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20',
             avatar: 'from-violet-500 to-cyan-500 shadow-violet-500/20' },
  cyan:    { bg: 'from-cyan-500/10 via-blue-500/5 to-transparent border-cyan-500/20',
             avatar: 'from-cyan-500 to-blue-500 shadow-cyan-500/20' },
  emerald: { bg: 'from-emerald-500/10 via-cyan-500/5 to-transparent border-emerald-500/20',
             avatar: 'from-emerald-500 to-cyan-500 shadow-emerald-500/20' },
  amber:   { bg: 'from-amber-500/10 via-rose-500/5 to-transparent border-amber-500/20',
             avatar: 'from-amber-500 to-rose-500 shadow-amber-500/20' },
  rose:    { bg: 'from-rose-500/10 via-violet-500/5 to-transparent border-rose-500/20',
             avatar: 'from-rose-500 to-violet-500 shadow-rose-500/20' },
}

const TAG_COLORS = {
  violet:  'bg-violet-500/20 text-violet-300 border-violet-500/30',
  cyan:    'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  emerald: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  amber:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
  rose:    'bg-rose-500/20 text-rose-300 border-rose-500/30',
  slate:   'bg-slate-500/20 text-slate-300 border-slate-500/30',
}

export function PremiumHero({
  emoji, title, subtitle, accent = 'violet', tags, action, footer, className,
}: PremiumHeroProps) {
  const a = ACCENT_MAP[accent]
  return (
    <GlassCard className={cn('p-5 bg-gradient-to-br', a.bg, className)}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-14 h-14 rounded-xl flex items-center justify-center text-2xl shadow-lg',
            'bg-gradient-to-br', a.avatar,
          )}>
            {emoji}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
            {subtitle && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">{subtitle}</p>
            )}
            {tags && tags.length > 0 && (
              <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                {tags.map((t, i) => (
                  <span
                    key={i}
                    className={cn(
                      'px-2 py-0.5 rounded font-mono uppercase border',
                      TAG_COLORS[t.color ?? 'slate'],
                    )}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {footer && <div className="mt-4">{footer}</div>}
    </GlassCard>
  )
}
