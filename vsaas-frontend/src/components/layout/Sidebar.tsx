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
import { useState, useEffect, useRef } from 'react'
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
  DollarSign, Crown, CreditCard, Shield, Lock, Rocket, HeartPulse, Wallet,
  PanelLeftClose, PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { api } from '../../api/client'
import { isSudoActive } from '../../lib/sudo'

type StaticBadge = 'LIVE' | 'NOVO' | 'PRO' | 'VERTICAL' | 'IA'

interface NavItem {
  to: string
  icon: LucideIcon
  /** Emoji colorido (opcional) — paridade pixel mockup. Se presente, sobrepõe o icon SVG. */
  emoji?: string
  label: string
  badge?: StaticBadge
  /** Source de badge dinâmico (consulta SWR) */
  dynamicBadge?: 'pending_approvals' | 'pending_demos' | 'critical_alerts' | 'tenants_count'
  /** Cor do accent quando ativo (override do default cyan) */
  accent?: 'violet' | 'amber' | 'cyan' | 'emerald' | 'rose'
  /** Acesso a dados sensíveis do cliente final — exige step-up auth (sudo) pra
   * INTEGRADOR_ADMIN. SUPER_ADMIN/CLIENTE_* passam direto. Mostra ícone de
   * cadeado quando sudo não está ativo. */
  sudoRequired?: boolean
  /** Item desabilitado (placeholder de roadmap), não navega. */
  disabled?: boolean
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
      { to: '/',                icon: LayoutDashboard, emoji: '📊', label: 'Dashboard Global', accent: 'violet' },
      { to: '/admin/tenants',   icon: Network,         emoji: '🌐', label: 'Tenants',          accent: 'violet', dynamicBadge: 'tenants_count' },
      { to: '/admin/comercial', icon: Briefcase,       emoji: '💼', label: 'Comercial',        accent: 'amber',  dynamicBadge: 'pending_demos' },
    ],
  },
  {
    id: 'operacao',
    title: 'Operação',
    groupColor: 'amber',
    items: [
      { to: '/admin/alerts', icon: AlertTriangle, emoji: '⚠️', label: 'Alertas e Saúde', accent: 'rose',    dynamicBadge: 'critical_alerts' },
      { to: '/health-scores', icon: Activity,    emoji: '💚', label: 'Saúde dos Clientes', accent: 'emerald' },
      { to: '/admin/trials', icon: Sparkles,    emoji: '🎁', label: 'Trials', accent: 'amber' },
      { to: '/admin/deal-registration', icon: Shield, emoji: '🛡️', label: 'Deal Registration', accent: 'violet' },
      { to: '/log-audit',    icon: ShieldCheck,   emoji: '🛡️', label: 'Log & Audit',     accent: 'emerald' },
      { to: '/admin/lgpd',   icon: Shield,        emoji: '⚖️', label: 'Solicitações LGPD', accent: 'cyan' },
    ],
  },
  {
    id: 'plataforma',
    title: 'Plataforma',
    groupColor: 'slate',
    items: [
      { to: '/admin/catalog',           icon: Puzzle,    emoji: '🧩', label: 'Catálogo de Módulos' },
      { to: '/admin/pricing',           icon: DollarSign, emoji: '💰', label: 'Pricing CMS' },
      { to: '/admin/retention-plans',   icon: HardDrive, emoji: '📦', label: 'Planos de Retenção' },
      { to: '/admin/storage',           icon: Server,    emoji: '🗄️', label: 'Storage Global' },
      { to: '/billing',                 icon: Wallet,    emoji: '💼', label: 'Margem da Plataforma' },
      { to: '/admin/whitelabel/tiers',  icon: Crown,     emoji: '👑', label: 'WL Tiers & Caps' },
      { to: '/admin/whitelabel',        icon: Palette,   emoji: '🎨', label: 'White-label (legado)' },
      { to: '/admin/billing',           icon: CreditCard, emoji: '💳', label: 'Billing (Asaas)' },
      { to: '/admin/integrations',      icon: Zap,       emoji: '⚡', label: 'Integrações' },
      { to: '/settings',                icon: Settings,  emoji: '⚙️', label: 'Settings Avançados' },
    ],
  },
]

