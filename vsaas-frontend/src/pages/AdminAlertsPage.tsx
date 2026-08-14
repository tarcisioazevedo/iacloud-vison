/**
 * AdminAlertsPage — Centro de comando de incidentes do SUPER_ADMIN.
 *
 * Mental model: "o que está acontecendo AGORA que precisa da minha atenção?"
 * Diferente de logs (post-mortem). Aqui é proativo: aja antes do cliente ligar.
 *
 * Categorias MVP: quota · infra · approvals · commercial
 * Severidades: critical · high · warning · info
 *
 * Auto-refresh 30s.
 */
import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import {
  AlertTriangle, AlertOctagon, Shield, Info, Activity,
  Cpu, DollarSign, CheckCircle2, Briefcase, RefreshCw,
  ChevronRight, Clock, Building2, Filter, Ban, Check,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api } from '../api/client'
import { toast } from '../components/Toast'
import { cn } from '../lib/utils'
import { bg500_15, bg500_20, bg500_30, border500_30, border500_40, border500_50, hoverBg500_25, text200 } from '../lib/colorClasses'

const fetcher = (u: string) => api.get(u).then(r => r.data)

type Severity = 'critical' | 'high' | 'warning' | 'info'
type Category = 'quota' | 'infra' | 'approvals' | 'commercial' | 'compliance'

interface Alert {
  id: string
  severity: Severity
  category: Category
  title: string
  description: string
  tenant: { id: string; name: string } | null
  resource: { type: string; id: string; name: string } | null
  createdAt: string
  ageMinutes: number
  actions: {
    label: string
    href?: string
    /** Ação inline: chama `method url` (com `body`) e remove/move o card ao concluir. */
    method?: 'POST' | 'PATCH'
    url?: string
    intent?: 'approve' | 'cancel'
    requiresReason?: boolean
    body?: Record<string, unknown>
  }[]
}

interface AlertsResponse {
  alerts: Alert[]
  total: number
  counts: Record<Severity, number>
  byCategory: Record<Category, number>
}

const SEVERITIES: { id: Severity; label: string; icon: any; color: string }[] = [
  { id: 'critical', label: 'Críticos',  icon: AlertOctagon,   color: 'rose' },
  { id: 'high',     label: 'Altos',     icon: AlertTriangle,  color: 'amber' },
  { id: 'warning',  label: 'Atenção',   icon: AlertTriangle,  color: 'amber' },
  { id: 'info',     label: 'Info',      icon: Info,           color: 'cyan' },
]

const CATEGORIES: { id: Category; label: string; icon: any; color: string }[] = [
  { id: 'quota',      label: 'Quota',      icon: DollarSign,     color: 'amber' },
  { id: 'infra',      label: 'Infra',      icon: Cpu,            color: 'cyan' },
  { id: 'approvals',  label: 'Aprovações', icon: CheckCircle2,   color: 'violet' },
  { id: 'commercial', label: 'Comercial',  icon: Briefcase,      color: 'emerald' },
  { id: 'compliance', label: 'Compliance', icon: Shield,         color: 'rose' },
]

