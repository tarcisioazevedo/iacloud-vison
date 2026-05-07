/**
 * PortalLayout — Sprint CF.4
 *
 * Shell reduzido pro portal cliente-final. Diferenças vs Layout principal:
 *   - Sidebar minimalista: apenas Live, Eventos, Logs (read-only).
 *   - Branding dinâmico via CSS vars `--portal-primary`/`--portal-secondary`,
 *     populadas a partir do localStorage `icv_portal_branding` (cacheado pelo
 *     PortalEntryPage logo após o exchange).
 *   - Header mostra logo + nome do cliente (não do integrador) — UX é
 *     "este portal é meu", não "estou na ferramenta da SaaS".
 *
 * Guarda de auth: se não houver `icv_token` ou role != CLIENTE_VIEWER,
 * redireciona para `/portal` (entry). Bloqueia também usuários da plataforma
 * principal acidentalmente abrindo /portal/home com sessão antiga.
 */
import { useEffect, useMemo } from 'react'
import { Outlet, NavLink, Navigate, useNavigate } from 'react-router-dom'
import {
  Video, ListChecks, FileText, LogOut, Building2, Shield, Map,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import type { PortalBranding } from '../../api/client'

function loadBranding(): PortalBranding | null {
  try {
    const raw = localStorage.getItem('icv_portal_branding')
    return raw ? (JSON.parse(raw) as PortalBranding) : null
  } catch { return null }
}

function loadCliente(): { id: string; name: string; vertical: string; portalSlug: string | null } | null {
  try {
    const raw = localStorage.getItem('icv_cliente_final')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function PortalLayout() {
  const navigate = useNavigate()
  const role     = typeof window !== 'undefined' ? localStorage.getItem('icv_role')  : null
  const token    = typeof window !== 'undefined' ? localStorage.getItem('icv_token') : null

  const branding = useMemo(loadBranding, [])
  const cliente  = useMemo(loadCliente,  [])

  // Aplica CSS vars do branding na :root via inline style; reverte ao desmontar.
  useEffect(() => {
    if (!branding) return
    const root = document.documentElement
    const prev = {
      primary:   root.style.getPropertyValue('--portal-primary'),
      secondary: root.style.getPropertyValue('--portal-secondary'),
    }
    if (branding.primaryColor)   root.style.setProperty('--portal-primary',   branding.primaryColor)
    if (branding.secondaryColor) root.style.setProperty('--portal-secondary', branding.secondaryColor)
    return () => {
      root.style.setProperty('--portal-primary',   prev.primary)
      root.style.setProperty('--portal-secondary', prev.secondary)
    }
  }, [branding])

  // Auth guard — só CLIENTE_VIEWER (emitido pelo /portal/exchange) entra aqui.
  if (!token || role !== 'CLIENTE_VIEWER') {
    return <Navigate to="/portal" replace />
  }

  function logout() {
    localStorage.removeItem('icv_token')
    localStorage.removeItem('icv_role')
    localStorage.removeItem('icv_cliente_final')
    localStorage.removeItem('icv_portal_branding')
    navigate('/portal', { replace: true })
  }

  // Cor primária pra inline styles (background com alpha). Usar CSS var em
  // background não dá pra fazer com alpha sem color-mix; mantemos uma cópia.
  const primary = branding?.primaryColor ?? 'var(--portal-primary)'

  return (
    <div className="flex min-h-screen bg-space-950 font-sans">
      {/* Sidebar fina */}
      <aside className="w-56 shrink-0 border-r border-slate-200 dark:border-white/5 bg-space-900/60 backdrop-blur flex flex-col">
        {/* Logo + nome cliente */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            {branding?.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={branding.name}
                className="w-9 h-9 rounded-lg object-contain bg-white/5"
              />
            ) : (
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: `${primary}20`, border: `1px solid ${primary}60` }}
              >
                <Building2 className="w-4 h-4" style={{ color: primary }} />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {cliente?.name ?? branding?.name ?? 'Portal'}
              </p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Cliente</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-1">
          <PortalNavItem to="/portal/home"   icon={Video}      label="Home" />
          <PortalNavItem to="/portal/live"   icon={Video}      label="Câmeras ao vivo" />
          <PortalNavItem to="/portal/maps"   icon={Map}        label="Mapas" badge="NOVO" />
          <PortalNavItem to="/portal/events" icon={ListChecks} label="Eventos" />
          <PortalNavItem to="/portal/logs"   icon={FileText}   label="Logs" />
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 dark:border-white/5 space-y-2">
          {branding?.integradorName && (
            <p className="text-[10px] text-slate-600 px-2 leading-tight">
              <Shield className="w-2.5 h-2.5 inline mr-1" />
              Powered by {branding.integradorName}
            </p>
          )}
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function PortalNavItem({
  to, icon: Icon, label, badge,
}: { to: string; icon: any; label: string; badge?: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) => cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition',
        isActive
          ? 'bg-[var(--portal-primary)]/15 text-white border border-[var(--portal-primary)]/30'
          : 'text-slate-400 hover:text-white hover:bg-slate-100 dark:hover:bg-white/5',
      )}
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="px-1.5 py-0.5 rounded-md bg-gradient-to-r from-fuchsia-500/20 to-cyan-500/20 border border-fuchsia-500/30 text-[9px] font-bold text-fuchsia-300 tracking-wide">
          {badge}
        </span>
      )}
    </NavLink>
  )
}
