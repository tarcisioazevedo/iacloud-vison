/**
 * Sprint Gap 6 — AuditPage (Transparência da Plataforma)
 *
 * Mostra o que SUPER_ADMIN (operadores da plataforma IA Cloud Vision) fizeram
 * no tenant do consultante. Cumpre o princípio de accountability LGPD: o
 * integrador/cliente final precisa enxergar quando a plataforma alterou
 * quotas, módulos, exportou dados, etc.
 *
 * Duas abas:
 *   - "Plataforma" (default) → ações de SUPER_ADMIN apenas (foco do gap).
 *   - "Tudo no tenant"       → timeline completa (próprias + plataforma).
 *
 * Filtros: janela (7/30/90 dias) e busca por código de ação.
 */
import { useMemo, useState } from 'react'
import {
  Shield, ShieldAlert, Search, AlertTriangle, Loader2,
  Activity, User, Clock, Building2, Filter, ChevronDown,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  usePlatformActions, useAuditTimeline, formatApiError,
  type AuditEntry,
} from '../api/client'
import { cn } from '../lib/utils'

type Tab = 'platform' | 'all'

export function AuditPage() {
  const [tab, setTab] = useState<Tab>('platform')
  const [days, setDays] = useState(30)
  const [actionFilter, setActionFilter] = useState('')

  const platform = usePlatformActions(days, actionFilter)
  const timeline = useAuditTimeline(days, actionFilter)

  const active = tab === 'platform' ? platform : timeline
  const logs = active.data?.logs ?? []

  return (
    <div className="space-y-6">
      {/* Hero */}
      <GlassCard className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-500/20 border border-violet-500/40 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-6 h-6 text-violet-300" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Auditoria & Transparência</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-3xl">
              Tudo que a <strong className="text-violet-600 dark:text-violet-300">plataforma</strong> (operadores
              SUPER_ADMIN) executou sobre o seu ambiente fica registrado aqui — quotas
              alteradas, módulos liberados/revogados, exports, intervenções de suporte.
              Esta visibilidade é parte da nossa política de <em>accountability</em> LGPD.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Abas + filtros */}
      <GlassCard className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-2">
            <TabBtn active={tab === 'platform'} onClick={() => setTab('platform')} icon={ShieldAlert}>
              Plataforma
            </TabBtn>
            <TabBtn active={tab === 'all'} onClick={() => setTab('all')} icon={Activity}>
              Tudo no tenant
            </TabBtn>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <select
                value={days}
                onChange={e => setDays(Number(e.target.value))}
                className={inputCls + ' pl-9 pr-8 appearance-none'}
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Filtrar por código de ação…"
                value={actionFilter}
                onChange={e => setActionFilter(e.target.value)}
                className={inputCls + ' pl-9 sm:w-72'}
              />
            </div>
          </div>
        </div>

        {/* Resumo de contadores (apenas tab platform) */}
        {tab === 'platform' && platform.data && Object.keys(platform.data.counts).length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5 flex flex-wrap gap-2">
            {Object.entries(platform.data.counts).slice(0, 8).map(([action, count]) => (
              <button
                key={action}
                onClick={() => setActionFilter(action)}
                className="text-[11px] px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-700 dark:text-violet-200 hover:bg-violet-500/20 transition"
              >
                {action} <span className="text-violet-600/70 dark:text-violet-400/70">·{count}</span>
              </button>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Lista */}
      {active.isLoading && (
        <GlassCard className="p-12 text-center">
          <Loader2 className="w-6 h-6 text-violet-500 dark:text-violet-400 mx-auto animate-spin" />
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-3">Carregando auditoria…</p>
        </GlassCard>
      )}
      {active.error && (
        <GlassCard className="p-6 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-center gap-3 text-rose-600 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5" />
            <p className="text-sm">{formatApiError(active.error)}</p>
          </div>
        </GlassCard>
      )}
      {!active.isLoading && !active.error && logs.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Shield className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {tab === 'platform'
              ? 'Nenhuma ação da plataforma foi registrada nesta janela. Tudo limpo.'
              : 'Nenhuma ação registrada nesta janela.'}
          </p>
        </GlassCard>
      )}
      {!active.isLoading && logs.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="divide-y divide-slate-200 dark:divide-white/5">
            {logs.map(l => <AuditRow key={l.id} entry={l} highlightPlatform={tab === 'platform'} />)}
          </div>
        </GlassCard>
      )}
    </div>
  )
}

// ─── Linha de auditoria ──────────────────────────────────────────────────────
function AuditRow({ entry, highlightPlatform }: { entry: AuditEntry; highlightPlatform: boolean }) {
  const isPlatform = !!entry.superAdmin
  const actor = entry.superAdmin
    ? { kind: 'platform', label: entry.superAdmin.name ?? entry.superAdmin.email ?? 'Plataforma', sub: entry.superAdmin.email }
    : entry.user
      ? { kind: 'user', label: entry.user.name ?? entry.user.email, sub: entry.user.role }
      : entry.integrador
        ? { kind: 'integ', label: entry.integrador.name, sub: 'integrador' }
        : { kind: 'system', label: 'Sistema', sub: null }

  const actorClr = actor.kind === 'platform'
    ? 'text-violet-300 bg-violet-500/10 border-violet-500/30'
    : actor.kind === 'user'
      ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30'
      : actor.kind === 'integ'
        ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
        : 'text-slate-400 bg-slate-700/20 border-slate-700/40'

  return (
    <div className={cn(
      'px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition',
      isPlatform && highlightPlatform && 'bg-violet-500/[0.04]',
    )}>
      <div className={cn('w-8 h-8 rounded-lg border flex items-center justify-center shrink-0', actorClr)}>
        {actor.kind === 'platform' ? <ShieldAlert className="w-4 h-4" /> : <User className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-mono text-slate-900 dark:text-white">{entry.action}</span>
          <span className="text-[11px] text-slate-500">·</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{entry.resource}{entry.resourceId ? `:${entry.resourceId.slice(0, 8)}…` : ''}</span>
          {entry.result && (
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full border ml-1',
              entry.result === 'SUCCESS'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : entry.result === 'BLOCKED'
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-300 border-rose-500/30',
            )}>
              {entry.result}
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1">
            {actor.kind === 'platform' ? <ShieldAlert className="w-3 h-3" /> : <User className="w-3 h-3" />}
            <span className={cn(actor.kind === 'platform' && 'text-violet-600 dark:text-violet-300 font-medium')}>{actor.label}</span>
            {actor.sub && <span className="text-slate-600">({actor.sub})</span>}
          </span>
          {entry.clienteFinal && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              <span>{entry.clienteFinal.name}</span>
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <Clock className="w-3 h-3" />
            {new Date(entry.createdAt).toLocaleString('pt-BR')}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── UI helpers ──────────────────────────────────────────────────────────────
function TabBtn({
  active, onClick, icon: Icon, children,
}: { active: boolean; onClick: () => void; icon: any; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition border',
        active
          ? 'bg-violet-500/15 text-violet-700 dark:text-violet-200 border-violet-500/40'
          : 'bg-transparent text-slate-500 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-200',
      )}
    >
      <Icon className="w-4 h-4" />
      {children}
    </button>
  )
}

const inputCls =
  'w-full px-3 py-2 bg-slate-50 dark:bg-space-800/40 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 ' +
  'focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/50 transition'
