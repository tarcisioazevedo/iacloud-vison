/**
 * MeuPlanoTab — integrador vê seu plano de revenda, uso, countdown trial,
 * comparador e solicita upgrade. Sprint 0 · Variação B.
 */
import { useState } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import {
  Rocket, Sparkles, Users, Camera, Clock, AlertTriangle,
  ArrowRight, Loader2, CheckCircle2, Send, X,
} from 'lucide-react'
import { api } from '../../api/client'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface PlanInfo {
  id: string; slug: string; name: string; tagline: string
  priceMonthly: number | null; priceMonuv: number | null
  maxClientesFinais: number | null; maxCameras: number | null
  extraClientePriceBrl: number | null; extraCameraPriceBrl: number | null
  isTrial: boolean; trialDays: number; enforcementMode: string
  accent: string; highlights: string[]; recommended: boolean
  connections?: string; retention?: string; totalAIs?: string
}

interface MeuPlanoData {
  integrador: { id: string; name: string; pricingVersion: number }
  plan: PlanInfo | null
  planActivatedAt: string | null
  trial: null | { endsAt: string; daysLeft: number; activatedAt: string | null }
  usage: {
    clientesAtivos: number; clientesLimit: number | null; clientesPct: number | null
    camerasAtivas: number;  camerasLimit:  number | null; camerasPct:  number | null
  }
  adicionais: { clientesExcedidos: number; camerasExcedidas: number; extraClienteBrl: number; extraCameraBrl: number }
  cobrancaPrevistaMensalBrl: number
}

interface UpgradeRequest {
  id: string; fromPlanId: string | null; toPlanId: string; status: string
  reason: string | null; decidedAt: string | null; createdAt: string
  fromPlan: { slug: string; name: string } | null
  toPlan: { slug: string; name: string } | null
}

function brl(n: number) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