// ════════════════════════════════════════════════════════════════════════════
// SIDEBAR · INTEGRADOR_ADMIN
// 3 grupos: COMERCIAL · OPERAÇÃO & SUPORTE · MEU NEGÓCIO
// Items sudoRequired (Live/Gravações/Faces/Placas) ficam só pro ADMIN e
// exigem reautenticação por senha+motivo (LGPD finality).
// ════════════════════════════════════════════════════════════════════════════
const INTEGRADOR_NAV_ADMIN: NavGroup[] = [
  {
    id: 'comercial',
    title: 'Comercial',
    groupColor: 'violet',
    items: [
      { to: '/',                     icon: LayoutDashboard, emoji: '📊', label: 'Cockpit',          accent: 'violet' },
      { to: '/clientes-finais',      icon: Briefcase,       emoji: '👤', label: 'Clientes',         accent: 'cyan' },
      { to: '/me/deal-registration', icon: Shield,          emoji: '🎯', label: 'Pipeline',         accent: 'violet' },
      { to: '/me/sales-kit',         icon: Briefcase,       emoji: '📂', label: 'Sales Kit',        accent: 'amber' },
    ],
  },
  {
    id: 'ops',
    title: 'Operação & Suporte',
    groupColor: 'amber',
    items: [
      { to: '/onboarding/cliente', icon: Rocket,     emoji: '🚀', label: 'Novo Cliente',      badge: 'NOVO', accent: 'cyan' },
      { to: '/health-scores',      icon: HeartPulse, emoji: '💚', label: 'Saúde da Operação', accent: 'emerald' },
      { to: '/review',             icon: Bell,       emoji: '🔔', label: 'Alertas pendentes', dynamicBadge: 'critical_alerts' },
      { to: '/edge',               icon: Cpu,        emoji: '📦', label: 'Frota Edge',        accent: 'cyan' },
      { to: '/log-audit',          icon: FileText,   emoji: '🛡', label: 'Auditoria & LGPD' },
      // Live/Gravações/Faces/Placas/Mapas removidos do menu raiz (decisão LGPD).
      // Acesso a esses dados acontece SÓ via impersonate (atalho "Acessar como…"
      // no topbar) ou via SudoGuard se digitar URL direto. SudoGuard nas rotas
      // continua ativo como defesa em profundidade.
    ],
  },
  {
    id: 'negocio',
    title: 'Meu Negócio',
    groupColor: 'slate',
    items: [
      { to: '/billing',       icon: Wallet,    emoji: '💼', label: 'Faturamento',     badge: 'PRO',   disabled: true },
      { to: '/storage',       icon: Server,    emoji: '🗄️', label: 'Meu Storage',     accent: 'cyan' },
      { to: '/modulos',       icon: Puzzle,    emoji: '🧩', label: 'Planos & Módulos' },
      { to: '/me/whitelabel', icon: Palette,   emoji: '🎨', label: 'White-label',     accent: 'violet' },
      { to: '/users',         icon: Users,     emoji: '👥', label: 'Equipe' },
      { to: '/settings',      icon: Settings,  emoji: '⚙️', label: 'Configurações' },
    ],
  },
]

