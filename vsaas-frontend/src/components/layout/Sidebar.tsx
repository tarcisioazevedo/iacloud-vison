/**
 * Sidebar — navegação principal organizada por persona (Mental Model 3 Tenants).
 *
 * Personas:
 *   - SUPER_ADMIN / ADMIN_GLOBAL  → Fabricante (visão da plataforma)
 *   - INTEGRADOR_ADMIN / TECNICO  → Integrador (visão do tenant nível 1)
 *   - CLIENTE_*                    → Cliente Final (visão do tenant nível 2)
 *
 * Cada persona vê uma estrutura DIFERENTE:
 *   - 3 grupos por persona (Comando/Operação/Plataforma para super; etc)
 *   - Itens não compartilháveis entre roles ficam só na persona certa
 *
 * Badges:
 *   - Estáticos: 'LIVE' | 'NOVO' | 'PRO' | 'VERTICAL' | 'IA'
 *   - Dinâmicos (vêm de hook): 'count' (ex: 5 leads pendentes) ou 'critical' (alertas)
 */
import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import {
  LayoutDashboard, Activity, Camera, Map, Users,
  ShieldCheck, BarChart3, Settings, Bell, LogOut,
  Cpu, ChevronRight, Puzzle, FileText, Fingerprint,
  Car, Brain, Share2, Building2, Sparkles, Radio, Gauge, Film,
  Inbox, Globe, Server, MapPin, Search,
  Flame, Landmark, Briefcase, Network, Terminal, ScrollText, PieChart,
  Palette, Zap, ShoppingBag, AlertTriangle, HardDrive, Wifi,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { api } from '../../api/client'

type StaticBadge = 'LIVE' | 'NOVO' | 'PRO' | 'VERTICAL' | 'IA'

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  badge?: StaticBadge
  /** Source de badge dinâmico (consulta SWR) */
  dynamicBadge?: 'pending_approvals' | 'pending_demos' | 'critical_alerts' | 'tenants_count'
  /** Cor do accent quando ativo (override do default cyan) */
  accent?: 'violet' | 'amber' | 'cyan' | 'emerald' | 'rose'
}

interface NavGroup {
  id: string
  title: string
  /** Cor do header do grupo (sutil) */
  groupColor?: 'violet' | 'amber' | 'slate'
  items: NavItem[]
}

// ════════════════════════════════════════════════════════════════════════════
// SIDEBAR · SUPER_ADMIN (FABRICANTE)
// 3 grupos: COMANDO · OPERAÇÃO · PLATAFORMA
// ════════════════════════════════════════════════════════════════════════════
const SUPER_ADMIN_NAV: NavGroup[] = [
  {
    id: 'comando',
    title: 'Comando da Plataforma',
    groupColor: 'violet',
    items: [
      { to: '/',                icon: LayoutDashboard, label: 'Dashboard Global', accent: 'violet' },
      { to: '/admin/tenants',   icon: Network,         label: 'Tenants',          accent: 'violet', dynamicBadge: 'tenants_count' },
      { to: '/admin/comercial', icon: Briefcase,       label: 'Comercial',        accent: 'amber',  dynamicBadge: 'pending_demos' },
    ],
  },
  {
    id: 'operacao',
    title: 'Operação',
    groupColor: 'amber',
    items: [
      { to: '/admin/alerts', icon: AlertTriangle, label: 'Alertas e Saúde', accent: 'rose',    dynamicBadge: 'critical_alerts' },
      // /audit = central unificada (AuditLog + EdgeConnectionLog + SystemLog +
      // CameraLog + IngestLog). /admin/logs (legado SystemLog/CameraLog crú)
      // mantido temporariamente como fallback técnico — remover quando todos
      // os clientes acostumarem com /audit.
      { to: '/audit',        icon: ShieldCheck,   label: 'Auditoria & Logs', accent: 'emerald' },
      { to: '/admin/logs',   icon: ScrollText,    label: 'Logs (legado)',   accent: 'cyan' },
    ],
  },
  {
    id: 'plataforma',
    title: 'Plataforma',
    groupColor: 'slate',
    items: [
      { to: '/admin/catalog',    icon: Puzzle,   label: 'Catálogo de Módulos' },
      { to: '/admin/whitelabel', icon: Palette,  label: 'White-label' },
      { to: '/admin/integrations', icon: Zap,    label: 'Integrações' },
      { to: '/settings',         icon: Settings, label: 'Settings Avançados' },
    ],
  },
]

