/**
 * PlaybackTimeline — barra de tempo 24h com heatmap de gravação.
 *
 * Estilo Frigate:
 *   - Barra horizontal de 1440px (1 px/min, ou esticável)
 *   - Cor escura nos minutos sem gravação, ciano nos minutos COM gravação
 *   - Click move o playhead
 *   - Marcador de tempo atual sobreposto
 *   - Hover mostra tooltip "HH:MM"
 */
import { useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

interface PlaybackTimelineProps {
  /** Bitmap de 1440 chars '0'|'1' por minuto. */
  bitmap?: string
  /** Posição atual do playhead, em segundos desde 00:00 do dia. */
  currentSecOfDay?: number
  /** Disparado quando usuário clica num minuto. Recebe segundos desde 00:00. */
  onSeek?: (secOfDay: number) => void
  className?: string
}

const MINUTES = 1440  // 24h × 60min

export function PlaybackTimeline({
  bitmap, currentSecOfDay, onSeek, className,
}: PlaybackTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hoverMin, setHoverMin] = useState<number | null>(null)

  // Pré-calcula segmentos contínuos pra renderizar como retângulos (em vez
  // de 1440 divs separadas — perf brutal). "010011000111" → ranges:
  // [{start:1,end:1},{start:4,end:5},{start:9,end:11}]
  const ranges = useMemo(() => {
    if (!bitmap) return [] as Array<{ start: number; end: number }>
    const out: Array<{ start: number; end: number }> = []
    let i = 0
    while (i < bitmap.length) {
      if (bitmap[i] === '1') {
        const start = i
        while (i < bitmap.length && bitmap[i] === '1') i++
        out.push({ start, end: i })  // exclusive end
      } else { i++ }
    }
    return out
  }, [bitmap])

  function pickFromX(clientX: number): number {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(MINUTES - 1, Math.floor(ratio * MINUTES)))
  }

  function handleClick(e: React.MouseEvent) {
    const min = pickFromX(e.clientX)
    onSeek?.(min * 60)
  }

  function handleHover(e: React.MouseEvent) {
    setHoverMin(pickFromX(e.clientX))
  }

  function fmtMin(min: number): string {
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  // Linhas de hora (0h, 4h, 8h, …) pra leitura visual
  const hourMarks = [0, 3, 6, 9, 12, 15, 18, 21, 24]
  const playheadPct = currentSecOfDay != null
    ? (currentSecOfDay / 60 / MINUTES) * 100
    : null

  return (
    <div className={cn('relative select-none', className)}>
      {/* Track principal — backdrop dark */}
      <div
        ref={trackRef}
        className="relative h-10 w-full bg-white/[0.04] border border-slate-200 dark:border-white/10 rounded-md cursor-crosshair overflow-hidden"
        onClick={handleClick}
        onMouseMove={handleHover}
        onMouseLeave={() => setHoverMin(null)}
      >
        {/* Ranges com gravação */}
        {ranges.map((r, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 bg-cyan-500/40 hover:bg-cyan-500/60 transition-colors"
            style={{
              left:  `${(r.start / MINUTES) * 100}%`,
              width: `${((r.end - r.start) / MINUTES) * 100}%`,
            }}
          />
        ))}

        {/* Hour marks (linhas verticais sutis) */}
        {hourMarks.map(h => (
          <div
            key={h}
            className="absolute top-0 bottom-0 border-l border-slate-200 dark:border-white/10 pointer-events-none"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}

        {/* Playhead atual */}
        {playheadPct != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
            style={{ left: `${playheadPct}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-amber-400" />
          </div>
        )}

        {/* Hover tooltip */}
        {hoverMin != null && (
          <div
            className="absolute bottom-full mb-1 -translate-x-1/2 px-2 py-0.5 rounded bg-black/80 border border-slate-200 dark:border-white/10 text-[10px] font-mono text-white pointer-events-none whitespace-nowrap"
            style={{ left: `${(hoverMin / MINUTES) * 100}%` }}
          >
            {fmtMin(hoverMin)}
          </div>
        )}
      </div>

      {/* Labels horários abaixo da barra (4 marcas: 0h, 6h, 12h, 18h) */}
      <div className="relative h-3 mt-0.5">
        {[0, 6, 12, 18, 24].map((h, i) => (
          <span
            key={h}
            className={cn(
              'absolute text-[9px] text-slate-500 font-mono',
              i === 0 ? 'left-0' :
              i === 4 ? 'right-0' :
              '-translate-x-1/2',
            )}
            style={i !== 0 && i !== 4 ? { left: `${(h / 24) * 100}%` } : undefined}
          >
            {String(h).padStart(2, '0')}h
          </span>
        ))}
      </div>
    </div>
  )
}