// SIDEBAR · INTEGRADOR_TECNICO — só operação, sem comercial, sem itens sensíveis
const INTEGRADOR_NAV_TECNICO: NavGroup[] = [
  {
    id: 'ops',
    title: 'Operação & Suporte',
    groupColor: 'amber',
    items: [
      { to: '/',                   icon: LayoutDashboard, emoji: '📊', label: 'Cockpit',           accent: 'violet' },
      { to: '/health-scores',      icon: HeartPulse,      emoji: '💚', label: 'Saúde da Operação', accent: 'emerald' },
      { to: '/review',             icon: Bell,            emoji: '🔔', label: 'Alertas pendentes', dynamicBadge: 'critical_alerts' },
      { to: '/edge',               icon: Cpu,             emoji: '📦', label: 'Frota Edge',        accent: 'cyan' },
      { to: '/sites',              icon: Building2,       emoji: '📍', label: 'Sites & Câmeras' },
      { to: '/maps',               icon: Map,             emoji: '🗺️', label: 'Mapas',             badge: 'NOVO', accent: 'violet' },
      { to: '/log-audit',          icon: FileText,        emoji: '🛡', label: 'Auditoria & LGPD' },
      { to: '/settings',           icon: Settings,        emoji: '⚙️', label: 'Configurações' },
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
      { to: '/',           icon: LayoutDashboard, emoji: '📊', label: 'Dashboard',   accent: 'violet' },
      { to: '/live',       icon: Activity,        emoji: '🔴', label: 'Ao Vivo',     badge: 'LIVE', accent: 'rose' },
      { to: '/cameras',    icon: Camera,          emoji: '📹', label: 'Câmeras' },
      { to: '/maps',       icon: Map,             emoji: '🗺️', label: 'Mapas',       badge: 'NOVO', accent: 'violet' },
      { to: '/recordings', icon: Film,            emoji: '🎬', label: 'Gravações' },
      { to: '/review',     icon: Bell,            emoji: '🔔', label: 'Eventos' },
    ],
  },
  {
    id: 'analytics',
    title: 'Analytics',
    groupColor: 'amber',
    items: [
      { to: '/frigate-reviews', icon: Bell,     emoji: '🚨', label: 'Alertas Frigate', badge: 'NEW', accent: 'rose' },
      { to: '/faces',        icon: Fingerprint, emoji: '😊', label: 'Faces' },
      { to: '/plates',       icon: Car,         emoji: '🚗', label: 'Placas' },
      { to: '/demographics', icon: PieChart,    emoji: '📊', label: 'Demografia' },
      { to: '/heatmap',      icon: Flame,       emoji: '🔥', label: 'Heatmap' },
    ],
  },
  {
    id: 'config',
    title: 'Configuração',
    groupColor: 'slate',
    items: [
      { to: '/users',    icon: Users,    emoji: '👥', label: 'Usuários' },
      { to: '/sites',    icon: Building2, emoji: '📍', label: 'Sites' },
      { to: '/log-audit', icon: FileText, emoji: '🛡️', label: 'Log & Audit' },
      { to: '/settings', icon: Settings, emoji: '🔔', label: 'Notificações' },
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

// Headers de grupo — paridade EXATA mockup 01 (sem text-shadow, simples)
const GROUP_COLOR_STYLES = {
  violet: 'text-violet-700 dark:text-violet-400',
  amber:  'text-amber-700 dark:text-amber-400',
  slate:  'text-slate-500 dark:text-slate-500',
}

// Items ativos — paridade EXATA mockup 01: bg/10 + text-300 + border/30 (simples)
const ACCENT_STYLES = {
  violet:  {
    active: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30',
    icon:   'text-violet-600 dark:text-violet-300',
  },
  amber:   {
    active: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
    icon:   'text-amber-600 dark:text-amber-300',
  },
  cyan:    {
    active: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-500/30',
    icon:   'text-cyan-600 dark:text-cyan-300',
  },
  emerald: {
    active: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
    icon:   'text-emerald-600 dark:text-emerald-300',
  },
  rose:    {
    active: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
    icon:   'text-rose-600 dark:text-rose-300',
  },
}

export interface SidebarProps {
  /** Modo icon-only (64px). Controlado pelo Layout via useSidebarState. */
  collapsed?:        boolean
  /** Botão pin (📌) no header dispara essa callback. */
  onToggleCollapse?: () => void
  /** Quando o sidebar está dentro do drawer mobile, esconde o botão pin
   *  (drawer fecha-e-abre por hambúrguer/backdrop, não por colapso). */
  mobileDrawer?:     boolean
  /** Callback chamada quando usuário clica num NavLink (mobile precisa
   *  fechar o drawer ao navegar). */
  onNavigate?:       () => void
}

export function Sidebar({
  collapsed = false, onToggleCollapse, mobileDrawer = false, onNavigate,
}: SidebarProps = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const role = (typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : '')

  // Hover-expand: quando colapsado e mouse sobre o sidebar por >150ms,
  // expande visualmente (POR CIMA do conteúdo, sem empurrar). Sai do hover
  // → re-colapsa em 200ms. Não persiste — é só visual transient.
  // Desabilitado em mobile (drawer já é overlay) e quando expandido (no-op).
  const [hoverExpand, setHoverExpand] = useState(false)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleMouseEnter() {
    if (!collapsed || mobileDrawer) return
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setHoverExpand(true), 150)
  }
  function handleMouseLeave() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setHoverExpand(false), 200)
  }
  // Quando muda o estado collapsed do parent, reseta hover-expand
  useEffect(() => { setHoverExpand(false) }, [collapsed])

  // Visualmente expandido = colapsado=false  OU  hover-expand ativo.
  // Pra width transition, não muda a árvore — só a classe.
  const visuallyExpanded = !collapsed || hoverExpand
  const showLabels       = visuallyExpanded

  // Escolhe estrutura por persona — INTEGRADOR_TECNICO vê só operação,
  // sem comercial e sem itens que exigem sudo (que ele não pode elevar).
  const groups: NavGroup[] = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
    ? SUPER_ADMIN_NAV
    : role === 'INTEGRADOR_ADMIN'
      ? INTEGRADOR_NAV_ADMIN
      : role === 'INTEGRADOR_TECNICO'
        ? INTEGRADOR_NAV_TECNICO
        : role.startsWith('CLIENTE_') || role === 'CLIENT_ADMIN'
          ? CLIENTE_NAV
          : SUPER_ADMIN_NAV  // fallback para roles desconhecidos

  // Reage a mudanças do estado sudo pra atualizar lock icons em tempo real
  const [sudoActive, setSudoActive] = useState(isSudoActive())
  useEffect(() => {
    function refresh() { setSudoActive(isSudoActive()) }
    window.addEventListener('icv-sudo-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('icv-sudo-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

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
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'fixed left-0 top-0 h-full group/sidebar z-40 overflow-hidden',
        // Largura: 64px colapsado, 256px expandido. Transição suave.
        // Em hover-expand, ele "salta" de 64 pra 256 via mesma transição.
        'transition-[width] duration-200 ease-out',
        visuallyExpanded ? 'w-64' : 'w-16',
        // Quando hover-expand ativo (mas collapsed=true), eleva o z-index
        // pra ficar acima do conteúdo (overlay sem deslocar layout).
        collapsed && hoverExpand && 'shadow-2xl',
      )}
    >
      {/* Background */}
      <div className={cn(
        'absolute inset-0 backdrop-blur-xl border-r',
        'bg-white/95 border-slate-200',
        'dark:bg-slate-900/80 dark:border-slate-800',
      )} />

      <div className="relative flex flex-col h-full py-4">
        {/* Logo + brand + botão pin — clicável retorna pro dashboard ("/") */}
        <div className="px-3 pb-4 mb-2 shrink-0 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <NavLink
              to="/"
              title="Voltar ao Dashboard"
              className="flex items-center gap-2.5 flex-1 min-w-0 hover:opacity-80 transition-opacity rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center bg-gradient-to-br from-violet-500 to-cyan-500">
                {/* SVG eye */}
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
                </svg>
              </div>
              {showLabels && (
                <div className="whitespace-nowrap overflow-hidden flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight truncate">IA Cloud Vision</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider leading-tight truncate">VSaaS · IA · Analytics</p>
                </div>
              )}
            </NavLink>
            {/* Pin toggle — só não aparece em mobile drawer (lá o botão é o
                hambúrguer/backdrop que controla open/close). */}
            {!mobileDrawer && onToggleCollapse && showLabels && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title={collapsed ? 'Fixar sidebar (Ctrl+\\)' : 'Recolher sidebar (Ctrl+\\)'}
                className={cn(
                  'p-1.5 rounded-md shrink-0 transition',
                  'text-slate-500 hover:text-cyan-700 hover:bg-cyan-100',
                  'dark:hover:text-cyan-300 dark:hover:bg-cyan-500/15',
                )}
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}
            {/* Quando colapsado sem hover, mostra um botão flutuante pequeno
                pra "fixar expandido". Aparece centrado no header. */}
            {!mobileDrawer && onToggleCollapse && !showLabels && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Fixar sidebar (Ctrl+\\)"
                className={cn(
                  'absolute -right-1 top-3 p-1 rounded-md transition',
                  'bg-white border border-slate-200 text-slate-500 hover:text-cyan-700 hover:bg-cyan-50 shadow-sm',
                  'dark:bg-slate-800 dark:border-slate-700 dark:hover:text-cyan-300 dark:hover:bg-cyan-500/10',
                )}
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </button>
            )}
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
            <div key={group.id} className={cn(gIdx > 0 && 'mt-4')}>
              {/* Header do grupo — quando colapsado vira um traço sutil em vez de texto */}
              {showLabels ? (
                <p className={cn(
                  'px-2 mb-2 text-[10px] uppercase tracking-wider font-bold whitespace-nowrap overflow-hidden',
                  group.groupColor ? GROUP_COLOR_STYLES[group.groupColor] : 'text-slate-500',
                )}>
                  {group.title}
                </p>
              ) : gIdx > 0 ? (
                <div className="mx-3 mb-2 h-px bg-slate-200 dark:bg-slate-700/50" />
              ) : null}

              <div className="space-y-0.5">
                {group.items.map(item => (
                  <NavRow
                    key={item.to}
                    item={item}
                    active={isActive(location.pathname, item.to)}
                    dynamicValue={item.dynamicBadge ? badges[item.dynamicBadge] : undefined}
                    sudoActive={sudoActive}
                    showLabels={showLabels}
                    onClick={onNavigate}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom: persona + logout */}
        <div className="px-3 mt-3 pt-3 shrink-0 border-t border-slate-200 dark:border-slate-800">
          <div className={cn(
            'flex items-center gap-2 rounded-lg overflow-hidden transition hover:bg-slate-100 dark:hover:bg-slate-800/50',
            showLabels ? 'px-2 py-1.5' : 'px-1.5 py-1.5 justify-center',
          )}>
            <div
              className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shrink-0 text-xs font-bold text-white"
              title={!showLabels ? `${personaLabel} · ${personaSub}` : undefined}
            >
              {(role[0] ?? 'U').toUpperCase()}
            </div>
            {showLabels && (
              <>
                <div className="flex-1 min-w-0 whitespace-nowrap">
                  <p className="text-xs font-medium truncate text-slate-700 dark:text-white">{personaLabel}</p>
                  <p className="text-[10px] truncate text-slate-500 dark:text-slate-500">{personaSub}</p>
                </div>
                <button
                  onClick={handleLogout}
                  title="Sair"
                  className={cn(
                    'transition p-1 rounded',
                    'text-slate-500 hover:bg-rose-100 hover:text-rose-600',
                    'dark:hover:bg-rose-500/15 dark:hover:text-rose-400',
                  )}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
          {/* Logout discreto fora do card quando colapsado */}
          {!showLabels && (
            <button
              onClick={handleLogout}
              title="Sair"
              className={cn(
                'mt-2 w-full flex items-center justify-center p-1.5 rounded-md transition',
                'text-slate-500 hover:bg-rose-100 hover:text-rose-600',
                'dark:hover:bg-rose-500/15 dark:hover:text-rose-400',
              )}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function NavRow({ item, active, dynamicValue, sudoActive, showLabels = true, onClick }: {
  item: NavItem
  active: boolean
  dynamicValue?: number
  sudoActive?: boolean
  showLabels?: boolean
  onClick?: () => void
}) {
  const Icon = item.icon
  const accent = item.accent ? ACCENT_STYLES[item.accent] : null
  const showLock = item.sudoRequired && !sudoActive

  // Tooltip (collapsed): label do item + badge se houver. native title= é
  // suficiente — não vale custom tooltip pra item de menu (UX consagrado).
  const tooltipText = !showLabels
    ? `${item.label}${item.badge ? ` · ${item.badge}` : ''}${(dynamicValue ?? 0) > 0 ? ` (${dynamicValue})` : ''}`
    : undefined

  // Disabled (placeholder de roadmap) — render como div opaco sem nav
  if (item.disabled) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg overflow-hidden border border-dashed cursor-not-allowed opacity-60',
          showLabels ? 'px-3 py-2' : 'px-2 py-2 justify-center',
          'border-slate-300 text-slate-400',
          'dark:border-slate-700 dark:text-slate-500',
        )}
        title={tooltipText ?? 'Em desenvolvimento — em breve'}
      >
        {item.emoji ? (
          <span className="text-base leading-none w-5 shrink-0 text-center select-none opacity-60" aria-hidden>{item.emoji}</span>
        ) : (
          <Icon className="w-5 h-5 shrink-0 opacity-60" />
        )}
        {showLabels && (
          <>
            <span className="text-sm font-medium whitespace-nowrap overflow-hidden flex-1">{item.label}</span>
            {item.badge && (
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border',
                STATIC_BADGE_STYLES[item.badge],
              )}>{item.badge}</span>
            )}
          </>
        )}
      </div>
    )
  }

  // Em modo collapsed, badges (estático/dinâmico) viram um DOT no canto
  // do ícone — sinaliza atenção sem ocupar largura.
  const hasBadgeIndicator =
    (dynamicValue !== undefined && dynamicValue > 0) ||
    (item.badge !== undefined)
  const indicatorTone =
    item.dynamicBadge === 'critical_alerts'
      ? 'bg-rose-500'
      : item.badge === 'NOVO' || item.badge === 'PRO'
        ? 'bg-fuchsia-500'
        : item.badge === 'LIVE'
          ? 'bg-rose-500 animate-pulse'
          : 'bg-cyan-500'

  return (
    <NavLink to={item.to} onClick={onClick}>
      <div
        title={tooltipText}
        className={cn(
          'flex items-center rounded-lg transition-colors group/item overflow-hidden border',
          showLabels ? 'gap-3 px-3 py-2' : 'gap-0 px-2 py-2 justify-center',
          active
            ? accent?.active ?? 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-500/30'
            : 'border-transparent text-slate-700 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50',
        )}
      >
        {/* Ícone (com indicador dot quando colapsado e há badge) */}
        <div className="relative shrink-0">
          {item.emoji ? (
            <span className="text-base leading-none w-5 inline-block text-center select-none" aria-hidden>
              {item.emoji}
            </span>
          ) : (
            <Icon className={cn(
              'w-5 h-5 transition-colors',
              active
                ? (accent?.icon ?? 'text-cyan-600 dark:text-cyan-300')
                : 'text-slate-500 dark:text-slate-400 group-hover/item:text-slate-900 dark:group-hover/item:text-white',
            )} />
          )}
          {!showLabels && hasBadgeIndicator && (
            <span className={cn(
              'absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-white dark:ring-slate-900',
              indicatorTone,
            )} />
          )}
        </div>

        {showLabels && (
          <>
            <span className="text-sm font-medium whitespace-nowrap overflow-hidden flex-1">
              {item.label}
            </span>

            {/* Cadeado sudo */}
            {showLock && (
              <Lock
                className="w-3 h-3 shrink-0 text-amber-500/70 dark:text-amber-400/80"
                aria-label="requer reautenticação"
              />
            )}

            {/* Badge dinâmico vence estático */}
            {dynamicValue !== undefined && dynamicValue > 0 && (
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border',
                item.dynamicBadge === 'critical_alerts'
                  ? 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/30 dark:text-rose-300 dark:border-rose-500/40 animate-pulse'
                  : item.dynamicBadge === 'pending_demos'
                    ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/30 dark:text-amber-300 dark:border-amber-500/40'
                    : 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/30 dark:text-violet-300 dark:border-violet-500/40',
              )}>
                {dynamicValue > 99 ? '99+' : dynamicValue}
              </span>
            )}
            {dynamicValue === undefined && item.badge && (
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border',
                STATIC_BADGE_STYLES[item.badge],
              )}>
                {item.badge}
              </span>
            )}
            {active && (
              <ChevronRight className={cn(
                'w-3 h-3 shrink-0',
                accent?.icon ?? 'text-cyan-600 dark:text-cyan-500',
              )} />
            )}
          </>
        )}
      </div>
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