// ════════════════════════════════════════════════════════════════════════════
// SIDEBAR · INTEGRADOR_ADMIN / INTEGRADOR_TECNICO
// 4 grupos: MEU NEGÓCIO · INFRAESTRUTURA · ANALYTICS · MINHA EMPRESA
// ════════════════════════════════════════════════════════════════════════════
const INTEGRADOR_NAV: NavGroup[] = [
  {
    id: 'negocio',
    title: 'Meu Negócio',
    groupColor: 'violet',
    items: [
      { to: '/',                icon: LayoutDashboard, label: 'Dashboard',         accent: 'violet' },
      { to: '/clientes-finais', icon: Briefcase,       label: 'Meus Clientes',     accent: 'cyan' },
      { to: '/users',           icon: Users,           label: 'Meus Usuários',     accent: 'violet' },
    ],
  },
  {
    id: 'infra',
    title: 'Infraestrutura',
    groupColor: 'amber',
    items: [
      { to: '/edge',       icon: Cpu,       label: 'Minhas Edge Boxes', accent: 'cyan' },
      { to: '/cameras',    icon: Camera,    label: 'Câmeras' },
      { to: '/sites',      icon: Building2, label: 'Sites' },
      { to: '/live',       icon: Activity,  label: 'Ao Vivo',           badge: 'LIVE', accent: 'rose' },
      { to: '/recordings', icon: Film,      label: 'Gravações' },
    ],
  },
  {
    id: 'analytics',
    title: 'Analytics & IA',
    groupColor: 'amber',
    items: [
      { to: '/analytics',    icon: BarChart3,   label: 'Analytics' },
      { to: '/triggers',     icon: Sparkles,    label: 'Gatilhos IA',  badge: 'IA',       accent: 'cyan' },
      { to: '/review',       icon: Bell,        label: 'Eventos' },
      { to: '/faces',        icon: Fingerprint, label: 'Faces' },
      { to: '/plates',       icon: Car,         label: 'Placas' },
      { to: '/heatmap',      icon: Flame,       label: 'Heatmap' },
      { to: '/demographics', icon: PieChart,    label: 'Demografia' },
      { to: '/smart-city',   icon: Landmark,    label: 'Smart City',   badge: 'VERTICAL', accent: 'emerald' },
    ],
  },
  {
    id: 'empresa',
    title: 'Minha Empresa',
    groupColor: 'slate',
    items: [
      { to: '/modulos',         icon: Puzzle,    label: 'Meus Módulos' },
      { to: '/quota',           icon: Gauge,     label: 'Quota Vertex' },
      { to: '/custom-domains',  icon: Globe,     label: 'Meu Domínio' },
      // /audit = central unificada com escopo automático ao integradorId via
      // tenantScopeFilter (vê AuditLog + EdgeConnectionLog + SystemLog +
      // CameraLog + IngestLog do próprio tenant + clientes finais filhos).
      { to: '/audit',           icon: FileText,  label: 'Auditoria & Logs' },
      { to: '/integrations/mqtt', icon: Radio,   label: 'MQTT' },
      { to: '/settings',        icon: Settings,  label: 'Configurações' },
    ],
  },
]

// ════════════════════════════════════════════════════════════════════════════
// SIDEBAR · CLIENTE_* (CLIENTE FINAL)
// 3 grupos: OPERAÇÃO · ANALYTICS · CONFIGURAÇÃO
// ════════════════════════════════════════════════════════════════════════════
const CLIENTE_NAV: NavGroup[] = [
  {
    id: 'operacao',
    title: 'Operação',
    groupColor: 'violet',
    items: [
      { to: '/',           icon: LayoutDashboard, label: 'Dashboard',   accent: 'violet' },
      { to: '/live',       icon: Activity,        label: 'Ao Vivo',     badge: 'LIVE', accent: 'rose' },
      { to: '/cameras',    icon: Camera,          label: 'Câmeras' },
      { to: '/recordings', icon: Film,            label: 'Gravações' },
      { to: '/review',     icon: Bell,            label: 'Eventos' },
    ],
  },
  {
    id: 'analytics',
    title: 'Analytics',
    groupColor: 'amber',
    items: [
      { to: '/faces',        icon: Fingerprint, label: 'Faces' },
      { to: '/plates',       icon: Car,         label: 'Placas' },
      { to: '/demographics', icon: PieChart,    label: 'Demografia' },
      { to: '/heatmap',      icon: Flame,       label: 'Heatmap' },
    ],
  },
  {
    id: 'config',
    title: 'Configuração',
    groupColor: 'slate',
    items: [
      { to: '/users',    icon: Users,    label: 'Usuários' },
      { to: '/sites',    icon: Building2,label: 'Sites' },
      // /audit = central unificada com escopo automático ao clienteFinalId.
      // Importante para LGPD: cliente final pode auditar quem do integrador
      // acessou suas câmeras/dados.
      { to: '/audit',    icon: FileText, label: 'Auditoria' },
      { to: '/settings', icon: Settings, label: 'Notificações' },
    ],
  },
]

