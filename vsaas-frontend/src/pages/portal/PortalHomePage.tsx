/**
 * PortalHomePage — Cockpit do CLIENTE FINAL.
 *
 * Refatorado na Onda 1.G do docs/13-PLAN-COCKPIT-PREMIUM.md, expandido em
 * 2026-05-06 para fechar gaps do mockup `04-cliente-cockpit.html`:
 *   - Mosaic "Ao Vivo" com câmeras reais (até 3 thumbs + slots vazios)
 *   - LGPD card com auditoria real (`usePlatformActions`) — quem acessou as
 *     câmeras nas últimas 24h
 *
 * Persona: CLIENTE_ADMIN / CLIENTE_OPERADOR / CLIENTE_VIEWER
 *
 * Diferenças vs Cockpits do Fabricante e Integrador:
 * - Foco em OPERAÇÃO ao vivo, não em gestão
 * - Card LGPD destacado (transparência: cliente vê quando integrador/fabricante
 *   acessa suas câmeras)
 * - Sem KPIs de "negócio" (sites, plano, billing) — esses ficam com integrador
 * - Branding do INTEGRADOR (whitelabel ativo via --portal-primary)
 *
 * Backend filtra tudo por clienteFinalId via JWT — sem necessidade de passar id.
 */
import { Link } from 'react-router-dom'
import {
  Video, ListChecks, FileText, ArrowRight, Activity,
  Camera as CameraIcon, ShieldCheck, Users, Bell, Plus,
  Maximize2,
} from 'lucide-react'
import { GlassCard } from '../../components/cards/GlassCard'
import { LivePlayer } from '../../components/player/LivePlayer'
import {
  useCameras, usePlatformActions, type AuditEntry,
} from '../../api/client'

