/**
 * IntegradorCockpitPage — Cockpit do INTEGRADOR (espelho do TenantCockpit do
 * Fabricante, mas escopado ao próprio tenant via JWT).
 *
 * Persona: INTEGRADOR_ADMIN / INTEGRADOR_TECNICO
 * Rota: /integrador (root) e /integrador/clientes/:id (drill)
 * Escopo: SEMPRE o integradorId do JWT (não pode espiar outros integradores)
 *
 * Diferenças vs Fabricante:
 * - Tom: "Meu Negócio" em vez de "Tenant Management"
 * - Sem KPI de receita do fabricante; tem KPI de plano contratado
 * - Filtros automáticos por integradorId via RBAC server-side
 * - Sem botão "criar integrador" — fora do escopo
 * - Banner discreto: "powered by VSaaS"
 *
 * Atualização 2026-05-06: fechados gaps do mockup `02-integrador-cockpit.html`:
 *   - Sparklines nas KPIs (sintéticas, baseadas nos counts atuais)
 *   - Card "Plano Atual" agora puxa `/quota/me` real
 *   - Cards "Alertas 24h" + "Atividade recente" pluggados em `/audit/timeline`
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Building2, Briefcase, Server, Plus,
  TrendingUp, Activity, Loader2, AlertTriangle, Search,
  Bell, ScrollText,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { TreeView, HealthScoreBadge, PresenceMap, Sparkline } from '../components/hierarchy'
import { HealthActionRequired } from '../components/HealthActionRequired'
import {
  useMyIntegradorTree, useSitesGeo, formatApiError,
  useAuditTimeline, useQuotaMe, type AuditEntry,
} from '../api/client'
import { cn } from '../lib/utils'

export function IntegradorCockpitPage() {
  const navigate = useNavigate()
  const { data, error, isLoading } = useMyIntegradorTree(3)
  const { data: auditTimeline } = useAuditTimeline(1)
  const { data: quota } = useQuotaMe()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all'|'active'|'inactive'>('all')

  const filtered = useMemo(() => {
    const list = data?.clientes ?? []
    return list.filter(c => {
      if (statusFilter === 'active' && !c.active) return false
      if (statusFilter === 'inactive' && c.active) return false
      if (!search) return true
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    })
  }, [data, search, statusFilter])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-600 dark:text-cyan-400" />
        <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Carregando seu cockpit...</span>
      </div>
    )
  }

  if (error) {
    return (
      <GlassCard className="p-5 border-rose-300 dark:border-rose-500/30">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-rose-700 dark:text-rose-300">Não foi possível carregar seu cockpit</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
          </div>
        </div>
      </GlassCard>
    )
  }

  if (!data) return null

  const { integrador, summary, clientes } = data
  const healthScore = summary.edgeNodes > 0
    ? Math.round((summary.edgeNodesOnline / summary.edgeNodes) * 100)
    : null

  const auditLogs = auditTimeline?.logs ?? []
  const alertLogs = auditLogs.filter(isAlertLike).slice(0, 4)

  return (
    <div className="space-y-4">
      {/* P0.E: card "Ações Necessárias" — só aparece se há alertas ativos */}
      <HealthActionRequired />

      {/* Hero do Integrador — "Meu Negócio" */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent border-cyan-300 dark:border-cyan-500/20">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-2xl">
                🤝
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Olá, {integrador.tradeName ?? integrador.name} 👋</h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Aqui está o resumo do seu negócio · {summary.clientes} cliente{summary.clientes !== 1 ? 's' : ''} ·{' '}
                  {summary.sites} site{summary.sites !== 1 ? 's' : ''} · {summary.edgeNodesOnline}/{summary.edgeNodes} box{summary.edgeNodes !== 1 ? 'es' : ''} online
                </p>
                <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                  <span className="px-2 py-0.5 rounded bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-500/30 font-mono uppercase">
                    Integrador
                  </span>
                  <span className={cn(
                    'px-2 py-0.5 rounded border',
                    integrador.active
                      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30'
                      : 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/30',
                  )}>
                    {integrador.active ? '● Ativo' : '⏸ Suspenso'}
                  </span>
                  <span className="text-slate-500">{integrador.email}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => navigate('/clientes-finais')}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-cyan-500/50 text-sm text-slate-900 dark:text-white transition flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Novo cliente
              </button>
              <button
                onClick={() => navigate('/edge')}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-amber-500/50 text-sm text-slate-900 dark:text-white transition flex items-center gap-1.5"
              >
                <Server className="w-3.5 h-3.5" /> Provisionar box
              </button>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* 3 cards densos: Meu Negócio · Operação · Plano */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCardLarge
          title="Meu Negócio"
          icon={Briefcase}
          color="cyan"
          subtitle="crescimento 30d"
          stats={[
            { label: 'cliente final', value: summary.clientes },
            { label: 'site ativo', value: summary.sites },
            { label: 'câmera ativa', value: summary.cameras },
            { label: 'usuário convidado', value: '—' },
          ]}
          sparklineValues={growthSeries(summary.clientes + summary.sites + summary.cameras)}
          sparklineColor="rgb(34 211 238)"
        />
        <KpiCardLarge
          title="Operação"
          icon={Activity}
          color="emerald"
          subtitle="status em tempo real"
          mainValue={
            <div className="flex items-center gap-1.5">
              <HealthScoreBadge score={healthScore} size="md" />
              <span className="text-base text-slate-600 dark:text-slate-400">/100</span>
            </div>
          }
          mainLabel="saúde média da rede"
          stats={[
            { label: 'boxes online', value: `${summary.edgeNodesOnline}/${summary.edgeNodes}` },
            { label: 'eventos críticos 24h', value: alertLogs.length },
          ]}
          sparklineValues={healthSeries(healthScore)}
          sparklineColor="rgb(52 211 153)"
        />
        <PlanCard quota={quota} navigateUpgrade={() => navigate('/quota')} />
      </div>

      {/* Lista de Clientes com TreeView */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              Meus Clientes ({summary.clientes})
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Clique para expandir e ver sites, boxes e câmeras</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all'|'active'|'inactive')}
              className="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900">
              <option value="all">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
            <div className="relative w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar cliente..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
            </div>
            <button
              onClick={() => navigate('/clientes-finais')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-slate-900 dark:text-white text-xs font-bold shadow-lg shadow-cyan-500/20"
            >
              <Plus className="w-3.5 h-3.5" /> Novo cliente
            </button>
          </div>
        </div>
        <TreeView
          clientes={filtered}
          onAddSite={() => navigate('/sites')}
          onAddBox={() => navigate('/edge')}
          onAddCamera={() => navigate('/cameras')}
          addCameraMode="callback"
          emptyState={
            <>
              <div className="text-4xl mb-2">🤝</div>
              <div className="text-sm">
                {clientes.length === 0
                  ? 'Você ainda não tem clientes cadastrados'
                  : `Nenhum cliente encontrado para "${search}"`}
              </div>
              <div className="text-xs mt-1 text-slate-600">
                {clientes.length === 0 && 'Comece adicionando seu primeiro cliente final'}
              </div>
            </>
          }
        />
      </GlassCard>

      {/* 🚨 Alertas + 📜 Atividade recente — gap do mockup 02 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AlertsCard logs={alertLogs} />
        <RecentActivityCard logs={auditLogs.slice(0, 6)} />
      </div>

      {/* 🗺 Presença Geográfica (Onda 7) */}
      <PresenceMapForIntegrador />

      {/* Footer "powered by" */}
      <div className="text-center text-[10px] text-slate-600 pt-2">
        powered by VSaaS · v0.1
      </div>
    </div>
  )
}

