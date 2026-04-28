/**
 * ThemeToggle — botão Sun/Moon que alterna o tema light/dark.
 *
 * Usado no Topbar (junto com refresh, downloads, notificações). Estado
 * vem do <ThemeProvider>; ao trocar, useTheme atualiza class no <html>
 * e localStorage de uma vez.
 */
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../../lib/theme'
import { cn } from '../../lib/utils'

interface Props {
  /** Tamanho dos ícones (px). Default 16. */
  size?: number
  className?: string
}

export function ThemeToggle({ size = 16, className }: Props) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggle}
      title={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className={cn(
        'p-2 rounded-lg transition-colors',
        // Light mode: bg slate-100 + text slate-700
        // Dark mode: bg slate-800 + text amber-400 (lua brilhante)
        'bg-slate-100 hover:bg-slate-200 text-slate-700',
        'dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-amber-400',
        className,
      )}
    >
      {isDark
        ? <Sun  width={size} height={size} />
        : <Moon width={size} height={size} />}
    </button>
  )
}
