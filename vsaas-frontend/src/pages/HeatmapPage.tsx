/**
 * Sprint U.1.2 — HeatmapPage (substitui placeholder)
 *
 * Renderiza o heatmap 7×24 (dias da semana × horas) retornado pelo endpoint
 * GET /bi/ia/heatmap. Usado para identificar bandas horárias críticas — quando
 * mais eventos batem, qual dia "noisy" é, etc.
 *
 * Cores: gradient de zero (transparent) → cyan-500 (max) usando `intensity`
 * normalizada (cell/max). Acessibilidade: também mostra o número dentro
 * da célula quando hover.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Map as MapIcon, Calendar, Activity, AlertTriangle, Loader2 } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useIaHeatmap, formatApiError } from '../api/client'
import { cn } from '../lib/utils'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

const RANGES = [
  { days: 7,  label: '7 dias' },
  { days: 14, label: '14 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
]

export function HeatmapPage() {
  const [days, setDays] = useState(14)
  const { data, error, isLoading } = useIaHeatmap(days)

  // Detecta dia/hora pico para "insight box"
  let peakDay = -1, peakHour = -1, peakValue = 0
  if (data?.matrix) {
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (data.matrix[d][h] > peakValue) {
          peakValue = data.matrix[d][h]
          peakDay = d
          peakHour = h
        }
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-violet-500/5 to-transparent border-cyan-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <MapIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Heatmap Temporal</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Distribuição de eventos por <strong className="text-slate-900 dark:text-white">dia da semana</strong> ×
                <strong className="text-slate-900 dark:text-white"> hora do dia</strong>. Identifica bandas
                críticas — útil para programar rondas, escalonar atendentes ou afinar gatilhos
                de notificação.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg p-1">
            {RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-semibold transition',
                  days === r.days
                    ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-200 border border-cyan-500/30'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiTile
          icon={Activity}
          label="Total no período"
          value={data?.total?.toLocaleString('pt-BR') ?? '—'}
          loading={isLoading}
        />
        <KpiTile
          icon={Calendar}
          label="Pico (dia/hora)"
          value={peakDay >= 0 ? `${DAYS[peakDay]} • ${String(peakHour).padStart(2, '0')}h` : '—'}
          loading={isLoading}
        />
        <KpiTile
          icon={Activity}
          label="Eventos no pico"
          value={peakValue ? peakValue.toLocaleString('pt-BR') : '—'}
          loading={isLoading}
        />
      </div>

      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao carregar heatmap</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Grid */}
      <GlassCard className="p-4 md:p-5">
        {isLoading && !data ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : data ? (
          <HeatmapGrid matrix={data.matrix} max={data.max} />
        ) : null}
      </GlassCard>

      {peakValue > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="text-[11px] text-slate-500 px-1"
        >
          💡 Concentração máxima nas {String(peakHour).padStart(2, '0')}h da{' '}
          {DAYS[peakDay].toLowerCase()}-feira nas últimas {days} semanas — considere
          intensificar monitoramento ou criar gatilho de severidade nessa janela.
        </motion.div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function HeatmapGrid({ matrix, max }: { matrix: number[][]; max: number }) {
  const safeMax = Math.max(1, max) // evita divisão por zero

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* Header com horas */}
        <div className="grid gap-1" style={{ gridTemplateColumns: '36px repeat(24, minmax(0, 1fr))' }}>
          <div />
          {HOURS.map(h => (
            <div key={h} className="text-[9px] text-slate-600 text-center font-mono">
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </div>
          ))}
        </div>

        {/* Linhas */}
        {matrix.map((row, dow) => (
          <div
            key={dow}
            className="grid gap-1 mt-1"
            style={{ gridTemplateColumns: '36px repeat(24, minmax(0, 1fr))' }}
          >
            <div className="text-[10px] text-slate-500 font-mono text-right pr-1 self-center">
              {DAYS[dow]}
            </div>
            {row.map((value, hour) => {
              const intensity = value / safeMax
              return (
                <Cell key={hour} value={value} intensity={intensity} hour={hour} day={DAYS[dow]} />
              )
            })}
          </div>
        ))}

        {/* Legenda */}
        <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-500">
          <span>menos</span>
          <div className="flex gap-0.5">
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map(i => (
              <div
                key={i}
                className="w-5 h-3 rounded-sm border border-slate-200 dark:border-white/5"
                style={{ background: cellColor(i) }}
              />
            ))}
          </div>
          <span>mais</span>
          <span className="ml-auto text-slate-600 font-mono">
            max = {max.toLocaleString('pt-BR')} ev/h
          </span>
        </div>
      </div>
    </div>
  )
}

function Cell({ value, intensity, hour, day }: { value: number; intensity: number; hour: number; day: string }) {
  return (
    <div
      title={`${day} ${String(hour).padStart(2, '0')}:00 — ${value} evento${value === 1 ? '' : 's'}`}
      className="aspect-square rounded-sm border border-slate-200/50 dark:border-white/5 hover:border-cyan-500/50 hover:scale-110 transition cursor-help relative group"
      style={{ background: cellColor(intensity) }}
    >
      {value > 0 && intensity > 0.5 && (
        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-mono text-white/80">
          {value > 99 ? '99+' : value}
        </span>
      )}
    </div>
  )
}

/**
 * Mistura entre cor "vazia" (#1a1f2e leve) e cyan-500 baseado em intensity.
 * Fórmula simples — não precisa de chroma.js. Mantém build limpo.
 */
function cellColor(intensity: number): string {
  if (intensity <= 0) return 'rgba(255,255,255,0.02)'
  // intensity 0..1 → opacity 0.10..0.95 sobre cyan-500 (#06b6d4)
  const alpha = 0.10 + intensity * 0.85
  return `rgba(34, 211, 238, ${alpha})`
}

function KpiTile({
  icon: Icon, label, value, loading,
}: { icon: any; label: string; value: string; loading?: boolean }) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-xl font-bold text-slate-900 dark:text-white font-mono">
        {loading ? <Loader2 className="w-5 h-5 animate-spin inline" /> : value}
      </p>
    </GlassCard>
  )
}