function PresenceMapForIntegrador() {
  const { data, isLoading } = useSitesGeo()
  if (isLoading) return null
  const points = (data?.points ?? []).map(p => ({
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    clienteName: p.clienteName ?? undefined,
    healthScore: p.healthScore,
    counts: {
      cameras: p.counts.cameras,
      boxes: p.counts.boxes,
      boxesOnline: p.counts.boxesOnline,
    },
  }))
  return <PresenceMap points={points} title="🗺 Meus Sites no Mapa" height="320px" />
}

// ────────────────────────────────────────────────────────────────────────────
// PlanCard — usa /quota/me real. Mostra cameras/boxes/storage usage com
// progress bars e CTA de Upgrade. Sem hardcoded "27 dias trial".
// ────────────────────────────────────────────────────────────────────────────

function PlanCard({
  quota,
  navigateUpgrade,
}: {
  quota: ReturnType<typeof useQuotaMe>['data']
  navigateUpgrade: () => void
}) {
  if (!quota) {
    return (
      <GlassCard className="p-5 border-amber-300 dark:border-amber-500/20">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-300 font-bold flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Plano Atual
          </span>
          <Loader2 className="w-3 h-3 animate-spin text-amber-700 dark:text-amber-300" />
        </div>
        <div className="text-xs text-slate-500">Carregando uso...</div>
      </GlassCard>
    )
  }

  // hardLimits está populado quando scope=INTEGRADOR
  const hl = quota.hardLimits
  const cameras = quota.summary.cameras
  const storageGb = quota.summary.storageGb

  // Streaming/Vision são limites de plano por ciclo — proxy do "tier"
  const streamingPct = hl?.streaming?.pct ?? 0
  const visionPct = hl?.vision?.pct ?? 0
  const overallPct = Math.max(streamingPct, visionPct)

  const tierLabel = hl
    ? overallPct < 60 ? 'Saudável' : overallPct < 85 ? 'Atenção' : 'Limite próximo'
    : quota.scope === 'PLATFORM' ? 'Sem limite' : 'Sem plano ativo'

  const tierStyles = overallPct < 60
    ? { border: 'border-emerald-300 dark:border-emerald-500/20', headText: 'text-emerald-700 dark:text-emerald-300', badge: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30' }
    : overallPct < 85
    ? { border: 'border-amber-300 dark:border-amber-500/20',   headText: 'text-amber-700 dark:text-amber-300',   badge: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30' }
    : { border: 'border-rose-300 dark:border-rose-500/20',    headText: 'text-rose-700 dark:text-rose-300',    badge: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/30' }

  return (
    <GlassCard className={cn('p-5', tierStyles.border)}>
      <div className="flex items-center justify-between mb-3">
        <span className={cn('text-xs uppercase tracking-wider font-bold flex items-center gap-1.5', tierStyles.headText)}>
          <TrendingUp className="w-3.5 h-3.5" /> Plano Atual
        </span>
        <span className={cn('text-[10px] rounded px-1.5 border', tierStyles.badge)}>
          {tierLabel}
        </span>
      </div>

      <div className="text-3xl font-bold text-slate-900 dark:text-white">
        {cameras}<span className="text-base text-slate-600 dark:text-slate-400"> câm</span>
      </div>
      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
        {storageGb.toFixed(1)} GB usados · ciclo {quota.summary.cycleLabel}
      </div>

      {hl ? (
        <div className="mt-3 space-y-2 text-xs">
          <QuotaBar label="Vision API calls" used={hl.vision.used} limit={hl.vision.limit} pct={hl.vision.pct} />
          <QuotaBar label="Streaming (min)" used={hl.streaming.usedMinutes} limit={hl.streaming.limitMinutes} pct={hl.streaming.pct} />
        </div>
      ) : (
        <div className="mt-3 text-xs text-slate-500 italic">
          {quota.scope === 'PLATFORM' ? 'Conta da plataforma · sem limites' : 'Sem hard-limits configurados'}
        </div>
      )}

      <button
        onClick={navigateUpgrade}
        className="mt-3 w-full py-2 px-3 rounded-lg text-xs font-bold text-slate-900 dark:text-white transition bg-gradient-to-r from-amber-500 to-rose-500 hover:opacity-90"
      >
        Ver detalhes / Upgrade →
      </button>
    </GlassCard>
  )
}

function QuotaBar({ label, used, limit, pct }: { label: string; used: number; limit: number; pct: number }) {
  const barClass = pct < 60
    ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
    : pct < 85
    ? 'bg-gradient-to-r from-amber-500 to-amber-400'
    : 'bg-gradient-to-r from-rose-500 to-rose-400'
  return (
    <div>
      <div className="flex justify-between text-slate-600 dark:text-slate-400">
        <span>{label}</span>
        <span>{used.toLocaleString('pt-BR')} / {limit.toLocaleString('pt-BR')}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-0.5">
        <div className={cn('h-full', barClass)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// AlertsCard — usa /audit/timeline filtrado por ações tipo "issue/error"
// ────────────────────────────────────────────────────────────────────────────

function AlertsCard({ logs }: { logs: AuditEntry[] }) {
  return (
    <GlassCard className="p-5 border-rose-300 dark:border-rose-500/20">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
        <Bell className="w-4 h-4 text-rose-600 dark:text-rose-400" />
        Alertas dos meus clientes (24h)
      </h3>
      {logs.length === 0 ? (
        <div className="text-center py-6">
          <div className="text-4xl mb-2">✅</div>
          <div className="text-sm text-emerald-600 dark:text-emerald-400 font-bold">Tudo operacional</div>
          <div className="text-xs text-slate-500 mt-1">Nenhum alerta nas últimas 24h</div>
        </div>
      ) : (
        <ul className="space-y-2 text-xs">
          {logs.map(log => (
            <li key={log.id} className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
              <span className="text-rose-600 dark:text-rose-400 mt-0.5">●</span>
              <div className="flex-1 min-w-0">
                <div className="truncate">{describeAuditAction(log)}</div>
                <div className="text-[10px] text-slate-500">
                  {formatRelative(log.createdAt)}
                  {log.clienteFinal?.name && ` · ${log.clienteFinal.name}`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  )
}

function RecentActivityCard({ logs }: { logs: AuditEntry[] }) {
  return (
    <GlassCard className="p-5 border-cyan-300 dark:border-cyan-500/20">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
        <ScrollText className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
        Atividade recente
      </h3>
      {logs.length === 0 ? (
        <div className="text-center py-6 text-xs text-slate-500 italic">
          Nenhuma atividade registrada nas últimas 24h
        </div>
      ) : (
        <ul className="space-y-2 text-xs">
          {logs.map(log => {
            const color = activityColor(log)
            return (
              <li key={log.id} className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
                <span className={cn('mt-0.5', color)}>⊕</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{describeAuditAction(log)}</div>
                  <div className="text-[10px] text-slate-500">
                    {formatRelative(log.createdAt)}
                    {log.user?.name && ` · ${log.user.name}`}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </GlassCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function isAlertLike(log: AuditEntry): boolean {
  if (log.result === 'BLOCKED' || log.result === 'ERROR') return true
  const a = log.action.toLowerCase()
  return a.includes('offline') || a.includes('disconnected') || a.includes('failed') || a.includes('error') || a.includes('alert')
}

function describeAuditAction(log: AuditEntry): string {
  const { action, resource, resourceId } = log
  const tail = resourceId ? ` ${resourceId.slice(0, 8)}` : ''
  return `${action}${resource ? ` · ${resource}${tail}` : tail}`
}

function activityColor(log: AuditEntry): string {
  const a = log.action.toLowerCase()
  if (a.includes('create') || a.includes('add')) return 'text-emerald-600 dark:text-emerald-400'
  if (a.includes('delete') || a.includes('remove') || a.includes('error')) return 'text-rose-600 dark:text-rose-400'
  if (a.includes('update') || a.includes('patch')) return 'text-amber-600 dark:text-amber-400'
  if (a.includes('login') || a.includes('connect')) return 'text-cyan-600 dark:text-cyan-400'
  return 'text-violet-600 dark:text-violet-400'
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin}min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Série sintética de "crescimento" — produz 7 pontos terminando no valor atual. */
function growthSeries(current: number): number[] {
  if (current <= 0) return [0, 0, 0, 0, 0, 0, 0]
  const peaks = [0.1, 0.15, 0.25, 0.4, 0.55, 0.75, 1]
  return peaks.map(p => Math.max(1, Math.round(current * p)))
}

/** Série sintética de saúde — oscila estável. */
function healthSeries(score: number | null): number[] {
  if (score == null) return [0, 0, 0, 0, 0, 0, 0]
  const pattern = [0.6, 0.7, 0.8, 0.85, 0.9, 0.88, 0.95, score / 100]
  return pattern.map(p => Math.round(p * 100))
}

// ────────────────────────────────────────────────────────────────────────────
// KpiCardLarge — KPI card com sparkline opcional
// ────────────────────────────────────────────────────────────────────────────

interface KpiCardLargeProps {
  title: string
  icon: typeof Building2
  color: 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose'
  subtitle?: string
  mainValue?: React.ReactNode
  mainLabel?: string
  stats?: Array<{ label: string; value: React.ReactNode }>
  cta?: { label: string; onClick: () => void }
  sparklineValues?: number[]
  sparklineColor?: string
}

function KpiCardLarge({ title, icon: Icon, color, subtitle, mainValue, mainLabel, stats, cta, sparklineValues, sparklineColor }: KpiCardLargeProps) {
  const colorMap = {
    cyan:    { border: 'border-cyan-300 dark:border-cyan-500/20',    text: 'text-cyan-700 dark:text-cyan-300',    bg: 'bg-cyan-50 dark:bg-cyan-500/10',    bar: 'from-cyan-500 to-blue-500' },
    emerald: { border: 'border-emerald-300 dark:border-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-500/10', bar: 'from-emerald-500 to-cyan-500' },
    amber:   { border: 'border-amber-300 dark:border-amber-500/20',   text: 'text-amber-700 dark:text-amber-300',   bg: 'bg-amber-50 dark:bg-amber-500/10',   bar: 'from-amber-500 to-rose-500' },
    violet:  { border: 'border-violet-300 dark:border-violet-500/20',  text: 'text-violet-700 dark:text-violet-300',  bg: 'bg-violet-50 dark:bg-violet-500/10',  bar: 'from-violet-500 to-cyan-500' },
    rose:    { border: 'border-rose-300 dark:border-rose-500/20',    text: 'text-rose-700 dark:text-rose-300',    bg: 'bg-rose-50 dark:bg-rose-500/10',    bar: 'from-rose-500 to-amber-500' },
  }[color]

  return (
    <GlassCard className={cn('p-5', colorMap.border)}>
      <div className="flex items-center justify-between mb-3">
        <span className={cn('text-xs uppercase tracking-wider font-bold flex items-center gap-1.5', colorMap.text)}>
          <Icon className="w-3.5 h-3.5" />
          {title}
        </span>
        {subtitle && <span className="text-[10px] text-slate-500">{subtitle}</span>}
      </div>

      {mainValue && (
        <div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{mainValue}</div>
          {mainLabel && <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{mainLabel}</div>}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          {stats.map((s, idx) => (
            <div key={idx}>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {sparklineValues && sparklineValues.some(v => v > 0) && (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800/50">
          <Sparkline values={sparklineValues} color={sparklineColor ?? 'currentColor'} height={28} />
        </div>
      )}

      {cta && (
        <button
          onClick={cta.onClick}
          className={cn(
            'mt-3 w-full py-2 px-3 rounded-lg text-xs font-bold text-slate-900 dark:text-white transition bg-gradient-to-r hover:opacity-90',
            colorMap.bar,
          )}
        >
          {cta.label}
        </button>
      )}
    </GlassCard>
  )
}
