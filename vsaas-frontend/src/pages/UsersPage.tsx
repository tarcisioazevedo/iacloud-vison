/**
 * UsersPage — gestão centralizada de tudo relacionado a usuários do tenant.
 *
 * Estrutura:
 *   Header (hero) adaptativo por tab + tabs no topo (URL ?tab=).
 *
 *   • tab=users     → lista de users + filtros + drawer de detalhes
 *   • tab=guests    → acessos convidado (Magic Links) — renderiza GuestLinksPage headless
 *   • tab=sessions  → sessões ativas consolidadas de TODOS os users do tenant
 *   • tab=activity  → audit log filtrado por ações de usuários
 *
 * Convite: wizard de 5 passos (Identidade → Escopo → Agenda → Validade → Confirma).
 *
 * Backend (rotas usadas pela página + drawer):
 *   GET    /users
 *   POST   /users/invite
 *   PATCH  /users/:id
 *   DELETE /users/:id
 *   POST   /users/:id/reset-password
 *   GET    /users/:id/sessions
 *   POST   /users/:id/sessions/:sid/revoke
 *   POST   /users/:id/sessions/revoke-all
 *   GET    /audit/explorer?actorId=:id
 *
 * Sprints A/B/C/F · docs/40-PLAN-GESTAO-USUARIOS.md + docs/41-PLAN-MAGIC-LINK-GUEST.md
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useSWRConfig } from 'swr'
import useSWR from 'swr'
import {
  Users, Search, X, Loader2, Copy, Check, Mail, AlertTriangle,
  ShieldCheck, Building2, UserPlus, Clock, Shield, Link2, Activity,
  ChevronRight, ChevronLeft, MapPin, Camera, Calendar, Lock, Monitor,
  RefreshCw, Trash2,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useUsers, useClientesModules, inviteUser, formatApiError,
  useSites, useCameras, revokeUserSession, revokeAllUserSessions,
  type UserRow, type AppRole, type InviteResponse, type InvitePayload,
  type AccessSchedule, api,
} from '../api/client'
import { cn } from '../lib/utils'
import { UserDetailDrawer } from '../components/users/UserDetailDrawer'
import { GuestLinksPage } from './GuestLinksPage'
import { useUiToast } from '../components/Toast'
import { confirm as confirmDialog } from '../components/ConfirmDialog'

const userRole = (typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : '') as AppRole | ''
const canInviteAny     = ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'CLIENTE_ADMIN'].includes(userRole)
const isSuperAdmin     = userRole === 'SUPER_ADMIN'
const isIntegradorAdmin= userRole === 'INTEGRADOR_ADMIN'

const ROLE_BADGES: Record<AppRole, string> = {
  SUPER_ADMIN:        'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
  ADMIN_GLOBAL:       'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
  INTEGRADOR_ADMIN:   'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30',
  INTEGRADOR_TECNICO: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-200 dark:border-cyan-500/20',
  CLIENTE_ADMIN:      'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  CLIENTE_SUPERVISOR: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  CLIENTE_OPERADOR:   'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/20',
  CLIENTE_VIEWER:     'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
}
const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN:        'Super Admin',
  ADMIN_GLOBAL:       'Admin Global',
  INTEGRADOR_ADMIN:   'Integrador Admin',
  INTEGRADOR_TECNICO: 'Integrador Técnico',
  CLIENTE_ADMIN:      'Cliente Admin',
  CLIENTE_SUPERVISOR: 'Cliente Supervisor',
  CLIENTE_OPERADOR:   'Cliente Operador',
  CLIENTE_VIEWER:     'Cliente Visualizador',
}

type Tab = 'users' | 'guests' | 'sessions' | 'activity'

const TAB_META: Record<Tab, { label: string; icon: typeof Users; color: string }> = {
  users:    { label: 'Usuários',         icon: Users,    color: 'text-cyan-300' },
  guests:   { label: 'Acessos Convidado', icon: Link2,    color: 'text-violet-300' },
  sessions: { label: 'Sessões Ativas',    icon: Monitor,  color: 'text-emerald-300' },
  activity: { label: 'Atividade',         icon: Activity, color: 'text-amber-300' },
}

// ════════════════════════════════════════════════════════════════════════════
// Página principal
// ════════════════════════════════════════════════════════════════════════════
export function UsersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = (searchParams.get('tab') as Tab) ?? 'users'
  const tab: Tab = (['users', 'guests', 'sessions', 'activity'] as Tab[]).includes(rawTab) ? rawTab : 'users'
  function setTab(t: Tab) {
    const next = new URLSearchParams(searchParams)
    if (t === 'users') next.delete('tab')
    else next.set('tab', t)
    setSearchParams(next, { replace: true })
  }

  const { data: usersData, mutate: refetchUsers } = useUsers()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteResult, setInviteResult] = useState<InviteResponse | null>(null)
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null)
  const drawerUser = drawerUserId ? usersData?.users.find(u => u.id === drawerUserId) ?? null : null

  // KPIs derivados pra mostrar no hero (zero impacto se sem dados)
  const allUsers = usersData?.users ?? []
  const kpis = useMemo(() => {
    const active     = allUsers.filter(u => u.active).length
    const with2fa    = allUsers.filter(u => u.totpEnabledAt).length
    const expiring   = allUsers.filter(u => {
      if (!u.expiresAt) return false
      const days = (new Date(u.expiresAt).getTime() - Date.now()) / 86_400_000
      return days >= 0 && days <= 14
    }).length
    const blocked    = allUsers.filter(u => u.lockedUntil && new Date(u.lockedUntil) > new Date()).length
    const sessions   = allUsers.reduce((s, u) => s + (u._count?.sessions ?? 0), 0)
    return { active, with2fa, expiring, blocked, sessions, total: allUsers.length }
  }, [allUsers])

  return (
    <div className="space-y-4 p-6 max-w-7xl mx-auto">
      {/* Hero adaptativo por tab (com KPIs) */}
      <PageHero tab={tab} onInvite={() => setInviteOpen(true)} kpis={kpis} />

      {/* Tabs com badges numéricos */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-white/10">
        {(Object.keys(TAB_META) as Tab[]).map(t => {
          const meta = TAB_META[t]
          const active = t === tab
          const Icon = meta.icon
          const badge =
            t === 'users'    ? kpis.total :
            t === 'sessions' ? kpis.sessions :
            undefined
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2.5 text-sm font-semibold border-b-2 transition flex items-center gap-2 -mb-px',
                active
                  ? 'border-cyan-500 text-cyan-700 dark:text-cyan-300'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
              )}
            >
              <Icon className={cn('w-4 h-4', active && meta.color)} />
              {meta.label}
              {badge !== undefined && badge > 0 && (
                <span className={cn(
                  'text-[10px] font-mono px-1.5 py-0.5 rounded-full',
                  active
                    ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-200'
                    : 'bg-slate-200 dark:bg-white/10 text-slate-500',
                )}>{badge}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Conteúdo por tab */}
      {tab === 'users' && (
        <UsersTab
          onOpenDetail={(id) => setDrawerUserId(id)}
        />
      )}
      {tab === 'guests'   && <GuestLinksPage headless />}
      {tab === 'sessions' && <ActiveSessionsTab onOpenUser={(id) => setDrawerUserId(id)} />}
      {tab === 'activity' && <UserActivityTab />}

      {/* Modais */}
      <AnimatePresence>
        {inviteOpen && (
          <InviteWizard
            onClose={() => setInviteOpen(false)}
            onSuccess={result => { setInviteOpen(false); setInviteResult(result) }}
          />
        )}
        {inviteResult && (
          <InviteResultModal
            result={inviteResult}
            onClose={() => setInviteResult(null)}
          />
        )}
      </AnimatePresence>

      {/* Drawer de detalhes (com 6 abas internas) */}
      {drawerUser && (
        <UserDetailDrawer
          user={drawerUser as any}
          onClose={() => setDrawerUserId(null)}
          onChanged={() => refetchUsers()}
          onSwitchTab={(t) => { setDrawerUserId(null); setTab(t) }}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Hero adaptativo por tab — com KPIs preenchendo o espaço lateral
// ════════════════════════════════════════════════════════════════════════════
interface Kpis {
  total: number; active: number; with2fa: number
  expiring: number; blocked: number; sessions: number
}

function PageHero({ tab, onInvite, kpis }: { tab: Tab; onInvite: () => void; kpis: Kpis }) {
  const content = {
    users: {
      title: 'Usuários',
      desc:  'Quem tem acesso ao seu tenant. Convide novos com escopo, agenda e validade — a senha temporária é enviada por email.',
      cta:   canInviteAny ? { label: 'Convidar usuário', icon: UserPlus, onClick: onInvite } : null,
    },
    guests: {
      title: 'Acessos Convidado',
      desc:  'Magic Links auditáveis — acesso temporário a uma câmera/clipe/site específico, com PIN e revogação instantânea.',
      cta:   null,
    },
    sessions: {
      title: 'Sessões Ativas',
      desc:  'Onde cada usuário está logado agora. Encerre sessões individualmente ou em massa em caso de incidente.',
      cta:   null,
    },
    activity: {
      title: 'Atividade dos Usuários',
      desc:  'Linha do tempo de logins, mudanças de permissão, alterações de senha e ações de 2FA — registro completo LGPD.',
      cta:   null,
    },
  }[tab]

  return (
    <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-violet-500/5 to-transparent border-cyan-500/20 overflow-hidden">
      <div className="grid lg:grid-cols-[1fr_auto] gap-4 items-start">
        {/* Lado esquerdo — identidade da tab */}
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{content.title}</h1>
            <p className="text-sm text-slate-700 dark:text-slate-400 mt-1">{content.desc}</p>
          </div>
        </div>

        {/* Lado direito — CTA */}
        {content.cta && (
          <button
            onClick={content.cta.onClick}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold transition shadow-lg shadow-cyan-500/30 shrink-0"
          >
            <content.cta.icon className="w-3.5 h-3.5" />
            {content.cta.label}
          </button>
        )}
      </div>

      {/* KPIs — grid responsivo no rodapé do hero */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-5 pt-5 border-t border-cyan-500/15">
        <KpiPill label="Total"          value={kpis.total}    icon={Users}        color="cyan"    />
        <KpiPill label="Ativos"         value={kpis.active}   icon={Check}        color="emerald" />
        <KpiPill label="Com 2FA"        value={kpis.with2fa}  icon={ShieldCheck}  color="violet"  />
        <KpiPill label="Sessões agora"  value={kpis.sessions} icon={Monitor}      color="amber"   />
        <KpiPill label={kpis.blocked > 0 ? 'Bloqueados' : 'Expirando ≤14d'}
                 value={kpis.blocked > 0 ? kpis.blocked : kpis.expiring}
                 icon={kpis.blocked > 0 ? Lock : Clock}
                 color={kpis.blocked > 0 ? 'rose' : 'slate'} />
      </div>
    </GlassCard>
  )
}

const KPI_COLOR: Record<string, { bg: string; text: string; ring: string }> = {
  cyan:    { bg: 'bg-cyan-500/15',    text: 'text-cyan-700 dark:text-cyan-300',       ring: 'ring-cyan-500/20'    },
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-500/20' },
  violet:  { bg: 'bg-violet-500/15',  text: 'text-violet-700 dark:text-violet-300',   ring: 'ring-violet-500/20'  },
  amber:   { bg: 'bg-amber-500/15',   text: 'text-amber-700 dark:text-amber-300',     ring: 'ring-amber-500/20'   },
  rose:    { bg: 'bg-rose-500/15',    text: 'text-rose-700 dark:text-rose-300',       ring: 'ring-rose-500/20'    },
  slate:   { bg: 'bg-slate-500/10',   text: 'text-slate-700 dark:text-slate-300',     ring: 'ring-slate-500/15'   },
}

function KpiPill({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: typeof Users; color: keyof typeof KPI_COLOR
}) {
  const c = KPI_COLOR[color]
  return (
    <div className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/40 dark:bg-white/5 ring-1 backdrop-blur', c.ring)}>
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', c.bg)}>
        <Icon className={cn('w-4 h-4', c.text)} />
      </div>
      <div className="min-w-0">
        <p className={cn('text-lg font-bold leading-none', c.text)}>{value}</p>
        <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mt-0.5 truncate">{label}</p>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 1 — Usuários (lista enriquecida)
// ════════════════════════════════════════════════════════════════════════════
function UsersTab({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const { data, error, isLoading } = useUsers()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<AppRole | ''>('')

  const users = data?.users ?? []

  const filtered = useMemo(() => {
    return users.filter(u => {
      if (roleFilter && u.role !== roleFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!u.email.toLowerCase().includes(q) && !u.name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [users, search, roleFilter])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou email..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-slate-600 text-sm focus:outline-none focus:border-cyan-500/50"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as AppRole | '')}
          className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 dark:bg-white/5 dark:border-white/10 dark:text-slate-300 text-xs"
        >
          <option value="" className="bg-white dark:bg-space-900">Todas as funções</option>
          {(Object.keys(ROLE_LABELS) as AppRole[]).map(r => (
            <option key={r} value={r} className="bg-white dark:bg-space-900">{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <span className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/5 dark:border-white/10 text-xs text-slate-700 dark:text-slate-400 font-mono">
          {filtered.length} / {users.length}
        </span>
      </div>

      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Falha ao listar usuários</p>
              <p className="text-xs text-slate-700 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {isLoading && !data && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando usuários...</p>
        </GlassCard>
      )}

      {filtered.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[860px]">
            <thead className="bg-slate-100 dark:bg-white/5 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left  px-4 py-3">Usuário</th>
                <th className="text-left  px-4 py-3">Função</th>
                <th className="text-left  px-4 py-3">Escopo</th>
                <th className="text-left  px-4 py-3">Expira</th>
                <th className="text-left  px-4 py-3">2FA</th>
                <th className="text-left  px-4 py-3">Último login</th>
                <th className="text-right px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => <UserRowItem key={u.id} user={u} onOpen={() => onOpenDetail(u.id)} />)}
            </tbody>
          </table></div>
        </GlassCard>
      )}

      {data && filtered.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Users className="w-12 h-12 mx-auto text-slate-400 dark:text-slate-700 mb-3" />
          <p className="text-sm text-slate-700 dark:text-slate-400">
            {search || roleFilter ? 'Nenhum usuário bate com o filtro.' : 'Nenhum usuário cadastrado.'}
          </p>
        </GlassCard>
      )}

      {/* Quando há poucos usuários (≤3), preenche o espaço com dicas/CTAs */}
      {data && users.length > 0 && users.length <= 3 && !search && !roleFilter && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <SuggestionCard
            icon={UserPlus}
            color="cyan"
            title="Convide mais membros"
            text="Adicione operadores, supervisores ou colegas pra dividir a operação. Cada um com escopo e horário próprio."
          />
          <SuggestionCard
            icon={ShieldCheck}
            color="emerald"
            title="Ative 2FA na equipe"
            text="Recomende que todos configurem 2FA em Configurações → Segurança. Aumenta a segurança da conta sem dor."
          />
          <SuggestionCard
            icon={Link2}
            color="violet"
            title="Gere acesso convidado"
            text="Precisa mostrar uma câmera pra alguém de fora? Use a aba Acessos Convidado — link único, com PIN, auditável."
          />
        </div>
      )}
    </div>
  )
}

function SuggestionCard({ icon: Icon, color, title, text }: {
  icon: typeof Users; color: keyof typeof KPI_COLOR; title: string; text: string
}) {
  const c = KPI_COLOR[color]
  return (
    <div className={cn(
      'p-4 rounded-xl bg-white/40 dark:bg-white/5 ring-1 backdrop-blur',
      c.ring,
    )}>
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-3', c.bg)}>
        <Icon className={cn('w-4 h-4', c.text)} />
      </div>
      <p className="text-sm font-bold text-slate-900 dark:text-white">{title}</p>
      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">{text}</p>
    </div>
  )
}

// Cor determinística do avatar a partir do nome — sensação de "memória" do user
const AVATAR_GRADIENTS = [
  'from-cyan-500 to-blue-500',
  'from-violet-500 to-fuchsia-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-purple-500',
]
function avatarGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}

function UserRowItem({ user, onOpen }: { user: UserRow; onOpen: () => void }) {
  const sites = user.allowedSiteIds?.length ?? 0
  const cams  = user.allowedCameraIds?.length ?? 0
  const scopeLabel = (sites === 0 && cams === 0)
    ? <span className="text-slate-500 italic">todos</span>
    : (
      <span className="inline-flex items-center gap-1 flex-wrap">
        {sites > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 text-[10px] font-mono">
            <MapPin className="w-2.5 h-2.5" />{sites}
          </span>
        )}
        {cams > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-300 text-[10px] font-mono">
            <Camera className="w-2.5 h-2.5" />{cams}
          </span>
        )}
      </span>
    )

  const expires = user.expiresAt ? new Date(user.expiresAt) : null
  const expiresLabel = !expires
    ? <span className="text-slate-400">—</span>
    : expires < new Date()
      ? <span className="text-rose-500 font-mono text-[11px]">expirou</span>
      : (() => {
          const days = Math.ceil((expires.getTime() - Date.now()) / 86_400_000)
          const cls = days <= 7 ? 'text-rose-500' : days <= 30 ? 'text-amber-500' : 'text-emerald-500'
          return <span className={cn(cls, 'font-mono text-[11px]')}>{days}d</span>
        })()

  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase()
  const gradient = avatarGradient(user.id)

  const sessionCount = user._count?.sessions ?? 0

  return (
    <tr
      onClick={onOpen}
      className="border-t border-slate-200 dark:border-white/5 hover:bg-cyan-50/70 dark:hover:bg-cyan-500/5 cursor-pointer transition group"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-9 h-9 rounded-full bg-gradient-to-br text-white font-bold text-sm flex items-center justify-center shrink-0 shadow ring-2 ring-white/10',
            gradient,
          )}>
            {initial}
          </div>
          <div className="min-w-0">
            <p className="text-slate-900 dark:text-white font-medium truncate flex items-center gap-2">
              {user.name}
              {sessionCount > 0 && (
                <span className="inline-flex w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" title={`${sessionCount} sessão(ões) ativa(s)`} />
              )}
            </p>
            <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={cn('px-2 py-0.5 rounded text-[10px] border font-mono uppercase whitespace-nowrap', ROLE_BADGES[user.role])}>
          {ROLE_LABELS[user.role]}
        </span>
      </td>
      <td className="px-4 py-3 text-xs">{scopeLabel}</td>
      <td className="px-4 py-3 text-xs">{expiresLabel}</td>
      <td className="px-4 py-3 text-xs">
        {user.totpEnabledAt
          ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase"><ShieldCheck className="w-3 h-3"/> Sim</span>
          : <span className="text-slate-400 text-[11px]">—</span>}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {user.lastLoginAt
          ? <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> {relativeTime(user.lastLoginAt)}</span>
          : <span className="italic text-slate-400">nunca</span>}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {user.lockedUntil && new Date(user.lockedUntil) > new Date()
          ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300"><Lock className="w-3 h-3"/>Bloq.</span>
          : user.active
            ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Ativo</span>
            : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300">Inativo</span>}
        <ChevronRight className="w-3.5 h-3.5 inline-block ml-2 text-slate-400 group-hover:text-cyan-500 transition" />
      </td>
    </tr>
  )
}

function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const min = diffMs / 60_000
  if (min < 1) return 'agora'
  if (min < 60) return `${Math.floor(min)}min`
  const h = min / 60
  if (h < 24) return `${Math.floor(h)}h`
  const days = h / 24
  if (days < 30) return `${Math.floor(days)}d`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 3 — Sessões ativas consolidadas
// ════════════════════════════════════════════════════════════════════════════
interface SessionRow {
  id: string
  device: string | null
  ip: string | null
  createdAt: string
  expiresAt: string
  lastSeenAt: string | null
}

function ActiveSessionsTab({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const toast = useUiToast()
  const { data: usersData } = useUsers()
  const users = usersData?.users ?? []

  // Fetch sessões em paralelo para cada user (best-effort)
  const userIds = users.map(u => u.id).sort().join(',')
  const swr = useSWR(
    userIds ? ['/users-sessions-bulk', userIds] : null,
    async () => {
      const results = await Promise.all(users.map(async u => {
        try {
          const { data } = await api.get<{ sessions: SessionRow[] }>(`/users/${u.id}/sessions`)
          return { user: u, sessions: data.sessions ?? [] }
        } catch { return { user: u, sessions: [] as SessionRow[] } }
      }))
      return results
    },
    { revalidateOnFocus: false },
  )

  async function revokeOne(userId: string, sid: string) {
    try {
      await revokeUserSession(userId, sid)
      toast.success('Sessão revogada')
      void swr.mutate()
    } catch (e) { toast.error(formatApiError(e)) }
  }
  async function revokeAllOf(userId: string, name: string) {
    if (!await confirmDialog({
      title: `Revogar TODAS as sessões de ${name}?`,
      description: 'Ele(a) terá que fazer login de novo em todos os dispositivos.',
      destructive: true, confirmLabel: 'Revogar todas',
    })) return
    try {
      const r = await revokeAllUserSessions(userId)
      toast.success(`${r.revoked} sessão(ões) revogada(s)`)
      void swr.mutate()
    } catch (e) { toast.error(formatApiError(e)) }
  }

  const allRows = (swr.data ?? []).flatMap(({ user, sessions }) =>
    sessions.map(s => ({ user, session: s })),
  )

  if (swr.isLoading && !swr.data) {
    return (
      <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-xs">Carregando sessões ativas...</p>
      </GlassCard>
    )
  }

  if (allRows.length === 0) {
    return (
      <GlassCard className="p-12 text-center">
        <Monitor className="w-12 h-12 mx-auto text-slate-400 dark:text-slate-700 mb-3" />
        <p className="text-sm text-slate-700 dark:text-slate-400">Nenhuma sessão ativa no momento.</p>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">{allRows.length} sessão(ões) ativa(s) · {new Set(allRows.map(r => r.user.id)).size} usuário(s) logados</p>
        <button onClick={() => swr.mutate()} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-300 flex items-center gap-1.5">
          <RefreshCw className="w-3 h-3" /> Atualizar
        </button>
      </div>
      <GlassCard className="p-0 overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[700px]">
          <thead className="bg-slate-100 dark:bg-white/5 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left  px-4 py-3">Usuário</th>
              <th className="text-left  px-4 py-3">Dispositivo</th>
              <th className="text-left  px-4 py-3">IP</th>
              <th className="text-left  px-4 py-3">Criada</th>
              <th className="text-left  px-4 py-3">Expira</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map(({ user, session }) => (
              <tr key={session.id} className="border-t border-slate-200 dark:border-white/5">
                <td className="px-4 py-3">
                  <button onClick={() => onOpenUser(user.id)} className="text-left hover:underline">
                    <p className="text-slate-900 dark:text-white font-medium">{user.name}</p>
                    <p className="text-[10px] text-slate-500">{user.email}</p>
                  </button>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 truncate max-w-[280px]" title={session.device ?? ''}>
                  {session.device ?? <span className="italic">desconhecido</span>}
                </td>
                <td className="px-4 py-3 text-xs font-mono text-slate-500">{session.ip ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{new Date(session.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{new Date(session.expiresAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => revokeOne(user.id, session.id)}
                    className="px-2 py-1 rounded text-[10px] uppercase font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                    Revogar
                  </button>
                  <button onClick={() => revokeAllOf(user.id, user.name)}
                    className="ml-1 px-2 py-1 rounded text-[10px] uppercase font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                    Todas
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </GlassCard>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 4 — Atividade (audit log filtrado em ações de usuários)
// ════════════════════════════════════════════════════════════════════════════
interface AuditEvent {
  id: string
  ts: string
  action: string
  result: string
  userId: string | null
  userName: string | null
  userEmail: string | null
  resourceId: string | null
  metadata: any
  ip: string | null
}

const USER_ACTIONS = [
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_FAILED_LOCKOUT',
  'LOGIN_MFA_CHALLENGED', 'LOGIN_MFA_SUCCESS', 'LOGIN_MFA_FAILED', 'LOGIN_MFA_BACKUP_USED',
  'USER_INVITED', 'USER_UPDATED', 'USER_DELETED', 'USER_PASSWORD_RESET',
  'PASSWORD_CHANGED', 'PASSWORD_CHANGE_FAILED', 'PASSWORD_EXPIRED_AUTO_LOCK',
  'USER_TOTP_ENABLED', 'USER_TOTP_DISABLED',
  'USER_LGPD_ACCEPTED', 'ACCOUNT_EXPIRED_AUTO_DISABLE',
]

function UserActivityTab() {
  const swr = useSWR<{ events: AuditEvent[] }>(
    `/audit/explorer?limit=200&actions=${USER_ACTIONS.join(',')}`,
    async (url: string) => (await api.get(url)).data,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  )

  if (swr.isLoading && !swr.data) {
    return (
      <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-xs">Carregando atividade...</p>
      </GlassCard>
    )
  }

  const events = swr.data?.events ?? []

  if (events.length === 0) {
    return (
      <GlassCard className="p-12 text-center">
        <Activity className="w-12 h-12 mx-auto text-slate-400 dark:text-slate-700 mb-3" />
        <p className="text-sm text-slate-700 dark:text-slate-400">Sem eventos de usuário no histórico recente.</p>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="p-0 overflow-hidden">
      <ul className="divide-y divide-slate-200 dark:divide-white/5">
        {events.map(ev => <ActivityRow key={ev.id} ev={ev} />)}
      </ul>
    </GlassCard>
  )
}

function ActivityRow({ ev }: { ev: AuditEvent }) {
  const meta = ACTION_META[ev.action] ?? { label: ev.action, color: 'text-slate-500', emoji: '•' }
  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5">
      <span className="text-lg leading-none">{meta.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-900 dark:text-white">
          <span className={cn('font-semibold', meta.color)}>{meta.label}</span>
          {ev.userName && <span className="text-slate-500"> · {ev.userName}</span>}
          {ev.result === 'BLOCKED' && <span className="ml-2 text-[10px] uppercase font-mono text-rose-500">bloqueado</span>}
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {new Date(ev.ts).toLocaleString('pt-BR')}
          {ev.ip && <span className="font-mono ml-2">· {ev.ip}</span>}
        </p>
      </div>
    </li>
  )
}

const ACTION_META: Record<string, { label: string; color: string; emoji: string }> = {
  LOGIN_SUCCESS:                { label: 'Login bem-sucedido',         color: 'text-emerald-500', emoji: '✅' },
  LOGIN_FAILED:                 { label: 'Tentativa de login falhou',  color: 'text-amber-500',   emoji: '⚠️' },
  LOGIN_FAILED_LOCKOUT:         { label: 'Conta bloqueada por excesso',color: 'text-rose-500',    emoji: '🔒' },
  LOGIN_MFA_CHALLENGED:         { label: '2FA solicitado',             color: 'text-cyan-500',    emoji: '🔐' },
  LOGIN_MFA_SUCCESS:            { label: '2FA validado',               color: 'text-emerald-500', emoji: '🔓' },
  LOGIN_MFA_FAILED:             { label: '2FA inválido',               color: 'text-rose-500',    emoji: '❌' },
  LOGIN_MFA_BACKUP_USED:        { label: 'Backup code 2FA usado',      color: 'text-amber-500',   emoji: '🎫' },
  USER_INVITED:                 { label: 'Convite enviado',            color: 'text-cyan-500',    emoji: '✉️' },
  USER_UPDATED:                 { label: 'Usuário atualizado',         color: 'text-slate-500',   emoji: '✏️' },
  USER_DELETED:                 { label: 'Usuário excluído',           color: 'text-rose-500',    emoji: '🗑️' },
  USER_PASSWORD_RESET:          { label: 'Senha resetada (admin)',     color: 'text-amber-500',   emoji: '🔑' },
  PASSWORD_CHANGED:             { label: 'Senha alterada',             color: 'text-emerald-500', emoji: '🔑' },
  PASSWORD_CHANGE_FAILED:       { label: 'Falha ao alterar senha',     color: 'text-rose-500',    emoji: '❌' },
  PASSWORD_EXPIRED_AUTO_LOCK:   { label: 'Senha venceu (auto-lock)',   color: 'text-amber-500',   emoji: '⏰' },
  USER_TOTP_ENABLED:            { label: '2FA habilitado',             color: 'text-emerald-500', emoji: '🛡️' },
  USER_TOTP_DISABLED:           { label: '2FA desabilitado',           color: 'text-amber-500',   emoji: '⚠️' },
  USER_LGPD_ACCEPTED:           { label: 'LGPD aceito',                color: 'text-emerald-500', emoji: '📜' },
  ACCOUNT_EXPIRED_AUTO_DISABLE: { label: 'Conta vencida (auto-disable)', color: 'text-rose-500', emoji: '🚫' },
}

// ════════════════════════════════════════════════════════════════════════════
// Wizard de Convite (5 passos)
// ════════════════════════════════════════════════════════════════════════════
type WizardStep = 1 | 2 | 3 | 4 | 5

function InviteWizard({ onClose, onSuccess }: {
  onClose: () => void
  onSuccess: (r: InviteResponse) => void
}) {
  const { mutate } = useSWRConfig()
  const { data: clientesData } = useClientesModules()
  const { data: sitesData }    = useSites()
  const { data: camsData }     = useCameras()
  const clientes = clientesData?.clientes ?? []
  const sites    = sitesData?.sites ?? []
  const cameras  = camsData?.cameras ?? []

  const availableRoles: InvitePayload['role'][] = useMemo(() => {
    if (isSuperAdmin) return ['INTEGRADOR_TECNICO', 'CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
    if (isIntegradorAdmin) return ['INTEGRADOR_TECNICO', 'CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
    return ['CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
  }, [])

  const [step, setStep] = useState<WizardStep>(1)
  const [form, setForm] = useState<InvitePayload>({
    email: '', name: '', role: availableRoles[0],
    clienteFinalId: undefined,
    integradorId:   undefined,
    allowedSiteIds: [],
    allowedCameraIds: [],
    accessSchedule: null,
    expiresAt: null,
    tags: [],
    requireMfaSetup: false,
  })
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [schedule, setSchedule] = useState<AccessSchedule>({
    weekdays: [1, 2, 3, 4, 5],
    hourStart: 8,
    hourEnd:   18,
    timezone:  'America/Sao_Paulo',
  })

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const needsClienteFinal =
       (form.role.startsWith('CLIENTE_') && !['CLIENTE_OPERADOR', 'CLIENTE_VIEWER'].some(r => userRole === 'CLIENTE_ADMIN' && r === form.role))
    || (form.role.startsWith('CLIENTE_') && userRole !== 'CLIENTE_ADMIN')
  const needsIntegrador = isSuperAdmin && form.role === 'INTEGRADOR_TECNICO'

  const isScopedRole = form.role === 'CLIENTE_OPERADOR' || form.role === 'CLIENTE_VIEWER'

  function canAdvance(s: WizardStep): boolean {
    if (s === 1) {
      if (!form.email || !form.name) return false
      if (needsClienteFinal && !form.clienteFinalId) return false
      if (needsIntegrador && !form.integradorId) return false
      return true
    }
    return true  // 2/3/4 são opcionais
  }

  async function submit() {
    setSaving(true); setError(null)
    try {
      const payload: InvitePayload = {
        ...form,
        email: form.email.trim().toLowerCase(),
        name:  form.name.trim(),
        allowedSiteIds:   isScopedRole ? form.allowedSiteIds   : [],
        allowedCameraIds: isScopedRole ? form.allowedCameraIds : [],
        accessSchedule:   scheduleEnabled ? schedule : null,
      }
      const result = await inviteUser(payload)
      await mutate('/users')
      onSuccess(result)
    } catch (err: any) {
      setError(formatApiError(err))
      setSaving(false)
    }
  }

  function nextStep() {
    if (step < 5) setStep((step + 1) as WizardStep)
    else void submit()
  }

  return (
    <ModalShell title="Convidar usuário" onClose={onClose} accent="cyan" wide>
      {/* Stepper */}
      <div className="flex items-center gap-2 mb-5">
        {[1, 2, 3, 4, 5].map((n, i) => (
          <div key={n} className="flex-1 flex items-center gap-2">
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold',
              step === n ? 'bg-cyan-500 text-white'
                : step > n ? 'bg-emerald-500 text-white'
                : 'bg-slate-200 dark:bg-white/10 text-slate-500',
            )}>
              {step > n ? <Check className="w-3.5 h-3.5" /> : n}
            </div>
            {i < 4 && <div className={cn('flex-1 h-0.5', step > n ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-white/10')} />}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5 text-[10px] uppercase tracking-wider text-slate-500 mb-4">
        <span className="text-center">Identidade</span>
        <span className="text-center">Escopo</span>
        <span className="text-center">Agenda</span>
        <span className="text-center">Validade</span>
        <span className="text-center">Confirmar</span>
      </div>

      {/* Step content */}
      <div className="space-y-3 text-sm min-h-[280px]">
        {step === 1 && (
          <>
            <Field label="Email *">
              <input type="email" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="usuario@empresa.com.br" className={inputCls} autoFocus />
            </Field>
            <Field label="Nome *">
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Maria Silva" className={inputCls} />
            </Field>
            <Field label="Função *">
              <select value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value as InvitePayload['role'] })}
                className={inputCls}>
                {availableRoles.map(r => (
                  <option key={r} value={r} className="bg-white dark:bg-space-900">{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </Field>
            {needsClienteFinal && (
              <Field label="Cliente final *">
                <select value={form.clienteFinalId ?? ''}
                  onChange={e => setForm({ ...form, clienteFinalId: e.target.value || undefined })}
                  className={inputCls}>
                  <option value="" className="bg-white dark:bg-space-900">— selecionar —</option>
                  {clientes.map((c: { id: string; name: string }) => (
                    <option key={c.id} value={c.id} className="bg-white dark:bg-space-900">{c.name}</option>
                  ))}
                </select>
              </Field>
            )}
            {needsIntegrador && (
              <Field label="Integrador (UUID) *">
                <input value={form.integradorId ?? ''}
                  onChange={e => setForm({ ...form, integradorId: e.target.value || undefined })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className={inputCls + ' font-mono'} />
              </Field>
            )}
          </>
        )}

        {step === 2 && (
          <>
            {!isScopedRole ? (
              <div className="px-3 py-4 rounded-lg bg-slate-500/10 border border-slate-500/20 text-xs text-slate-600 dark:text-slate-300">
                <p className="font-semibold mb-1">Esta função não usa escopo restrito.</p>
                <p>Admins e técnicos têm visão completa por padrão. Pule pra próxima etapa.</p>
              </div>
            ) : (
              <>
                <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-200 flex items-start gap-2">
                  <Shield className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Deixe ambos vazios para liberar <strong>todos os sites/câmeras</strong> do tenant.
                    Marque para restringir.</span>
                </div>
                <Field label={<><MapPin className="w-3 h-3 inline mr-1" />Sites permitidos</>}>
                  <MultiSelect
                    options={sites.map((s: any) => ({ id: s.id, label: s.name }))}
                    selected={form.allowedSiteIds ?? []}
                    onChange={ids => setForm({ ...form, allowedSiteIds: ids })}
                  />
                </Field>
                <Field label={<><Camera className="w-3 h-3 inline mr-1" />Câmeras permitidas</>}>
                  <MultiSelect
                    options={cameras.map((c: any) => ({ id: c.id, label: c.name }))}
                    selected={form.allowedCameraIds ?? []}
                    onChange={ids => setForm({ ...form, allowedCameraIds: ids })}
                  />
                </Field>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" checked={!scheduleEnabled} onChange={e => setScheduleEnabled(!e.target.checked)} className="w-4 h-4" />
              <span className="text-sm">Sem restrição de horário (acesso 24×7)</span>
            </label>
            {scheduleEnabled && (
              <>
                <Field label={<><Calendar className="w-3 h-3 inline mr-1" />Dias da semana</>}>
                  <div className="flex gap-1.5 flex-wrap">
                    {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d, i) => {
                      const active = schedule.weekdays.includes(i)
                      return (
                        <button key={d} type="button"
                          onClick={() => setSchedule({
                            ...schedule,
                            weekdays: active ? schedule.weekdays.filter(x => x !== i) : [...schedule.weekdays, i].sort(),
                          })}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-semibold border',
                            active ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-200 border-cyan-500/40' : 'bg-white/5 text-slate-500 border-slate-300 dark:border-white/10',
                          )}>{d}</button>
                      )
                    })}
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={<><Clock className="w-3 h-3 inline mr-1" />Início</>}>
                    <input type="time" value={`${String(schedule.hourStart).padStart(2,'0')}:00`}
                      onChange={e => setSchedule({ ...schedule, hourStart: parseInt(e.target.value.split(':')[0], 10) })}
                      className={inputCls + ' font-mono'} />
                  </Field>
                  <Field label={<><Clock className="w-3 h-3 inline mr-1" />Fim</>}>
                    <input type="time" value={`${String(schedule.hourEnd).padStart(2,'0')}:00`}
                      onChange={e => setSchedule({ ...schedule, hourEnd: parseInt(e.target.value.split(':')[0], 10) })}
                      className={inputCls + ' font-mono'} />
                  </Field>
                </div>
              </>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <Field label={<><Calendar className="w-3 h-3 inline mr-1" />Conta expira em (opcional)</>}>
              <input type="date" value={form.expiresAt ?? ''}
                onChange={e => setForm({ ...form, expiresAt: e.target.value || null })}
                className={inputCls} />
              <p className="text-[10px] text-slate-500 mt-1">Em branco = nunca expira. Útil pra terceirizados / consultores.</p>
            </Field>
            <label className="flex items-start gap-2 cursor-pointer p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
              <input type="checkbox" checked={form.requireMfaSetup ?? false}
                onChange={e => setForm({ ...form, requireMfaSetup: e.target.checked })}
                className="w-4 h-4 mt-0.5" />
              <span className="text-xs">
                <strong className="text-cyan-700 dark:text-cyan-200">Exigir 2FA no primeiro login</strong>
                <br/><span className="text-slate-600 dark:text-slate-400">Usuário não consegue usar o sistema sem configurar TOTP.</span>
              </span>
            </label>
            <Field label="Tags (opcional, separadas por vírgula)">
              <input value={(form.tags ?? []).join(', ')}
                onChange={e => setForm({ ...form, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                placeholder="terceirizado, noturno, consultoria"
                className={inputCls} />
            </Field>
          </>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Confirme antes de convidar:</p>
            <ConfirmRow icon={Mail} label="Email" value={form.email} />
            <ConfirmRow icon={UserPlus} label="Nome" value={form.name} />
            <ConfirmRow icon={Shield} label="Função" value={ROLE_LABELS[form.role as AppRole]} />
            {needsClienteFinal && form.clienteFinalId && (
              <ConfirmRow icon={Building2} label="Cliente final" value={clientes.find((c: any) => c.id === form.clienteFinalId)?.name ?? '—'} />
            )}
            {isScopedRole && (
              <ConfirmRow icon={MapPin} label="Escopo"
                value={(form.allowedSiteIds?.length ?? 0) === 0 && (form.allowedCameraIds?.length ?? 0) === 0
                  ? 'Todos os sites e câmeras'
                  : `${form.allowedSiteIds?.length ?? 0} sites · ${form.allowedCameraIds?.length ?? 0} câmeras`} />
            )}
            <ConfirmRow icon={Clock} label="Horário"
              value={scheduleEnabled
                ? `${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].filter((_,i) => schedule.weekdays.includes(i)).join(', ')} · ${schedule.hourStart}h–${schedule.hourEnd}h`
                : '24×7 (sem restrição)'} />
            <ConfirmRow icon={Calendar} label="Expira" value={form.expiresAt ? new Date(form.expiresAt).toLocaleDateString('pt-BR') : 'Nunca'} />
            {form.requireMfaSetup && (
              <ConfirmRow icon={Lock} label="2FA" value="Obrigatório no 1º login" />
            )}
            <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-700 dark:text-emerald-200 flex items-start gap-2 mt-3">
              <Mail className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Backend gera senha temporária e (se SMTP configurado) envia por email. A senha é mostrada UMA vez na próxima tela.</span>
            </div>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-200 dark:border-white/10">
        <button
          onClick={() => step > 1 ? setStep((step - 1) as WizardStep) : onClose()}
          disabled={saving}
          className="px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
        >
          {step > 1 ? <><ChevronLeft className="w-3.5 h-3.5" /> Voltar</> : 'Cancelar'}
        </button>
        <button
          onClick={nextStep}
          disabled={saving || !canAdvance(step)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
            step < 5 ? <>Próximo <ChevronRight className="w-3.5 h-3.5" /></> :
            <><UserPlus className="w-3.5 h-3.5" /> Convidar</>}
        </button>
      </div>
    </ModalShell>
  )
}

function ConfirmRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
      <Icon className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
      <span className="text-[10px] uppercase text-slate-500 w-24 shrink-0">{label}</span>
      <span className="text-xs text-slate-900 dark:text-white font-medium truncate">{value}</span>
    </div>
  )
}

// ── Multi-select chip-style ────────────────────────────────────────────────
function MultiSelect({ options, selected, onChange }: {
  options:  { id: string; label: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(
    () => options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  )
  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id))
    else onChange([...selected, id])
  }
  return (
    <div className="border border-slate-300 dark:border-white/10 rounded-lg overflow-hidden">
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder={`Buscar (${options.length} disponíveis)…`}
        className="w-full px-3 py-2 text-xs bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 focus:outline-none" />
      <div className="max-h-32 overflow-y-auto p-2 space-y-1 bg-white dark:bg-white/5">
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-500 px-1 py-2">Nenhum item.</p>
        ) : filtered.slice(0, 50).map(o => (
          <label key={o.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer text-xs">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
            <span className="truncate flex-1">{o.label}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="px-2 py-1.5 border-t border-slate-200 dark:border-white/10 text-[10px] text-slate-500 bg-slate-50 dark:bg-white/5">
          {selected.length} selecionado(s)
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Resultado do convite
// ════════════════════════════════════════════════════════════════════════════
function InviteResultModal({ result, onClose }: { result: InviteResponse; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <ModalShell title="Convite criado" onClose={onClose} accent="emerald">
      <div className="space-y-4 text-sm">
        <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-200 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong className="block mb-0.5">Senha temporária só aparece UMA vez</strong>
            Copie agora. Se o email automático não chegou, repasse manualmente
            via canal seguro (não use email pessoal/whatsapp).
          </div>
        </div>

        <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs">
          <p className="text-slate-900 dark:text-white"><strong>{result.user.name}</strong></p>
          <p className="text-slate-500 mt-0.5">{result.user.email} · {ROLE_LABELS[result.user.role]}</p>
          {result.user.clienteFinal && (
            <p className="text-slate-500 mt-0.5 flex items-center gap-1"><Building2 className="w-3 h-3" /> {result.user.clienteFinal.name}</p>
          )}
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Senha temporária</p>
          <div className="flex gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-slate-200 dark:border-white/10 text-sm font-mono text-emerald-300 truncate">
              {result.invitation.tempPassword}
            </code>
            <button onClick={() => copy('pwd', result.invitation.tempPassword)}
              className="px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-700 dark:text-emerald-200 text-xs flex items-center gap-1.5">
              {copied === 'pwd' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'pwd' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">URL de login</p>
          <div className="flex gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-slate-200 dark:border-white/10 text-xs font-mono text-cyan-300 truncate">
              {result.invitation.loginUrl}
            </code>
            <button onClick={() => copy('url', result.invitation.loginUrl)}
              className="px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-700 dark:text-cyan-200 text-xs flex items-center gap-1.5">
              {copied === 'url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'url' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>

        <div className={cn(
          'px-3 py-2 rounded-lg border text-xs flex items-center gap-2',
          result.invitation.emailSent
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-200'
            : 'bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-300',
        )}>
          {result.invitation.emailSent
            ? <><Check className="w-4 h-4" /> Email enviado para <strong>{result.user.email}</strong></>
            : <>
                <Mail className="w-4 h-4" />
                <span>
                  <strong>Email NÃO enviado</strong> — repasse manualmente.
                  {result.invitation.emailReason && (
                    <span className="block text-[10px] text-slate-500 mt-0.5">Motivo: {result.invitation.emailReason}</span>
                  )}
                </span>
              </>}
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold">
            Concluído
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// UI helpers
// ════════════════════════════════════════════════════════════════════════════
function ModalShell({ title, onClose, accent, wide, children }: {
  title: string; onClose: () => void; accent: 'cyan' | 'emerald'; wide?: boolean
  children: React.ReactNode
}) {
  const ring = accent === 'cyan' ? 'border-cyan-500/30' : 'border-emerald-500/30'
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={cn('w-full max-h-[92vh] overflow-auto rounded-2xl bg-white dark:bg-space-900 border p-5', ring, wide ? 'max-w-2xl' : 'max-w-lg')}
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-500" />
            {title}
          </h2>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-cyan-500/50 dark:focus:ring-cyan-500/20'

// Sentinelas pra linter
void Trash2; void useEffect
