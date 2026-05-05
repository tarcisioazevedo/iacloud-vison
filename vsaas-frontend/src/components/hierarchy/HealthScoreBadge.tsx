/**
 * HealthScoreBadge — Bullet colored ●NN (0-100) with semantic color thresholds.
 * Used at every level of the hierarchy (Integrador, Cliente, Site, Box, Camera).
 *
 * Until the server-side health-score endpoint is wired (Onda 2.6), components
 * pass score from local heuristics (e.g. % of online edge nodes).
 */
import { cn } from '../../lib/utils'

export interface HealthScoreBadgeProps {
  /** 0-100. If null/undefined, shows neutral muted "—". */
  score?: number | null
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

function tierFor(score: number): { color: string; label: string } {
  if (score >= 95) return { color: 'text-emerald-400', label: 'Ótimo' }
  if (score >= 80) return { color: 'text-emerald-500', label: 'Bom' }
  if (score >= 60) return { color: 'text-amber-400',  label: 'Atenção' }
  if (score >= 40) return { color: 'text-orange-400', label: 'Ruim' }
  return { color: 'text-rose-400', label: 'Crítico' }
}

export function HealthScoreBadge({ score, size = 'sm', className }: HealthScoreBadgeProps) {
  if (score == null || Number.isNaN(score)) {
    return (
      <span className={cn(
        'inline-flex items-center gap-0.5 font-mono text-slate-500',
        size === 'xs' ? 'text-[10px]' : size === 'md' ? 'text-sm' : 'text-xs',
        className,
      )}>
        <span>●</span><span>—</span>
      </span>
    )
  }

  const value = Math.max(0, Math.min(100, Math.round(score)))
  const { color, label } = tierFor(value)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-mono font-bold',
        color,
        size === 'xs' ? 'text-[10px]' : size === 'md' ? 'text-sm' : 'text-xs',
        className,
      )}
      title={`${label} (${value}/100)`}
    >
      <span>●</span><span>{value}</span>
    </span>
  )
}
