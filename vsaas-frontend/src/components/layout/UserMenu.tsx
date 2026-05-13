/**
 * UserMenu — dropdown completo do usuário logado no TopBar.
 *
 * Substitui o antigo AvatarMenu (que só trocava foto). Mostra:
 *   - Avatar + nome + email + role (badge)
 *   - Tenant associado (integrador / cliente final) quando existir
 *   - Acesso rápido: Meu Perfil (Settings § perfil) · Trocar senha (§ segurança)
 *   - Theme Builder atalho — apenas INTEGRADOR_ADMIN
 *   - Theme toggle inline (light/dark/system)
 *   - Logout
 *
 * Avatar:
 *   - SUPER_ADMIN/INTEGRADOR_ADMIN: não tem avatar editável (entidades, não User);
 *     mostra inicial do nome.
 *   - Demais roles: lê de localStorage `icv_avatar` (cache do upload).
 *
 * Logout:
 *   - Limpa icv_token, icv_role, icv_avatar, icv_must_change_pw e demais
 *     chaves icv_* relacionadas a sessão. Redireciona para /login.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Settings, LogOut, KeyRound, Palette, ChevronRight, X,
  ShieldCheck, Briefcase, Building2,
} from 'lucide-react'
import { useMe } from '../../api/client'
import { ThemeToggle } from './ThemeToggle'
import { cn } from '../../lib/utils'

const ROLE_LABEL: Record<string, { label: string; color: string }> = {
  SUPER_ADMIN:        { label: 'Super-admin',        color: 'violet' },
  ADMIN_GLOBAL:       { label: 'Admin Global',       color: 'violet' },
  INTEGRADOR_ADMIN:   { label: 'Integrador Admin',   color: 'cyan' },
  INTEGRADOR_TECNICO: { label: 'Integrador Técnico', color: 'cyan' },
  CLIENTE_ADMIN:      { label: 'Cliente Admin',      color: 'emerald' },
  CLIENTE_OPERADOR:   { label: 'Cliente Operador',   color: 'emerald' },
  CLIENTE_VIEWER:     { label: 'Cliente Viewer',     color: 'slate' },
  CLIENTE_SUPERVISOR: { label: 'Cliente Supervisor', color: 'amber' },
}

const ROLE_COLOR_CLASS: Record<string, string> = {
  violet:  'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  cyan:    'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  slate:   'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
  amber:   'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
}

export function UserMenu() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const avatarUrl = typeof window !== 'undefined' ? (localStorage.getItem('icv_avatar') ?? '') : ''
  const roleConf = ROLE_LABEL[role] ?? { label: role || '—', color: 'slate' }
  const isIntegradorAdmin = role === 'INTEGRADOR_ADMIN'

  const displayName = me?.name ?? 'Usuário'
  const displayEmail = me?.email ?? ''
  const initials = displayName.split(' ').slice(0, 2).map(s => s[0] ?? '').join('').toUpperCase() || 'U'

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function handleLogout() {
    // Limpa todas as chaves de sessão para evitar leak entre contas
    const keys = ['icv_token', 'icv_role', 'icv_avatar', 'icv_must_change_pw',
                  'icv_portal_branding', 'icv_cliente_final', 'icv_clientes_view', 'icv_sites_view']
    for (const k of keys) localStorage.removeItem(k)
    navigate('/login', { replace: true })
  }

  function go(path: string) {
    setOpen(false)
    navigate(path)
  }

  const tenantLabel = me?.integrador
    ? `${me.integrador.tradeName ?? me.integrador.name}`
    : me?.clienteFinal
      ? `${me.clienteFinal.tradeName ?? me.clienteFinal.name}`
      : null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Menu do usuário"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-xl border pl-1 pr-2 py-1 transition',
          'bg-slate-50 border-slate-200 hover:bg-slate-100',
          'dark:bg-white/5 dark:border-white/10 dark:hover:bg-slate-100 dark:bg-white/10',
        )}
        title={displayName}
      >
        <div className={cn(
          'w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center text-[11px] font-bold shrink-0',
          'bg-gradient-to-br from-violet-500 to-cyan-500 text-white',
        )}>
          {avatarUrl
            ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            : initials
          }
        </div>
        <span className="hidden md:inline text-xs font-semibold text-slate-700 dark:text-slate-200 max-w-[100px] truncate">
          {displayName.split(' ')[0]}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute right-0 top-11 z-50 w-72 rounded-xl border shadow-2xl overflow-hidden',
              'bg-white border-slate-200',
              'dark:bg-slate-900 dark:border-white/10',
            )}
          >
            {/* Header — identidade */}
            <div className="p-4 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-b border-slate-200 dark:border-white/10">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-base font-bold text-white shrink-0">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                    : initials
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{displayName}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{displayEmail}</p>
                  <span className={cn(
                    'inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border',
                    ROLE_COLOR_CLASS[roleConf.color] ?? ROLE_COLOR_CLASS.slate,
                  )}>
                    <ShieldCheck className="w-2.5 h-2.5" />
                    {roleConf.label}
                  </span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Fechar"
                  className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {tenantLabel && (
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                  {me?.integrador
                    ? <Briefcase className="w-3 h-3 text-cyan-500" />
                    : <Building2 className="w-3 h-3 text-emerald-500" />
                  }
                  <span className="font-medium truncate">{tenantLabel}</span>
                </div>
              )}
            </div>

            {/* Ações */}
            <div className="py-1">
              <MenuItem icon={User}     label="Meu perfil"          onClick={() => go('/settings?section=profile')} />
              <MenuItem icon={KeyRound} label="Trocar senha"        onClick={() => go('/settings?section=security')} />
              {isIntegradorAdmin && (
                <MenuItem icon={Palette} label="Theme Builder" badge="Onda 8" onClick={() => go('/integrador/theme')} />
              )}
              <MenuItem icon={Settings} label="Configurações"        onClick={() => go('/settings')} />
            </div>

            {/* Tema */}
            <div className="px-3 py-2 border-t border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Tema</span>
                <ThemeToggle />
              </div>
            </div>

            {/* Logout */}
            <div className="border-t border-slate-200 dark:border-white/10">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition"
              >
                <LogOut className="w-4 h-4" />
                Sair
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuItem({
  icon: Icon, label, onClick, badge,
}: {
  icon: typeof User
  label: string
  onClick: () => void
  badge?: string
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition group"
    >
      <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400 group-hover:text-violet-500 dark:group-hover:text-violet-300" />
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-600 dark:text-violet-300 border border-violet-500/30">
          {badge}
        </span>
      )}
      <ChevronRight className="w-3 h-3 text-slate-400 dark:text-slate-600 group-hover:text-violet-400" />
    </button>
  )
}
