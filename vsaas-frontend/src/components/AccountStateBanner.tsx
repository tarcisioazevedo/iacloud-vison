/**
 * <AccountStateBanner> — banner único com regra de exclusão mútua.
 *
 * Hoje o cockpit tinha 3-4 banners empilhando ao mesmo tempo:
 *   🔴 "Sua assinatura está suspensa"
 *   🟡 "Você tem 1 assinatura em graça"
 *   🟢 "Tudo operando normalmente"
 *   🔵 "Trial vence em N dias"
 *
 * Esse componente decide UM banner por vez via prioridade:
 *
 *   1º SUSPENDED  → tem fatura vencida real
 *   2º GRACE      → cliente cancelou, dados ainda existem
 *   3º TRIAL_EXPIRING → trial vence em <= 3 dias
 *   4º SYSTEM_HEALTH → backend reportando incidente
 *   (nada) → estado normal, sem banner
 *
 * Banner verde "tudo operando normalmente" foi REMOVIDO — era mentira
 * pra cliente sem plano. Estado normal = sem banner.
 *
 * Fonte: docs/35 Pacote B + docs/36 Cenário 5
 */
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { AlertCircle, Clock, AlertTriangle, RefreshCw, Download } from 'lucide-react'
import { api } from '../api/client'
import { BRAND } from '../lib/brand'

interface AccountState {
  /** Tem fatura vencida real */
  isSuspended: boolean
  /** Tem assinatura cancelada em período de graça */
  hasGrace: boolean
  /** Trial vence em N dias (≤ 3) */
  trialDaysLeft: number | null
  /** Sistema reportando incidente */
  systemIncident: { title: string; severity: 'warning' | 'critical' } | null

  // Detalhes
  graceUntil?: string | null  // ISO date
  graceCount?: number
  suspendedReason?: string | null
}

interface Props {
  /** Override pra teste/dev */
  state?: Partial<AccountState>
  /** Esconde o componente totalmente (útil em telas que não querem mostrar) */
  hidden?: boolean
}

/**
 * Componente principal. Decide qual banner mostrar.
 */
export function AccountStateBanner({ state: override, hidden }: Props = {}) {
  const { data: fetched } = useSWR<AccountState>(
    hidden ? null : '/me/capabilities/account-state',
    async (url: string) => {
      const { data } = await api.get(url)
      return data
    },
    {
      revalidateOnFocus: false,
      refreshInterval: 60_000,  // 1min
      // Se o endpoint não existir ainda, não bloqueia
      onError: () => {},
    },
  )

  const state = { ...(fetched ?? {}), ...(override ?? {}) } as AccountState

  if (hidden) return null

  // Regra de exclusão mútua: 1 banner por vez, ordenado por prioridade.
  if (state.isSuspended) return <SuspendedBanner reason={state.suspendedReason} />
  if (state.hasGrace)    return <GraceBanner until={state.graceUntil} count={state.graceCount} />
  if (state.trialDaysLeft !== null && state.trialDaysLeft !== undefined && state.trialDaysLeft <= 3) {
    return <TrialExpiringBanner daysLeft={state.trialDaysLeft} />
  }
  if (state.systemIncident) return <SystemIncidentBanner incident={state.systemIncident} />

  // Estado normal: nada renderizado. Sem banner verde mentindo.
  return null
}

// ── Banners individuais ──────────────────────────────────────────────

function SuspendedBanner({ reason }: { reason?: string | null }) {
  return (
    <BannerShell color="rose" icon={AlertCircle}>
      <div className="flex-1">
        <p className="text-sm font-semibold text-rose-200 mb-0.5">
          Sua assinatura está suspensa por inadimplência
        </p>
        <p className="text-xs text-rose-300/80">
          {reason || 'As gravações foram interrompidas. Regularize o pagamento para reativar o serviço.'}
        </p>
      </div>
      <a
        href={`mailto:${BRAND.email.support}?subject=Reativação%20de%20assinatura`}
        className="shrink-0 px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition"
      >
        Falar com suporte
      </a>
    </BannerShell>
  )
}

