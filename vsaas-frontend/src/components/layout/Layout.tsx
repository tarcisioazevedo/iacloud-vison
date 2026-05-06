import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { EyeOff, UserX } from 'lucide-react'
import { api } from '../../api/client'
import { AutoBreadcrumb } from '../hierarchy/AutoBreadcrumb'
import { CommandPalette } from '../hierarchy/CommandPalette'
import { ImpersonateBanner } from '../hierarchy/ImpersonateBanner'
import { useApplyIntegradorTheme } from '../../hooks/useApplyIntegradorTheme'

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

  const isReadOnly       = role === 'CLIENTE_SUPERVISOR'
  const isImpersonating  = !!(payload?.impersonatedBy)

  // Onda 8.7: aplica CSS vars do tema do integrador (no-op para SUPER_ADMIN)
  useApplyIntegradorTheme()

  return (
    // Light: bg-slate-50. Dark: transparente pra deixar o gradiente do body
    // (definido em globals.css, espelhando o mockup) aparecer.
    <div className="flex min-h-screen bg-slate-50 dark:bg-transparent font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-64">
        <TopBar />
        {/* Lote 2: Banner somente-leitura para CLIENTE_SUPERVISOR */}
        {isReadOnly && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/30 text-xs text-amber-700 dark:text-amber-300">
            <EyeOff className="w-3.5 h-3.5 shrink-0"/>
            <span>Modo supervisor — visualização somente leitura. Alterações não são permitidas.</span>
          </div>
        )}
        {/* Onda 9: ImpersonateBanner com countdown + auto-logout (substitui banner Lote 5) */}
        <ImpersonateBanner />
        {/* Breadcrumb hierárquico (oculto em rotas raiz; só aparece em drill-in) */}
        <AutoBreadcrumb className="px-6 py-2 border-b border-slate-200/30 dark:border-violet-500/15 bg-slate-50/50 dark:bg-gradient-to-r dark:from-slate-900/40 dark:via-violet-950/20 dark:to-slate-900/40 backdrop-blur-sm" />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
      {/* Cmd+K palette global — escuta Cmd/Ctrl+K em qualquer rota */}
      <CommandPalette />
    </div>
  )
}