function loadCliente(): { name?: string; id?: string } | null {
  try {
    const raw = localStorage.getItem('icv_cliente_final')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function loadIntegradorBranding(): { name?: string } | null {
  try {
    const raw = localStorage.getItem('icv_integrador_branding')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

interface CameraLite {
  id: string
  name: string
  active?: boolean
  status?: string
}

export function PortalHomePage() {
  const cliente = loadCliente()
  const integradorBranding = loadIntegradorBranding()
  const greeting = greetingForHour(new Date().getHours())
  const { data: camerasData } = useCameras()
  const { data: auditData } = usePlatformActions(1)

  const cameras: CameraLite[] = Array.isArray(camerasData)
    ? camerasData
    : (camerasData?.cameras ?? camerasData?.items ?? [])
  const activeCameras = cameras.filter(c => c.active !== false)
  const liveSlots: (CameraLite | null)[] = [
    activeCameras[0] ?? null,
    activeCameras[1] ?? null,
    activeCameras[2] ?? null,
  ]

  const auditLogs = auditData?.logs ?? []

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Hero — saudação personalizada + branding do integrador */}
      <GlassCard className="p-6 bg-gradient-to-br from-[var(--portal-primary,#f59e0b)]/10 via-rose-500/5 to-transparent border-[var(--portal-primary,#f59e0b)]/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-4">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl shadow-lg"
              style={{
                background: 'linear-gradient(to bottom right, var(--portal-primary, #f59e0b), var(--portal-accent, #f43f5e))',
                color: 'white',
              }}
            >
              👤
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {greeting}{cliente?.name ? `, ${cliente.name}` : ''} 🌅
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {activeCameras.length > 0
                  ? `Tudo operando · ${activeCameras.length} câmera${activeCameras.length !== 1 ? 's' : ''} ao vivo · transparência LGPD ativa`
                  : 'Bem-vindo ao seu portal · transparência LGPD ativa'}
              </p>
              <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                <span
                  className="px-2 py-0.5 rounded font-mono uppercase"
                  style={{
                    background: 'color-mix(in srgb, var(--portal-primary, #f59e0b) 20%, transparent)',
                    color: 'var(--portal-primary, #f59e0b)',
                    border: '1px solid color-mix(in srgb, var(--portal-primary, #f59e0b) 40%, transparent)',
                  }}
                >
                  Cliente
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">● Ativo</span>
              </div>
            </div>
          </div>
          {integradorBranding?.name && (
            <div className="text-right">
              <div className="text-xs text-slate-500">Suporte por</div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                🤝 {integradorBranding.name}
              </div>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Card "Ao Vivo" hero — mosaic com câmeras reais (até 3 + slots vazios) */}
      <LiveMosaicCard slots={liveSlots} totalActive={activeCameras.length} />

      {/* Atalhos principais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ShortcutCard
          to="/portal/live"
          icon={Video}
          title="Câmeras ao vivo"
          desc="Matriz com todas as câmeras do seu ambiente."
          accent="rose"
        />
        <ShortcutCard
          to="/portal/events"
          icon={ListChecks}
          title="Eventos"
          desc="Detecções recentes (faces, placas, EPI…)."
          accent="amber"
        />
        <ShortcutCard
          to="/portal/logs"
          icon={FileText}
          title="Auditoria"
          desc="Histórico de acessos e operações."
          accent="emerald"
        />
      </div>

      {/* 3 cards densos — Estatísticas · Eventos · Usuários */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GlassCard className="p-5 border-amber-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider text-amber-300 font-bold flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Estatísticas hoje
            </span>
          </div>
          <ul className="space-y-2 text-xs">
            <li className="flex justify-between"><span className="text-slate-400">👤 Pessoas detectadas</span><span className="font-bold text-white">—</span></li>
            <li className="flex justify-between"><span className="text-slate-400">🚗 Placas lidas</span><span className="font-bold text-white">—</span></li>
            <li className="flex justify-between"><span className="text-slate-400">😊 Faces reconhecidas</span><span className="font-bold text-white">—</span></li>
            <li className="flex justify-between border-t border-slate-800 pt-2 mt-2"><span className="text-slate-400">🎬 Câmeras ativas</span><span className="font-bold text-emerald-400">{activeCameras.length}</span></li>
          </ul>
        </GlassCard>

        <GlassCard className="p-5 border-rose-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider text-rose-300 font-bold flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5" /> Eventos recentes
            </span>
          </div>
          <div className="text-center py-4">
            <div className="text-3xl mb-1">😴</div>
            <div className="text-sm text-slate-400">Sem eventos hoje</div>
            <div className="text-[10px] text-slate-600 mt-1">Próximas detecções aparecem aqui em tempo real</div>
          </div>
          <Link
            to="/portal/events"
            className="block w-full mt-2 py-1.5 px-3 rounded-lg bg-slate-800 border border-slate-700 hover:border-rose-500/50 text-xs text-slate-400 hover:text-white transition text-center"
          >
            Ver histórico →
          </Link>
        </GlassCard>

        <GlassCard className="p-5 border-cyan-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider text-cyan-300 font-bold flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Minha empresa
            </span>
          </div>
          <div className="text-2xl font-bold text-white">1<span className="text-base text-slate-400"> usuário ativo</span></div>
          <div className="text-xs text-slate-500 mt-1">você</div>
          <div className="mt-3 pt-3 border-t border-slate-800 space-y-1 text-xs text-slate-400">
            <div className="flex justify-between"><span>convites pendentes</span><span className="text-white font-bold">0</span></div>
            <div className="flex justify-between"><span>último login</span><span className="text-white font-bold">agora</span></div>
          </div>
        </GlassCard>
      </div>

      {/* 🛡 LGPD — destaque (transparência) com dados REAIS */}
      <LgpdAuditCard logs={auditLogs} totalDays={1} />

      {/* Footer informativo */}
      <GlassCard className="p-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
            <CameraIcon className="w-4 h-4 text-slate-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-white mb-1">Sobre este portal</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Este portal é mantido pelo seu integrador. Para alterações de
              configuração, novas câmeras ou mudanças de usuários, entre em contato
              com o responsável pelo contrato. Sua sessão expira automaticamente
              após algumas horas — use um novo magic-link para retornar.
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

function greetingForHour(h: number): string {
  if (h < 6) return 'Boa madrugada'
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

// ────────────────────────────────────────────────────────────────────────────
// LiveMosaicCard — mosaic com câmeras reais. 3 slots: cada um pode ser
// uma câmera real (LivePlayer com WHEP) ou um slot vazio "Solicitar câmera"
// ────────────────────────────────────────────────────────────────────────────

function LiveMosaicCard({ slots, totalActive }: { slots: (CameraLite | null)[]; totalActive: number }) {
  return (
    <GlassCard className="p-5 border-rose-500/20 bg-gradient-to-br from-rose-500/5 to-transparent">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          Ao Vivo {totalActive > 0 && <span className="text-xs text-slate-400 font-normal">— {totalActive} câmera{totalActive !== 1 ? 's' : ''} ativa{totalActive !== 1 ? 's' : ''}</span>}
        </h2>
        <Link
          to="/portal/live"
          className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 text-xs font-bold transition flex items-center gap-1.5"
        >
          <Maximize2 className="w-3 h-3" />
          Ver mosaico completo →
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {slots.map((cam, idx) => (
          <LiveSlot key={cam?.id ?? `empty-${idx}`} camera={cam} />
        ))}
      </div>
    </GlassCard>
  )
}

function LiveSlot({ camera }: { camera: CameraLite | null }) {
  if (!camera) {
    return (
      <Link
        to="/portal/live"
        className="aspect-video bg-slate-900/50 rounded-xl border border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-600 hover:border-amber-500/40 hover:text-amber-300 transition group"
      >
        <Plus className="w-8 h-8 group-hover:scale-110 transition" />
        <div className="text-[10px] uppercase tracking-wider mt-1">Solicitar câmera</div>
        <div className="text-[10px] mt-0.5 text-slate-700 group-hover:text-slate-500">via integrador</div>
      </Link>
    )
  }

  return (
    <Link to={`/portal/live?camera=${camera.id}`} className="block group">
      <div className="aspect-video bg-slate-950 rounded-xl border border-slate-800 overflow-hidden relative">
        <LivePlayer cameraId={camera.id} cameraName={camera.name} muted showOverlay={false} />
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-rose-500/80 text-white text-[10px] font-bold flex items-center gap-1 z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> AO VIVO
        </div>
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between text-[10px] text-white/90 z-10">
          <span className="truncate font-medium">{camera.name}</span>
          <Maximize2 className="w-3 h-3 opacity-70 group-hover:opacity-100 shrink-0" />
        </div>
      </div>
    </Link>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// LgpdAuditCard — card destacado que mostra QUEM acessou as câmeras do
// cliente nas últimas 24h. Usa /audit/platform-actions (já filtrado por
// superAdminId — exatamente o caso "Fabricante acessou meus dados").
// Quando integradores também forem auditáveis, trocar pra /audit/timeline.
// ────────────────────────────────────────────────────────────────────────────

function LgpdAuditCard({ logs, totalDays }: { logs: AuditEntry[]; totalDays: number }) {
  const top = logs.slice(0, 5)

  return (
    <GlassCard className="p-5 border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -mr-16 -mt-16 blur-2xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            LGPD · Quem acessou suas câmeras nas últimas {totalDays === 1 ? '24h' : `${totalDays}d`}?
          </h3>
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono uppercase">
            Transparência total
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Você tem direito de saber. Aqui mostramos todos os acessos do fabricante
          (IA Cloud Vision) às suas câmeras e dados — auditados e imutáveis.
        </p>

        {top.length === 0 ? (
          <div className="text-xs text-slate-500 italic text-center py-6 bg-slate-900/50 rounded-lg border border-slate-800">
            ✅ Nenhum acesso do fabricante registrado nas últimas {totalDays === 1 ? '24h' : `${totalDays} dias`}.
          </div>
        ) : (
          <div className="space-y-2">
            {top.map(log => <AuditRow key={log.id} log={log} />)}
            {logs.length > top.length && (
              <div className="text-center text-xs text-slate-500 py-1">
                + {logs.length - top.length} acesso{logs.length - top.length !== 1 ? 's' : ''} adicional{logs.length - top.length !== 1 ? 'is' : ''} no período
              </div>
            )}
          </div>
        )}

        <Link
          to="/portal/logs"
          className="block w-full mt-3 py-2 px-3 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 text-xs font-bold text-center transition"
        >
          Ver auditoria completa →
        </Link>
      </div>
    </GlassCard>
  )
}

function AuditRow({ log }: { log: AuditEntry }) {
  const actorName = log.superAdmin?.name ?? log.superAdmin?.email ?? 'Super Admin'
  const date = new Date(log.createdAt)
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const description = describeAction(log)

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800">
      <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-xs font-bold text-violet-300 shrink-0">
        {actorName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">
          {actorName} <span className="text-slate-500 font-normal">(Super Admin)</span>
        </div>
        <div className="text-xs text-slate-400 truncate">
          {description} · {day} {time}
        </div>
      </div>
      <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 shrink-0">
        FABRICANTE
      </span>
    </div>
  )
}

function describeAction(log: AuditEntry): string {
  const action = log.action.toLowerCase()
  const resource = log.resource ?? ''
  if (action.includes('camera') && action.includes('view')) return `visualizou câmera ${log.resourceId ? log.resourceId.slice(0, 8) : ''}`
  if (action.includes('live')) return `assistiu live`
  if (action.includes('playback')) return `acessou gravação`
  if (action.includes('export')) return `exportou ${resource || 'evidência'}`
  if (action.includes('login') || action.includes('impersonate')) return 'sessão de suporte (impersonate)'
  return `${log.action}${resource ? ` em ${resource}` : ''}`
}

// ────────────────────────────────────────────────────────────────────────────
// ShortcutCard — atalho preserved
// ────────────────────────────────────────────────────────────────────────────

function ShortcutCard({
  to, icon: Icon, title, desc, accent = 'cyan',
}: {
  to: string
  icon: typeof Video
  title: string
  desc: string
  accent?: 'rose' | 'amber' | 'emerald' | 'cyan' | 'violet'
}) {
  const accentMap = {
    rose:    'group-hover:border-rose-500/40    group-hover:bg-rose-500/5',
    amber:   'group-hover:border-amber-500/40   group-hover:bg-amber-500/5',
    emerald: 'group-hover:border-emerald-500/40 group-hover:bg-emerald-500/5',
    cyan:    'group-hover:border-cyan-500/40    group-hover:bg-cyan-500/5',
    violet:  'group-hover:border-violet-500/40  group-hover:bg-violet-500/5',
  }[accent]
  const iconColor = {
    rose: 'text-rose-400', amber: 'text-amber-400',
    emerald: 'text-emerald-400', cyan: 'text-cyan-400', violet: 'text-violet-400',
  }[accent]

  return (
    <Link to={to} className="group">
      <GlassCard className={`p-5 transition ${accentMap}`}>
        <div className="flex items-start justify-between mb-3">
          <Icon className={`w-5 h-5 ${iconColor}`} />
          <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-white transition" />
        </div>
        <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
        <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
      </GlassCard>
    </Link>
  )
}