// ════════════════════════════════════════════════════════════════════════════
// Hook para badges dinâmicos — consulta endpoints uma vez e expõe valores
// ════════════════════════════════════════════════════════════════════════════
function useDynamicBadges(role: string) {
  const isSuperAdmin = role === 'SUPER_ADMIN'
  // Consulta apenas se for super_admin (outras roles não usam badges dinâmicos)
  const fetcher = (url: string) => api.get(url).then(r => r.data)
  const { data: stats } = useSWR(
    isSuperAdmin ? '/admin/integradores/stats' : null,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  )
  const { data: leads } = useSWR(
    isSuperAdmin ? '/leads?status=NEW' : null,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  )

  return {
    pending_approvals: stats?.pendingApprovals ?? 0,
    pending_demos:     leads?.total ?? leads?.leads?.length ?? 0,
    critical_alerts:   0, // será preenchido por /admin/alerts/active na F3
    tenants_count:     stats?.integradores?.total ?? 0,
  }
}

// Cores dos badges estáticos
const STATIC_BADGE_STYLES: Record<StaticBadge, string> = {
  LIVE:
    'bg-rose-100 text-rose-700 border-rose-200 ' +
    'dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30 animate-pulse-slow',
  PRO:
    'bg-gradient-to-r from-violet-100 to-cyan-100 text-violet-700 border-violet-200 ' +
    'dark:from-violet-500/30 dark:to-cyan-500/30 dark:text-violet-200 dark:border-violet-500/40',
  VERTICAL:
    'bg-emerald-100 text-emerald-700 border-emerald-200 ' +
    'dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  NOVO:
    'bg-gradient-to-r from-fuchsia-100 to-cyan-100 text-fuchsia-700 border-fuchsia-200 ' +
    'dark:from-fuchsia-500/30 dark:to-cyan-500/30 dark:text-fuchsia-200 dark:border-fuchsia-500/40',
  IA:
    'bg-cyan-100 text-cyan-700 border-cyan-200 ' +
    'dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30',
}

const GROUP_COLOR_STYLES = {
  violet: 'text-violet-700 dark:text-violet-300',
  amber:  'text-amber-700 dark:text-amber-300',
  slate:  'text-slate-500 dark:text-slate-400',
}

