/**
 * useSidebarState — estado híbrido (Opção D) do sidebar/drawer.
 *
 * 3 modos por viewport:
 *   • desktop  (≥1280px) — default expandido (256px)
 *                          Override usuário: 📌 colapsa para 64px (icon-only)
 *   • laptop   (768-1279) — default colapsado (icon-only)
 *                          Override usuário: 📌 expande para 256px
 *   • mobile   (<768)    — sempre off-canvas drawer (sem persistência)
 *                          Click no hambúrguer abre/fecha
 *
 * Persistência: salva preferência por viewport em localStorage —
 * usuário pode preferir colapsado no laptop e expandido no desktop, e
 * a app respeita os dois.
 *
 * Atalho: Ctrl+\\ (Win/Linux) ou Cmd+\\ (Mac) toggla — estilo VSCode/Cursor.
 *
 * Uso:
 *   const { mode, collapsed, drawerOpen, toggleCollapse, openDrawer, closeDrawer } = useSidebarState()
 *   - mode:        'desktop' | 'laptop' | 'mobile'
 *   - collapsed:   boolean — true = sidebar 64px (não vale em mobile)
 *   - drawerOpen:  boolean — true em mobile com drawer aberto
 *   - toggleCollapse() — alterna entre expandido e colapsado
 *   - openDrawer() / closeDrawer() — controla mobile
 */
import { useEffect, useState, useCallback } from 'react'

export type SidebarMode = 'desktop' | 'laptop' | 'mobile'

const BREAKPOINT_DESKTOP = 1280  // ≥ xl (Tailwind)
const BREAKPOINT_LAPTOP  = 768   // ≥ md

const STORAGE_KEY = 'icv_sidebar_collapsed'  // por viewport: { desktop, laptop }

interface PersistedState {
  desktop?: boolean
  laptop?: boolean
}

function loadPersisted(): PersistedState {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch { return {} }
}

function savePersisted(s: PersistedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* quota? */ }
}

function detectMode(): SidebarMode {
  if (typeof window === 'undefined') return 'desktop'
  const w = window.innerWidth
  if (w >= BREAKPOINT_DESKTOP) return 'desktop'
  if (w >= BREAKPOINT_LAPTOP)  return 'laptop'
  return 'mobile'
}

function defaultCollapsed(mode: SidebarMode, persisted: PersistedState): boolean {
  if (mode === 'mobile')  return true   // mobile sempre "colapsado" (drawer)
  if (mode === 'desktop') return persisted.desktop ?? false  // desktop default expandido
  return persisted.laptop ?? true                            // laptop default colapsado
}

export interface SidebarState {
  /** Viewport atual — recalculado via resize listener com debounce 150ms. */
  mode: SidebarMode
  /** True quando o sidebar está em modo icon-only (64px). */
  collapsed: boolean
  /** True quando drawer mobile está aberto. */
  drawerOpen: boolean
  /** Alterna expandido/colapsado e persiste. No mobile vira open/close drawer. */
  toggleCollapse: () => void
  /** Abre drawer (apenas mobile — em desktop/laptop é no-op). */
  openDrawer: () => void
  /** Fecha drawer. */
  closeDrawer: () => void
}

export function useSidebarState(): SidebarState {
  const [mode, setMode]             = useState<SidebarMode>(() => detectMode())
  const [collapsed, setCollapsed]   = useState<boolean>(() => defaultCollapsed(detectMode(), loadPersisted()))
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false)

  // Resize listener com debounce — evita re-render em cada pixel
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    function onResize() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const newMode = detectMode()
        setMode(prev => {
          if (prev === newMode) return prev
          // Mudou de breakpoint: aplica default do novo viewport
          // (preserva preferência salva quando voltar pra esse viewport).
          setCollapsed(defaultCollapsed(newMode, loadPersisted()))
          // Fecha drawer ao sair do mobile
          if (newMode !== 'mobile') setDrawerOpen(false)
          return newMode
        })
      }, 150)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Atalho de teclado Ctrl/Cmd+\
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // \ é "Backslash" na maioria dos layouts; alternativa "IntlBackslash"
      if ((e.ctrlKey || e.metaKey) && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault()
        toggleCollapse()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const toggleCollapse = useCallback(() => {
    if (mode === 'mobile') {
      setDrawerOpen(v => !v)
      return
    }
    setCollapsed(prev => {
      const next = !prev
      // Persiste apenas pro viewport atual
      const cur = loadPersisted()
      if (mode === 'desktop') savePersisted({ ...cur, desktop: next })
      else                    savePersisted({ ...cur, laptop:  next })
      return next
    })
  }, [mode])

  const openDrawer  = useCallback(() => { if (mode === 'mobile') setDrawerOpen(true) },  [mode])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  return {
    mode,
    collapsed: mode === 'mobile' ? true : collapsed,
    drawerOpen,
    toggleCollapse,
    openDrawer,
    closeDrawer,
  }
}