function GraceBanner({ until, count = 1 }: { until?: string | null, count?: number }) {
  const daysLeft = until ? Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null

  return (
    <BannerShell color="amber" icon={Clock}>
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-200 mb-0.5">
          {count === 1
            ? 'Você tem 1 assinatura cancelada em período de graça'
            : `Você tem ${count} assinaturas canceladas em período de graça`}
        </p>
        <p className="text-xs text-amber-300/80">
          {daysLeft !== null
            ? daysLeft > 0
              ? `Seus dados serão excluídos em ${daysLeft} dia${daysLeft === 1 ? '' : 's'} (${formatDate(until!)}).`
              : 'Seus dados serão excluídos hoje.'
            : 'Seus dados serão excluídos ao fim do período de graça.'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/marketplace/minhas-assinaturas"
          className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition flex items-center gap-1.5"
        >
          <RefreshCw className="w-3 h-3" />
          Reativar assinatura
        </Link>
        <Link
          to="/recordings"
          title="Exportar clipes antes da exclusão"
          className="px-3 py-2 rounded-lg border border-amber-500/40 hover:bg-amber-500/10 text-amber-300 text-xs font-semibold transition flex items-center gap-1.5"
        >
          <Download className="w-3 h-3" />
          Baixar dados
        </Link>
      </div>
    </BannerShell>
  )
}

function TrialExpiringBanner({ daysLeft }: { daysLeft: number }) {
  return (
    <BannerShell color="cyan" icon={Clock}>
      <div className="flex-1">
        <p className="text-sm font-semibold text-cyan-200 mb-0.5">
          {daysLeft === 0
            ? 'Seu trial expira hoje'
            : `Seu trial expira em ${daysLeft} dia${daysLeft === 1 ? '' : 's'}`}
        </p>
        <p className="text-xs text-cyan-300/80">
          Contrate o plano completo agora para não perder acesso aos recursos.
        </p>
      </div>
      <Link
        to="/marketplace"
        className="shrink-0 px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold transition"
      >
        Ver planos
      </Link>
    </BannerShell>
  )
}

function SystemIncidentBanner({ incident }: { incident: { title: string; severity: 'warning' | 'critical' } }) {
  const color = incident.severity === 'critical' ? 'rose' : 'amber'
  return (
    <BannerShell color={color} icon={AlertTriangle}>
      <div className="flex-1">
        <p className={`text-sm font-semibold mb-0.5 ${color === 'rose' ? 'text-rose-200' : 'text-amber-200'}`}>
          {incident.title}
        </p>
        <p className={`text-xs ${color === 'rose' ? 'text-rose-300/80' : 'text-amber-300/80'}`}>
          Acompanhe atualizações em https://status.{BRAND.domain}
        </p>
      </div>
    </BannerShell>
  )
}

// ── Shell visual compartilhado ───────────────────────────────────────

interface ShellProps {
  color: 'rose' | 'amber' | 'cyan'
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}

const COLOR_STYLES: Record<string, { border: string; bg: string; iconWrap: string; iconColor: string }> = {
  rose:  { border: 'border-rose-500/40',  bg: 'from-rose-500/10 to-rose-500/5',  iconWrap: 'bg-rose-500/20 border-rose-500/40',  iconColor: 'text-rose-400' },
  amber: { border: 'border-amber-500/40', bg: 'from-amber-500/10 to-amber-500/5', iconWrap: 'bg-amber-500/20 border-amber-500/40', iconColor: 'text-amber-400' },
  cyan:  { border: 'border-cyan-500/40',  bg: 'from-cyan-500/10 to-cyan-500/5',  iconWrap: 'bg-cyan-500/20 border-cyan-500/40',  iconColor: 'text-cyan-400' },
}

function BannerShell({ color, icon: Icon, children }: ShellProps) {
  const s = COLOR_STYLES[color]
  return (
    <div className={`rounded-xl border ${s.border} bg-gradient-to-r ${s.bg} backdrop-blur-sm p-4 mb-4`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`w-10 h-10 rounded-lg border ${s.iconWrap} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${s.iconColor}`} />
        </div>
        {children}
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR')
  } catch {
    return iso
  }
}
