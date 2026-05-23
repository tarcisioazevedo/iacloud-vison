/**
 * ClienteCockpitPage — Cockpit do Cliente Final.
 *
 * Renderiza a tela inicial dos roles CLIENTE_* a partir do mockup
 * `public/preview/04-cliente-cockpit.html` (3 grupos de nav · whitelabel
 * do integrador · hero com saudação · card "Ao Vivo" · 3 cards de KPI ·
 * card LGPD).
 *
 * Self-contained: renderiza próprio sidebar/topbar/main e usa overlay
 * `fixed inset-0 z-30` para cobrir o Layout padrão (que continua montando
 * banners de impersonação por baixo, mas a UI principal vem daqui).
 */
import { Link, useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { Search } from 'lucide-react'
import { api } from '../api/client'
import { ClienteRetentionCard } from '../components/retention/ClienteRetentionCard'
import { useMyCapabilities } from '../hooks/useMyCapabilities'
import { AccountStateBanner } from '../components/AccountStateBanner'
import { CAP } from '../lib/capabilities'
// AlertTriangle/Download/RefreshCw/PauseCircle/cn removidos — banners e mailto antigos
// foram substituídos pelo <AccountStateBanner> (Pacote B).

interface MeResponse {
  kind: 'USER' | 'SUPER_ADMIN' | 'INTEGRADOR'
  id: string
  name: string
  email: string
  role?: string
  integrador?: { id: string; name: string; tradeName?: string | null } | null
  clienteFinal?: { id: string; name: string; tradeName?: string | null } | null
}

interface CamerasListResponse {
  cameras: { id: string; name: string; status: string }[]
  total?: number
}

interface BiKpisResponse {
  today: string
  totalEvents: number
  personCount: number
  avgDwellSeconds: number
  topEmotion: string
}

interface ListResponse<T> {
  items: T[]
  total: number
  page?: number
  pageSize?: number
}

interface UsersResponse {
  users: { id: string; email: string; name?: string | null; role: string; active: boolean; createdAt: string; lastLoginAt?: string | null }[]
  total: number
}

interface AuditLogRow {
  id: string
  action: string
  resource: string
  resourceId: string | null
  result: string | null
  ipAddress: string | null
  createdAt: string
  superAdmin?:   { id: string; name: string; email: string } | null
  integrador?:   { id: string; name: string } | null
  clienteFinal?: { id: string; name: string } | null
  user?:         { id: string; name: string; email: string; role: string } | null
}

interface AuditTimelineResponse {
  logs: AuditLogRow[]
  total: number
  window: { sinceIso: string; days: number }
}

interface StorageUsageResponse {
  scope: { kind: 'CLIENTE_FINAL' | 'INTEGRADOR'; clienteFinalId?: string; integradorId?: string | null }
  usedBytes: number
  usedMB: number
  usedGB: number
  quotaBytes: number | null
  quotaGB: number | null
  usagePct: number | null
  status: 'ok' | 'warning' | 'critical' | 'unmetered'
  objectCount: number
  retainDays: number
  windowSinceIso: string
  asOf: string
}

function humanBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  const rounded = v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)
  return `${rounded} ${units[i]}`
}

const fetcher = (url: string) => api.get(url).then(r => r.data)

function midnightIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diffMs / 60_000)
  if (m < 1)  return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}

// Ações do AuditLog que representam acesso a câmera/dados sensíveis do cliente
// (decisão LGPD: o cliente vê quem viu o que dele, não toda a navegação).
const LGPD_VISIBLE_ACTIONS = new Set([
  'IMPERSONATION_START',
  'CAMERA_LIVE_VIEW',
  'CAMERA_PLAYBACK',
  'RECORDING_DOWNLOAD',
  'RECORDING_EXPORT',
  'EXPORT_AUDIT',
  'EXPORT_RECORDING',
])

