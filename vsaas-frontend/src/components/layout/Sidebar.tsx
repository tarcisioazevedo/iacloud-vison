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

import useSWR from 'swr'
import {
  LayoutDashboard, Activity, Camera, Map, Users,
  ShieldCheck, Settings, Bell, LogOut,
  Cpu, ChevronRight, Puzzle, FileText, Fingerprint,
  Car, Building2, Sparkles, Film,
  Server,
  Flame, Briefcase, Network, PieChart,
  Palette, Zap, ShoppingBag, AlertTriangle, HardDrive,
  DollarSign, CreditCard, Shield, Lock, Rocket, HeartPulse, Wallet,
  PanelLeftClose, PanelLeftOpen, ClipboardList,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { api } from '../../api/client'
import { isSudoActive } from '../../lib/sudo'
import { useMyCapabilities } from '../../hooks/useMyCapabilities'

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
  /** Match exato de rota — não ativa para sub-rotas (ex: /admin/whitelabel não
   * deve ficar ativo quando estiver em /admin/whitelabel/tiers). */
  exact?: boolean
  /**
   * Capability necessária pra ver esse item. Se cliente não tem, item somee
   * do menu (mode='hide'). Não passar = item visível pra todos com role compatível.
   * Aplicado apenas para role CLIENTE_* (integrador/admin sempre vê tudo).
   * Aceita string (1 cap) ou array (qualquer uma das listadas libera).
   */
  cap?: string | string[]
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
      { to: '/admin/alerts',        icon: AlertTriangle, emoji: '⚠️', label: 'Alertas e Saúde',   accent: 'rose',    dynamicBadge: 'critical_alerts' },
      { to: '/admin/recording-ops',    icon: Activity,    emoji: '📹', label: 'Recording Ops',     accent: 'cyan' },
      { to: '/admin/gemini-ops',       icon: Sparkles,    emoji: '🤖', label: 'Gemini Ops',         badge: 'IA', accent: 'violet' },
      { to: '/admin/storage-health',   icon: HeartPulse,  emoji: '🩺', label: 'Storage Health',     accent: 'emerald' },
      { to: '/health-scores',       icon: HeartPulse,    emoji: '💚', label: 'Saúde dos Clientes', accent: 'emerald' },
      { to: '/maps',                icon: Map,           emoji: '🗺️', label: 'Mapa Global',        accent: 'violet' },
      { to: '/admin/trials',        icon: Sparkles,      emoji: '🎁', label: 'Trials',             accent: 'amber' },
      { to: '/admin/deal-registration', icon: Shield,    emoji: '🛡️', label: 'Deal Registration', accent: 'violet' },
      { to: '/log-audit',           icon: ShieldCheck,   emoji: '🛡️', label: 'Log & Audit',       accent: 'emerald' },
      { to: '/admin/lgpd',          icon: Shield,        emoji: '⚖️', label: 'Solicitações LGPD', accent: 'cyan' },
    ],
  },
  {
    id: 'plataforma',
    title: 'Plataforma',
    groupColor: 'slate',
    items: [
      { to: '/admin/marketplace/fabricante', icon: ShoppingBag, emoji: '🛍️', label: 'Marketplace',  badge: 'NOVO', accent: 'violet' },
      { to: '/admin/catalog',           icon: Puzzle,    emoji: '🧩', label: 'Catálogo de Módulos' },
      { to: '/admin/pricing',           icon: DollarSign, emoji: '💰', label: 'Pricing CMS' },
      { to: '/admin/retention-plans',   icon: HardDrive, emoji: '📦', label: 'Planos de Retenção' },
      { to: '/admin/storage',           icon: Server,    emoji: '🗄️', label: 'Storage Global' },
      { to: '/billing',                 icon: Wallet,    emoji: '💼', label: 'Margem da Plataforma' },
      { to: '/admin/whitelabel',         icon: Palette, emoji: '🎨', label: 'White-label',             accent: 'violet' },
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
      { to: '/maps',               icon: Map,        emoji: '🗺️', label: 'Mapas',             accent: 'violet' },
      { to: '/log-audit',          icon: FileText,   emoji: '🛡', label: 'Auditoria & LGPD' },
      // Live/Gravações/Faces/Placas/Câmeras removidos do menu raiz (decisão LGPD).
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
      { to: '/marketplace',            icon: ShoppingBag,    emoji: '🛍️', label: 'Marketplace',          badge: 'NOVO', accent: 'amber' },
      { to: '/marketplace/integrador', icon: LayoutDashboard, emoji: '📊', label: 'Gestão Marketplace',   badge: 'NOVO', accent: 'cyan' },
      { to: '/billing',       icon: Wallet,    emoji: '💼', label: 'Faturamento',     badge: 'PRO',   disabled: true },
      { to: '/storage',       icon: Server,    emoji: '🗄️', label: 'Meu Storage',     accent: 'cyan' },
      { to: '/modulos',       icon: Puzzle,    emoji: '🧩', label: 'Planos & Módulos' },
      { to: '/me/whitelabel', icon: Palette,   emoji: '🎨', label: 'White-label',     accent: 'violet' },
      { to: '/me/integrador/gemini', icon: Sparkles, emoji: '🤖', label: 'Gemini IA (BYOK)', badge: 'IA', accent: 'cyan' },
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
      { to: '/',              icon: LayoutDashboard, emoji: '📊', label: 'Cockpit',           accent: 'violet' },
      { to: '/health-scores', icon: HeartPulse,      emoji: '💚', label: 'Saúde da Operação', accent: 'emerald' },
      { to: '/review',        icon: Bell,            emoji: '🔔', label: 'Alertas pendentes', dynamicBadge: 'critical_alerts' },
      { to: '/edge',          icon: Cpu,             emoji: '📦', label: 'Frota Edge',        accent: 'cyan' },
      { to: '/sites',         icon: Building2,       emoji: '📍', label: 'Sites' },
      { to: '/maps',          icon: Map,             emoji: '🗺️', label: 'Mapas',             accent: 'violet' },
      { to: '/log-audit',     icon: FileText,        emoji: '🛡', label: 'Auditoria & LGPD' },
    ],
  },
  {
    id: 'perfil',
    title: 'Meu Perfil',
    groupColor: 'slate',
    items: [
      // Marketplace read-only: técnico vê assinaturas dos clientes (scoped por integradorId no backend)
      { to: '/marketplace', icon: ShoppingBag, emoji: '🛍️', label: 'Marketplace', accent: 'amber' },
      { to: '/settings',    icon: Settings,    emoji: '⚙️', label: 'Configurações' },
    ],
  },
]

