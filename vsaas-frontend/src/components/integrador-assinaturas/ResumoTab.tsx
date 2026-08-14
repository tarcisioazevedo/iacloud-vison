/**
 * ResumoTab — KPIs no padrão KpiCardLarge do IntegradorCockpit.
 */
import useSWR from 'swr'
import {
  AlertTriangle, Clock, ExternalLink, Loader2, TrendingUp, DollarSign,
  Camera, Activity, ArrowRight, CreditCard, Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface Dashboard {
  proximaFatura: null | { id: string; totalAmountBrl: number; dueDate: string | null; status: string; asaasPaymentUrl: string | null }
  receitaPrevistaMensal: number
  custoPrevistoMensal:   number
  margemEstimadaMensal:  number
  margemPct:             number
  camerasAtivas:    number
  clientesAtivos:   number
  assinaturasAtivas: number
  atividadeRecente: Array<{
    kind:     'subscription_created' | 'invoice_paid'
    when:     string
    subject:  string
    valueBrl: number
  }>
}

function brl(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function ResumoTab(_props: { overview: any }) {
  const { data, isLoading } = useSWR<Dashboard>('/me/integrador/billing/dashboard', fetcher,
    { refreshInterval: 60_000 },
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-600 dark:text-cyan-400" />
        <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Carregando…</span>
      </div>
    )
  }

  if (!data) return null

  // Empty state — ainda sem contratos
  if (data.clientesAtivos === 0 && !data.proximaFatura && data.atividadeRecente.length === 0) {
    return (
      <GlassCard className="p-8">
        <div className="text-center max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 mx-auto mb-4 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Comece a vender</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 mb-6">
            Quando seus clientes finais contratarem produtos do marketplace, esta tela mostra a margem que você ganha e o que paga ao iaCloud Vision.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left mb-6">
            <Step n={1} title="Habilite produtos" desc="Defina o que você revende e seu markup" />
            <Step n={2} title="Cliente contrata" desc="Pelo marketplace, com seu preço final" />
            <Step n={3} title="Fatura automática" desc="Dia 1, breakdown do consumo" />
          </div>
          <Link to="/me/integrador/minhas-assinaturas?tab=catalogo"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 shadow-md shadow-cyan-500/20">
            Configurar meu catálogo <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-4">
      {/* Alerta de fatura */}
      {data.proximaFatura && (
        <GlassCard className={cn('p-4 border-l-4',
          data.proximaFatura.status === 'OVERDUE'
            ? 'border-l-rose-500 border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/5'
            : 'border-l-amber-500 border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5',
        )}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {data.proximaFatura.status === 'OVERDUE'
                ? <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                : <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              <p className={cn('text-sm font-semibold',
                data.proximaFatura.status === 'OVERDUE'
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-amber-700 dark:text-amber-300',
              )}>
                {data.proximaFatura.status === 'OVERDUE'
                  ? <>Fatura em atraso — R$ {brl(data.proximaFatura.totalAmountBrl)}</>
                  : <>Próxima fatura R$ {brl(data.proximaFatura.totalAmountBrl)} vence em {data.proximaFatura.dueDate ? new Date(data.proximaFatura.dueDate).toLocaleDateString('pt-BR') : '—'}</>}
              </p>
            </div>
            <div className="flex gap-2 items-center">
              {data.proximaFatura.asaasPaymentUrl && (
                <a href={data.proximaFatura.asaasPaymentUrl} target="_blank" rel="noopener"
                  className={cn('px-3 py-1.5 rounded-md text-xs font-semibold text-white inline-flex items-center gap-1 shadow-md',
                    data.proximaFatura.status === 'OVERDUE'
                      ? 'bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 shadow-rose-500/20'
                      : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-500/20',
                  )}>
                  <ExternalLink className="w-3 h-3" /> Pagar agora
                </a>
              )}
              <Link to="/me/integrador/minhas-assinaturas?tab=faturas" className="text-xs text-cyan-700 dark:text-cyan-400 hover:underline font-medium">Detalhes →</Link>
            </div>
          </div>
        </GlassCard>
      )}

      {/* KPIs no padrão do sistema */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi color="amber"   title="Próxima fatura"        Icon={DollarSign} value={data.proximaFatura ? `R$ ${brl(data.proximaFatura.totalAmountBrl)}` : '—'}
             sub={data.proximaFatura?.dueDate ? `vence ${new Date(data.proximaFatura.dueDate).toLocaleDateString('pt-BR')}` : 'sem pendência'} />
        <Kpi color="emerald" title="Receita prevista/mês"  Icon={TrendingUp} value={`R$ ${brl(data.receitaPrevistaMensal)}`}
             sub={`${data.assinaturasAtivas} assinatura${data.assinaturasAtivas !== 1 ? 's' : ''}`} />
        <Kpi color="cyan"    title="Margem estimada"       Icon={TrendingUp} value={`R$ ${brl(data.margemEstimadaMensal)}`}
             sub={`${data.margemPct}% sobre receita`} />
        <Kpi color="violet"  title="Câmeras ativas"        Icon={Camera}     value={String(data.camerasAtivas)}
             sub={`em ${data.clientesAtivos} cliente${data.clientesAtivos !== 1 ? 's' : ''}`} />
      </div>

      {/* Atividade recente */}
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          <h3 className="text-xs uppercase tracking-wider font-bold text-cyan-700 dark:text-cyan-300">Atividade recente</h3>
        </div>
        {data.atividadeRecente.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">Sem atividade nos últimos 30 dias.</p>
        ) : (
          <div className="space-y-1">
            {data.atividadeRecente.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-2.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/40 border-b border-slate-100 dark:border-white/5 last:border-0">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    a.kind === 'invoice_paid'
                      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                      : 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
                  )}>
                    {a.kind === 'invoice_paid' ? <CreditCard className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  </div>
                  <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{a.subject}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={cn('font-mono text-sm font-semibold',
                    a.kind === 'invoice_paid' ? 'text-slate-700 dark:text-slate-300' : 'text-emerald-600 dark:text-emerald-400',
                  )}>
                    {a.kind === 'subscription_created' ? '+ ' : ''}R$ {brl(a.valueBrl)}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">{new Date(a.when).toLocaleDateString('pt-BR')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  )
}

function Kpi({ color, title, Icon, value, sub }: {
  color: 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose'
  title: string
  Icon: any
  value: string
  sub?: string
}) {
  const map = {
    cyan:    { border: 'border-cyan-300 dark:border-cyan-500/20',       text: 'text-cyan-700 dark:text-cyan-300' },
    emerald: { border: 'border-emerald-300 dark:border-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-300' },
    amber:   { border: 'border-amber-300 dark:border-amber-500/20',     text: 'text-amber-700 dark:text-amber-300' },
    violet:  { border: 'border-violet-300 dark:border-violet-500/20',   text: 'text-violet-700 dark:text-violet-300' },
    rose:    { border: 'border-rose-300 dark:border-rose-500/20',       text: 'text-rose-700 dark:text-rose-300' },
  }[color]
  return (
    <GlassCard className={cn('p-5', map.border)}>
      <div className="flex items-center justify-between mb-3">
        <span className={cn('text-xs uppercase tracking-wider font-bold flex items-center gap-1.5', map.text)}>
          <Icon className="w-3.5 h-3.5" />
          {title}
        </span>
      </div>
      <div className="text-3xl font-bold text-slate-900 dark:text-white">{value}</div>
      {sub && <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{sub}</div>}
    </GlassCard>
  )
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-3 border border-slate-200 dark:border-white/10">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 text-white text-xs font-bold flex items-center justify-center shadow-md shadow-cyan-500/20">{n}</span>
        <p className="text-sm font-bold text-slate-900 dark:text-white">{title}</p>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400 ml-8">{desc}</p>
    </div>
  )
}
