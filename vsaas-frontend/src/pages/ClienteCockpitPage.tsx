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
      name: `${log.superAdmin.name} (Super Admin · IA Cloud Vision)`,
      tag: 'FABRICANTE',
      tagColor: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    }
  }
  if (log.integrador) {
    return {
      name: `${log.integrador.name} (Integrador)`,
      tag: 'INTEGRADOR',
      tagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    }
  }
  if (log.user) {
    return {
      name: `${log.user.name ?? log.user.email} (${log.user.role})`,
      tag: 'INTERNO',
      tagColor: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    }
  }
  return { name: 'Sistema', tag: 'INTERNO', tagColor: 'bg-slate-500/20 text-slate-300 border-slate-500/30' }
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

  return (
    <div
      className="fixed inset-0 z-30 overflow-auto text-slate-200 font-sans antialiased"
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #422006 50%, #0f172a 100%)',
        minHeight: '100vh',
      }}
    >
      <div className="flex min-h-screen">

        {/* ── Sidebar do cliente final (whitelabel do integrador) ──────────── */}
        <aside
          className="w-64 border-r border-slate-800 flex-shrink-0"
          style={{ background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(12px)' }}
        >
          <div className="p-4 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center font-bold text-white">
                {initial(clienteName)}
              </div>
              <div>
                <div className="text-sm font-bold text-white truncate max-w-[160px]" title={clienteName}>{clienteName}</div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider truncate max-w-[160px]" title={integradorName}>via {integradorName}</div>
              </div>
            </div>
          </div>

          <nav className="p-3 space-y-4 text-sm">
            <NavGroup title="Operação" titleColor="text-amber-400">
              <NavItem to="/"          icon="📊" label="Dashboard" active />
              <NavItem to="/live"      icon="🔴" label="Ao Vivo"   badge="LIVE" badgeColor="bg-rose-500/30 text-rose-300" />
              <NavItem to="/cameras"   icon="📹" label="Câmeras"   />
              <NavItem to="/recordings" icon="🎬" label="Gravações" />
              <NavItem to="/review"    icon="🔔" label="Eventos"   />
            </NavGroup>

            <NavGroup title="Analytics" titleColor="text-amber-400">
              <NavItem to="/faces"        icon="👤" label="Faces" />
              <NavItem to="/plates"       icon="🚗" label="Placas" />
              <NavItem to="/demographics" icon="📊" label="Demografia" />
              <NavItem to="/heatmap"      icon="🔥" label="Heatmap" />
            </NavGroup>

            <NavGroup title="Configuração" titleColor="text-slate-500">
              <NavItem to="/users"     icon="👥" label="Usuários" />
              <NavItem to="/sites"     icon="🏢" label="Sites" />
              <NavItem to="/log-audit" icon="🛡" label="Auditoria" badge="LGPD" badgeColor="bg-emerald-500/30 text-emerald-300" />
              <NavItem to="/settings"  icon="🔔" label="Notificações" />
            </NavGroup>
          </nav>
        </aside>

        {/* ── Main ──────────────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-auto">
          {/* Top bar */}
          <div
            className="sticky top-0 z-10 border-b border-slate-800/50 px-6 py-3 flex items-center gap-3"
            style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(12px)' }}
          >
            <span className="text-sm text-slate-400">👤 {clienteName}</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">● 0 ALERTAS</span>
            <button
              onClick={() => navigate('/semantic')}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-amber-500/50 text-sm text-slate-400 transition max-w-md"
            >
              <Search className="w-4 h-4" />
              Buscar câmera ou evento…
              <kbd className="ml-2 text-[10px] bg-slate-700/50 rounded px-1.5 py-0.5 border border-slate-600">⌘K</kbd>
            </button>
          </div>

          <div className="p-6 space-y-5">

            {/* Hero — saudação + branding do integrador */}
            <div
              className="border border-amber-500/20 rounded-2xl p-6"
              style={{ background: 'linear-gradient(to bottom right, rgba(245,158,11,0.05), rgba(244,63,94,0.05)), rgba(15,23,42,0.6)', backdropFilter: 'blur(12px)' }}
            >
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center text-2xl">👤</div>
                  <div>
                    <h1 className="text-2xl font-bold text-white">{greeting()}, {clienteName} {emojiOfTime()}</h1>
                    <p className="text-sm text-slate-400">
                      Tudo operando normalmente · {liveCount} {liveCount === 1 ? 'câmera ao vivo' : 'câmeras ao vivo'} · 24h de gravação disponível
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Suporte por</div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">🤝 {integradorName}</div>
                </div>
              </div>
            </div>

            {/* Card Ao Vivo */}
            <GlassCard borderColor="border-rose-500/20" gradient="from-rose-500/5 to-transparent">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full bg-rose-500"
                    style={{ animation: 'icv-live-pulse 2s infinite' }}
                  />
                  Ao Vivo — {liveCount} {liveCount === 1 ? 'câmera ativa' : 'câmeras ativas'}
                </h2>
                <button
                  onClick={() => navigate('/live')}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 text-xs font-bold transition"
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
              <GlassCard borderColor="border-amber-500/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-amber-300 font-bold">📊 Estatísticas hoje</span>
                </div>
                <ul className="space-y-2 text-xs">
                  <StatRow icon="👤" label="Pessoas detectadas" value={peopleToday.toLocaleString('pt-BR')} />
                  <StatRow icon="🚗" label="Placas lidas"        value={platesToday.toLocaleString('pt-BR')} />
                  <StatRow icon="😊" label="Faces reconhecidas"  value={facesToday.toLocaleString('pt-BR')} />
                  <StatRow icon="🎬" label="Gravação 1080p"      value="24h" valueColor="text-emerald-400" />
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
                      storageResp?.status === 'critical' ? 'text-rose-400'
                      : storageResp?.status === 'warning' ? 'text-amber-400'
                      : 'text-white'
                    }
                  />
                </ul>
              </GlassCard>

              <GlassCard borderColor="border-rose-500/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-rose-300 font-bold">🎬 Eventos recentes</span>
                  {eventsToday > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono">
                      {eventsToday.toLocaleString('pt-BR')} hoje
                    </span>
                  )}
                </div>
                {eventsToday === 0 ? (
                  <div className="text-center py-4">
                    <div className="text-3xl mb-1">😴</div>
                    <div className="text-sm text-slate-400">Sem eventos hoje</div>
                    <div className="text-[10px] text-slate-600 mt-1">Próximas detecções aparecem aqui em tempo real</div>
                  </div>
                ) : (
                  <ul className="space-y-2 text-xs py-1">
                    {platesToday > 0 && (
                      <li className="flex justify-between">
                        <span className="text-slate-400">🚗 Placas lidas</span>
                        <span className="font-bold text-white">{platesToday.toLocaleString('pt-BR')}</span>
                      </li>
                    )}
                    {facesToday > 0 && (
                      <li className="flex justify-between">
                        <span className="text-slate-400">😊 Faces reconhecidas</span>
                        <span className="font-bold text-white">{facesToday.toLocaleString('pt-BR')}</span>
                      </li>
                    )}
                    {(kpis?.totalEvents ?? 0) > 0 && (
                      <li className="flex justify-between">
                        <span className="text-slate-400">🔔 Outros eventos</span>
                        <span className="font-bold text-white">{(kpis?.totalEvents ?? 0).toLocaleString('pt-BR')}</span>
                      </li>
                    )}
                  </ul>
                )}
                <button
                  onClick={() => navigate('/review')}
                  className="w-full mt-2 py-1.5 px-3 rounded-lg bg-slate-800 border border-slate-700 hover:border-rose-500/50 text-xs text-slate-400 transition"
                >
                  Ver histórico →
                </button>
              </GlassCard>

              <GlassCard borderColor="border-cyan-500/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-cyan-300 font-bold">👥 Minha empresa</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {activeCount}
                  <span className="text-base text-slate-400">
                    {' '}{activeCount === 1 ? 'usuário ativo' : 'usuários ativos'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1 truncate" title={me?.email ?? ''}>
                  você ({me?.role ? me.role.toLowerCase().replace('cliente_', '') : 'admin'})
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <span>total no time</span>
                    <span className="text-white font-bold">{usersResp?.total ?? activeCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>último login</span>
                    <span className="text-white font-bold">{lastLoginLbl}</span>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/users')}
                  className="w-full mt-3 py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-xs font-bold text-white transition"
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

            {/* LGPD card */}
            <div
              className="border border-emerald-500/30 rounded-2xl p-5 relative overflow-hidden"
              style={{ background: 'linear-gradient(to bottom right, rgba(16,185,129,0.05), rgba(6,182,212,0.05)), rgba(15,23,42,0.6)', backdropFilter: 'blur(12px)' }}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -mr-16 -mt-16 blur-2xl" />
              <div className="relative">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="text-xl">🛡</span> LGPD · Quem acessou minhas câmeras nas últimas 24h?
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono uppercase">Transparência total</span>
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  Você tem direito de saber. Aqui mostramos todos os acessos do seu integrador e do fabricante (IA Cloud Vision) às suas câmeras e dados.
                </p>
                <div className="space-y-2">
                  {visibleAccesses.length === 0 ? (
                    <div className="text-center text-xs text-slate-500 py-3">— sem acessos nas últimas 24h —</div>
                  ) : visibleAccesses.map(log => {
                    const actor = actorLabel(log)
                    const desc  = actionDescription(log)
                    const when  = new Date(log.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    return (
                      <div key={log.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                        <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-xs font-bold shrink-0">
                          {actor.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate" title={actor.name}>{actor.name}</div>
                          <div className="text-xs text-slate-400 truncate">{desc} · {when}{log.ipAddress ? ` · IP ${log.ipAddress}` : ''}</div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded border ${actor.tagColor} shrink-0`}>{actor.tag}</span>
                      </div>
                    )
                  })}
                </div>
                <Link
                  to="/log-audit"
                  className="block w-full text-center mt-3 py-2 px-3 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 text-xs font-bold transition"
                >
                  Ver auditoria completa →
                </Link>
              </div>
            </div>
          </div>
        </main>
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

function NavGroup({ title, titleColor, children }: { title: string; titleColor: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wider ${titleColor} font-bold mb-2 px-2`}>{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function NavItem({
  to, icon, label, badge, badgeColor, active,
}: {
  to: string
  icon: string
  label: string
  badge?: string
  badgeColor?: string
  active?: boolean
}) {
  const baseCls = 'flex items-center gap-3 px-3 py-2 rounded-lg transition'
  const cls = active
    ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
  return (
    <Link to={to} className={`${baseCls} ${cls}`}>
      <span>{icon}</span>
      <span>{label}</span>
      {badge && (
        <span className={`ml-auto text-[10px] rounded px-1.5 ${badgeColor ?? 'bg-slate-700 text-slate-300'}`}>
          {badge}
        </span>
      )}
    </Link>
  )
}

function GlassCard({
  children, borderColor = 'border-slate-700', gradient,
}: {
  children: React.ReactNode
  borderColor?: string
  gradient?: string
}) {
  return (
    <div
      className={`border ${borderColor} rounded-2xl p-5`}
      style={{
        background: gradient
          ? `linear-gradient(to bottom right, var(--icv-grad-from, rgba(244,63,94,0.05)), var(--icv-grad-to, transparent)), rgba(15,23,42,0.6)`
          : 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {children}
    </div>
  )
}

function StatRow({ icon, label, value, valueColor = 'text-white' }: {
  icon: string
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <li className="flex justify-between">
      <span className="text-slate-400">{icon} {label}</span>
      <span className={`font-bold ${valueColor}`}>{value}</span>
    </li>
  )
}

function CameraSlot({ camera, onClick }: { camera: { id: string; name: string }; onClick: () => void }) {
  return (
    <div className="relative group cursor-pointer" onClick={onClick}>
      <div className="aspect-video bg-slate-950 rounded-xl border border-slate-800 overflow-hidden relative">
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
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-rose-500/80 text-white text-[10px] font-bold flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-white" style={{ animation: 'icv-live-pulse 2s infinite' }} /> AO VIVO
        </div>
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-mono">1080p</div>
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] text-white/80">
          <span className="truncate max-w-[60%]">{camera.name}</span>
          <span>2Mbps · 25fps</span>
        </div>
        <div className="absolute inset-0 bg-rose-500/10 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
          <div className="bg-black/80 px-4 py-2 rounded-full text-xs font-bold text-white">▶ Expandir</div>
        </div>
      </div>
      <div className="text-xs text-slate-300 mt-2 flex items-center justify-between">
        <span className="font-bold text-white truncate max-w-[60%]">{camera.name}</span>
        <span className="text-slate-500">●98</span>
      </div>
    </div>
  )
}

function EmptyCameraSlot({ integradorName, showAttribution }: { integradorName: string; showAttribution: boolean }) {
  return (
    <div className="aspect-video bg-slate-900 rounded-xl border border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-600 hover:border-amber-500/30 hover:text-amber-300 cursor-pointer transition group">
      <span className="text-3xl group-hover:scale-110 transition">+</span>
      <div className="text-[10px] uppercase tracking-wider mt-1">Solicitar câmera</div>
      {showAttribution && (
        <div className="text-[10px] mt-0.5 text-slate-700">via {integradorName}</div>
      )}
    </div>
  )
}