const ACCENT_STYLES = {
  violet:  { active: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/25', icon: 'text-violet-600 dark:text-violet-400' },
  amber:   { active: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25',     icon: 'text-amber-600 dark:text-amber-400' },
  cyan:    { active: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/25',           icon: 'text-cyan-600 dark:text-cyan-400' },
  emerald: { active: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25', icon: 'text-emerald-600 dark:text-emerald-400' },
  rose:    { active: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25',           icon: 'text-rose-600 dark:text-rose-400' },
}

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const role = (typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : '')

  // Escolhe estrutura por persona
  const groups: NavGroup[] = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
    ? SUPER_ADMIN_NAV
    : role.startsWith('INTEGRADOR_')
      ? INTEGRADOR_NAV
      : role.startsWith('CLIENTE_') || role === 'CLIENT_ADMIN'
        ? CLIENTE_NAV
        : SUPER_ADMIN_NAV  // fallback para roles desconhecidos

  const badges = useDynamicBadges(role)

  function handleLogout() {
    localStorage.removeItem('icv_token')
    localStorage.removeItem('icv_role')
    localStorage.removeItem('icv_must_change_pw')
    navigate('/login', { replace: true })
  }

  const personaLabel = role === 'SUPER_ADMIN' ? 'Super Admin'
    : role === 'INTEGRADOR_ADMIN' ? 'Integrador'
    : role === 'INTEGRADOR_TECNICO' ? 'Técnico'
    : role.startsWith('CLIENTE_') ? 'Cliente Final'
    : role || 'Usuário'

  const personaSub = role === 'SUPER_ADMIN' ? 'fabricante · plataforma'
    : role.startsWith('INTEGRADOR_') ? 'integrador · revenda'
    : role.startsWith('CLIENTE_') ? 'cliente final · operação'
    : 'sessão ativa'

  return (
    <aside className="fixed left-0 top-0 h-full w-16 hover:w-60 group/sidebar transition-all duration-300 z-40 overflow-hidden">
      {/* Background */}
      <div className={cn(
        'absolute inset-0 backdrop-blur-xl border-r',
        'bg-white/95 border-slate-200',
        'dark:bg-space-900/95 dark:border-white/8',
      )} />

      <div className="relative flex flex-col h-full py-4">
        {/* Logo + brand */}
        <div className="px-3 mb-4 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center overflow-hidden shadow-[0_0_18px_-4px_rgba(6,182,212,0.7)]">
              <BrandLogo />
            </div>
            <div className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 whitespace-nowrap overflow-hidden">
              <p className="text-xs font-bold tracking-wide text-slate-900 dark:text-white">
                IA <span className="text-cyan-600 dark:text-cyan-400">Cloud Vision</span>
              </p>
              <p className="text-[9px] text-cyan-700/70 dark:text-cyan-500/70">VSaaS · IA · Analytics</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav
          className="flex-1 px-2 overflow-y-auto overflow-x-hidden
                     [scrollbar-width:thin]
                     [scrollbar-color:rgba(15,23,42,0.15)_transparent]
                     dark:[scrollbar-color:rgba(255,255,255,0.08)_transparent]
                     [&::-webkit-scrollbar]:w-1
                     [&::-webkit-scrollbar-thumb]:rounded-full
                     [&::-webkit-scrollbar-thumb]:bg-slate-300
                     dark:[&::-webkit-scrollbar-thumb]:bg-white/10"
        >
          {groups.map((group, gIdx) => (
            <div key={group.id} className={cn(gIdx > 0 && 'mt-3 pt-3 border-t border-slate-200/70 dark:border-white/5')}>
              {/* Header do grupo (visível só expandido) */}
              <p className={cn(
                'opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200',
                'px-3 mb-1 text-[9px] uppercase tracking-[0.14em] font-bold whitespace-nowrap overflow-hidden',
                group.groupColor ? GROUP_COLOR_STYLES[group.groupColor] : 'text-slate-400 dark:text-slate-600',
              )}>
                {group.title}
              </p>

              <div className="space-y-0.5">
                {group.items.map(item => (
                  <NavRow
                    key={item.to}
                    item={item}
                    active={isActive(location.pathname, item.to)}
                    dynamicValue={item.dynamicBadge ? badges[item.dynamicBadge] : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom: persona + logout */}
        <div className="px-2 mt-3 pt-3 shrink-0 border-t border-slate-200 dark:border-white/8">
          <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl overflow-hidden transition hover:bg-slate-100 dark:hover:bg-white/5">
            <div className="w-7 h-7 rounded-full bg-brand-gradient flex items-center justify-center shrink-0 text-xs font-bold text-white shadow-sky-glow">
              {(role[0] ?? 'U').toUpperCase()}
            </div>
            <div className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 flex-1 min-w-0 whitespace-nowrap">
              <p className="text-xs font-medium truncate text-slate-700 dark:text-slate-300">{personaLabel}</p>
              <p className="text-[9px] truncate text-slate-500 dark:text-slate-600">{personaSub}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sair"
              className={cn(
                'opacity-0 group-hover/sidebar:opacity-100 transition-opacity p-1 rounded',
                'text-slate-500 hover:bg-rose-100 hover:text-rose-600',
                'dark:text-slate-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400',
              )}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function NavRow({ item, active, dynamicValue }: {
  item: NavItem
  active: boolean
  dynamicValue?: number
}) {
  const Icon = item.icon
  const accent = item.accent ? ACCENT_STYLES[item.accent] : null

  return (
    <NavLink to={item.to}>
      <motion.div
        whileHover={{ x: 2 }}
        className={cn(
          'flex items-center gap-3 px-2.5 py-2 rounded-xl transition-all duration-200 group/item overflow-hidden border',
          active
            ? accent?.active ?? 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/25'
            : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-100 dark:hover:bg-white/5',
        )}
      >
        <Icon className={cn(
          'w-5 h-5 shrink-0 transition-colors',
          active
            ? (accent?.icon ?? 'text-cyan-600 dark:text-cyan-400')
            : 'group-hover/item:text-slate-900 dark:group-hover/item:text-slate-200',
        )} />
        <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 text-sm font-medium whitespace-nowrap overflow-hidden flex-1">
          {item.label}
        </span>

        {/* Badge dinâmico (count ou critical) — vence o estático */}
        {dynamicValue !== undefined && dynamicValue > 0 && (
          <span className={cn(
            'opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200',
            'text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border',
            item.dynamicBadge === 'critical_alerts'
              ? 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/30 dark:text-rose-300 dark:border-rose-500/40 animate-pulse'
              : item.dynamicBadge === 'pending_demos'
                ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/30 dark:text-amber-300 dark:border-amber-500/40'
                : 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/30 dark:text-violet-300 dark:border-violet-500/40',
          )}>
            {dynamicValue > 99 ? '99+' : dynamicValue}
          </span>
        )}

        {/* Badge estático (só se não tem dinâmico) */}
        {dynamicValue === undefined && item.badge && (
          <span className={cn(
            'opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200',
            'text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border',
            STATIC_BADGE_STYLES[item.badge],
          )}>
            {item.badge}
          </span>
        )}

        {active && (
          <ChevronRight className={cn(
            'opacity-0 group-hover/sidebar:opacity-100 w-3 h-3 shrink-0',
            accent?.icon ?? 'text-cyan-600 dark:text-cyan-500',
          )} />
        )}
      </motion.div>
    </NavLink>
  )
}

function isActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(to + '/')
}

// ────────────────────────────────────────────────────────────────────────────
function BrandLogo() {
  return (
    <svg viewBox="0 0 512 512" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sb-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0B1629"/>
          <stop offset="100%" stopColor="#071020"/>
        </linearGradient>
        <linearGradient id="sb-cloud" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0ea5e9"/>
          <stop offset="60%" stopColor="#06b6d4"/>
          <stop offset="100%" stopColor="#0284c7"/>
        </linearGradient>
        <radialGradient id="sb-iris" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0B1629"/>
          <stop offset="65%" stopColor="#0e2040"/>
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8"/>
        </radialGradient>
        <radialGradient id="sb-pupil" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff"/>
          <stop offset="30%" stopColor="#06b6d4"/>
          <stop offset="100%" stopColor="#0B1629"/>
        </radialGradient>
        <filter id="sb-glow">
          <feGaussianBlur stdDeviation="7" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width="512" height="512" rx="96" fill="url(#sb-bg)"/>
      <ellipse cx="185" cy="265" rx="73" ry="66" fill="url(#sb-cloud)"/>
      <ellipse cx="256" cy="238" rx="100" ry="88" fill="url(#sb-cloud)"/>
      <ellipse cx="330" cy="260" rx="78" ry="70" fill="url(#sb-cloud)"/>
      <rect x="152" y="272" width="220" height="66" rx="8" fill="url(#sb-cloud)"/>
      <ellipse cx="256" cy="258" rx="136" ry="96" fill="#0d2a4a" opacity="0.5"/>
      <ellipse cx="256" cy="258" rx="86" ry="50" fill="white" opacity="0.95"/>
      <circle cx="256" cy="258" r="40" fill="url(#sb-iris)"/>
      <circle cx="256" cy="258" r="40" fill="none" stroke="#06b6d4" strokeWidth="2" opacity="0.7"/>
      <circle cx="256" cy="258" r="28" fill="none" stroke="#06b6d4" strokeWidth="1.5" opacity="0.45"/>
      <g stroke="#06b6d4" strokeWidth="1.2" opacity="0.4">
        <line x1="256" y1="218" x2="256" y2="230"/>
        <line x1="256" y1="286" x2="256" y2="298"/>
        <line x1="216" y1="258" x2="228" y2="258"/>
        <line x1="284" y1="258" x2="296" y2="258"/>
      </g>
      <circle cx="256" cy="258" r="18" fill="url(#sb-pupil)" filter="url(#sb-glow)"/>
      <circle cx="256" cy="258" r="9" fill="#0B1629"/>
      <circle cx="256" cy="258" r="4" fill="#06b6d4" opacity="0.9"/>
      <circle cx="262" cy="252" r="3" fill="white" opacity="0.75"/>
      <ellipse cx="256" cy="258" rx="86" ry="50" fill="none" stroke="#06b6d4" strokeWidth="2.5" opacity="0.55" filter="url(#sb-glow)"/>
      <g fill="#06b6d4" opacity="0.65" filter="url(#sb-glow)">
        <circle cx="170" cy="258" r="4"/>
        <circle cx="342" cy="258" r="4"/>
        <circle cx="210" cy="212" r="3"/>
        <circle cx="302" cy="212" r="3"/>
      </g>
    </svg>
  )
}
