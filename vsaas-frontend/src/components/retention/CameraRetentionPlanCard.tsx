/**
 * CameraRetentionPlanCard — gerência de plano de retenção por câmera.
 *
 * Mostra:
 *   - Plano efetivo em vigor + origem (CAMERA / CLIENTE_FINAL / INTEGRADOR default)
 *   - Preço final cobrado (com markup do integrador)
 *   - Dropdown pra trocar plano (override por câmera)
 *
 * Endpoints:
 *   GET  /retention/cameras/:id/effective-plan
 *   GET  /retention/plans
 *   POST /retention/cameras/:id/plan  { retentionPlanId, downgradeBehavior }
 *
 * Permissões:
 *   - SUPER_ADMIN, INTEGRADOR_ADMIN, CLIENTE_ADMIN do tenant
 *   - Sub-roles (TECNICO, OPERADOR, VIEWER) só visualizam
 */
import { useEffect, useState } from 'react'
import { Loader2, Layers, AlertTriangle, CheckCircle2, ArrowUpRight, ArrowDownRight } from 'lucide-react'
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

interface EffectivePlanResponse {
  effective: {
    plan:                  RetentionPlan
    source:                'CAMERA' | 'CLIENTE_FINAL' | 'INTEGRADOR'
    markupPct:             number
    pricePerCameraMonthUsd: number
    finalPriceUsd:         number
    finalPriceBrl:         number
  } | null
  reason?: string
}

const role = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const canEdit = ['SUPER_ADMIN', 'ADMIN_GLOBAL', 'INTEGRADOR_ADMIN', 'CLIENTE_ADMIN'].includes(role)

