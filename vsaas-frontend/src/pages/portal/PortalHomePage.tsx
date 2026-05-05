/**
 * PortalHomePage — Cockpit do CLIENTE FINAL.
 *
 * Refatorado na Onda 1.G do docs/13-PLAN-COCKPIT-PREMIUM.md.
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
  Video, ListChecks, FileText, ArrowRight, Building2, Activity,
  Camera as CameraIcon, ShieldCheck, Users, Bell, Plus,
} from 'lucide-react'
import { GlassCard } from '../../components/cards/GlassCard'
import { HealthScoreBadge } from '../../components/hierarchy'

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

export function PortalHomePage() {
  const cliente = loadCliente()
  const integradorBranding = loadIntegradorBranding()
  const greeting = greetingForHour(new Date().getHours())

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
                Tudo operando normalmente · monitoramento ao vivo · transparência LGPD ativa
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

      {/* Atalhos principais — mantidos do design original */}
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
            <li className="flex justify-between border-t border-slate-800 pt-2 mt-2"><span className="text-slate-400">🎬 Gravação 1080p</span><span className="font-bold text-emerald-400">disponível</span></li>
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

      {/* 🛡 LGPD — destaque (transparência) */}
      <GlassCard className="p-5 border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -mr-16 -mt-16 blur-2xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              LGPD · Quem acessou suas câmeras nas últimas 24h?
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono uppercase">
              Transparência total
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Você tem direito de saber. Aqui mostramos todos os acessos do seu integrador
            e do fabricante (IA Cloud Vision) às suas câmeras e dados.
          </p>
          <div className="text-xs text-slate-500 italic text-center py-3 bg-slate-900/50 rounded-lg border border-slate-800">
            Histórico de acessos será exibido aqui assim que o serviço de auditoria
            LGPD começar a registrar atividades.
          </div>
          <Link
            to="/portal/logs"
            className="block w-full mt-3 py-2 px-3 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 text-xs font-bold text-center transition"
          >
            Ver auditoria completa →
          </Link>
        </div>
      </GlassCard>

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
