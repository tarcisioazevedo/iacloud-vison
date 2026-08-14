/**
 * MeIntegradorMinhasAssinaturasPage — painel ÚNICO do integrador.
 *
 * Consolida em 1 página: pagamentos, contratações, catálogo, config.
 * UX alinhado ao padrão do sistema (IntegradorCockpit, FabricanteMarketplace).
 */
import { useState, useEffect, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import {
  AlertTriangle, CheckCircle2, Clock, CreditCard, Loader2,
  LayoutDashboard, FileText, Building2, Package, Settings, Rocket,
} from 'lucide-react'
import { api } from '../api/client'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

const ResumoTab        = lazy(() => import('../components/integrador-assinaturas/ResumoTab').then(m => ({ default: m.ResumoTab })))
const FaturasTab       = lazy(() => import('../components/integrador-assinaturas/FaturasTab').then(m => ({ default: m.FaturasTab })))
const ContratacoesTab  = lazy(() => import('../components/integrador-assinaturas/ContratacoesTab').then(m => ({ default: m.ContratacoesTab })))
const CatalogoTab      = lazy(() => import('../components/integrador-assinaturas/CatalogoTab').then(m => ({ default: m.CatalogoTab })))
const ConfigTab        = lazy(() => import('../components/integrador-assinaturas/ConfigTab').then(m => ({ default: m.ConfigTab })))
const MeuPlanoTab      = lazy(() => import('../components/integrador-assinaturas/MeuPlanoTab').then(m => ({ default: m.MeuPlanoTab })))

type TabKey = 'resumo' | 'meu-plano' | 'faturas' | 'contratacoes' | 'catalogo' | 'config'

interface BillingOverview {
  enabled:            boolean
  customerConfigured: boolean
  current:    null | { id: string; totalAmountBrl: number; status: string; asaasPaymentUrl: string | null; dueDate: string | null }
  counts:     { pending: number; overdue: number }
  alert:      { kind: 'overdue' | 'due_soon' | 'paid' | 'none'; daysUntilDue?: number; daysOverdue?: number }
}

const TABS: Array<{ key: TabKey; label: string; icon: any }> = [
  { key: 'resumo',       label: 'Resumo',        icon: LayoutDashboard },
  { key: 'meu-plano',    label: 'Meu plano',     icon: Rocket },
  { key: 'faturas',      label: 'Faturas',       icon: FileText },
  { key: 'contratacoes', label: 'Contratações',  icon: Building2 },
  { key: 'catalogo',     label: 'Meu catálogo',  icon: Package },
  { key: 'config',       label: 'Configuração',  icon: Settings },
]

export function MeIntegradorMinhasAssinaturasPage() {
  const [params, setParams] = useSearchParams()
  const tabFromUrl = (params.get('tab') as TabKey) ?? 'resumo'
  const [tab, setTab] = useState<TabKey>(TABS.some(t => t.key === tabFromUrl) ? tabFromUrl : 'resumo')

  useEffect(() => {
    if (tab !== tabFromUrl) {
      const p = new URLSearchParams(params)
      p.set('tab', tab)
      setParams(p, { replace: true })
    }
  }, [tab])

  const { data: ov, error, isLoading } = useSWR<BillingOverview>(
    '/me/integrador/billing/overview', fetcher,
    { refreshInterval: 60_000 },
  )

  if (error) {
    return (
      <GlassCard className="p-5 border-rose-300 dark:border-rose-500/30">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-rose-700 dark:text-rose-300">Acesso restrito</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              {error?.response?.data?.message ?? 'Apenas INTEGRADOR_ADMIN ou INTEGRADOR_TECNICO pode acessar.'}
            </p>
          </div>
        </div>
      </GlassCard>
    )
  }

  const statusKind = !ov?.customerConfigured
    ? 'pending_setup'
    : ov.alert.kind === 'overdue'  ? 'critical'
    : ov.alert.kind === 'due_soon' ? 'warning'
    : 'ok'

  const headerColor = statusKind === 'critical'      ? 'rose'
                    : statusKind === 'warning'       ? 'amber'
                    : statusKind === 'pending_setup' ? 'cyan'
                    :                                  'emerald'

  const colorMap = {
    emerald: { gradient: 'from-emerald-500/20 via-cyan-500/10 to-transparent', border: 'border-emerald-400 dark:border-emerald-500/40', iconBg: 'from-emerald-500 to-cyan-500', iconShadow: 'shadow-emerald-500/30' },
    amber:   { gradient: 'from-amber-500/20 via-rose-500/10 to-transparent',   border: 'border-amber-400 dark:border-amber-500/40',   iconBg: 'from-amber-500 to-rose-500',   iconShadow: 'shadow-amber-500/30' },
    rose:    { gradient: 'from-rose-500/20 via-amber-500/10 to-transparent',   border: 'border-rose-400 dark:border-rose-500/40',    iconBg: 'from-rose-500 to-amber-500',   iconShadow: 'shadow-rose-500/30' },
    cyan:    { gradient: 'from-cyan-500/20 via-blue-500/10 to-transparent',    border: 'border-cyan-400 dark:border-cyan-500/40',    iconBg: 'from-cyan-500 to-blue-500',    iconShadow: 'shadow-cyan-500/30' },
  }[headerColor]

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <GlassCard className={cn('p-6 bg-gradient-to-br border-2', colorMap.gradient, colorMap.border)}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className={cn('w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-xl text-3xl shrink-0',
              colorMap.iconBg, colorMap.iconShadow)}>
              <CreditCard className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Minhas assinaturas</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-xl">
                Pagamentos ao iaCloud Vision · contratações dos seus clientes finais · produtos do seu catálogo de revenda.
              </p>
              <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                {ov && (
                  <>
                    <StatusBadge kind={statusKind} />
                    {ov.counts.pending > 0 && <Pill label={`${ov.counts.pending} pendente${ov.counts.pending !== 1 ? 's' : ''}`} color="amber" />}
                    {ov.counts.overdue > 0 && <Pill label={`${ov.counts.overdue} em atraso`} color="rose" />}
                    {ov.current && <Pill label={`R$ ${Number(ov.current.totalAmountBrl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} color="cyan" />}
                  </>
                )}
              </div>
            </div>
          </div>
          {statusKind === 'pending_setup' && (
            <div className="text-right max-w-xs">
              <p className="text-xs text-cyan-700 dark:text-cyan-300 font-bold uppercase tracking-wider">
                <i className="ti ti-info-circle" /> Configure no primeiro mês
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Sua conta Asaas é criada automaticamente quando a primeira fatura for gerada.
              </p>
            </div>
          )}
        </div>
      </GlassCard>

      {/* TABS — padrão do sistema (FabricanteMarketplacePage) */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {TABS.map(t => {
          const isActive = tab === t.key
          const Icon = t.icon
          const badge = t.key === 'faturas' && (ov?.counts.pending ?? 0) > 0 ? ov?.counts.pending : null
          const overdue = t.key === 'faturas' && (ov?.counts.overdue ?? 0) > 0
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition -mb-px whitespace-nowrap',
                isActive
                  ? 'border-cyan-600 text-cyan-700 dark:text-cyan-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {badge != null && (
                <span className={cn('ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold',
                  overdue ? 'bg-rose-500 text-white' : 'bg-amber-500 text-white',
                )}>{badge}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* CONTEÚDO */}
      <div className="min-h-[400px]">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-600 dark:text-cyan-400" />
            <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Carregando…</span>
          </div>
        )}

        {!isLoading && ov && (
          <Suspense fallback={
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-600 dark:text-cyan-400" />
              <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Carregando aba…</span>
            </div>
          }>
            {tab === 'resumo'       && <ResumoTab overview={ov} />}
            {tab === 'meu-plano'    && <MeuPlanoTab />}
            {tab === 'faturas'      && <FaturasTab overview={ov} />}
            {tab === 'contratacoes' && <ContratacoesTab />}
            {tab === 'catalogo'     && <CatalogoTab />}
            {tab === 'config'       && <ConfigTab />}
          </Suspense>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ kind }: { kind: 'ok' | 'warning' | 'critical' | 'pending_setup' }) {
  const label =
    kind === 'ok'             ? 'Em dia' :
    kind === 'warning'        ? 'Vence em breve' :
    kind === 'critical'       ? 'Em atraso' :
    'Cadastro pendente'
  const Icon =
    kind === 'critical' ? AlertTriangle :
    kind === 'warning'  ? Clock :
    kind === 'ok'       ? CheckCircle2 :
    CreditCard
  return (
    <span className={cn('flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold uppercase',
      kind === 'ok'             && 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30',
      kind === 'warning'        && 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30',
      kind === 'critical'       && 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30',
      kind === 'pending_setup'  && 'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-500/30',
    )}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  )
}

function Pill({ label, color }: { label: string; color: 'amber' | 'rose' | 'cyan' }) {
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-bold uppercase border',
      color === 'amber' && 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30',
      color === 'rose'  && 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/30',
      color === 'cyan'  && 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/30',
    )}>{label}</span>
  )
}