// ════════════════════════════════════════════════════════════════════════════
// SIDEBAR · CLIENTE_* (CLIENTE FINAL)
// 5 grupos: MONITORAMENTO · MINHA INFRAESTRUTURA · ANALYTICS · MARKETPLACE · MINHA CONTA
//
// Única camada com acesso direto a câmeras (live, playback, etc.).
// INTEGRADOR acessa esses dados SOMENTE via impersonation (botão "Acessar como…").
// Sites/Mapas/Edge = view da infraestrutura instalada para este clienteFinalId
// (mesmo path que integrador, dados scoped por clienteFinalId no backend).
// ════════════════════════════════════════════════════════════════════════════
const CLIENTE_NAV: NavGroup[] = [
  {
    id: 'monitoramento',
    title: 'Monitoramento',
    groupColor: 'violet',
    items: [
      { to: '/',           icon: LayoutDashboard, emoji: '📊', label: 'Dashboard',       accent: 'violet' },
      { to: '/live',       icon: Activity,        emoji: '🔴', label: 'Ao Vivo',         badge: 'LIVE', accent: 'rose' },
      { to: '/recordings', icon: Film,            emoji: '🎬', label: 'Gravações' },
      // P1-5: Busca por Zona absorvida como tab interna de /recordings (link direto pra tab via query string).
      // P0-3: "Cockpit IA" renomeado pra "Busca Avançada" — desambigua de Dashboard, reforça função real.
      { to: '/cockpit',    icon: Sparkles,        emoji: '🚀', label: 'Busca Avançada',  badge: 'IA',  accent: 'cyan',
        cap: ['ai.semantic.process', 'ai.detection.basic'] },
      { to: '/review',     icon: Bell,            emoji: '🔔', label: 'Eventos & Alertas' },  // sempre visível — Review é dado próprio
      // P1-6: Mapas movido de Infra → Monitoramento (mapa de câmeras é função operacional, não de cadastro).
      { to: '/maps',       icon: Map,             emoji: '🗺️', label: 'Mapas',           accent: 'violet' },
    ],
  },
  {
    id: 'infraestrutura',
    title: 'Minha Infraestrutura',
    groupColor: 'amber',
    items: [
      // Câmeras, sites e edge são scoped por clienteFinalId no backend.
      // O cliente vê apenas a infraestrutura instalada para ele.
      { to: '/cameras', icon: Camera,    emoji: '📷', label: 'Câmeras' },
      { to: '/sites',   icon: Building2, emoji: '📍', label: 'Sites',      accent: 'cyan' },
      { to: '/edge',    icon: Cpu,       emoji: '🖥️', label: 'Edge Nodes', accent: 'cyan' },
    ],
  },
  {
    id: 'analytics',
    title: 'Analytics',
    groupColor: 'amber',
    items: [
      // P1-4: Frigate Reviews renomeado pra "Detecções Edge" — menos jargão técnico,
      // descreve a função real (alertas vindos do Edge Box). Continua tela separada
      // porque tem fluxo distinto (mark_reviewed → Frigate via EdgeCommand).
      { to: '/frigate-reviews', icon: Bell,        emoji: '🚨', label: 'Detecções Edge',     badge: 'NOVO', accent: 'rose',
        cap: 'ai.detection.basic' },
      { to: '/semantic-rules',  icon: Sparkles,    emoji: '🎯', label: 'Alertas Semânticos', badge: 'IA',   accent: 'cyan',
        cap: ['ai.semantic.create_rule', 'ai.semantic.list_alerts'] },
      { to: '/faces',           icon: Fingerprint, emoji: '😊', label: 'Faces',
        cap: 'ai.fr.search_face' },
      { to: '/plates',          icon: Car,         emoji: '🚗', label: 'Placas LPR',
        cap: 'ai.lpr.read_plate' },
      { to: '/demographics',    icon: PieChart,    emoji: '📊', label: 'Demografia',
        cap: ['analytics.people_count', 'analytics.basic'] },
      { to: '/heatmap',         icon: Flame,       emoji: '🔥', label: 'Heatmap',
        cap: 'ai.heatmap.generate' },
    ],
  },
  {
    id: 'marketplace',
    title: 'Marketplace',
    groupColor: 'amber',
    items: [
      // P0-1/P0-2: De 3 itens redundantes (Storage/Timelapse eram redirects pra ?cat=)
      // pra 2 itens semanticamente distintos: VITRINE (comprar) vs GESTÃO (gerenciar).
      // Categorias storage/timelapse continuam acessíveis via chips dentro da vitrine.
      { to: '/marketplace',                       icon: ShoppingBag,   emoji: '🛍️', label: 'Marketplace',         accent: 'amber' },
      { to: '/marketplace/minhas-assinaturas',    icon: ClipboardList, emoji: '📋', label: 'Minhas Assinaturas',  accent: 'cyan' },
    ],
  },
  {
    id: 'conta',
    title: 'Minha Conta',
    groupColor: 'slate',
    items: [
      { to: '/users',     icon: Users,     emoji: '👥', label: 'Usuários' },
      // P3: padroniza nomenclatura com Integrador ("Auditoria & LGPD").
      { to: '/log-audit', icon: FileText,  emoji: '🛡️', label: 'Auditoria' },
      { to: '/settings',  icon: Settings,  emoji: '⚙️', label: 'Configurações' },
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

// Sidebar SEMPRE-DARK: badges usam backgrounds claros (alto contraste sobre navy).
// Sem dark: — sidebar nunca muda de tema, então um único valor funciona nos dois modos.
const STATIC_BADGE_STYLES: Record<StaticBadge, string> = {
  LIVE:     'bg-rose-100 text-rose-700 border-rose-200 animate-pulse-slow',
  PRO:      'bg-gradient-to-r from-violet-100 to-cyan-100 text-violet-700 border-violet-200',
  VERTICAL: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  NOVO:     'bg-gradient-to-r from-fuchsia-100 to-cyan-100 text-fuchsia-700 border-fuchsia-200',
  IA:       'bg-cyan-100 text-cyan-700 border-cyan-200',
}

// ─── Sidebar é SEMPRE-DARK (assinatura premium VSaaS) ──────────────────────
// Espelha mockup `02-dashboard.html`: chrome navy gradient não responde ao
// tema. Concorrentes premium (Linear, Vercel, Notion, UniFi) usam esse
// pattern — sidebar permanece como "identidade da marca" enquanto o canvas
// principal alterna light/dark conforme preferência do operador.

// Headers de grupo — variante dark única (sempre fica sobre navy).
// Cores extraídas de tokens.css: violet=#C4B5FD, amber=#FCD34D, slate=#94A3B8
const GROUP_COLOR_STYLES = {
  violet: 'text-violet-300',
  amber:  'text-amber-300',
  slate:  'text-slate-400',
}

// Items ativos — bg/15 + text-300 + border/30 (valores do tokens.css).
const ACCENT_STYLES = {
  violet:  {
    active: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    icon:   'text-violet-300',
  },
  amber:   {
    active: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    icon:   'text-amber-300',
  },
  cyan:    {
    active: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    icon:   'text-cyan-300',
  },
  emerald: {
    active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    icon:   'text-emerald-300',
  },
  rose:    {
    active: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    icon:   'text-rose-300',
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
  const baseGroups: NavGroup[] = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
    ? SUPER_ADMIN_NAV
    : role === 'INTEGRADOR_ADMIN'
      ? INTEGRADOR_NAV_ADMIN
      : role === 'INTEGRADOR_TECNICO'
        ? INTEGRADOR_NAV_TECNICO
        : role.startsWith('CLIENTE_') || role === 'CLIENT_ADMIN'
          ? CLIENTE_NAV
          : SUPER_ADMIN_NAV  // fallback para roles desconhecidos

  // Filtra itens por capability (apenas para roles CLIENTE_*).
  // Integrador/admin vê tudo (operam em nome do cliente).
  // Cliente sem a capability → item somede do menu (mode="hide").
  // Implementação: usa Set pra lookup O(1) das capabilities ativas do cliente.
  const { capabilities, isLoading: capsLoading } = useMyCapabilities()
  const isClienteRole = role.startsWith('CLIENTE_') || role === 'CLIENT_ADMIN'
  const capsSet = new Set(capabilities)

  const groups: NavGroup[] = isClienteRole && !capsLoading
    ? baseGroups.map(g => ({
        ...g,
        items: g.items.filter(item => {
          if (!item.cap) return true  // sem cap declarada = sempre visível
          const required = Array.isArray(item.cap) ? item.cap : [item.cap]
          // OR lógico: se cliente tem PELO MENOS UMA das caps, libera
          return required.some(c => capsSet.has(c))
        }),
      })).filter(g => g.items.length > 0)  // remove grupos que ficaram vazios
    : baseGroups

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
      {/* Background — SEMPRE dark (assinatura premium, não responde ao tema).
       * Gradiente vertical navy → deep-navy espelha tokens.css `--sidebar-bg`. */}
      <div
        className="absolute inset-0"
        style={{ background: 'var(--grad-sidebar)', borderRight: '1px solid rgba(0,192,208,0.18)' }}
      />

      <div className="relative flex flex-col h-full py-4">
        {/* Logo + brand + botão pin — clicável retorna pro dashboard ("/")
         * Padding-left = `pl-5` (20px) pra alinhar o ícone da nuvem do wordmark
         * com a coluna de ícones do menu abaixo (nav `px-2` + item `px-3` = 20px).
         * Padding-right = `pr-3` (12px) — mesma borda direita dos itens. */}
        <div className="pl-5 pr-3 pb-4 mb-2 shrink-0 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <NavLink
              to="/"
              title="Voltar ao Dashboard"
              className="flex items-center flex-1 min-w-0 hover:opacity-80 transition-opacity rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              {showLabels ? (
                // Mesmo wordmark da página de login (fundo dark embutido).
                <img
                  src="/brand/vsaas-wordmark-transparent.png"
                  alt="VSaaS"
                  className="h-8 w-auto block"
                  draggable={false}
                />
              ) : (
                // Estado colapsado: logomark quadrado (lupa+infinity).
                <img
                  src="/brand/vsaas-logomark.png"
                  alt="VSaaS"
                  className="w-9 h-9 object-contain shrink-0 mx-auto"
                  draggable={false}
                />
              )}
            </NavLink>
            {/* Pin toggle — só não aparece em mobile drawer (lá o botão é o
                hambúrguer/backdrop que controla open/close). */}
            {!mobileDrawer && onToggleCollapse && showLabels && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title={collapsed ? 'Fixar sidebar (Ctrl+\\)' : 'Recolher sidebar (Ctrl+\\)'}
                className="p-1.5 rounded-md shrink-0 transition text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/15"
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
                className="absolute -right-1 top-3 p-1 rounded-md transition bg-white/10 border border-white/20 text-slate-300 hover:text-cyan-300 hover:bg-cyan-500/15 shadow-sm backdrop-blur-sm"
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
                     [scrollbar-color:rgba(255,255,255,0.08)_transparent]
                     [&::-webkit-scrollbar]:w-1
                     [&::-webkit-scrollbar-thumb]:rounded-full
                     [&::-webkit-scrollbar-thumb]:bg-white/10"
        >
          {groups.map((group, gIdx) => (
            <div key={group.id} className={cn(gIdx > 0 ? 'mt-4' : 'mt-2')}>
              {/* Header do grupo — quando colapsado vira um traço sutil em vez de texto */}
              {showLabels ? (
                <p className={cn(
                  'px-3 pb-1.5 text-[10px] uppercase tracking-widest font-bold whitespace-nowrap overflow-hidden',
                  group.groupColor ? GROUP_COLOR_STYLES[group.groupColor] : 'text-slate-400',
                )}>
                  {group.title}
                </p>
              ) : gIdx > 0 ? (
                <div className="mx-3 mb-2 h-px bg-white/[0.06]" />
              ) : null}

              <div className="space-y-0.5">
                {group.items.map(item => (
                  <NavRow
                    key={item.to}
                    item={item}
                    active={isActive(location.pathname, item.to, item.exact)}
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

        {/* Bottom: persona + logout — always-dark (acompanha sidebar) */}
        <div className="px-3 mt-3 pt-3 shrink-0 border-t border-white/[0.06]">
          <div className={cn(
            'flex items-center gap-2 rounded-[10px] transition bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07]',
            showLabels ? 'px-2.5 py-2' : 'px-1.5 py-2 justify-center',
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
                  <p className="text-xs font-medium truncate text-white">{personaLabel}</p>
                  <p className="text-[10px] truncate text-slate-400">{personaSub}</p>
                </div>
                <button
                  onClick={handleLogout}
                  title="Sair"
                  className="transition p-1 rounded text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
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
              className="mt-2 w-full flex items-center justify-center p-1.5 rounded-md transition text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
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
          'flex items-center gap-2.5 rounded-[10px] overflow-hidden border border-dashed cursor-not-allowed opacity-60',
          showLabels ? 'px-[10px] py-2 text-[13px]' : 'px-2 py-2 justify-center',
          'border-slate-600 text-slate-500',
        )}
        title={tooltipText ?? 'Em desenvolvimento — em breve'}
      >
        {item.emoji ? (
          <span className="text-base leading-none w-5 shrink-0 text-center select-none opacity-60" aria-hidden>{item.emoji}</span>
        ) : (
          <Icon className="w-4 h-4 shrink-0 opacity-60" />
        )}
        {showLabels && (
          <>
            <span className="font-semibold whitespace-nowrap overflow-hidden flex-1">{item.label}</span>
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
          'flex items-center rounded-[10px] transition-colors group/item overflow-hidden border',
          showLabels ? 'gap-2.5 px-[10px] py-2 text-[13px]' : 'gap-0 px-2 py-2 justify-center',
          active
            ? accent?.active ?? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
            : 'border-transparent text-vsaas-silver hover:text-white hover:bg-white/[0.05]',
        )}
      >
        {/* Ícone (com indicador dot quando colapsado e há badge) — width+height
         * fixos com inline-flex pra centralizar. Emojis têm glyph width variável
         * (⚠️ 🎁 ⚖️ renderizam mais largos), então sem container fixo o label
         * fica desalinhado linha a linha. */}
        <div className="relative shrink-0">
          {item.emoji ? (
            <span
              className="inline-flex items-center justify-center w-4 h-4 text-[14px] leading-none select-none overflow-hidden"
              aria-hidden
            >
              {item.emoji}
            </span>
          ) : (
            <Icon
              className={cn(
                'w-4 h-4 transition-colors',
                active
                  ? (accent?.icon ?? 'text-cyan-300')
                  : 'text-[#8D9295] group-hover/item:text-white',
              )}
            />
          )}
          {!showLabels && hasBadgeIndicator && (
            <span className={cn(
              'absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-vsaas-navy',
              indicatorTone,
            )} />
          )}
        </div>

        {showLabels && (
          <>
            <span className="font-semibold whitespace-nowrap overflow-hidden flex-1">
              {item.label}
            </span>

            {/* Cadeado sudo */}
            {showLock && (
              <Lock
                className="w-3 h-3 shrink-0 text-amber-400/80"
                aria-label="requer reautenticação"
              />
            )}

            {/* Badge dinâmico vence estático */}
            {dynamicValue !== undefined && dynamicValue > 0 && (
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border',
                item.dynamicBadge === 'critical_alerts'
                  ? 'bg-rose-100 text-rose-700 border-rose-200 animate-pulse'
                  : item.dynamicBadge === 'pending_demos'
                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-violet-100 text-violet-700 border-violet-200',
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
                accent?.icon ?? 'text-cyan-400',
              )} />
            )}
          </>
        )}
      </div>
    </NavLink>
  )
}

function isActive(pathname: string, to: string, exact = false): boolean {
  if (to === '/' || exact) return pathname === to
  return pathname === to || pathname.startsWith(to + '/')
}


