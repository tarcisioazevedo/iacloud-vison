/**
 * Sidebar — navegação principal do dashboard.
 *
 * Grupos (7 grupos coesos, sem item orphan):
 *   - **Operação**  — rotina diária do operador (Dashboard, Live, Mapa,
 *     Gravações, Eventos, Câmeras, Sites).
 *   - **IA & Detecção** — features alimentadas por modelos de visão
 *     computacional (Gatilhos, Regras, Busca IA, Faces, Placas, Heatmap, Demo).
 *   - **Analytics** — relatórios históricos e consumo (Analytics, Consumo, Logs).
 *   - **Infra** — recursos de infraestrutura multi-tenant (Federação, Smart City,
 *     Edge Nodes, MQTT).
 *   - **Gestão** — administração de entidades: Usuários, Clientes, Integradores,
 *     Módulos, Domínios.
 *   - **Admin** — operações críticas visíveis apenas para SUPER_ADMIN / ADMIN_GLOBAL
 *     (CRM & Leads, Ingest Log, Auditoria).
 *   - **Sistema** — configurações de conta/plataforma.
 *
 * Regras de ícone: cada ícone é usado em NO MÁXIMO um item de nav.
 * Regra de badge: "NOVO" só para funcionalidades < 60 dias no ar; "IA" para
 * features de modelos de visão; "LIVE"/"PRO"/"VERTICAL" para estados permanentes.
 */
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Activity, Camera, Map, Users,
  ShieldCheck, BarChart3, Settings, Bell, LogOut,
  Cpu, ChevronRight, Puzzle, FileText, Fingerprint,
  Car, Brain, Share2, Building2, Sparkles, Radio, Gauge, Film,
  Inbox, Globe, Server,
  // ícones adicionados na auditoria — substituem duplicatas
  Flame, Landmark, Briefcase, Network, Terminal, ScrollText, PieChart,
} from 'lucide-react'
import { cn } from '../../lib/utils'

type Badge = 'LIVE' | 'NOVO' | 'PRO' | 'VERTICAL' | 'IA' | null

interface NavItem {
  to: string
  icon: any
  label: string
  badge: Badge
  /** roles que podem ver. `null` = todos. */
  roles: string[] | null
}

interface NavGroup {
  id: string
  title: string
  items: NavItem[]
}

/**
 * Grupos. Ordem aqui é a ordem visual no sidebar.
 *
 * Para adicionar nova entrada:
 *   1. Escolha o grupo apropriado e verifique que o ícone não está sendo
 *      usado em outro item — cada ícone deve ser único na nav.
 *   2. Adicione `{ to, icon, label, badge, roles }`.
 *   3. badge 'IA' → feature de modelo de visão; 'NOVO' → < 60 dias no ar
 *      (remova depois desse prazo). 'PRO'/'VERTICAL' → estado permanente.
 */
