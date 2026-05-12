/**
 * IntegradorContractCard — gerência do contrato de retenção do integrador.
 *
 * Mostra/edita:
 *   - Plano default que será aplicado a câmeras novas
 *   - Markup % sobre o preço atacado VSaaS
 *   - Limites de auto-aprovação (Δ R$ máximo, resolução máxima, dias máximos)
 *
 * Endpoints:
 *   GET  /retention/contract            → contrato atual + plano default
 *   PUT  /retention/contract            → upsert
 *   GET  /retention/plans               → lista pra escolher plano default
 *
 * Permissões: INTEGRADOR_ADMIN ou SUPER_ADMIN (com ?integradorId=).
 */
import { useEffect, useState } from 'react'
import { Loader2, Save, FileSignature, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { api, formatApiError } from '../../api/client'
import { cn } from '../../lib/utils'

interface RetentionPlan {
  id:                     string
  slug:                   string
  name:                   string
  retainDays:             number
  resolution:             'ANY' | 'VGA' | 'HD' | 'FHD' | 'UHD_4K'
  pricePerCameraMonthUsd: string | number
  active:                 boolean
}

interface Contract {
  id:                          string
  defaultPlanoId:              string
  markupPct:                   string | number
  active:                      boolean
  notes:                       string | null
  autoApproveUpgradeLimitBrl:  string | number | null
  autoApproveResolutionMax:    'ANY' | 'VGA' | 'HD' | 'FHD' | 'UHD_4K' | null
  autoApproveRetainDaysMax:    number | null
  notifyAllChanges:            boolean
  defaultPlano?:               RetentionPlan
}

const RESOLUTIONS = ['ANY', 'VGA', 'HD', 'FHD', 'UHD_4K'] as const

export function IntegradorContractCard({ integradorId }: { integradorId?: string }) {
  const [plans, setPlans]       = useState<RetentionPlan[]>([])
  const [contract, setContract] = useState<Contract | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  // Form state — separado do contract pra permitir edição sem mutação
  const [defaultPlanoId, setDefaultPlanoId]                   = useState('')
  const [markupPct, setMarkupPct]                             = useState(30)
  const [autoApproveLimitBrl, setAutoApproveLimitBrl]         = useState<number | null>(100)
  const [autoApproveResolutionMax, setAutoApproveResolutionMax] = useState<'ANY' | 'VGA' | 'HD' | 'FHD' | 'UHD_4K'>('FHD')
  const [autoApproveRetainDaysMax, setAutoApproveRetainDaysMax] = useState(90)

  function reload() {
    setLoading(true)
    const params = integradorId ? `?integradorId=${integradorId}` : ''
    Promise.all([
      api.get('/retention/plans').then(r => r.data.plans ?? []),
      api.get('/retention/contract' + params).then(r => r.data.contract).catch(() => null),
    ]).then(([ps, ct]: [RetentionPlan[], Contract | null]) => {
      setPlans(ps.filter(p => p.active))
      setContract(ct)
      if (ct) {
        setDefaultPlanoId(ct.defaultPlanoId)
        setMarkupPct(Number(ct.markupPct))
        setAutoApproveLimitBrl(ct.autoApproveUpgradeLimitBrl != null ? Number(ct.autoApproveUpgradeLimitBrl) : null)
        setAutoApproveResolutionMax(ct.autoApproveResolutionMax ?? 'FHD')
        setAutoApproveRetainDaysMax(ct.autoApproveRetainDaysMax ?? 90)
      }
    }).finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [integradorId])

  async function save() {
    if (!defaultPlanoId) {
      setFeedback({ ok: false, msg: 'Escolha um plano default' })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      const params = integradorId ? `?integradorId=${integradorId}` : ''
      await api.put('/retention/contract' + params, {
        defaultPlanoId,
        markupPct,
        autoApproveUpgradeLimitBrl: autoApproveLimitBrl,
        autoApproveResolutionMax,
        autoApproveRetainDaysMax,
      } as any)
      setFeedback({ ok: true, msg: 'Contrato atualizado.' })
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

  const selectedPlan = plans.find(p => p.id === defaultPlanoId)
  const usdBrl = 5.30
  const wholesaleUsd = selectedPlan ? Number(selectedPlan.pricePerCameraMonthUsd) : 0
  const finalUsd = wholesaleUsd * (1 + markupPct / 100)
  const finalBrl = finalUsd * usdBrl

  return (
    <GlassCard className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shrink-0">
          <FileSignature className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Contrato com VSaaS</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Plano default + markup que define o preço cobrado dos seus clientes finais
          </p>
        </div>
        {contract?.active === false && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
            INATIVO
          </span>
        )}
      </div>

      {/* Plano default */}
      <Field label="Plano default (aplicado a câmeras novas sem override)">
        <select
          value={defaultPlanoId}
          onChange={e => setDefaultPlanoId(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-white/5 dark:border-white/10 dark:text-white"
        >
          <option value="">— escolher —</option>
          {plans.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} · ${Number(p.pricePerCameraMonthUsd).toFixed(2)}/cam/mês
            </option>
          ))}
        </select>
      </Field>

      {/* Markup */}
      <Field label="Sua margem (markup % sobre o preço atacado)">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={markupPct}
            onChange={e => setMarkupPct(Number(e.target.value))}
            className="flex-1"
          />
          <input
            type="number"
            min={0}
            max={500}
            value={markupPct}
            onChange={e => setMarkupPct(Number(e.target.value))}
            className="w-20 px-2 py-1.5 text-sm text-center rounded-lg border bg-white dark:bg-white/5 dark:border-white/10 dark:text-white"
          />
          <span className="text-sm text-slate-500">%</span>
        </div>
      </Field>

      {/* Preview do preço final */}
      {selectedPlan && (
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
          <p className="text-[10px] uppercase font-bold text-slate-500 mb-2">
            Cálculo aplicado a cada câmera
          </p>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-slate-500">Custo VSaaS</p>
              <p className="font-mono font-medium text-slate-700 dark:text-slate-300">
                ${wholesaleUsd.toFixed(2)} USD
              </p>
            </div>
            <div>
              <p className="text-slate-500">+ markup {markupPct}%</p>
              <p className="font-mono font-medium text-cyan-600">
                ${finalUsd.toFixed(2)} USD
              </p>
            </div>
            <div>
              <p className="text-slate-500">Você cobra do CF</p>
              <p className="font-mono font-bold text-emerald-600">
                R$ {finalBrl.toFixed(2)}
              </p>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            * USD→BRL ref. {usdBrl.toFixed(2)} — câmbio é congelado no fechamento mensal
          </p>
        </div>
      )}

      {/* Auto-approve config */}
      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-cyan-600 select-none flex items-center gap-2">
          <span className="text-cyan-600">⚙</span> Limites de auto-aprovação de upgrade
          <span className="text-[10px] text-slate-400">(o cliente final pode subir plano sem ticket até estes limites)</span>
        </summary>
        <div className="mt-3 space-y-3 pl-4 border-l-2 border-cyan-500/20">
          <Field label="Δ R$/mês máximo pra auto-aprovar">
            <input
              type="number"
              min={0}
              value={autoApproveLimitBrl ?? ''}
              onChange={e => setAutoApproveLimitBrl(e.target.value ? Number(e.target.value) : null)}
              placeholder="100 (default)"
              className="w-32 px-2 py-1.5 text-sm rounded-lg border bg-white dark:bg-white/5 dark:border-white/10 dark:text-white"
            />
          </Field>
          <Field label="Resolução máxima">
            <select
              value={autoApproveResolutionMax}
              onChange={e => setAutoApproveResolutionMax(e.target.value as any)}
              className="px-2 py-1.5 text-sm rounded-lg border bg-white dark:bg-white/5 dark:border-white/10 dark:text-white"
            >
              {RESOLUTIONS.map(r => (
                <option key={r} value={r}>{r === 'UHD_4K' ? '4K' : r}</option>
              ))}
            </select>
          </Field>
          <Field label="Retenção máxima (dias)">
            <input
              type="number"
              min={0}
              max={365}
              value={autoApproveRetainDaysMax}
              onChange={e => setAutoApproveRetainDaysMax(Number(e.target.value))}
              className="w-24 px-2 py-1.5 text-sm rounded-lg border bg-white dark:bg-white/5 dark:border-white/10 dark:text-white"
            />
          </Field>
        </div>
      </details>

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

      {/* Save */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={save}
          disabled={saving || !defaultPlanoId}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {contract ? 'Atualizar contrato' : 'Criar contrato'}
        </button>
      </div>
    </GlassCard>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}
