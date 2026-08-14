import { motion } from 'framer-motion'
import { GlassCard } from '../cards/GlassCard'
import { Flame } from 'lucide-react'
import { cn } from '../../lib/utils'
import { densityToColor } from '../../lib/heatmapColor'

// Mock grid — em produção vem de /bi/heatmap
function generateMockGrid(rows = 10, cols = 16): number[][] {
  const grid: number[][] = []
  const cx = cols / 2, cy = rows / 2
  for (let r = 0; r < rows; r++) {
    const row: number[] = []
    for (let c = 0; c < cols; c++) {
      const dx = (c - cx) / cx
      const dy = (r - cy) / cy
      const base = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy))
      row.push(Math.min(1, base * (0.6 + Math.random() * 0.8)))
    }
    grid.push(row)
  }
  return grid
}

interface HeatmapGridProps {
  label?: string
  delay?: number
}

export function HeatmapGrid({ label = 'Praça de Alimentação', delay = 0 }: HeatmapGridProps) {
  const grid = generateMockGrid(10, 16)

  const maxVal = Math.max(...grid.flat())
  const peak   = grid.flat().filter(v => v > 0.75).length
  const avg    = grid.flat().reduce((a, b) => a + b, 0) / grid.flat().length

  return (
    <GlassCard delay={delay} className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
            <Flame className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            Mapa de Calor
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">{label}</p>
        </div>
        <div className="flex gap-3 text-xs text-slate-500">
          <span>Pico: <span className="font-medium text-rose-700 dark:text-rose-400">{peak} zonas</span></span>
          <span>Médio: <span className="font-medium text-amber-700 dark:text-amber-400">{Math.round(avg * 100)}%</span></span>
        </div>
      </div>

      {/* Grid */}
      <div
        className="grid gap-0.5 rounded-xl overflow-hidden"
        style={{ gridTemplateColumns: `repeat(16, 1fr)` }}
      >
        {grid.map((row, r) =>
          row.map((val, c) => (
            <motion.div
              key={`${r}-${c}`}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: delay + (r * 16 + c) * 0.002, duration: 0.3 }}
              title={`Densidade: ${Math.round(val * 100)}%`}
              className="aspect-square rounded-[1px] cursor-crosshair transition-all duration-500"
              style={{ background: densityToColor(val / maxVal) }}
            />
          ))
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-slate-500 dark:text-slate-600">Vazio</span>
        <div className="flex gap-0.5 flex-1 mx-3 h-2 rounded-full overflow-hidden">
          {[0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.88, 1.0].map((v, i) => (
            <div key={i} className="flex-1" style={{ background: densityToColor(v) }} />
          ))}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-600">Lotado</span>
      </div>

      {/* Zone labels */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        {['Entrada', 'Centro', 'Caixas'].map((zone, i) => {
          const zoneVals = grid.flat().slice(i * 16, (i + 1) * 16)
          const zoneAvg  = zoneVals.reduce((a, b) => a + b, 0) / zoneVals.length
          const level    = zoneAvg > 0.7 ? 'Lotado' : zoneAvg > 0.4 ? 'Moderado' : 'Tranquilo'
          const levelClr = zoneAvg > 0.7
            ? 'text-rose-700 dark:text-rose-400'
            : zoneAvg > 0.4
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-emerald-700 dark:text-emerald-400'
          return (
            <div key={zone} className="rounded-lg p-2 text-center bg-slate-100 dark:bg-white/[0.03]">
              <p className="text-xs text-slate-600 dark:text-slate-400">{zone}</p>
              <p className={cn('text-xs font-semibold mt-0.5', levelClr)}>{level}</p>
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}
