import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

interface GlassCardProps {
  children: React.ReactNode
  className?: string
  glow?: 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber' | 'none'
  hover?: boolean
  onClick?: () => void
  delay?: number
}

const glowMap = {
  cyan:    'hover:shadow-cyan-glow hover:border-cyan-500/40',
  violet:  'hover:shadow-violet-glow hover:border-violet-500/40',
  emerald: 'hover:shadow-emerald-glow hover:border-emerald-500/40',
  rose:    'hover:shadow-rose-glow hover:border-rose-500/40',
  amber:   'hover:shadow-[0_0_20px_rgba(251,191,36,0.4)] hover:border-amber-500/40',
  none:    '',
}

/**
 * GlassCard — container card com aparência glass no DARK e card branco
 * sólido no LIGHT. Mesma API; substitui automaticamente conforme tema.
 *
 * IMPORTANTE: o wrapper interno `<div className="relative z-10">` envolve
 * children. Se um filho precisa de `flex flex-col h-[80vh]` no parent,
 * use `motion.div` direto em vez deste GlassCard (caso CameraMapPage).
 */
export function GlassCard({
  children,
  className,
  glow = 'none',
  hover = false,
  onClick,
  delay = 0,
}: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      onClick={onClick}
      className={cn(
        'relative rounded-2xl border transition-all duration-300',
        // Light mode: card branco com border slate-200 e sombra discreta
        'bg-white border-slate-200 shadow-sm',
        // Dark mode: efeito glass espelhando o mockup
        // (`.glass { backdrop-filter: blur(12px); background: rgba(15,23,42,0.6); }`).
        // slate-900/60 == rgba(15,23,42,0.6); backdrop-blur-md == 12px.
        'dark:bg-slate-900/60 dark:backdrop-blur-md dark:border-slate-800/50 dark:shadow-glass',
        hover && 'cursor-pointer hover:shadow-md hover:border-slate-300 dark:hover:shadow-glass-hover dark:hover:border-slate-700/60',
        glow !== 'none' && glowMap[glow],
        onClick && 'cursor-pointer',
        className,
      )}
    >
      <div className="relative z-10">{children}</div>
    </motion.div>
  )
}