export function AdminAlertsPage() {
  const { data, error, isLoading, mutate, isValidating } = useSWR<AlertsResponse>(
    '/admin/alerts/active', fetcher, { refreshInterval: 30_000 }
  )
  const [severityFilter, setSeverityFilter] = useState<Severity[]>([])
  const [categoryFilter, setCategoryFilter] = useState<Category[]>([])

  const filtered = useMemo(() => {
    const alerts = data?.alerts ?? []
    return alerts.filter(a => {
      if (severityFilter.length && !severityFilter.includes(a.severity)) return false
      if (categoryFilter.length && !categoryFilter.includes(a.category)) return false
      return true
    })
  }, [data, severityFilter, categoryFilter])

  function toggleSev(s: Severity) {
    setSeverityFilter(arr => arr.includes(s) ? arr.filter(x => x !== s) : [...arr, s])
  }
  function toggleCat(c: Category) {
    setCategoryFilter(arr => arr.includes(c) ? arr.filter(x => x !== c) : [...arr, c])
  }

  /** Remove o card resolvido de forma otimista e revalida com o servidor. */
  function handleResolve(alertId: string) {
    mutate(prev => prev
      ? { ...prev, alerts: prev.alerts.filter(a => a.id !== alertId), total: Math.max(0, prev.total - 1) }
      : prev, { revalidate: true })
  }

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-rose-500/10 via-amber-500/5 to-transparent border-rose-300 dark:border-rose-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-amber-500 flex items-center justify-center shadow-lg">
              <AlertTriangle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Alertas e Saúde</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Centro de comando de incidentes. Agir aqui ANTES do cliente reclamar — proatividade é diferencial.
              </p>
              <p className="text-[10px] text-slate-500 mt-2">
                <Activity className="w-3 h-3 inline mr-1" /> Auto-refresh a cada 30s · Última atualização: {data ? 'agora' : '—'}
                {isValidating && <span className="text-cyan-600 dark:text-cyan-400 ml-2">atualizando...</span>}
              </p>
            </div>
          </div>
          <button onClick={() => mutate()}
            className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-white text-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
        </div>
      </GlassCard>

      {/* KPIs por severidade */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {SEVERITIES.map(s => {
          const count = data?.counts?.[s.id] ?? 0
          const Icon = s.icon
          const cls: Record<string, string> = {
            rose:  'border-rose-300 dark:border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300',
            amber: 'border-amber-300 dark:border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
            cyan:  'border-cyan-300 dark:border-cyan-500/30 bg-cyan-500/5 text-cyan-700 dark:text-cyan-300',
          }
          return (
            <button key={s.id} onClick={() => toggleSev(s.id)}
              className={cn('p-3 rounded-lg border text-left transition', cls[s.color],
                severityFilter.includes(s.id) && 'ring-2 ring-offset-2 ring-offset-slate-900 ring-current')}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4" />
                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">{s.label}</span>
              </div>
              <p className="text-2xl font-bold text-white">{count}</p>
            </button>
          )
        })}
      </div>

      {/* Categorias filtráveis */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase text-slate-500 mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Categoria:
          </span>
          {CATEGORIES.map(c => {
            const count = data?.byCategory?.[c.id] ?? 0
            const Icon = c.icon
            const isActive = categoryFilter.includes(c.id)
            return (
              <button key={c.id} onClick={() => toggleCat(c.id)}
                className={cn('px-2 py-1 rounded text-[10px] font-bold border flex items-center gap-1 transition',
                  isActive
                    ? cn(bg500_30(c.color), text200(c.color), border500_50(c.color))
                    : 'text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-white/20')}>
                <Icon className="w-3 h-3" /> {c.label} ({count})
              </button>
            )
          })}
          {(severityFilter.length > 0 || categoryFilter.length > 0) && (
            <button onClick={() => { setSeverityFilter([]); setCategoryFilter([]) }}
              className="ml-auto px-2 py-1 rounded text-[10px] text-slate-500 hover:text-white">
              Limpar filtros
            </button>
          )}
        </div>
      </GlassCard>

      {/* Lista de alertas */}
      {isLoading ? (
        <SkeletonAlerts />
      ) : error ? (
        <GlassCard className="p-6 border-rose-300 dark:border-rose-500/30">
          <p className="text-sm text-rose-700 dark:text-rose-300">Erro ao carregar alertas.</p>
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <CheckCircle2 className="w-16 h-16 mx-auto text-emerald-500/50 mb-4" />
          <h3 className="text-base font-bold text-white">Tudo sob controle 🎉</h3>
          <p className="text-sm text-slate-500 mt-1">Nenhum alerta ativo nos filtros aplicados.</p>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtered.map(alert => (
              <AlertCard key={alert.id} alert={alert} onResolve={handleResolve} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function AlertCard({ alert, onResolve }: { alert: Alert; onResolve: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  // Executa ação inline (aprovar/cancelar): chama o backend e move o card pra fora.
  async function runAction(act: Alert['actions'][number]) {
    if (!act.url || !act.method) return
    let reason: string | undefined
    if (act.requiresReason) {
      const r = window.prompt(
        act.intent === 'cancel'
          ? 'Motivo do cancelamento (mín. 5 caracteres):'
          : 'Motivo (mín. 5 caracteres):',
      )?.trim()
      if (!r) return // usuário cancelou o prompt
      if (r.length < 5) { toast.error('O motivo precisa de ao menos 5 caracteres.'); return }
      reason = r
    }
    setBusy(act.label)
    try {
      const body: Record<string, unknown> = { ...(act.body ?? {}) }
      if (reason) {
        // /approvals/:id/reject espera `reason`; /leads/:id espera `lostReason`.
        if (act.url.startsWith('/approvals/')) body.reason = reason
        else body.lostReason = reason
      }
      if (act.method === 'POST') await api.post(act.url, body)
      else await api.patch(act.url, body)
      toast.success(act.intent === 'cancel' ? 'Aprovação cancelada.' : 'Aprovado com sucesso.')
      onResolve(alert.id)
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível concluir a ação.')
    } finally {
      setBusy(null)
    }
  }

  const sevConfig = {
    critical: { color: 'rose',   icon: AlertOctagon,  bg: 'bg-rose-50 dark:bg-rose-500/10 border-rose-500/40',   text: 'text-rose-700 dark:text-rose-300' },
    high:     { color: 'amber',  icon: AlertTriangle, bg: 'bg-amber-50 dark:bg-amber-500/10 border-amber-500/40', text: 'text-amber-700 dark:text-amber-300' },
    warning:  { color: 'amber',  icon: AlertTriangle, bg: 'bg-amber-500/5 border-amber-300 dark:border-amber-500/30',  text: 'text-amber-700 dark:text-amber-300' },
    info:     { color: 'cyan',   icon: Info,          bg: 'bg-cyan-500/5 border-cyan-300 dark:border-cyan-500/20',    text: 'text-cyan-700 dark:text-cyan-300' },
  }[alert.severity]

  const Icon = sevConfig.icon
  const ageLabel = alert.ageMinutes < 60
    ? `${alert.ageMinutes}min`
    : alert.ageMinutes < 24 * 60
      ? `${Math.floor(alert.ageMinutes / 60)}h`
      : `${Math.floor(alert.ageMinutes / (60 * 24))}d`

  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.25 }}
      className={cn('p-4 rounded-lg border flex items-start gap-3 overflow-hidden', sevConfig.bg)}>
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', bg500_20(sevConfig.color))}>
        <Icon className={cn('w-4 h-4', sevConfig.text)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={cn('text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border',
            bg500_30(sevConfig.color), sevConfig.text, border500_40(sevConfig.color))}>
            {alert.severity}
          </span>
          <span className="text-[9px] uppercase text-slate-500">{alert.category}</span>
          {alert.tenant && (
            <Link to={`/admin/tenants/${alert.tenant.id}`}
              className="text-[10px] text-cyan-600 dark:text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
              <Building2 className="w-3 h-3" />{alert.tenant.name}
            </Link>
          )}
          <span className="text-[10px] text-slate-500 flex items-center gap-1 ml-auto">
            <Clock className="w-3 h-3" /> há {ageLabel}
          </span>
        </div>
        <h3 className="text-sm font-bold text-white">{alert.title}</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{alert.description}</p>
        {alert.actions.length > 0 && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {alert.actions.map((act, i) => {
              // 1) Ação inline (aprovar/cancelar) — chama o backend e move o card pra fora.
              if (act.url && act.method) {
                const isCancel = act.intent === 'cancel'
                const ActIcon = isCancel ? Ban : Check
                return (
                  <button key={i} disabled={!!busy} onClick={() => runAction(act)}
                    className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold border transition disabled:opacity-50 disabled:cursor-not-allowed',
                      isCancel
                        ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30'
                        : cn(bg500_15(sevConfig.color), hoverBg500_25(sevConfig.color), sevConfig.text, border500_30(sevConfig.color)))}>
                    <ActIcon className="w-3 h-3" /> {busy === act.label ? '...' : act.label}
                  </button>
                )
              }
              // 2) Link de navegação.
              if (act.href) {
                return (
                  <Link key={i} to={act.href}
                    className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold border transition',
                      bg500_15(sevConfig.color), hoverBg500_25(sevConfig.color), sevConfig.text, border500_30(sevConfig.color))}>
                    {act.label} <ChevronRight className="w-3 h-3" />
                  </Link>
                )
              }
              // 3) Fallback informativo (sem href/url).
              return (
                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold bg-slate-50 dark:bg-white/5 text-slate-500 border border-slate-200 dark:border-white/10">
                  {act.label}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function SkeletonAlerts() {
  return (
    <div className="space-y-2">
      {[0,1,2,3].map(i => <div key={i} className="h-20 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />)}
    </div>
  )
}