const NAV_GROUPS: NavGroup[] = [
  // ── 1. Operação ──────────────────────────────────────────────────────────
  // Rotina diária do operador de câmeras.
  {
    id: 'operacao',
    title: 'Operação',
    items: [
      { to: '/',           icon: LayoutDashboard, label: 'Dashboard',  badge: null,   roles: null },
      { to: '/live',       icon: Activity,        label: 'Ao Vivo',    badge: 'LIVE', roles: null },
      { to: '/live/map',   icon: Map,             label: 'Mapa',       badge: null,   roles: null },
      { to: '/recordings', icon: Film,            label: 'Gravações',  badge: 'NOVO', roles: null },
      { to: '/review',     icon: Bell,            label: 'Eventos',    badge: null,   roles: null },
      { to: '/cameras',    icon: Camera,          label: 'Câmeras',    badge: null,   roles: null },
      { to: '/sites',      icon: Building2,       label: 'Sites',      badge: null,   roles: ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'CLIENT_ADMIN'] },
    ],
  },

  // ── 2. IA & Detecção ─────────────────────────────────────────────────────
  // Features alimentadas por modelos de visão computacional / embeddings.
  // EPI omitido intencionalmente — página ainda é PlaceholderPage.
  {
    id: 'ia',
    title: 'IA & Detecção',
    items: [
      { to: '/triggers',     icon: Sparkles,    label: 'Gatilhos IA', badge: 'IA',   roles: null },
      { to: '/review/rules', icon: ShieldCheck, label: 'Regras',      badge: null,   roles: ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'CLIENT_ADMIN'] },
      { to: '/semantic',     icon: Brain,       label: 'Busca IA',    badge: 'IA',   roles: null },
      { to: '/faces',        icon: Fingerprint, label: 'Faces',       badge: null,   roles: null },
      { to: '/plates',       icon: Car,         label: 'Placas',      badge: null,   roles: null },
      // Flame ≠ Map (Mapa usa Map); PieChart ≠ Users (Usuários usa Users)
      { to: '/heatmap',      icon: Flame,       label: 'Heatmap',     badge: null,   roles: null },
      { to: '/demographics', icon: PieChart,    label: 'Demografia',  badge: null,   roles: null },
    ],
  },

  // ── 3. Analytics ─────────────────────────────────────────────────────────
  // Relatórios históricos, consumo e logs operacionais.
  {
    id: 'analytics',
    title: 'Analytics',
    items: [
      { to: '/analytics', icon: BarChart3, label: 'Analytics', badge: null, roles: null },
      { to: '/quota',     icon: Gauge,     label: 'Consumo',   badge: null, roles: null },
      { to: '/logs',      icon: FileText,  label: 'Logs',      badge: null, roles: null },
    ],
  },

  // ── 4. Infra ─────────────────────────────────────────────────────────────
  // Infraestrutura multi-tenant: rede, streaming e hardware de campo.
  {
    id: 'infra',
    title: 'Infra',
    items: [
      { to: '/federation',        icon: Share2,    label: 'Federação',  badge: 'PRO',      roles: null },
      // Landmark ≠ Building2 (Sites usa Building2)
      { to: '/smart-city',        icon: Landmark,  label: 'Smart City', badge: 'VERTICAL', roles: null },
      // Fleet é a visão centralizada da frota de edge nodes (Fleet UI)
      { to: '/fleet',             icon: Server,    label: 'Fleet',      badge: null,       roles: null },
      { to: '/edge',              icon: Cpu,       label: 'Edge Nodes', badge: null,       roles: ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'] },
      { to: '/integrations/mqtt', icon: Radio,     label: 'MQTT',       badge: null,       roles: ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'] },
    ],
  },

  // ── 5. Gestão ─────────────────────────────────────────────────────────────
  // Administração de entidades de negócio: usuários, tenants, módulos.
  {
    id: 'gestao',
    title: 'Gestão',
    items: [
      { to: '/users',              icon: Users,     label: 'Usuários',        badge: null,   roles: ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'CLIENT_ADMIN', 'CLIENTE_ADMIN'] },
      // Briefcase ≠ Building2 (Sites usa Building2); Network ≠ Building2
      { to: '/clientes-finais',    icon: Briefcase, label: 'Clientes Finais', badge: null,   roles: ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'] },
      { to: '/admin/integradores', icon: Network,   label: 'Integradores',    badge: null,   roles: ['SUPER_ADMIN'] },
      // Módulos: role-split intencional — cada role vê apenas a sua rota.
      { to: '/modulos',            icon: Puzzle,    label: 'Módulos',         badge: null,   roles: ['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'] },
      { to: '/admin/modulos',      icon: Puzzle,    label: 'Módulos',         badge: null,   roles: ['SUPER_ADMIN'] },
      { to: '/custom-domains',     icon: Globe,     label: 'Domínios',        badge: 'NOVO', roles: ['SUPER_ADMIN', 'ADMIN_GLOBAL', 'INTEGRADOR_ADMIN', 'CLIENTE_ADMIN'] },
    ],
  },

  // ── 6. Admin ──────────────────────────────────────────────────────────────
  // Operações críticas visíveis apenas para SUPER_ADMIN / ADMIN_GLOBAL.
  // Terminal ≠ Activity (Ao Vivo usa Activity); ScrollText = auditoria.
  {
    id: 'admin',
    title: 'Admin',
    items: [
      { to: '/admin/leads',      icon: Inbox,      label: 'CRM & Leads', badge: null, roles: ['SUPER_ADMIN', 'ADMIN_GLOBAL'] },
      { to: '/admin/ingest-log', icon: Terminal,   label: 'Ingest Log',  badge: null, roles: ['SUPER_ADMIN'] },
      { to: '/audit',            icon: ScrollText, label: 'Auditoria',   badge: null, roles: ['SUPER_ADMIN'] },
    ],
  },

  // ── 7. Sistema ────────────────────────────────────────────────────────────
  {
    id: 'sistema',
    title: 'Sistema',
    items: [
      { to: '/settings', icon: Settings, label: 'Configurações', badge: null, roles: null },
    ],
  },
]

// Cada badge ganha versão light (bg sólido suave + texto saturado) e dark
// (bg translúcido + texto pastel) para legibilidade nos dois temas.
const BADGE_STYLES: Record<NonNullable<Badge>, string> = {
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

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const role = localStorage.getItem('icv_role') ?? ''

  // Filtra cada grupo pelo role e descarta grupos que ficaram vazios.
  const visibleGroups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => !i.roles || i.roles.includes(role)) }))
    .filter(g => g.items.length > 0)

  function handleLogout() {
    localStorage.removeItem('icv_token')
    localStorage.removeItem('icv_role')
    localStorage.removeItem('icv_must_change_pw')
    navigate('/login', { replace: true })
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-16 hover:w-60 group/sidebar transition-all duration-300 z-40 overflow-hidden">
      {/* Background — branca translúcida no LIGHT, glass space-900 no DARK */}
      <div className={cn(
        'absolute inset-0 backdrop-blur-xl border-r',
        'bg-white/95 border-slate-200',
        'dark:bg-space-900/95 dark:border-white/8',
      )} />

      <div className="relative flex flex-col h-full py-4">
        {/* Logo */}
        <div className="px-3 mb-4 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            {/* Ícone da marca: nuvem com olho */}
            <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center overflow-hidden shadow-[0_0_18px_-4px_rgba(6,182,212,0.7)]">
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
                {/* BG */}
                <rect width="512" height="512" rx="96" fill="url(#sb-bg)"/>
                {/* Cloud body */}
                <ellipse cx="185" cy="265" rx="73" ry="66" fill="url(#sb-cloud)"/>
                <ellipse cx="256" cy="238" rx="100" ry="88" fill="url(#sb-cloud)"/>
                <ellipse cx="330" cy="260" rx="78" ry="70" fill="url(#sb-cloud)"/>
                <rect x="152" y="272" width="220" height="66" rx="8" fill="url(#sb-cloud)"/>
                {/* Inner dark zone */}
                <ellipse cx="256" cy="258" rx="136" ry="96" fill="#0d2a4a" opacity="0.5"/>
                {/* Eye white */}
                <ellipse cx="256" cy="258" rx="86" ry="50" fill="white" opacity="0.95"/>
                {/* Iris */}
                <circle cx="256" cy="258" r="40" fill="url(#sb-iris)"/>
                <circle cx="256" cy="258" r="40" fill="none" stroke="#06b6d4" strokeWidth="2" opacity="0.7"/>
                <circle cx="256" cy="258" r="28" fill="none" stroke="#06b6d4" strokeWidth="1.5" opacity="0.45"/>
                {/* Spokes */}
                <g stroke="#06b6d4" strokeWidth="1.2" opacity="0.4">
                  <line x1="256" y1="218" x2="256" y2="230"/>
                  <line x1="256" y1="286" x2="256" y2="298"/>
                  <line x1="216" y1="258" x2="228" y2="258"/>
                  <line x1="284" y1="258" x2="296" y2="258"/>
                  <line x1="228" y1="230" x2="236" y2="238"/>
                  <line x1="276" y1="278" x2="284" y2="286"/>
                  <line x1="284" y1="230" x2="276" y2="238"/>
                  <line x1="236" y1="278" x2="228" y2="286"/>
                </g>
                {/* Pupil */}
                <circle cx="256" cy="258" r="18" fill="url(#sb-pupil)" filter="url(#sb-glow)"/>
                <circle cx="256" cy="258" r="9" fill="#0B1629"/>
                <circle cx="256" cy="258" r="4" fill="#06b6d4" opacity="0.9"/>
                <circle cx="262" cy="252" r="3" fill="white" opacity="0.75"/>
                {/* Eye glow outline */}
                <ellipse cx="256" cy="258" rx="86" ry="50" fill="none" stroke="#06b6d4" strokeWidth="2.5" opacity="0.55" filter="url(#sb-glow)"/>
                {/* Node dots */}
                <g fill="#06b6d4" opacity="0.65" filter="url(#sb-glow)">
                  <circle cx="170" cy="258" r="4"/>
                  <circle cx="342" cy="258" r="4"/>
                  <circle cx="210" cy="212" r="3"/>
                  <circle cx="302" cy="212" r="3"/>
                </g>
                <g stroke="#06b6d4" strokeWidth="1" opacity="0.25">
                  <line x1="170" y1="258" x2="132" y2="338"/>
                  <line x1="342" y1="258" x2="380" y2="338"/>
                  <line x1="210" y1="212" x2="178" y2="168"/>
                  <line x1="302" y1="212" x2="334" y2="168"/>
                </g>
              </svg>
            </div>
            <div className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 whitespace-nowrap overflow-hidden">
              <p className="text-xs font-bold tracking-wide text-slate-900 dark:text-white">
                IA <span className="text-cyan-600 dark:text-cyan-400">Cloud Vision</span>
              </p>
              <p className="text-[9px] text-cyan-700/70 dark:text-cyan-500/70">VSaaS · IA · Analytics</p>
            </div>
          </div>
        </div>

        {/* Nav agrupada — scroll vertical interno se necessário, scrollbar fina */}
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
          {visibleGroups.map((group, gIdx) => (
            <div key={group.id} className={cn(gIdx > 0 && 'mt-3 pt-3 border-t border-slate-200/70 dark:border-white/5')}>
              {/* Header do grupo — só aparece quando expandido */}
              <p className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 px-3 mb-1 text-[9px] uppercase tracking-[0.14em] font-bold whitespace-nowrap overflow-hidden text-slate-400 dark:text-slate-600">
                {group.title}
              </p>

              <div className="space-y-0.5">
                {group.items.map(item => (
                  <NavRow
                    key={item.to}
                    item={item}
                    active={isActive(location.pathname, item.to)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom: user + logout */}
        <div className="px-2 mt-3 pt-3 shrink-0 border-t border-slate-200 dark:border-white/8">
          <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl overflow-hidden transition hover:bg-slate-100 dark:hover:bg-white/5">
            <div className="w-7 h-7 rounded-full bg-brand-gradient flex items-center justify-center shrink-0 text-xs font-bold text-white shadow-sky-glow">
              {(role[0] ?? 'U').toUpperCase()}
            </div>
            <div className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 flex-1 min-w-0 whitespace-nowrap">
              <p className="text-xs font-medium truncate text-slate-700 dark:text-slate-300">
                {role === 'SUPER_ADMIN' ? 'Super Admin' : role === 'INTEGRADOR_ADMIN' ? 'Integrador' : role || 'Usuário'}
              </p>
              <p className="text-[9px] truncate text-slate-500 dark:text-slate-600">{role.toLowerCase().replace(/_/g, ' ') || 'sessão ativa'}</p>
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
function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <NavLink to={item.to}>
      <motion.div
        whileHover={{ x: 2 }}
        className={cn(
          'flex items-center gap-3 px-2.5 py-2 rounded-xl transition-all duration-200 group/item overflow-hidden border',
          active
            // Estado ATIVO: pílula cyan suave (light) / glass cyan (dark).
            ? cn(
                'bg-cyan-50 text-cyan-700 border-cyan-200',
                'dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/25',
                'dark:shadow-[0_0_20px_-10px_rgba(34,211,238,0.5)]',
              )
            // Estado INATIVO: cinza neutro com hover sutil.
            : cn(
                'border-transparent',
                'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
                'dark:text-slate-500 dark:hover:text-slate-100 dark:hover:bg-white/5',
              ),
        )}
      >
        <Icon className={cn(
          'w-5 h-5 shrink-0 transition-colors',
          active
            ? 'text-cyan-600 dark:text-cyan-400'
            : 'group-hover/item:text-slate-900 dark:group-hover/item:text-slate-200',
        )} />
        <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 text-sm font-medium whitespace-nowrap overflow-hidden flex-1">
          {item.label}
        </span>
        {item.badge && (
          <span className={cn(
            'opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200',
            'text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border',
            BADGE_STYLES[item.badge],
          )}>
            {item.badge}
          </span>
        )}
        {active && (
          <ChevronRight className="opacity-0 group-hover/sidebar:opacity-100 w-3 h-3 shrink-0 text-cyan-600 dark:text-cyan-500" />
        )}
      </motion.div>
    </NavLink>
  )
}

/**
 * Calcula se uma rota está ativa.
 *
 * Pega match exato e prefix-match para subrotas (ex.: /cameras/abc → /cameras
 * fica ativo). Exceção: '/' só ativa em match exato — senão tudo casaria.
 */
function isActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(to + '/')
}
