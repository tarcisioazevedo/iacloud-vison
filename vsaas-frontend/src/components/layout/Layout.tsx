import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { EyeOff } from 'lucide-react'
import { AutoBreadcrumb } from '../hierarchy/AutoBreadcrumb'
import { CommandPalette } from '../hierarchy/CommandPalette'
import { ImpersonateBanner } from '../hierarchy/ImpersonateBanner'
import { SudoBanner } from '../auth/SudoBanner'
import { useApplyIntegradorTheme } from '../../hooks/useApplyIntegradorTheme'
import { useSidebarState } from '../../hooks/useSidebarState'
import { TrialBanner } from '../TrialBanner'
import { cn } from '../../lib/utils'

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}

export function Layout() {
  const role  = localStorage.getItem('icv_role') ?? ''
  const token = localStorage.getItem('icv_token') ?? ''
  const payload = token ? decodeJwtPayload(token) : null

  const location = useLocation()
  const isLivePage = location.pathname.includes('/live')

  const isReadOnly       = role === 'CLIENTE_SUPERVISOR'
  const isImpersonating  = !!(payload?.impersonatedBy)
  void isImpersonating

  // Sprint sidebar híbrido (Opção D) — viewport-aware + persist por viewport
  const sidebar = useSidebarState()

  // Onda 8.7: aplica CSS vars do tema do integrador (no-op para SUPER_ADMIN)
  useApplyIntegradorTheme()

  const isMobile = sidebar.mode === 'mobile'
  return (
    <div className="flex h-screen h-[100dvh] overflow-hidden bg-slate-50 dark:bg-transparent font-sans">
      {/* Desktop / Laptop: sidebar fixa lateral. Mobile: off-canvas drawer */}
      {!isMobile && (
        <Sidebar
          collapsed={sidebar.collapsed}
          onToggleCollapse={sidebar.toggleCollapse}
        />
      )}

      {/* Mobile drawer (off-canvas com backdrop) */}
      <AnimatePresence>
        {isMobile && sidebar.drawerOpen && (
          <>
            {/* Backdrop click-to-close */}
            <motion.div
              key="sb-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={sidebar.closeDrawer}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
            {/* Drawer slide-in da esquerda */}
            <motion.div
              key="sb-drawer"
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed left-0 top-0 h-full z-50"
            >
              <Sidebar
                collapsed={false}        // dentro do drawer sempre expandido
                mobileDrawer
                onNavigate={sidebar.closeDrawer}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Conteúdo principal — ml dinâmico só em desktop/laptop. Mobile = full width */}
      <div
        className={cn(
          'flex-1 flex flex-col transition-[margin] duration-200 ease-out',
          isMobile
            ? 'ml-0'
            : sidebar.collapsed
              ? 'ml-16'
              : 'ml-64',
        )}
      >
        <TopBar
          showHamburger={isMobile}
          onHamburger={sidebar.openDrawer}
        />
        {/* Banner somente-leitura para CLIENTE_SUPERVISOR */}
        {isReadOnly && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/30 text-xs text-amber-700 dark:text-amber-300">
            <EyeOff className="w-3.5 h-3.5 shrink-0"/>
            <span>Modo supervisor — visualização somente leitura. Alterações não são permitidas.</span>
          </div>
        )}
        <ImpersonateBanner />
        <SudoBanner />
        <TrialBanner />
        {!isLivePage && (
          <AutoBreadcrumb className="px-6 py-2 border-b border-slate-200/30 dark:border-violet-500/15 bg-slate-50/50 dark:bg-gradient-to-r dark:from-slate-900/40 dark:via-violet-950/20 dark:to-slate-900/40 backdrop-blur-sm" />
        )}
        <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>

      <CommandPalette />
    </div>
  )
}
