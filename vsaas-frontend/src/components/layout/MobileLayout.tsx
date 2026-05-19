/**
 * MobileLayout — layout exclusivo para Cliente Final em viewport < 768px.
 *
 * Substitui o Layout desktop (sidebar + topbar) por:
 *   • Header minimalista com logo + sino de notificações
 *   • Conteúdo fullscreen por aba
 *   • Bottom navigation bar com 5 abas
 *
 * Roles suportadas: CLIENTE_ADMIN, CLIENTE_OPERADOR, CLIENTE_SUPERVISOR
 * Integrador: nunca cai aqui (só via impersonate, que já troca o role)
 */
import { useState, useEffect, Suspense } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Home, Camera, Bell, CreditCard, User, WifiOff, Sun, Moon } from 'lucide-react'
import { cn } from '../../lib/utils'
import { NotificationsBell } from '../notifications/NotificationsBell'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { path: '/mobile',               label: 'Câmeras',     icon: Camera     },
  { path: '/mobile/alerts',        label: 'Alertas',     icon: Bell       },
  { path: '/mobile/subscriptions', label: 'Assinaturas', icon: CreditCard },
  { path: '/mobile/profile',       label: 'Perfil',      icon: User       },
]

// ── Skeleton loader ────────────────────────────────────────────────────────────
function MobileSkeleton() {
  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 animate-pulse px-4 pt-6 gap-3">
      <div className="h-6 w-40 bg-slate-200 dark:bg-slate-800 rounded-xl" />
      <div className="grid grid-cols-3 gap-2">
        {[1,2,3].map(i => <div key={i} className="h-20 bg-slate-100 dark:bg-slate-900 rounded-2xl" />)}
      </div>
      <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded-xl" />
      <div className="space-y-2">
        {[1,2,3,4].map(i => <div key={i} className="h-16 bg-slate-100 dark:bg-slate-900 rounded-2xl" />)}
      </div>
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────
export function MobileLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const isOnline = useOnlineStatus()
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    // Sincroniza com a tag html (injetada no index.html)
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  // Bloqueia scroll de body/html enquanto MobileLayout estiver montado.
  // Sem isso, iOS Safari vaza scrollbar do body mesmo com overflow-hidden
  // no container filho — o layout mobile é sempre 100dvh sem scroll externo.
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overflow
    const prevBody = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtml
      body.style.overflow = prevBody
    }
  }, [])

  function toggleTheme() {
    const nextDark = !isDark
    setIsDark(nextDark)
    if (nextDark) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('icv-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('icv-theme', 'light')
    }
  }

  // Aba ativa: match exato para Home, prefixo para as demais
  function isActive(path: string) {
    if (path === '/mobile') return location.pathname === '/mobile'
    return location.pathname.startsWith(path)
  }

  return (
    <div
      className="flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-300"
      style={{ height: '100dvh' }}   // dvh: desconta barra do browser no mobile
    >
      {/* ── Top bar minimalista ──────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800/60 shrink-0 bg-white/80 dark:bg-slate-950/95 backdrop-blur-xl transition-colors duration-300">
        <div className="flex items-center">
          {/* Logo Tema Escuro (Original intacta) */}
          <img src="/brand/vsaas-logo-new.png" className="h-7 w-auto object-contain hidden dark:block" alt="VSaaS" />
          {/* Logo Tema Claro (Invertemos preto/branco e rotacionamos matiz para preservar o cyan) */}
          <img src="/brand/vsaas-logo-new.png" className="h-7 w-auto object-contain block dark:hidden invert hue-rotate-180 brightness-110 contrast-125" alt="VSaaS" />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={toggleTheme} className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-200 dark:active:bg-slate-700 transition-colors">
            {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <NotificationsBell />
        </div>
      </header>

      {/* ── Offline banner ────────────────────────────────────────── */}
      {!isOnline && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 border-b border-red-500/20 shrink-0">
          <WifiOff className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">Sem conexão — verifique sua internet</p>
        </div>
      )}

      {/* ── Page content ─────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<MobileSkeleton />}>
          <Outlet />
        </Suspense>
      </main>

      {/* ── Bottom navigation ────────────────────────────────────── */}
      <nav className="shrink-0 border-t border-slate-200 dark:border-slate-800/60 bg-white/90 dark:bg-slate-950/95 backdrop-blur-xl pb-safe transition-colors duration-300">
        <div className="flex items-stretch">
          {TABS.map(({ path, label, icon: Icon }) => {
            const active = isActive(path)
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors relative',
                  active ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-500 active:text-slate-800 dark:active:text-slate-300',
                )}
              >
                {/* Active indicator */}
                {active && (
                  <span className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-cyan-500 dark:bg-cyan-400" />
                )}
                <Icon className={cn('w-5 h-5', active && 'text-cyan-600 dark:text-cyan-400')} />
                <span className={cn('text-[10px] font-medium', active ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-500')}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
