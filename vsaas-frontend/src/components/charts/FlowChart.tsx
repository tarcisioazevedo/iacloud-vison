import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { GlassCard } from '../cards/GlassCard'
import { useFlowHourly } from '../../api/client'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { TrendingUp } from 'lucide-react'

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className={[
      'backdrop-blur border rounded-xl p-3 shadow-lg text-xs',
      'bg-white/95 border-slate-200',
      'dark:bg-space-800/95 dark:border-white/10 dark:shadow-glass',
    ].join(' ')}>
      <p className="mb-2 font-medium text-slate-600 dark:text-slate-400">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="capitalize text-slate-700 dark:text-slate-300">{p.name}:</span>
          <span className="font-semibold text-slate-900 dark:text-white">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

interface FlowChartProps {
  days?: number
  delay?: number
}

export function FlowChart({ days = 7, delay = 0 }: FlowChartProps) {
  const { data, isLoading } = useFlowHourly(days)

  const chartData = (data?.data ?? []).map((d: any) => ({
    hour: format(parseISO(d.hour), 'HH:mm', { locale: ptBR }),
    Entradas: d.in,
    Saídas: d.out,
  }))

  return (
    <GlassCard delay={delay} className="p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
            <TrendingUp className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            Fluxo de Pessoas
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Últimos {days} dias • por hora</p>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
            <span className="w-3 h-0.5 bg-cyan-500 dark:bg-cyan-400 rounded" />Entradas
          </span>
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
            <span className="w-3 h-0.5 bg-violet-500 dark:bg-violet-400 rounded" />Saídas
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="h-56 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="gradCyan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#00C0D0" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#00C0D0" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradViolet" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* slate-500 a 16% — funciona como subtle grid no light (bg
                slate-50) e no dark (bg space-950). Recharts não aceita
                classes Tailwind, então usar rgba neutra é a saída pragmática
                pra evitar precisar de hook de tema dentro do chart. */}
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.16)" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="Entradas"
              stroke="#00C0D0"
              strokeWidth={2}
              fill="url(#gradCyan)"
              dot={false}
              activeDot={{ r: 4, fill: '#00C0D0', stroke: '#040d1a', strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="Saídas"
              stroke="#8b5cf6"
              strokeWidth={2}
              fill="url(#gradViolet)"
              dot={false}
              activeDot={{ r: 4, fill: '#8b5cf6', stroke: '#040d1a', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  )
}
