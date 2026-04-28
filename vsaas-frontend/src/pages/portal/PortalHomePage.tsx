/**
 * PortalHomePage — Sprint CF.4
 *
 * Landing do portal cliente-final, exibida após o exchange.
 *
 * Mostra cards-resumo (câmeras online, eventos do dia, último alerta) e
 * atalhos pras 3 áreas que o CLIENTE_VIEWER pode acessar:
 *   - Live  (matriz de câmeras)
 *   - Events (review/timeline read-only)
 *   - Logs   (auditoria do tenant)
 *
 * Backend já filtra tudo por clienteFinalId via JWT — aqui é só apresentação.
 *
 * Decisão: não mostrar BI/quota/integrador-stuff. CLIENTE_VIEWER é leitura
 * focada em segurança operacional, não em métricas comerciais (que são do
 * integrador).
 */
import { Link } from 'react-router-dom'
import { Video, ListChecks, FileText, ArrowRight, Building2, Activity } from 'lucide-react'
import { GlassCard } from '../../components/cards/GlassCard'

function loadCliente() {
  try {
    const raw = localStorage.getItem('icv_cliente_final')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function PortalHomePage() {
  const cliente = loadCliente()

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background: 'color-mix(in srgb, var(--portal-primary) 20%, transparent)',
              border:     '1px solid color-mix(in srgb, var(--portal-primary) 40%, transparent)',
            }}
          >
            <Building2 className="w-5 h-5" style={{ color: 'var(--portal-primary)' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Bem-vindo{cliente?.name ? `, ${cliente.name}` : ''}
            </h1>
            <p className="text-xs text-slate-500">
              Acesso somente leitura ao seu ambiente de videomonitoramento.
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ShortcutCard
          to="/portal/live"
          icon={Video}
          title="Câmeras ao vivo"
          desc="Matriz com todas as câmeras do seu ambiente."
        />
        <ShortcutCard
          to="/portal/events"
          icon={ListChecks}
          title="Eventos"
          desc="Detecções recentes (faces, placas, EPI…)."
        />
        <ShortcutCard
          to="/portal/logs"
          icon={FileText}
          title="Logs"
          desc="Histórico de operações do sistema."
        />
      </div>

      <GlassCard className="p-6">
        <div className="flex items-center gap-2 text-emerald-300 mb-2">
          <Activity className="w-4 h-4" />
          <h2 className="text-sm font-semibold">Sobre este portal</h2>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Este é um portal somente leitura mantido pelo seu integrador. Você
          não pode alterar configurações nem cadastrar usuários — para mudanças,
          fale com o responsável pelo contrato. Sua sessão expira em algumas
          horas; para retornar, use um novo magic-link.
        </p>
      </GlassCard>
    </div>
  )
}

function ShortcutCard({
  to, icon: Icon, title, desc,
}: { to: string; icon: any; title: string; desc: string }) {
  return (
    <Link to={to} className="group">
      <GlassCard className="p-5 transition group-hover:border-[var(--portal-primary,#06b6d4)]/40">
        <div className="flex items-start justify-between mb-3">
          <Icon className="w-5 h-5" style={{ color: 'var(--portal-primary)' }} />
          <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-white transition" />
        </div>
        <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
        <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
      </GlassCard>
    </Link>
  )
}