export function CameraRetentionPlanCard({ cameraId, cameraName }: {
  cameraId: string
  cameraName?: string
}) {
  const [plans, setPlans]         = useState<RetentionPlan[]>([])
  const [effective, setEffective] = useState<EffectivePlanResponse | null>(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [feedback, setFeedback]   = useState<{ ok: boolean; msg: string } | null>(null)
  const [selectPlanId, setSelectPlanId] = useState<string>('')
  const [downgradeBehavior, setDowngradeBehavior] = useState<'soft' | 'immediate'>('soft')

  function reload() {
    setLoading(true)
    Promise.all([
      api.get('/retention/plans').then(r => r.data.plans ?? []),
      api.get(`/retention/cameras/${cameraId}/effective-plan`).then(r => r.data).catch(() => null),
    ]).then(([ps, eff]: [RetentionPlan[], EffectivePlanResponse | null]) => {
      setPlans(ps.filter(p => p.active))
      setEffective(eff)
      setSelectPlanId('')
      setFeedback(null)
    }).finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [cameraId])

  async function applyPlan(retentionPlanId: string | null) {
    setSaving(true)
    setFeedback(null)
    try {
      const r = await api.post(`/retention/cameras/${cameraId}/plan`, {
        retentionPlanId,
        downgradeBehavior,
      })
      const decision = r.data.decision
      const pending  = r.data.pending
      if (pending) {
        setFeedback({
          ok: true,
          msg: `Pedido pendente de aprovação do integrador (Δ R$ ${pending.deltaBrl?.toFixed(2) ?? '?'} — ${pending.reason}).`,
        })
      } else if (decision?.status === 'AUTO_APPROVED') {
        const delta = decision.deltaBrl
        setFeedback({
          ok: true,
          msg: delta > 0
            ? `Upgrade aprovado (+R$ ${delta.toFixed(2)}/mês a partir do próximo ciclo).`
            : delta < 0
              ? `Downgrade aplicado (R$ ${Math.abs(delta).toFixed(2)}/mês a menos).`
              : 'Plano atualizado.',
        })
      } else {
        setFeedback({ ok: true, msg: 'Plano atualizado.' })
      }
      reload()
    } catch (err) {
      setFeedback({ ok: false, msg: formatApiError(err) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <GlassCard className="p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </GlassCard>
    )
  }

  const eff = effective?.effective
  const targetPlan  = plans.find(p => p.id === selectPlanId)
  const currentUsd  = eff?.finalPriceUsd ?? 0
  const targetUsd   = targetPlan
    ? Number(targetPlan.pricePerCameraMonthUsd) * (1 + (eff?.markupPct ?? 30) / 100)
    : 0
  const usdBrl      = 5.30
  const deltaBrl    = (targetUsd - currentUsd) * usdBrl
  const isDowngrade = targetPlan && eff && targetPlan.retainDays < eff.plan.retainDays

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shrink-0">
          <Layers className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
            Plano de Retenção
            {cameraName && <span className="ml-2 text-[10px] font-normal text-slate-500">{cameraName}</span>}
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Plano contratado define quanto tempo a gravação fica disponível e o preço cobrado
          </p>
        </div>
      </div>

      {/* Plano efetivo atual */}
      {eff ? (
        <div className="p-3 rounded-lg bg-gradient-to-br from-cyan-500/10 to-emerald-500/5 border border-cyan-500/20">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div>
              <p className="text-[10px] uppercase font-bold text-cyan-700 dark:text-cyan-300">Em vigor</p>
              <p className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                {eff.plan.name}
              </p>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                {eff.plan.slug} · origem: {sourceLabel(eff.source)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-500">Cobrança/mês</p>
              <p className="text-lg font-bold text-emerald-600">
                R$ {eff.finalPriceBrl.toFixed(2)}
              </p>
              <p className="text-[10px] text-slate-400 font-mono">
                US$ {eff.pricePerCameraMonthUsd.toFixed(2)} + {eff.markupPct}% markup
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-bold text-amber-700 dark:text-amber-400">Sem plano configurado</p>
            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
              {effective?.reason === 'no_plan_configured'
                ? 'Câmera usa retenção legacy (recordRetainDays). Atribua um plano abaixo pra integrar com billing.'
                : 'Plano de retenção não resolveu.'}
            </p>
          </div>
        </div>
      )}

      {/* Trocar plano */}
      {canEdit && (
        <div className="space-y-2 pt-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Trocar para outro plano
          </label>
          <div className="flex gap-2">
            <select
              value={selectPlanId}
              onChange={e => setSelectPlanId(e.target.value)}
              className="flex-1 px-3 py-2 text-sm rounded-lg border bg-white dark:bg-white/5 dark:border-white/10 dark:text-white"
            >
              <option value="">— escolher plano —</option>
              {plans.map(p => (
                <option key={p.id} value={p.id} disabled={p.id === eff?.plan.id}>
                  {p.name} · ${Number(p.pricePerCameraMonthUsd).toFixed(2)}/mês
                  {p.id === eff?.plan.id ? ' (atual)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={() => applyPlan(selectPlanId || null)}
              disabled={saving || !selectPlanId || selectPlanId === eff?.plan.id}
              className="px-4 py-2 text-sm rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
            </button>
          </div>

          {/* Preview do impacto + opção downgrade */}
          {targetPlan && eff && targetPlan.id !== eff.plan.id && (
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-medium">
                {deltaBrl > 0
                  ? <><ArrowUpRight className="w-3.5 h-3.5 text-rose-500" /> Upgrade</>
                  : <><ArrowDownRight className="w-3.5 h-3.5 text-emerald-500" /> Downgrade</>}
                <span className={cn(
                  'font-mono font-bold',
                  deltaBrl > 0 ? 'text-rose-600' : 'text-emerald-600',
                )}>
                  {deltaBrl > 0 ? '+' : ''}R$ {Math.abs(deltaBrl).toFixed(2)}/mês
                </span>
              </div>

              {isDowngrade && (
                <div className="pt-2 border-t border-slate-200 dark:border-white/10">
                  <p className="text-[10px] uppercase font-bold text-slate-500 mb-1.5">
                    Comportamento do downgrade
                  </p>
                  <div className="space-y-1.5">
                    <RadioOption
                      checked={downgradeBehavior === 'soft'}
                      onChange={() => setDowngradeBehavior('soft')}
                      label="Soft (recomendado)"
                      desc="Gravações antigas vivem até expirarem naturalmente. Sem perda de evidência."
                    />
                    <RadioOption
                      checked={downgradeBehavior === 'immediate'}
                      onChange={() => setDowngradeBehavior('immediate')}
                      label="Imediato"
                      desc="Apaga gravações além da nova retenção HOJE. Sem reembolso do mês corrente."
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Botão remover override */}
          {eff?.source === 'CAMERA' && (
            <button
              onClick={() => applyPlan(null)}
              disabled={saving}
              className="text-xs text-slate-500 hover:text-cyan-600 underline"
            >
              Remover override desta câmera (volta a usar plano do cliente/integrador)
            </button>
          )}
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div className={cn(
          'p-2.5 rounded-lg text-xs flex items-center gap-2',
          feedback.ok
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
            : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
        )}>
          {feedback.ok
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertTriangle className="w-4 h-4 shrink-0" />}
          {feedback.msg}
        </div>
      )}
    </GlassCard>
  )
}

function sourceLabel(source: string): string {
  if (source === 'CAMERA')        return 'override desta câmera'
  if (source === 'CLIENTE_FINAL') return 'plano do cliente'
  if (source === 'INTEGRADOR')    return 'plano default do integrador'
  return source
}

function RadioOption({ checked, onChange, label, desc }: {
  checked: boolean
  onChange: () => void
  label: string
  desc: string
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-0.5"
      />
      <div className="flex-1">
        <p className={cn('text-xs font-medium', checked ? 'text-cyan-600' : 'text-slate-700 dark:text-slate-300')}>
          {label}
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>
      </div>
    </label>
  )
}
