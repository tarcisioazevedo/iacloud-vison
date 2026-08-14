/**
 * CostEstimateCard — estima custo mensal de storage R2 em USD e BRL.
 *
 * Onda 5 / P1 #7.
 */
import { useEffect, useState } from 'react'
import { DollarSign, TrendingUp } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { getStorageCostEstimate, type StorageCostEstimate } from '../../api/client'
import { cn } from '../../lib/utils'

type Props = {
  integradorId: string
  className?: string
}

export function CostEstimateCard({ integradorId, className }: Props) {
  const [data, setData] = useState<StorageCostEstimate | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getStorageCostEstimate(integradorId)
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [integradorId])

  if (loading) {
    return (
      <GlassCard className={cn('p-4', className)}>
        <p className="text-xs text-slate-500">Calculando custo…</p>
      </GlassCard>
    )
  }
  if (!data) return null

  return (
    <GlassCard className={cn('p-4 space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500 tracking-wider">Custo estimado</p>
            <p className="text-[10px] text-slate-500">{data.period}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
            R$ {data.costBrl.total.toFixed(2).replace('.', ',')}
          </p>
          <p className="text-[10px] text-slate-500">/ mês · USD {data.costUsd.total.toFixed(2)}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px] pt-2 border-t border-slate-200 dark:border-white/10">
        <Metric label="Storage" value={`$ ${data.costUsd.storage.toFixed(2)}`} />
        <Metric label="PUTs"    value={`$ ${data.costUsd.puts.toFixed(2)}`} />
        <Metric label="GETs"    value={`$ ${data.costUsd.gets.toFixed(2)}`} />
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>{data.usage.totalGB} GB · {data.usage.segmentsLast30d.toLocaleString('pt-BR')} segmentos</span>
        <span className="flex items-center gap-1">
          <TrendingUp className="w-2.5 h-2.5" />
          USD R$ {data.costBrl.usdRate.toFixed(2)}
        </span>
      </div>
      <p className="text-[9px] text-slate-400 italic">{data.pricingNote}</p>
    </GlassCard>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[9px] uppercase text-slate-500">{label}</p>
      <p className="font-mono font-semibold text-slate-700 dark:text-slate-300">{value}</p>
    </div>
  )
}