function actorLabel(log: AuditLogRow): { name: string; tag: 'FABRICANTE' | 'INTEGRADOR' | 'INTERNO'; tagColor: string } {
  if (log.superAdmin) {
    return {
      name: `${log.superAdmin.name} (Super Admin · VSaaS)`,
      tag: 'FABRICANTE',
      tagColor: 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/30',
    }
  }
  if (log.integrador) {
    return {
      name: `${log.integrador.name} (Integrador)`,
      tag: 'INTEGRADOR',
      tagColor: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30',
    }
  }
  if (log.user) {
    return {
      name: `${log.user.name ?? log.user.email} (${log.user.role})`,
      tag: 'INTERNO',
      tagColor: 'bg-slate-500/20 text-slate-600 dark:text-slate-300 border-slate-500/30',
    }
  }
  return { name: 'Sistema', tag: 'INTERNO', tagColor: 'bg-slate-500/20 text-slate-600 dark:text-slate-300 border-slate-500/30' }
}

function actionDescription(log: AuditLogRow): string {
  const map: Record<string, string> = {
    IMPERSONATION_START:  'Iniciou sessão como usuário do cliente',
    CAMERA_LIVE_VIEW:     'Visualizou câmera ao vivo',
    CAMERA_PLAYBACK:      'Reproduziu gravação',
    RECORDING_DOWNLOAD:   'Baixou gravação',
    RECORDING_EXPORT:     'Exportou gravação',
    EXPORT_AUDIT:         'Exportou audit log',
    EXPORT_RECORDING:     'Exportou gravação',
  }
  return map[log.action] ?? log.action.toLowerCase().replace(/_/g, ' ')
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function emojiOfTime(): string {
  const h = new Date().getHours()
  if (h < 12) return '🌅'
  if (h < 18) return '☀️'
  return '🌙'
}

function initial(name?: string | null): string {
  return (name ?? 'C').trim().charAt(0).toUpperCase() || 'C'
}

/**
 * Badge de contagem de alertas REAL (substitui "● 0 ALERTAS" hardcoded).
 * Mostra cor verde se 0, amarela se 1-5, vermelha se >5 hoje.
 */
function AlertsCountBadge() {
  const { data } = useSWR<{ count: number }>(
    '/review/stats/overview',
    (url: string) => api.get(url).then(r => ({ count: r.data?.total ?? 0 })),
    { revalidateOnFocus: false, refreshInterval: 60_000, onError: () => {} },
  )
  const count = data?.count ?? 0
  const color = count === 0
    ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30'
    : count <= 5
      ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30'
      : 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/30'
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded ${color} border font-mono ml-2`}>
      ● {count} {count === 1 ? 'ALERTA' : 'ALERTAS'}
    </span>
  )
}

/**
 * Linha de gravação no card de estatísticas — mostra qualidade e retenção
 * REAIS contratadas pelo cliente, ou "Não contratado" se não tem plano.
 * Substitui o hardcoded "Gravação 1080p · 24h".
 */
function RecordingStatRow() {
  const { has, hasAny } = useMyCapabilities()
  const resolution = has(CAP.STORAGE_RESOLUTION_FHD) ? '1080p (FHD)'
    : has(CAP.STORAGE_RESOLUTION_HD) ? '720p (HD)'
    : has(CAP.STORAGE_RESOLUTION_SD) ? '480p (SD)'
    : null
  const retentionDays = has(CAP.STORAGE_RETENTION_90D) ? 90
    : has(CAP.STORAGE_RETENTION_60D) ? 60
    : has(CAP.STORAGE_RETENTION_30D) ? 30
    : has(CAP.STORAGE_RETENTION_15D) ? 15
    : has(CAP.STORAGE_RETENTION_7D) ? 7
    : null
  const hasStorage = hasAny([CAP.STORAGE_RECORDING_CONTINUOUS, CAP.STORAGE_RECORDING_MOTION_ONLY])

  if (!hasStorage || !resolution || !retentionDays) {
    return (
      <li className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-200/50 dark:border-white/5 last:border-0">
        <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <span>🎬</span> Gravação
        </span>
        <span className="text-amber-600 dark:text-amber-400 font-mono text-[11px]">não contratada</span>
      </li>
    )
  }
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-200/50 dark:border-white/5 last:border-0">
      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
        <span>🎬</span> Gravação {resolution}
      </span>
      <span className="text-emerald-600 dark:text-emerald-400 font-mono">{retentionDays}d</span>
    </li>
  )
}

/**
 * Subtítulo do hero do cockpit. Mostra estado REAL do cliente baseado em
 * câmeras ativas + capabilities contratadas. Substitui o texto antigo
 * "Tudo operando normalmente · 24h de gravação disponível" que era hardcoded
 * e mentia para clientes sem plano de storage.
 */
function CockpitSubtitle({ liveCount }: { liveCount: number }) {
  const { has, hasAny } = useMyCapabilities()
  const hasStorage = hasAny([CAP.STORAGE_RECORDING_CONTINUOUS, CAP.STORAGE_RECORDING_MOTION_ONLY])
  const hasAI = hasAny([CAP.AI_SEMANTIC_PROCESS, CAP.AI_DETECTION_BASIC])
  const retention = has(CAP.STORAGE_RETENTION_90D) ? '90 dias'
    : has(CAP.STORAGE_RETENTION_60D) ? '60 dias'
    : has(CAP.STORAGE_RETENTION_30D) ? '30 dias'
    : has(CAP.STORAGE_RETENTION_15D) ? '15 dias'
    : has(CAP.STORAGE_RETENTION_7D) ? '7 dias'
    : null

  const camStr = liveCount === 0
    ? 'nenhuma câmera ativa'
    : `${liveCount} ${liveCount === 1 ? 'câmera ativa' : 'câmeras ativas'}`
  const storageStr = retention
    ? `gravação ${retention}`
    : 'sem plano de gravação'
  const aiStr = hasAI ? '· IA ativa' : ''

  return (
    <>
      {camStr} · {storageStr} {aiStr}
      {!hasStorage && liveCount > 0 && (
        <Link
          to="/marketplace?cat=storage"
          className="ml-2 text-cyan-600 dark:text-cyan-400 hover:underline font-semibold"
        >
          Contratar storage →
        </Link>
      )}
    </>
  )
}

export function ClienteCockpitPage() {
  const navigate = useNavigate()
  const since = midnightIso()

  const { data: me } = useSWR<MeResponse>('/auth/me', fetcher, { revalidateOnFocus: false })
  const { data: camsResp } = useSWR<CamerasListResponse>('/cameras', fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
  })

  // Estatísticas hoje
  const { data: kpis } = useSWR<BiKpisResponse>('/bi/kpis', fetcher, { refreshInterval: 60_000 })
  const { data: platesResp } = useSWR<ListResponse<unknown>>(
    `/plates/events/list?since=${encodeURIComponent(since)}&pageSize=1`,
    fetcher, { refreshInterval: 60_000 },
  )
  const { data: facesResp } = useSWR<ListResponse<unknown>>(
    `/faces/events?since=${encodeURIComponent(since)}&pageSize=1`,
    fetcher, { refreshInterval: 60_000 },
  )

  // Minha empresa
  const { data: usersResp } = useSWR<UsersResponse>('/users', fetcher, { refreshInterval: 5 * 60_000 })

  // LGPD — quem acessou nas últimas 24h
  const { data: auditResp } = useSWR<AuditTimelineResponse>(
    '/audit/timeline?days=1&limit=50',
    fetcher, { refreshInterval: 60_000 },
  )

  // Storage usado (soma dos sizeBytes dos segments do cliente na janela de retenção)
  const { data: storageResp } = useSWR<StorageUsageResponse>(
    '/storage/me/usage',
    fetcher, { refreshInterval: 5 * 60_000 },
  )

  // Assinaturas em período de graça
  // graceSubs/suspendedSubs queries antigas removidas — agora vêm via
  // /me/capabilities/account-state e são renderizadas pelo <AccountStateBanner>
  // (Pacote B). Mantemos só queries que ainda alimentam outros widgets.

  const clienteName    = me?.clienteFinal?.tradeName ?? me?.clienteFinal?.name ?? 'Cliente'
  const integradorName = me?.integrador?.tradeName  ?? me?.integrador?.name  ?? 'Integrador'

  const cameras = camsResp?.cameras ?? []
  const liveCams = cameras.filter(c => c.status === 'ACTIVE' || c.status === 'ONLINE' || c.status === 'STREAMING')
  const liveCount = liveCams.length || cameras.length

  const liveSlots: ({ id: string; name: string } | null)[] = [
    liveCams[0] ?? cameras[0] ?? null,
    liveCams[1] ?? cameras[1] ?? null,
    liveCams[2] ?? cameras[2] ?? null,
  ]

  // KPIs derivados (hoje)
  const peopleToday = kpis?.personCount ?? 0
  const platesToday = platesResp?.total ?? 0
  const facesToday  = facesResp?.total ?? 0
  const eventsToday = (kpis?.totalEvents ?? 0) + platesToday + facesToday

  // Minha empresa
  const allUsers     = usersResp?.users ?? []
  const activeUsers  = allUsers.filter(u => u.active)
  const activeCount  = activeUsers.length || (usersResp?.total ?? 0)
  const myUser       = me ? allUsers.find(u => u.email === me.email) : null
  const lastLoginIso = myUser?.lastLoginAt ?? null
  const lastLoginLbl = lastLoginIso ? relativeTime(lastLoginIso) : 'agora'

  // LGPD — filtra acessos relevantes ao cliente final
  const visibleAccesses = (auditResp?.logs ?? []).filter(l => LGPD_VISIBLE_ACTIONS.has(l.action)).slice(0, 5)

  // Refactor 2026-05-12: removido o overlay `fixed inset-0 z-30` + sidebar
  // self-contained + topbar próprio. Esse cockpit agora renderiza DENTRO do
  // `<Layout>` (App.tsx:147 `<Route index>`), que já fornece:
  //   - Sidebar com CLIENTE_NAV (retrátil, pin/hover-expand, persona-aware)
  //   - TopBar com search global, notificações, user menu
  // Antes, esse overlay sobrepunha o Layout (z-30 sob z-40 do Sidebar do Layout
  // → 2 sidebars visíveis ao mesmo tempo). Bug visual e bug de fonte única
  // de navegação. Sidebar próprio descartado: itens já cobertos por CLIENTE_NAV
  // em components/layout/Sidebar.tsx (operacao / analytics / configuracao).
  return (
    <div className="space-y-5">
      {/* Banner unificado — regra de exclusão mútua (1 banner por vez).
          Decide entre: SUSPENDED, GRACE, TRIAL_EXPIRING, SYSTEM_INCIDENT.
          Estado normal = nada renderizado. Substitui os 3+ banners antigos
          que empilhavam contradições. */}
      <AccountStateBanner />

      {/* Identificação do tenant (whitelabel: "via integrador") — chip discreto
          no topo do cockpit, já que o TopBar global mostra apenas o usuário. */}
      <div className="flex items-center gap-2 text-xs">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center font-bold text-white shrink-0 shadow-md shadow-cyan-500/30">
          {initial(clienteName)}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 dark:text-white truncate">{clienteName}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">via {integradorName}</div>
        </div>
        <AlertsCountBadge />
        <button
          onClick={() => navigate('/semantic')}
          className="ml-auto hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 hover:border-cyan-400 dark:hover:border-cyan-500/50 text-xs text-slate-600 dark:text-slate-400 transition"
          title="Atalho: ⌘K na busca global do topo"
        >
          <Search className="w-3.5 h-3.5" />
          Busca semântica
        </button>
      </div>

      <div>

            {/* Hero — paleta VSaaS (cyan→aqua "esverdeado") em vez do amber/rose antigo.
                Light: branco com tinta cyan-emerald + glow blob aqua no canto.
                Dark: glass slate-900 (mantido). */}
            <div className="relative overflow-hidden border border-cyan-200 dark:border-cyan-500/20 rounded-2xl p-4
                            bg-gradient-to-br from-cyan-50 via-white to-emerald-50
                            dark:from-cyan-500/5 dark:via-slate-900/40 dark:to-emerald-500/5
                            shadow-[0_1px_3px_rgba(3,52,87,0.06),0_8px_24px_rgba(3,52,87,0.08)] dark:shadow-glass">
              {/* Glow blob aqua decorativo */}
              <div className="absolute -right-12 -bottom-12 w-56 h-32 rounded-full blur-3xl bg-emerald-300/30 dark:bg-emerald-400/10 pointer-events-none" aria-hidden />
              <div className="relative flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  {/* Avatar com gradient da marca (cyan-prime → aqua-tech) */}
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 shadow-lg shadow-cyan-500/30 flex items-center justify-center text-xl text-white">👤</div>
                  <div>
                    <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white"
                        style={{ fontFamily: 'Manrope, Inter, sans-serif' }}>
                      {greeting()}, <span className="bg-gradient-to-r from-cyan-600 to-emerald-600 dark:from-cyan-400 dark:to-emerald-400 bg-clip-text text-transparent">{clienteName}</span> {emojiOfTime()}
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      <CockpitSubtitle liveCount={liveCount} />
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500">Suporte por</div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mt-1">🤝 {integradorName}</div>
                </div>
              </div>
            </div>

            {/* Card Ao Vivo */}
            <GlassCard borderColor="border-rose-300 dark:border-rose-500/20" gradient="from-rose-500/5 to-transparent">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full bg-rose-500"
                    style={{ animation: 'icv-live-pulse 2s infinite' }}
                  />
                  Ao Vivo — {liveCount} {liveCount === 1 ? 'câmera ativa' : 'câmeras ativas'}
                </h2>
                <button
                  onClick={() => navigate('/live')}
                  className="px-3 py-1.5 rounded-lg bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 hover:bg-rose-500/30 text-xs font-bold transition"
                >
                  Ver mosaico completo →
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {liveSlots.map((cam, idx) => cam ? (
                  <CameraSlot key={cam.id} camera={cam} onClick={() => navigate(`/cameras/${cam.id}`)} />
                ) : (
                  <EmptyCameraSlot key={`empty-${idx}`} integradorName={integradorName} showAttribution={idx === 1} />
                ))}
              </div>
            </GlassCard>

            {/* 3 cards: Estatísticas · Eventos · Minha empresa */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Palette VSaaS: Estatísticas → cyan (info/dados) */}
              <GlassCard borderColor="border-cyan-200 dark:border-cyan-500/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-cyan-700 dark:text-cyan-300 font-bold">📊 Estatísticas hoje</span>
                </div>
                <ul className="space-y-2 text-xs">
                  <StatRow icon="👤" label="Pessoas detectadas" value={peopleToday.toLocaleString('pt-BR')} />
                  <StatRow icon="🚗" label="Placas lidas"        value={platesToday.toLocaleString('pt-BR')} />
                  <StatRow icon="😊" label="Faces reconhecidas"  value={facesToday.toLocaleString('pt-BR')} />
                  {/* Gravação: mostra resolução/retenção REAL do plano (não hardcoded) */}
                  <RecordingStatRow />
                  <StatRow
                    icon="💾"
                    label={`Storage (${storageResp?.retainDays ?? 30}d)`}
                    value={
                      !storageResp
                        ? '…'
                        : storageResp.quotaBytes != null
                          ? `${humanBytes(storageResp.usedBytes)} / ${humanBytes(storageResp.quotaBytes)} (${storageResp.usagePct ?? 0}%)`
                          : humanBytes(storageResp.usedBytes)
                    }
                    valueColor={
                      storageResp?.status === 'critical' ? 'text-rose-600 dark:text-rose-400'
                      : storageResp?.status === 'warning' ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-900 dark:text-white'
                    }
                  />
                </ul>
              </GlassCard>

              {/* Palette VSaaS: Eventos → emerald (atividade/IA) */}
              <GlassCard borderColor="border-emerald-200 dark:border-emerald-500/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-bold">🎬 Eventos recentes</span>
                  {eventsToday > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 font-mono">
                      {eventsToday.toLocaleString('pt-BR')} hoje
                    </span>
                  )}
                </div>
                {eventsToday === 0 ? (
                  <div className="text-center py-4">
                    <div className="text-3xl mb-1">😴</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Sem eventos hoje</div>
                    <div className="text-[10px] text-slate-600 mt-1">Próximas detecções aparecem aqui em tempo real</div>
                  </div>
                ) : (
                  <ul className="space-y-2 text-xs py-1">
                    {platesToday > 0 && (
                      <li className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">🚗 Placas lidas</span>
                        <span className="font-bold text-slate-900 dark:text-white">{platesToday.toLocaleString('pt-BR')}</span>
                      </li>
                    )}
                    {facesToday > 0 && (
                      <li className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">😊 Faces reconhecidas</span>
                        <span className="font-bold text-slate-900 dark:text-white">{facesToday.toLocaleString('pt-BR')}</span>
                      </li>
                    )}
                    {(kpis?.totalEvents ?? 0) > 0 && (
                      <li className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">🔔 Outros eventos</span>
                        <span className="font-bold text-slate-900 dark:text-white">{(kpis?.totalEvents ?? 0).toLocaleString('pt-BR')}</span>
                      </li>
                    )}
                  </ul>
                )}
                <button
                  onClick={() => navigate('/review')}
                  className="w-full mt-2 py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-500/50 hover:text-emerald-700 dark:hover:text-emerald-300 text-xs text-slate-600 dark:text-slate-400 transition"
                >
                  Ver histórico →
                </button>
              </GlassCard>

              {/* Palette VSaaS: Minha Empresa → violet (identidade/conta) */}
              <GlassCard borderColor="border-violet-200 dark:border-violet-500/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-violet-700 dark:text-violet-300 font-bold">👥 Minha empresa</span>
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">
                  {activeCount}
                  <span className="text-base text-slate-600 dark:text-slate-400">
                    {' '}{activeCount === 1 ? 'usuário ativo' : 'usuários ativos'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1 truncate" title={me?.email ?? ''}>
                  você ({me?.role ? me.role.toLowerCase().replace('cliente_', '') : 'admin'})
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between">
                    <span>total no time</span>
                    <span className="text-slate-900 dark:text-white font-bold">{usersResp?.total ?? activeCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>último login</span>
                    <span className="text-slate-900 dark:text-white font-bold">{lastLoginLbl}</span>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/users')}
                  className="w-full mt-3 py-2 px-3 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 hover:opacity-90 text-xs font-bold text-white shadow-md shadow-violet-500/20 transition"
                >
                  + Convidar usuário
                </button>
              </GlassCard>
            </div>

            {/* Plano de retenção (self-service de upgrade) */}
            {me?.clienteFinal?.id && (
              <ClienteRetentionCard
                clienteFinalId={me.clienteFinal.id}
                cameraCount={cameras.length}
              />
            )}

            {/* LGPD card — paleta emerald/cyan tinted, branco no light */}
            <div className="relative overflow-hidden border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-5
                            bg-gradient-to-br from-emerald-50 via-white to-cyan-50
                            dark:from-emerald-500/5 dark:via-slate-900/40 dark:to-cyan-500/5
                            shadow-[0_1px_3px_rgba(3,52,87,0.06),0_8px_24px_rgba(3,52,87,0.08)] dark:shadow-glass">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-300/30 dark:bg-emerald-500/10 rounded-full -mr-16 -mt-16 blur-2xl pointer-events-none" />
              <div className="relative">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span className="text-xl">🛡</span> LGPD · Quem acessou minhas câmeras nas últimas 24h?
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 font-mono uppercase">Transparência total</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                  Você tem direito de saber. Aqui mostramos todos os acessos do seu integrador e do fabricante (VSaaS) às suas câmeras e dados.
                </p>
                <div className="space-y-2">
                  {visibleAccesses.length === 0 ? (
                    <div className="text-center text-xs text-slate-500 py-3">— sem acessos nas últimas 24h —</div>
                  ) : visibleAccesses.map(log => {
                    const actor = actorLabel(log)
                    const desc  = actionDescription(log)
                    const when  = new Date(log.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    return (
                      <div key={log.id} className="flex items-center gap-3 p-3 rounded-lg bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                        <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center text-xs font-bold shrink-0">
                          {actor.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-900 dark:text-white truncate" title={actor.name}>{actor.name}</div>
                          <div className="text-xs text-slate-600 dark:text-slate-400 truncate">{desc} · {when}{log.ipAddress ? ` · IP ${log.ipAddress}` : ''}</div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded border ${actor.tagColor} shrink-0`}>{actor.tag}</span>
                      </div>
                    )
                  })}
                </div>
                <Link
                  to="/log-audit"
                  className="block w-full text-center mt-3 py-2 px-3 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/30 text-xs font-bold transition"
                >
                  Ver auditoria completa →
                </Link>
              </div>
            </div>
          </div>
      {/* Animação live-pulse — escopo local, evita poluir global */}
      <style>{`
        @keyframes icv-live-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────────────────
// NavGroup/NavItem removidos 2026-05-12: o cockpit não tem mais sidebar próprio,
// quem renderiza a nav é o <Layout> → <Sidebar> com CLIENTE_NAV.

function GlassCard({
  children, borderColor = 'border-slate-200 dark:border-slate-700', gradient,
}: {
  children: React.ReactNode
  borderColor?: string
  gradient?: string
}) {
  // Refactor 2026-05-12: tema light usa surface branco + shadow sutil;
  // dark mantém glass slate-900 translúcido. Gradient opcional vira tinta
  // cyan→aqua (palette VSaaS, era rose→transparent hardcoded antes).
  return (
    <div
      className={[
        'border rounded-2xl p-5 transition',
        borderColor,
        // Light: branco com sombra suave + ring sutil pra contraste sobre o gradient cyan-aqua do body
        'bg-white shadow-[0_1px_3px_rgba(3,52,87,0.06),0_8px_24px_rgba(3,52,87,0.08)] ring-1 ring-slate-200/60',
        // Dark: glass slate-900 (antigo)
        'dark:bg-slate-900/60 dark:backdrop-blur-md dark:shadow-glass dark:ring-0',
        // Gradient opcional (light = white→cyan-50; dark = unchanged)
        gradient ? 'bg-gradient-to-br from-white to-cyan-50/40 dark:from-slate-900/60 dark:to-slate-900/60' : '',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

function StatRow({ icon, label, value, valueColor = 'text-slate-900 dark:text-white' }: {
  icon: string
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <li className="flex justify-between">
      <span className="text-slate-600 dark:text-slate-400">{icon} {label}</span>
      <span className={`font-bold ${valueColor}`}>{value}</span>
    </li>
  )
}

function CameraSlot({ camera, onClick }: { camera: { id: string; name: string }; onClick: () => void }) {
  return (
    <div className="relative group cursor-pointer" onClick={onClick}>
      <div className="aspect-video bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-slate-600">
          <span className="text-4xl opacity-30">📹</span>
        </div>
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-rose-500/80 text-slate-900 dark:text-white text-[10px] font-bold flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-white" style={{ animation: 'icv-live-pulse 2s infinite' }} /> AO VIVO
        </div>
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 text-slate-900 dark:text-white text-[10px] font-mono">1080p</div>
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] text-slate-900 dark:text-white/80">
          <span className="truncate max-w-[60%]">{camera.name}</span>
          <span>2Mbps · 25fps</span>
        </div>
        <div className="absolute inset-0 bg-rose-50 dark:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
          <div className="bg-black/80 px-4 py-2 rounded-full text-xs font-bold text-slate-900 dark:text-white">▶ Expandir</div>
        </div>
      </div>
      <div className="text-xs text-slate-600 dark:text-slate-300 mt-2 flex items-center justify-between">
        <span className="font-bold text-slate-900 dark:text-white truncate max-w-[60%]">{camera.name}</span>
        <span className="text-slate-500">●98</span>
      </div>
    </div>
  )
}

function EmptyCameraSlot({ integradorName, showAttribution }: { integradorName: string; showAttribution: boolean }) {
  return (
    <div className="aspect-video bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-slate-600 hover:border-cyan-400 dark:hover:border-cyan-500/50 hover:text-cyan-700 dark:hover:text-cyan-300 cursor-pointer transition group">
      <span className="text-3xl group-hover:scale-110 transition">+</span>
      <div className="text-[10px] uppercase tracking-wider mt-1">Solicitar câmera</div>
      {showAttribution && (
        <div className="text-[10px] mt-0.5 text-slate-700">via {integradorName}</div>
      )}
    </div>
  )
}