export function MeuPlanoTab() {
  const { data, isLoading, error } = useSWR<MeuPlanoData>('/me/integrador/plan', fetcher,
    { refreshInterval: 60_000 },
  )
  const { data: requests } = useSWR<UpgradeRequest[]>('/me/integrador/plan/upgrade-requests', fetcher)
  const { data: available } = useSWR<PlanInfo[]>('/me/integrador/plan/available', fetcher)

  const [upgradeOpen, setUpgradeOpen] = useState<string | null>(null) // toPlanId

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-600 dark:text-cyan-400" />
        <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Carregando seu plano…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <GlassCard className="p-5 border-rose-300 dark:border-rose-500/30">
        <p className="text-sm text-rose-700 dark:text-rose-300">Falha ao carregar plano.</p>
      </GlassCard>
    )
  }

  const pending = requests?.find(r => r.status === 'PENDING')

  // Sem plano atribuído
  if (!data.plan) {
    return (
      <GlassCard className="p-8">
        <div className="text-center max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-rose-500 mx-auto mb-4 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <AlertTriangle className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Sem plano atribuído</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            Seu cadastro ainda não tem um plano de revenda definido. Entre em contato com o fabricante para começar.
          </p>
        </div>
      </GlassCard>
    )
  }

  const accent = data.plan.accent || 'cyan'
  const borderMap: Record<string, string> = {
    cyan:    'border-cyan-300 dark:border-cyan-500/40',
    emerald: 'border-emerald-300 dark:border-emerald-500/40',
    violet:  'border-violet-300 dark:border-violet-500/40',
    amber:   'border-amber-300 dark:border-amber-500/40',
    rose:    'border-rose-300 dark:border-rose-500/40',
  }
  const gradMap: Record<string, string> = {
    cyan:    'from-cyan-500/20 via-blue-500/10 to-transparent',
    emerald: 'from-emerald-500/20 via-cyan-500/10 to-transparent',
    violet:  'from-violet-500/20 via-cyan-500/10 to-transparent',
    amber:   'from-amber-500/20 via-rose-500/10 to-transparent',
    rose:    'from-rose-500/20 via-amber-500/10 to-transparent',
  }
  const iconBgMap: Record<string, string> = {
    cyan:    'from-cyan-500 to-blue-500',
    emerald: 'from-emerald-500 to-cyan-500',
    violet:  'from-violet-500 to-cyan-500',
    amber:   'from-amber-500 to-rose-500',
    rose:    'from-rose-500 to-amber-500',
  }

  return (
    <div className="space-y-4">
      {/* HEADER plano atual */}
      <GlassCard className={cn('p-6 bg-gradient-to-br border-2', gradMap[accent], borderMap[accent])}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className={cn('w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-xl shrink-0', iconBgMap[accent])}>
              <Rocket className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">Seu plano de revenda</p>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{data.plan.name}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-xl">{data.plan.tagline}</p>
              {data.planActivatedAt && (
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                  Ativo desde {new Date(data.planActivatedAt).toLocaleDateString('pt-BR')}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-slate-900 dark:text-white">
              {data.plan.priceMonthly == null
                ? <span className="text-base">Sob consulta</span>
                : <>R$ {brl(data.plan.priceMonthly)}<span className="text-base font-normal text-slate-500">/mês</span></>}
            </p>
            {data.cobrancaPrevistaMensalBrl > 0 && data.cobrancaPrevistaMensalBrl !== Number(data.plan.priceMonthly ?? 0) && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Previsão próxima fatura: <strong>R$ {brl(data.cobrancaPrevistaMensalBrl)}</strong>
              </p>
            )}
          </div>
        </div>
      </GlassCard>

      {/* COUNTDOWN TRIAL */}
      {data.trial && (
        <GlassCard className={cn('p-4 border-l-4',
          data.trial.daysLeft <= 3
            ? 'border-l-rose-500 border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/5'
            : 'border-l-amber-500 border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5',
        )}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Clock className={cn('w-5 h-5', data.trial.daysLeft <= 3 ? 'text-rose-600' : 'text-amber-600')} />
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  Trial acaba em <strong>{data.trial.daysLeft} dia{data.trial.daysLeft !== 1 ? 's' : ''}</strong>
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Expira em {new Date(data.trial.endsAt).toLocaleDateString('pt-BR')}.
                  Depois disso, sua conta vira sem plano até confirmação de assinatura.
                </p>
              </div>
            </div>
            <button className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-emerald-500 to-cyan-500 text-white">
              <CheckCircle2 className="w-3 h-3 inline mr-1" /> Quero assinar
            </button>
          </div>
        </GlassCard>
      )}

      {/* SOLICITAÇÃO PENDENTE */}
      {pending && (
        <GlassCard className="p-4 border-l-4 border-l-cyan-500 border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/5">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                Solicitação de upgrade pendente: <strong>{pending.toPlan?.name}</strong>
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Aguardando aprovação do fabricante. Você será notificado por email.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* KPIs USO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <GlassCard className="p-5 border-cyan-300 dark:border-cyan-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-bold text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Clientes finais
            </span>
            {data.usage.clientesPct != null && (
              <span className={cn('text-xs font-bold',
                data.usage.clientesPct >= 100 ? 'text-rose-600' :
                data.usage.clientesPct >= 80  ? 'text-amber-600' :
                'text-emerald-600',
              )}>{data.usage.clientesPct}%</span>
            )}
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">
            {data.usage.clientesAtivos}
            {data.usage.clientesLimit != null && <span className="text-base text-slate-500 font-normal"> / {data.usage.clientesLimit}</span>}
            {data.usage.clientesLimit == null && <span className="text-base text-slate-500 font-normal"> / ∞</span>}
          </div>
          {data.usage.clientesPct != null && (
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 mt-3 overflow-hidden">
              <div className={cn('h-full transition-all',
                data.usage.clientesPct >= 100 ? 'bg-gradient-to-r from-rose-500 to-amber-500' :
                data.usage.clientesPct >= 80  ? 'bg-gradient-to-r from-amber-500 to-rose-500' :
                'bg-gradient-to-r from-emerald-500 to-cyan-500',
              )} style={{ width: `${Math.min(100, data.usage.clientesPct)}%` }} />
            </div>
          )}
          {data.adicionais.clientesExcedidos > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              ⚠ {data.adicionais.clientesExcedidos} acima · +R$ {brl(data.adicionais.extraClienteBrl)}/mês
            </p>
          )}
        </GlassCard>

        <GlassCard className="p-5 border-violet-300 dark:border-violet-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-bold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" /> Câmeras
            </span>
            {data.usage.camerasPct != null && (
              <span className={cn('text-xs font-bold',
                data.usage.camerasPct >= 100 ? 'text-rose-600' :
                data.usage.camerasPct >= 80  ? 'text-amber-600' :
                'text-emerald-600',
              )}>{data.usage.camerasPct}%</span>
            )}
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">
            {data.usage.camerasAtivas}
            {data.usage.camerasLimit != null && <span className="text-base text-slate-500 font-normal"> / {data.usage.camerasLimit}</span>}
            {data.usage.camerasLimit == null && <span className="text-base text-slate-500 font-normal"> / ∞</span>}
          </div>
          {data.usage.camerasPct != null && (
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 mt-3 overflow-hidden">
              <div className={cn('h-full transition-all',
                data.usage.camerasPct >= 100 ? 'bg-gradient-to-r from-rose-500 to-amber-500' :
                data.usage.camerasPct >= 80  ? 'bg-gradient-to-r from-amber-500 to-rose-500' :
                'bg-gradient-to-r from-violet-500 to-cyan-500',
              )} style={{ width: `${Math.min(100, data.usage.camerasPct)}%` }} />
            </div>
          )}
          {data.adicionais.camerasExcedidas > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              ⚠ {data.adicionais.camerasExcedidas} acima · +R$ {brl(data.adicionais.extraCameraBrl)}/mês
            </p>
          )}
        </GlassCard>
      </div>

      {/* COMPARADOR DE PLANOS */}
      {available && available.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Quer crescer? Compare e suba
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {available
              .filter(p => p.id !== data.plan!.id) // Não mostra o atual
              .filter(p => !p.isTrial) // Trial não é upgrade
              .map(p => {
                const cheaper  = data.plan!.priceMonthly != null && p.priceMonthly != null && Number(p.priceMonthly) < Number(data.plan!.priceMonthly)
                const isPending = pending?.toPlanId === p.id
                return (
                  <GlassCard key={p.id} className={cn('p-4 border', borderMap[p.accent] ?? borderMap.cyan, p.recommended && 'ring-2 ring-cyan-500/30')}>
                    {p.recommended && (
                      <span className="inline-block mb-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-700 dark:text-cyan-300">
                        Mais popular
                      </span>
                    )}
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{p.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{p.tagline}</p>
                    <p className="text-xl font-bold text-slate-900 dark:text-white">
                      {p.priceMonthly == null
                        ? <span className="text-sm">Sob consulta</span>
                        : <>R$ {brl(Number(p.priceMonthly))}<span className="text-xs font-normal text-slate-500">/mês</span></>}
                    </p>
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-2 space-y-0.5">
                      {p.maxClientesFinais != null && <p>· até <strong>{p.maxClientesFinais}</strong> clientes</p>}
                      {p.maxCameras != null && <p>· até <strong>{p.maxCameras}</strong> câmeras</p>}
                    </div>
                    {isPending ? (
                      <button disabled className="mt-3 w-full px-3 py-2 rounded-md text-xs font-semibold bg-slate-200 dark:bg-slate-700 text-slate-500 inline-flex items-center justify-center gap-1">
                        <Clock className="w-3 h-3" /> Aguardando aprovação
                      </button>
                    ) : cheaper ? (
                      <button onClick={() => setUpgradeOpen(p.id)} className="mt-3 w-full px-3 py-2 rounded-md text-xs font-semibold border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5">
                        Solicitar mudança (downgrade)
                      </button>
                    ) : (
                      <button onClick={() => setUpgradeOpen(p.id)} disabled={!!pending} className="mt-3 w-full px-3 py-2 rounded-md text-xs font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 inline-flex items-center justify-center gap-1 disabled:opacity-50">
                        Solicitar upgrade <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </GlassCard>
                )
              })}
          </div>
        </div>
      )}

      {/* MODAL solicitar upgrade */}
      {upgradeOpen && available && (
        <UpgradeRequestModal
          toPlan={available.find(p => p.id === upgradeOpen)!}
          currentPlan={data.plan}
          onClose={() => setUpgradeOpen(null)}
          onSuccess={() => {
            setUpgradeOpen(null)
            globalMutate('/me/integrador/plan/upgrade-requests')
          }}
        />
      )}
    </div>
  )
}

function UpgradeRequestModal({ toPlan, currentPlan, onClose, onSuccess }: {
  toPlan: PlanInfo; currentPlan: PlanInfo; onClose: () => void; onSuccess: () => void
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true); setErr(null)
    try {
      await api.post('/me/integrador/plan/upgrade-request', { toPlanId: toPlan.id, reason: reason || undefined })
      onSuccess()
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? e?.response?.data?.error ?? e.message)
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Solicitar mudança de plano</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{currentPlan.name} → <strong>{toPlan.name}</strong></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-md p-3 mb-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">De</span><span>{currentPlan.name} · R$ {currentPlan.priceMonthly ? brl(Number(currentPlan.priceMonthly)) : '—'}/mês</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Para</span><strong>{toPlan.name} · R$ {toPlan.priceMonthly ? brl(Number(toPlan.priceMonthly)) : '—'}/mês</strong></div>
          {toPlan.maxClientesFinais != null && <div className="flex justify-between"><span className="text-slate-500">Limite clientes</span><span>{toPlan.maxClientesFinais}</span></div>}
          {toPlan.maxCameras != null && <div className="flex justify-between"><span className="text-slate-500">Limite câmeras</span><span>{toPlan.maxCameras}</span></div>}
        </div>

        <label className="text-xs text-slate-700 dark:text-slate-300 mb-1 block">Motivo (opcional)</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)}
          rows={4} placeholder="Por que quer mudar? Ajuda o fabricante a decidir."
          className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm" />

        {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-md text-xs border border-slate-300 dark:border-slate-600">Cancelar</button>
          <button onClick={submit} disabled={submitting} className="px-3 py-2 rounded-md text-xs font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 inline-flex items-center gap-1 disabled:opacity-50">
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Enviar solicitação
          </button>
        </div>

        <p className="text-[10px] text-slate-400 mt-3">
          O fabricante recebe sua solicitação e decide. Você é notificado por email.
        </p>
      </div>
    </div>
  )
}
