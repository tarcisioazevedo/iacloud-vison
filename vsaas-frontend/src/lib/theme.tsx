/**
 * Theme provider — alterna entre 'light' e 'dark' via toggle no UI.
 *
 * Como funciona:
 *   1. Boot script no `index.html` lê localStorage ANTES do React montar
 *      e adiciona `class="dark"` no <html> se necessário (anti-flash).
 *   2. ThemeProvider sincroniza React state com a classe no DOM e
 *      persiste no localStorage.
 *   3. Componentes consomem via `useTheme()` ou usam `dark:` no Tailwind.
 *
 * Por que useLayoutEffect (e não useEffect):
 *   useLayoutEffect roda SÍNCRONAMENTE antes do browser pintar o frame.
 *   Com useEffect (assíncrono), pode haver um frame piscando com a classe
 *   errada ainda no <html> — especialmente em React 18 StrictMode que
 *   re-executa efeitos no mount (cleanup → re-run), o que em useEffect
 *   resultaria em dois ticks assíncronos que se cancelam visualmente.
 *   useLayoutEffect garante que a classe já está aplicada no DOM antes
 *   do primeiro paint após o toggle.
 */
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'icv-theme'

interface ThemeCtx {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const Ctx = createContext<ThemeCtx | null>(null)

/** Aplica a classe no DOM imediatamente (chamado também pelo toggle direto). */
function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  try { localStorage.setItem(STORAGE_KEY, t) } catch { /* modo anônimo restrito */ }
}

/** Lê o tema corrente do <html> (depois do boot script). Default: dark. */
function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme)

  // useLayoutEffect — síncrono, ANTES do paint. Evita flash e cancela o
  // double-invocation do StrictMode (que re-executa effects no mount).
  useLayoutEffect(() => {
    applyTheme(theme)
  }, [theme])

  const value: ThemeCtx = {
    theme,
    setTheme: (t: Theme) => {
      applyTheme(t)      // DOM imediato (sem esperar o próximo render)
      setThemeState(t)   // state para re-render e atualizar ícone/tooltip
    },
    toggle: () => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      setThemeState(next)
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Hook pra consumir/alterar o tema. Throws se usado fora do provider. */
export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useTheme deve ser usado dentro de <ThemeProvider>')
  }
  return ctx
}
