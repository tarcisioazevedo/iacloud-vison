/**
 * UptimeSparkline — gráfico compacto de uptime de gravação por hora nas últimas
 * N horas (default 168h = 7 dias).
 *
 * Cada barra = 1 hora. Altura proporcional ao uptimePct (0-100).
 * Cor: verde (>80%), amarelo (20-80%), vermelho (<20%), cinza (sem dados).
 *
 * Onda 1 / P2 #15.
 */
import { useEffect, useState } from 'react'
import { getCameraUptimeHistory, type CameraUptimeHistory } from '../../api/client'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

type Props = {
  cameraId: string
  days?: number
  height?: number  // altura em px
  className?: string
}

export function UptimeSparkline({ cameraId, days = 7, height = 32, className }: Props) {
  const [data, setData] = useState<CameraUptimeHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getCameraUptimeHistory(cameraId, days)
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cameraId, days])

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 text-xs text-slate-500', className)}>
        <Loader2 className="w-3 h-3 animate-spin" />
        Carregando uptime…
      </div>
    )
  }

  if (!data || data.buckets.length === 0) {
    return (
      <div className={cn('text-[10px] text-slate-500 italic', className)}>
        Sem dados de gravação nos últimos {days} dias
      </div>
    )
  }

  const buckets = data.buckets
  const barWidth = Math.max(2, Math.floor(800 / buckets.length))

  const hoveredBucket = hover ? buckets[hover.idx] : null

  return (
    <div className={cn('relative', className)}>
      <div className="flex items-end gap-px" style={{ height }}>
        {buckets.map((b, i) => {
          const h = Math.max(1, Math.round((b.uptimePct / 100) * height))
          const color =
            b.uptimePct === 0      ? 'bg-slate-700/60'  // sem dados
            : b.uptimePct > 80     ? 'bg-emerald-500'
            : b.uptimePct > 20     ? 'bg-amber-500'
                                   : 'bg-rose-500'
          return (
            <div
              key={i}
              className={cn(color, 'transition-opacity', hover?.idx === i ? 'opacity-100' : 'opacity-80 hover:opacity-100')}
              style={{ width: barWidth, height: h, minHeight: 1 }}
              onMouseEnter={e => {
                const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                setHover({ idx: i, x: e.clientX - rect.left, y: 0 })
              }}
              onMouseLeave={() => setHover(null)}
              title={`${new Date(b.hour).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })} — ${b.uptimePct}%`}
            />
          )
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <span>{new Date(buckets[0].hour).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })}</span>
        <span className={cn(
          'font-bold',
          data.overall.uptimePct > 80 ? 'text-emerald-400' :
          data.overall.uptimePct > 50 ? 'text-amber-400' : 'text-rose-400',
        )}>
          Uptime {days}d: {data.overall.uptimePct}%
        </span>
        <span>agora</span>
      </div>
      {hoveredBucket && hover && (
        <div
          className="absolute -top-12 px-2 py-1 rounded bg-slate-900 text-white text-[10px] font-mono shadow-lg pointer-events-none whitespace-nowrap"
          style={{ left: Math.max(0, Math.min(hover.x - 60, 700)) }}
        >
          {new Date(hoveredBucket.hour).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
          <br/>
          Uptime: {hoveredBucket.uptimePct}% · {hoveredBucket.segments} segmentos
        </div>
      )}
    </div>
  )
}
