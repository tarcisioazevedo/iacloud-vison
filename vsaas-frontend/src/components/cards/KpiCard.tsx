import { motion, animate } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { cn, formatNumber } from '../../lib/utils'

interface KpiCardProps {
  title: string
  value: number
  unit?: string
  subtitle?: string
  icon: React.ReactNode
  accent: 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber'
  trend?: number        // % change vs yesterday
  format?: 'number' | 'time' | 'pct'
  delay?: number
}

// Accent map dual: light usa cor saturada (700) sobre bg suave sólido (50);
// dark mantém o brilho histórico (400 sobre 500/10 translúcido).
const accentStyles = {
  cyan: {
    text:   'text-cyan-700 dark:text-cyan-400',
    bg:     'bg-cyan-50 dark:bg-cyan-500/10',
    border: 'border-cyan-200 dark:border-cyan-500/20',
    icon:   'text-cyan-700 dark:text-cyan-400',
  },
  violet: {
    text:   'text-violet-700 dark:text-violet-400',
    bg:     'bg-violet-50 dark:bg-violet-500/10',
    border: 'border-violet-200 dark:border-violet-500/20',
    icon:   'text-violet-700 dark:text-violet-400',
  },
  emerald: {
    text:   'text-emerald-700 dark:text-emerald-400',
    bg:     'bg-emerald-50 dark:bg-emerald-500/10',
    border: 'border-emerald-200 dark:border-emerald-500/20',
    icon:   'text-emerald-700 dark:text-emerald-400',
  },
  rose: {
    text:   'text-rose-700 dark:text-rose-400',
    bg:     'bg-rose-50 dark:bg-rose-500/10',
    border: 'border-rose-200 dark:border-rose-500/20',
    icon:   'text-rose-700 dark:text-rose-400',
  },
  amber: {
    text:   'text-amber-700 dark:text-amber-400',
    bg:     'bg-amber-50 dark:bg-amber-500/10',
    border: 'border-amber-200 dark:border-amber-500/20',
    icon:   'text-amber-700 dark:text-amber-400',
  },
}

function formatValue(v: number, format: string) {
  if (format === 'pct')  return `${Math.round(v)}%`
  if (format === 'time') {
    const s = Math.round(v)
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
  }
  return formatNumber(Math.round(v))
}

function AnimatedCounter({ to, format = 'number' }: { to: number; format?: string }) {
  const [display, setDisplay] = useState(() => formatValue(to, format))
  const prev = useRef<number>(0)

  useEffect(() => {
    const from = prev.current
    const controls = animate(from, to, {
      duration: 1.0,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(formatValue(v, format)),
    })
    prev.current = to
    return () => controls.stop()
  }, [to, format])

  return <motion.span>{display}</motion.span>
}

export function KpiCard({ title, value, unit, subtitle, icon, accent, trend, format = 'number', delay = 0 }: KpiCardProps) {
  const styles = accentStyles[accent]

  return (
    <GlassCard glow={accent} hover delay={delay} className="p-5">
      <div className="flex items-start justify-between mb-4">
        <div className={cn('p-2.5 rounded-xl border', styles.bg, styles.border)}>
          <div className={cn('w-5 h-5', styles.icon)}>{icon}</div>
        </div>
        {trend !== undefined && (
          <div className={cn(
            'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full',
            trend > 0
              ? 'text-emerald-700 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/10'
              : trend < 0
                ? 'text-rose-700 bg-rose-100 dark:text-rose-400 dark:bg-rose-500/10'
                : 'text-slate-600 bg-slate-100 dark:text-slate-400 dark:bg-slate-500/10',
          )}>
            {trend > 0 ? <TrendingUp className="w-3 h-3" /> :
             trend < 0 ? <TrendingDown className="w-3 h-3" /> :
                         <Minus className="w-3 h-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className={cn('text-3xl font-bold tracking-tight', styles.text)}>
          <AnimatedCounter to={value} format={format} />
          {unit && <span className="text-lg font-medium ml-1 opacity-70">{unit}</span>}
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</p>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-500">{subtitle}</p>}
      </div>
    </GlassCard>
  )
}
