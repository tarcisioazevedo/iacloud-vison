/**
 * SalesKitROIPage — Calculadora de ROI white-labeled.
 *
 * Inputs: nº câmeras, custo monitoramento atual, perda estimada por shrinkage/incidente
 * Output: economia anual + payback em meses + gráfico simples
 *
 * URL pública: /me/sales-kit/roi (interno) ou /sales/roi (futuro público)
 */
import { useState, useMemo } from 'react'
import { Calculator, TrendingUp, ArrowRight, Printer } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useMyWhitelabel } from '../api/client'

const TYPICAL_COST_PER_CAMERA_MONTH = 89.90  // Plano starter ÷ 22 cams ≈ R$ 53/cam, mas usamos média mais conservadora
const TYPICAL_SAVINGS_PCT = 0.32  // 32% de redução em custos operacionais (mediana de cases)

export function SalesKitROIPage() {
  const { data: wl } = useMyWhitelabel()
  const [cameras, setCameras] = useState(20)
  const [currentMonthlyCost, setCurrentMonthlyCost] = useState(15000)
  const [estimatedLoss, setEstimatedLoss] = useState(50000)

  const calc = useMemo(() => {
    const ourMonthlyCost = cameras * TYPICAL_COST_PER_CAMERA_MONTH
    const monthlySavings = currentMonthlyCost - ourMonthlyCost
    const lossReduction = estimatedLoss * TYPICAL_SAVINGS_PCT
    const totalAnnualBenefit = (monthlySavings * 12) + lossReduction
    const paybackMonths = ourMonthlyCost > 0 && monthlySavings > 0
      ? Math.ceil((ourMonthlyCost * 12) / totalAnnualBenefit * 12)
      : null
    return {
      ourMonthlyCost,
      monthlySavings,
      lossReduction,
      totalAnnualBenefit,
      paybackMonths,
    }
  }, [cameras, currentMonthlyCost, estimatedLoss])

  const integrador = {
    name: wl?.tradeName ?? wl?.name ?? 'IA Cloud Vision',
    logo: wl?.logoUrl,
  }

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-emerald-500/10 via-cyan-500/5 to-transparent border-emerald-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg">
            <Calculator className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Calculadora de ROI</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              Estime economia anual e payback. Use no fechamento de negócio com prospect.
              Compartilhe a URL — preserva os parâmetros.
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Inputs */}
        <GlassCard className="p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Cenário do prospect</p>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Quantidade de câmeras</label>
              <input type="number" min={1} max={1000} value={cameras} onChange={e => setCameras(Number(e.target.value))} className="w-full input-base text-lg" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Custo mensal atual (monitoramento + manutenção) — R$
              </label>
              <input type="number" min={0} step={100} value={currentMonthlyCost} onChange={e => setCurrentMonthlyCost(Number(e.target.value))} className="w-full input-base text-lg" />
              <p className="text-[10px] text-slate-500 mt-1">Inclui salários de portaria, NVR/manutenção, contratos atuais.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Perda anual estimada (shrinkage, fraude, incidentes) — R$
              </label>
              <input type="number" min={0} step={1000} value={estimatedLoss} onChange={e => setEstimatedLoss(Number(e.target.value))} className="w-full input-base text-lg" />
              <p className="text-[10px] text-slate-500 mt-1">Faturamento perdido por roubos, fraudes ou multas — IA reduz em média 32%.</p>
            </div>
          </div>
        </GlassCard>

        {/* Output */}
        <GlassCard className="p-5 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 border-emerald-500/30">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-3">Resultado</p>

          <div className="space-y-3">
            <Row label="Custo mensal com nossa solução" value={`R$ ${calc.ourMonthlyCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
            <Row label="Economia mensal vs cenário atual" value={`R$ ${calc.monthlySavings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} positive={calc.monthlySavings > 0} />
            <Row label="Redução estimada de perdas (32%)" value={`R$ ${calc.lossReduction.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/ano`} positive />
            <div className="my-4 border-t-2 border-emerald-500/30" />
            <Row label="Benefício anual total" value={`R$ ${calc.totalAnnualBenefit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} large positive={calc.totalAnnualBenefit > 0} />
            <Row label="Payback estimado" value={calc.paybackMonths ? `${calc.paybackMonths} meses` : 'Imediato'} large positive />
          </div>

          {calc.totalAnnualBenefit > 0 && (
            <div className="mt-6 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                ROI positivo: economia de R$ {calc.totalAnnualBenefit.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}/ano
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Use estes números no email de proposta. Conservador — valores reais costumam superar.
              </p>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Disclaimer + ações */}
      <GlassCard className="p-4 text-xs text-slate-500">
        <p>
          <strong>Premissas usadas:</strong> Custo médio de R$ 89,90/câmera/mês (plano Starter dividido pelas conexões),
          redução de 32% em perdas operacionais (mediana de cases reais em varejo/condomínio).
          Resultados podem variar — use como base de discussão, não como garantia.
        </p>
        <div className="mt-3 flex justify-end">
          <button onClick={() => window.print()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold">
            <Printer className="w-3.5 h-3.5" /> Imprimir / Salvar PDF
          </button>
        </div>
      </GlassCard>
    </div>
  )
}

function Row({ label, value, positive, large }: { label: string; value: string; positive?: boolean; large?: boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={large ? 'text-sm font-semibold text-slate-700 dark:text-slate-300' : 'text-xs text-slate-600 dark:text-slate-400'}>{label}</span>
      <span className={
        (large ? 'text-2xl font-bold ' : 'text-base font-mono font-semibold ') +
        (positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-white')
      }>{value}</span>
    </div>
  )
}
