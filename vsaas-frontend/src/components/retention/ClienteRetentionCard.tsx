/**
 * ClienteRetentionCard — visão e gestão self-service do plano de retenção
 * pelo Cliente Final.
 *
 * Mostra:
 *   - Plano em vigor (herdado do integrador ou override do cliente)
 *   - Custo estimado mensal × #câmeras (R$/mês)
 *   - Storage consumido (vinculado ao /storage/me/usage)
 *   - Botão "Solicitar upgrade" → modal com lista de planos disponíveis
 *
 * Endpoints usados:
 *   GET /retention/plans                              (catálogo)
 *   GET /storage/me/usage                             (consumo)
 *   POST /retention/clientes/:cfId/plan               (request upgrade)
 *   GET /retention/upgrade-requests                   (status pedidos)
 *
 * Permissão: CLIENTE_ADMIN (CLIENTE_OPERADOR só visualiza, sem botão upgrade).
 */
import { useEffect, useState } from 'react'
import {
  Loader2, Layers, ArrowUpRight, AlertTriangle, CheckCircle2, X,
  Clock, Zap,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { api, formatApiError } from '../../api/client'
import { cn } from '../../lib/utils'

interface RetentionPlan {
  id:                     string
  slug:                   string
  name:                   string
  retainDays:             number
  resolution:             string
  pricePerCameraMonthUsd: string | number
  active:                 boolean
}

interface UsageResponse {
  usedBytes:    number
  usedGB:       number
  retainDays:   number
  objectCount:  number
}

interface UpgradeRequest {
  id:           string
  status:       'AUTO_APPROVED' | 'PENDING_INTEGRADOR' | 'APPROVED' | 'DENIED' | 'CANCELED'
  requestedAt:  string
  toPlano:      RetentionPlan
  fromPlano?:   RetentionPlan
  decisionNote?: string
}

interface EffectivePlanAgg {
  cameraCount:     number
  coveredCount:    number
  markupPct:       number
  usdBrlRate:      number
  totalMonthlyBrl: number
  dominant: {
    plan:           RetentionPlan
    source:         string
    cameraCount:    number
    finalPriceBrl:  number
  } | null
}

const role = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const canRequest = role === 'CLIENTE_ADMIN'

export function ClienteRetentionCard({ clienteFinalId, cameraCount }: {
  clienteFinalId: string
  cameraCount:    number
}) {
  const [plans, setPlans]         = useState<RetentionPlan[]>([])
  const [usage, setUsage]         = useState<UsageResponse | null>(null)
  const [pending, setPending]     = useState<UpgradeRequest | null>(null)
  const [effective, setEffective] = useState<EffectivePlanAgg | null>(null)
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)

  function reload() {
    setLoading(true)
    Promise.all([
      api.get('/retention/plans').then(r => r.data.plans ?? []),
      api.get('/storage/me/usage').then(r => r.data).catch(() => null),
      api.get('/retention/upgrade-requests')
        .then(r => (r.data.items ?? []).find((it: UpgradeRequest) =>
          it.status === 'PENDING_INTEGRADOR'))
        .catch(() => null),
      // A1: plano efetivo agregado (markup real, total real, plano dominante)
      api.get(`/retention/clientes/${clienteFinalId}/effective-plan`)
        .then(r => r.data).catch(() => null),
    ]).then(([ps, u, pend, eff]) => {
      setPlans(ps.filter((p: RetentionPlan) => p.active))
      setUsage(u)
      setPending(pend ?? null)
      setEffective(eff)
    }).finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [clienteFinalId])

  if (loading) {
    return (
      <GlassCard className="p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </GlassCard>
    )
  }

  // A2 fix (2026-05-09): plano em vigor vem do endpoint agregado quando
  // existe (markup real). Senão cai pro guess via /storage/me/usage (legacy).
  const dominantPlan = effective?.dominant?.plan
  const currentRetainDays = dominantPlan?.retainDays ?? usage?.retainDays ?? 30
  const currentPlanName = dominantPlan?.name ?? `${currentRetainDays} dias`
  const currentResolution = dominantPlan?.resolution
  const realMarkupPct = effective?.markupPct ?? 30
  const realUsdBrl    = effective?.usdBrlRate ?? 5.30
  const realTotalBrl  = effective?.totalMonthlyBrl ?? 0

  return (
    <>
      <GlassCard className="border-cyan-500/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wider text-cyan-300 font-bold flex items-center gap-2">
            <Layers className="w-3.5 h-3.5" /> Meu plano de retenção
          </span>
          {pending && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Pedido pendente
            </span>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xl font-bold text-slate-900 dark:text-white">
              {currentPlanName}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Gravação fica disponível por <strong className="text-cyan-300">{currentRetainDays} dias</strong>
              {currentResolution && ` · resolução ${currentResolution === 'UHD_4K' ? '4K' : currentResolution}`}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800/40 border border-slate-300 dark:border-slate-700/50">
              <p className="text-[10px] text-slate-500 uppercase">Câmeras</p>
              <p className="text-base font-bold text-slate-900 dark:text-white">{cameraCount}</p>
            </div>
            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800/40 border border-slate-300 dark:border-slate-700/50">
              <p className="text-[10px] text-slate-500 uppercase">Storage</p>
              <p className="text-base font-bold text-slate-900 dark:text-white">
                {usage?.usedGB?.toFixed(1) ?? '0'} GB
              </p>
            </div>
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <p className="text-[10px] text-emerald-300 uppercase">Mensal</p>
              <p className="text-base font-bold text-emerald-400">
                R$ {realTotalBrl.toFixed(2)}
              </p>
            </div>
          </div>

          {pending ? (
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs">
              <p className="text-amber-300 font-bold mb-0.5">
                Solicitação de upgrade aguardando aprovação
              </p>
              <p className="text-slate-400">
                {pending.fromPlano?.name ?? 'plano atual'} → <strong className="text-slate-900 dark:text-white">{pending.toPlano.name}</strong>
              </p>
              {pending.decisionNote && (
                <p className="text-[10px] text-slate-500 mt-1">{pending.decisionNote}</p>
              )}
            </div>
          ) : canRequest ? (
            <button
              onClick={() => setShowModal(true)}
              className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-90 text-xs font-bold text-white transition flex items-center justify-center gap-1.5"
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              Solicitar mais retenção / upgrade
            </button>
          ) : (
            <p className="text-[10px] text-slate-500 italic text-center pt-1">
              Apenas administradores podem solicitar mudança de plano
            </p>
          )}
        </div>
      </GlassCard>

      {/* Modal de upgrade */}
      {showModal && (
        <UpgradeModal
          plans={plans}
          currentRetainDays={currentRetainDays}
          clienteFinalId={clienteFinalId}
          cameraCount={cameraCount}
          markupPct={realMarkupPct}
          usdBrlRate={realUsdBrl}
          onClose={() => { setShowModal(false); reload() }}
        />
      )}
    </>
  )
}

// ─── Modal ──────────────────────────────────────────────────────────────────

function UpgradeModal({
  plans, currentRetainDays, clienteFinalId, cameraCount,
  markupPct, usdBrlRate, onClose,
}: {
  plans: RetentionPlan[]
  currentRetainDays: number
  clienteFinalId: string
  cameraCount: number
  markupPct: number
  usdBrlRate: number
  onClose: () => void
}) {
  const [selectedId, setSelectedId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const selected = plans.find(p => p.id === selectedId)
  // A2 fix: markup e câmbio reais vindos do endpoint agregado.
  const usdBrl = usdBrlRate
  const monthlyUsd = selected ? Number(selected.pricePerCameraMonthUsd) * (1 + markupPct / 100) : 0
  const monthlyBrl = monthlyUsd * usdBrl
  const totalBrl = monthlyBrl * cameraCount

  async function submit() {
    if (!selectedId) return
    setSubmitting(true)
    setFeedback(null)
    try {
      const r = await api.post(`/retention/clientes/${clienteFinalId}/plan`, {
        retentionPlanId: selectedId,
        downgradeBehavior: 'soft',
      })
      if (r.data.pending) {
        setFeedback({
          ok: true,
          msg: 'Solicitação enviada! Seu integrador foi notificado e responderá em breve.',
        })
      } else {
        setFeedback({
          ok: true,
          msg: 'Plano aplicado! Mudança vale a partir do próximo ciclo de billing.',
        })
      }
      setTimeout(onClose, 2500)
    } catch (err) {
      setFeedback({ ok: false, msg: formatApiError(err) })
    } finally {
      setSubmitting(false)
    }
  }

  // Agrupa planos por resolução pra UI navegável
  const byResolution: Record<string, RetentionPlan[]> = {}
  for (const p of plans) {
    if (p.retainDays === 0) continue   // skip live-only no upgrade
    const key = p.resolution
    if (!byResolution[key]) byResolution[key] = []
    byResolution[key].push(p)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-cyan-500/30 rounded-2xl shadow-2xl">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              Solicitar mudança de plano
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Plano atual: <strong className="text-cyan-300">{currentRetainDays} dias</strong> · {cameraCount} câmera{cameraCount === 1 ? '' : 's'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:bg-slate-800 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tabela de planos por resolução */}
          {Object.entries(byResolution).map(([res, ps]) => (
            <div key={res}>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">
                Resolução {res === 'UHD_4K' ? '4K' : res}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {ps.sort((a, b) => a.retainDays - b.retainDays).map(p => {
                  const isSelected = p.id === selectedId
                  const isCurrent  = p.retainDays === currentRetainDays
                  const monthlyApprox = Number(p.pricePerCameraMonthUsd) * (1 + markupPct / 100) * usdBrl
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      disabled={isCurrent}
                      className={cn(
                        'p-3 rounded-lg border text-left transition',
                        isSelected
                          ? 'bg-cyan-500/20 border-cyan-500 shadow-lg shadow-cyan-500/20'
                          : isCurrent
                            ? 'bg-slate-100 dark:bg-slate-800/50 border-slate-300 dark:border-slate-700 opacity-50 cursor-not-allowed'
                            : 'bg-slate-100 dark:bg-slate-800/30 border-slate-300 dark:border-slate-700 hover:border-cyan-500/50',
                      )}
                    >
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{p.retainDays}d</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        ~R$ {monthlyApprox.toFixed(2)}/cam/mês
                      </p>
                      {isCurrent && <p className="text-[9px] text-cyan-400 mt-1 font-bold">ATUAL</p>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Sumário do impacto */}
          {selected && (
            <div className="p-4 rounded-lg bg-gradient-to-br from-cyan-500/10 to-emerald-500/5 border border-cyan-500/30 space-y-2">
              <p className="text-[10px] uppercase font-bold text-cyan-400">Resumo</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">Plano novo</p>
                  <p className="text-slate-900 dark:text-white font-bold">{selected.name}</p>
                </div>
                <div>
                  <p className="text-slate-400">Total mensal estimado</p>
                  <p className="text-emerald-400 font-bold text-base">
                    R$ {totalBrl.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    R$ {monthlyBrl.toFixed(2)} × {cameraCount} câmera{cameraCount === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 italic pt-2 border-t border-cyan-500/20">
                * Cálculo com markup {markupPct.toFixed(0)}% (do contrato do seu integrador) × câmbio USD/BRL {usdBrl.toFixed(2)}. Pode variar conforme
                contrato com o seu integrador. Você verá a fatura definitiva no próximo ciclo.
              </p>
            </div>
          )}

          {/* Feedback */}
          {feedback && (
            <div className={cn(
              'p-3 rounded-lg text-xs flex items-center gap-2',
              feedback.ok
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-300 border border-rose-500/30',
            )}>
              {feedback.ok
                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                : <AlertTriangle className="w-4 h-4 shrink-0" />}
              {feedback.msg}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 text-slate-600 dark:text-slate-300"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={!selectedId || submitting}
              className="px-4 py-2 text-xs rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:opacity-90 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
              Solicitar mudança
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
