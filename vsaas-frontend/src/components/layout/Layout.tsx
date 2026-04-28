import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { EyeOff, UserX } from 'lucide-react'
import { api } from '../../api/client'

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

  return (
    // bg-slate-50 (light) / bg-space-950 (dark, visual histórico).
    // Sem essa dupla, o body vence mas estamos sobrescrevendo aqui pra
    // evitar borda visível durante mount.
    <div className="flex min-h-screen bg-slate-50 dark:bg-space-950 font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-16">
        <TopBar />
        {/* Lote 2: Banner somente-leitura para CLIENTE_SUPERVISOR */}
        {isReadOnly && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/30 text-xs text-amber-700 dark:text-amber-300">
            <EyeOff className="w-3.5 h-3.5 shrink-0"/>
            <span>Modo supervisor — visualização somente leitura. Alterações não são permitidas.</span>
          </div>
        )}
        {/* Lote 5: Banner de impersonação */}
        {isImpersonating && (
          <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-rose-50 dark:bg-rose-900/20 border-b border-rose-200 dark:border-rose-700/30 text-xs text-rose-700 dark:text-rose-300">
            <div className="flex items-center gap-2">
              <UserX className="w-3.5 h-3.5 shrink-0"/>
              <span><strong>Modo de impersonação ativo.</strong> Você está visualizando como outro usuário. Todas as ações são auditadas.</span>
            </div>
            <button
              onClick={async () => {
                try {
                  await api.post('/auth/impersonate/end')
                } catch {}
                localStorage.removeItem('icv_token')
                localStorage.removeItem('icv_role')
                window.location.href = '/login'
              }}
              className="shrink-0 px-2 py-1 rounded border border-rose-300 dark:border-rose-600 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/10 transition font-semibold"
            >
              Encerrar
            </button>
          </div>
        )}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
