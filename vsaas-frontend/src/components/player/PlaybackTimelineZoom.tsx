/**
 * PlaybackTimelineZoom — timeline 24h interativa com zoom + pan + click-to-seek.
 *
 * Diferenças do `PlaybackTimeline` (que continua existindo pra usos simples):
 *   1. Wheel scroll faz zoom (in/out) ancorado na posição do cursor — UX padrão
 *      de timeline em DAWs/NLEs. Shift+wheel pan horizontal.
 *   2. Drag (mouse-down + move) faz pan horizontal — útil quando zoom > 1.
 *   3. Click (sem drag) faz seek. Threshold de 4px diferencia drag de click.
 *   4. Eixo de tempo adapta granularidade: zoom out → marcas de 3h; zoom médio
 *      → marcas de 1h; zoom in → 15min/5min/1min conforme zoom level.
 *   5. Aceita callback opcional `onSeekIso` que recebe ISO 8601 — útil pra
 *      navegação de mosaico (vários câmeras, querendo ISO absoluto).
 *
 * Implementação:
 *   - Viewport: [viewStart, viewEnd] em segundos do dia [0, 86400).
 *     viewStart = 0, viewEnd = 86400 → "1×" (mostra dia inteiro).
 *     viewEnd - viewStart = 3600 → 24× (1h ocupa todo o track).
 *   - Zoom min = 1× (dia inteiro), max = 1440× (1 minuto na tela inteira).
 *   - Wheel deltaY > 0 = zoom out, deltaY < 0 = zoom in.
 *   - Pan limita pra que viewport sempre caiba em [0, 86400].
 *
 * Por que NÃO usar uma lib (visx, recharts, react-zoom-pan):
 *   - Bundle: visx adiciona ~50KB pra coisa que cabe em ~250 linhas.
 *   - Domínio: timeline de vídeo tem requisitos próprios (heatmap, hh:mm fmt,
 *     ranges contínuos) — abstração genérica acaba lutando contra a gente.
 *   - Performance: ranges contínuos como divs absolutas é O(ranges), não
 *     O(minutes) — escala bem mesmo com bitmap denso.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { cn } from '../../lib/utils'

interface Props {
  /** Bitmap 1440 chars '0'|'1' por minuto (mesmo formato do /playback/:id/timeline). */
  bitmap?: string
  /** Posição atual do playhead, em segundos desde 00:00 do dia. */
  currentSecOfDay?: number
  /** Callback ao clicar/seekar — segundos desde 00:00 do dia. */
  onSeek?: (secOfDay: number) => void
  /** Day base ISO (YYYY-MM-DD) — usado opcionalmente em onSeekIso. */
  dayUtcDate?: string
  /** Variante: callback com ISO 8601 absoluto (útil para multi-câmera). */
  onSeekIso?: (iso: string) => void
  className?: string
  /** Altura do track. Default 56px. */
  trackHeight?: number
  /**
   * Modo compacto: esconde header (zoom badge + range) e mini-mapa, deixando
   * apenas o track. Útil pra embedar dentro de tiles do mosaico onde espaço
   * é restrito. Hover tooltip e click-to-seek continuam funcionando.
   */
  compact?: boolean
}

const DAY_SECONDS  = 24 * 60 * 60   // 86400
const DAY_MINUTES  = 24 * 60        // 1440
const ZOOM_MIN     = 1              // dia inteiro
const ZOOM_MAX     = DAY_MINUTES    // 1 minuto fullscreen
const DRAG_THRESH  = 4              // px — abaixo disso é click

export function PlaybackTimelineZoom({
  bitmap, currentSecOfDay, onSeek, onSeekIso,
  dayUtcDate, className, trackHeight = 56, compact = false,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)

  // Viewport: faixa de segundos visíveis. Inicia mostrando o dia inteiro.
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd,   setViewEnd]   = useState(DAY_SECONDS)

  // Estado de drag — usado pra distinguir click de pan.
  const dragRef = useRef<{
    startX: number; startView: number; deltaX: number; pxPerSec: number
  } | null>(null)
  const [hoverSec, setHoverSec] = useState<number | null>(null)

  const viewRange = viewEnd - viewStart
  const zoom      = DAY_SECONDS / viewRange  // 1..1440

  // ── Coordinate helpers ──────────────────────────────────────────────────
  const xToSec = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    return Math.max(viewStart, Math.min(viewEnd, viewStart + ratio * viewRange))
  }, [viewStart, viewEnd, viewRange])

  const secToPct = useCallback((sec: number): number => {
    return ((sec - viewStart) / viewRange) * 100
  }, [viewStart, viewRange])

  // ── Zoom ─────────────────────────────────────────────────────────────────
  // Wheel: zoom ancorado no cursor.
  // Shift+wheel: pan horizontal.
  //
  // Implementado via addEventListener nativo com {passive:false} (ver useEffect
  // abaixo). A prop onWheel do React desde v17 anexa listeners passive por
  // default — preventDefault() vira no-op e a página rola junto. Native API
  // resolve cleanly.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {})
  wheelHandlerRef.current = (e: WheelEvent) => {
    e.preventDefault()
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()

    if (e.shiftKey) {
      // Pan: 1 wheel notch ≈ 5% da view atual
      const panSec = (e.deltaY > 0 ? 1 : -1) * viewRange * 0.05
      let newStart = viewStart + panSec
      let newEnd   = viewEnd   + panSec
      if (newStart < 0)            { newEnd -= newStart;            newStart = 0 }
      if (newEnd   > DAY_SECONDS)  { newStart -= (newEnd - DAY_SECONDS); newEnd = DAY_SECONDS }
      setViewStart(newStart); setViewEnd(newEnd)
      return
    }

    // Zoom factor: 0.85× por notch (suave). Trackpads costumam mandar valores
    // pequenos; clampar pra evitar zoom selvagem em laptops com trackpad.
    const dy = Math.max(-100, Math.min(100, e.deltaY))
    const factor = dy > 0 ? 1 / 0.85 : 0.85
    const ratio = (e.clientX - rect.left) / rect.width
    const anchorSec = viewStart + ratio * viewRange

    let newRange = viewRange * factor
    newRange = Math.max(DAY_SECONDS / ZOOM_MAX, Math.min(DAY_SECONDS, newRange))

    // Mantém o ponto sob o cursor estável: novo viewStart é tal que
    // anchorSec = newStart + ratio * newRange.
    let newStart = anchorSec - ratio * newRange
    let newEnd   = newStart + newRange
    if (newStart < 0)           { newStart = 0;            newEnd = newRange }
    if (newEnd   > DAY_SECONDS) { newEnd   = DAY_SECONDS;  newStart = newEnd - newRange }
    setViewStart(newStart); setViewEnd(newEnd)
  }

  // Anexa wheel listener nativo (passive:false) — necessário pra preventDefault
  // funcionar. React 17+ usa passive por default no onWheel prop.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const handler = (e: WheelEvent) => wheelHandlerRef.current(e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // ── Drag-to-pan (mouse) + distinção de click ────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const el = trackRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = {
      startX:    e.clientX,
      startView: viewStart,
      deltaX:    0,
      pxPerSec:  rect.width / viewRange,
    }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    setHoverSec(xToSec(e.clientX))
    const drag = dragRef.current; if (!drag) return
    drag.deltaX = e.clientX - drag.startX
    if (Math.abs(drag.deltaX) < DRAG_THRESH) return
    const panSec = -drag.deltaX / drag.pxPerSec
    let newStart = drag.startView + panSec
    if (newStart < 0) newStart = 0
    if (newStart + viewRange > DAY_SECONDS) newStart = DAY_SECONDS - viewRange
    setViewStart(newStart); setViewEnd(newStart + viewRange)
  }
  const onMouseUp = (e: React.MouseEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (Math.abs(drag.deltaX) < DRAG_THRESH) {
      // Click sem drag → seek
      const sec = xToSec(e.clientX)
      onSeek?.(Math.floor(sec))
      if (onSeekIso && dayUtcDate) {
        const ms = new Date(`${dayUtcDate}T00:00:00.000Z`).getTime() + Math.floor(sec) * 1000
        onSeekIso(new Date(ms).toISOString())
      }
    }
  }
  const onMouseLeave = () => { setHoverSec(null); dragRef.current = null }

  // ── Render: heatmap ranges do bitmap, restritos ao viewport ─────────────
  // O bitmap tem 1440 entries; convertemos pra segundos e clampamos no view.
  // Em zoom alto (visível < 60min), mostramos 1 retângulo por minuto pra
  // melhor granularidade visual.
  const ranges = useMemo(() => {
    if (!bitmap) return []
    const out: Array<{ start: number; end: number }> = []  // em segundos
    let i = 0
    while (i < bitmap.length) {
      if (bitmap[i] === '1') {
        const s = i
        while (i < bitmap.length && bitmap[i] === '1') i++
        out.push({ start: s * 60, end: i * 60 })
      } else { i++ }
    }
    // Filtra só os que intersectam com viewport.
    return out.filter(r => r.end >= viewStart && r.start <= viewEnd)
  }, [bitmap, viewStart, viewEnd])

  // ── Marcas de tempo: cadência depende do zoom ──────────────────────────
  // Mostramos ~6-12 marcas. Calcula step ideal e arredonda pra valores "nice".
  const ticks = useMemo(() => {
    const targetCount = 8
    const idealStep = viewRange / targetCount
    // Steps "bonitos" em segundos. Ordenado.
    const NICE = [
      60, 120, 300, 600, 900, 1800,            // 1m, 2m, 5m, 10m, 15m, 30m
      3600, 2 * 3600, 3 * 3600, 6 * 3600, 12 * 3600,  // 1h, 2h, 3h, 6h, 12h
    ]
    const step = NICE.find(n => n >= idealStep) ?? NICE[NICE.length - 1]
    const first = Math.ceil(viewStart / step) * step
    const out: number[] = []
    for (let t = first; t <= viewEnd; t += step) out.push(t)
    return { step, ticks: out }
  }, [viewStart, viewEnd, viewRange])

  function fmtSec(sec: number, withSec = false): string {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    if (withSec) return `${pad(h)}:${pad(m)}:${pad(s)}`
    return `${pad(h)}:${pad(m)}`
  }

  // Reset zoom em duplo click (UX padrão de DAW)
  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    setViewStart(0); setViewEnd(DAY_SECONDS)
  }

  // ── Atalhos de teclado (track focado) ─────────────────────────────────────
  // ←/→: ±5s · Shift+←/→: ±30s · Home/End: extremos · 0: reset zoom
  function onKeyDown(e: React.KeyboardEvent) {
    if (currentSecOfDay == null && e.key !== '0') return
    const cur = currentSecOfDay ?? 0
    const big = e.shiftKey ? 30 : 5
    let next = cur
    if (e.key === 'ArrowLeft')  next = Math.max(0, cur - big)
    else if (e.key === 'ArrowRight') next = Math.min(DAY_SECONDS - 1, cur + big)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End')  next = DAY_SECONDS - 1
    else if (e.key === '0')    { setViewStart(0); setViewEnd(DAY_SECONDS); e.preventDefault(); return }
    else return
    e.preventDefault()
    onSeek?.(Math.floor(next))
    if (onSeekIso && dayUtcDate) {
      const ms = new Date(`${dayUtcDate}T00:00:00.000Z`).getTime() + Math.floor(next) * 1000
      onSeekIso(new Date(ms).toISOString())
    }
  }

  // Reage ao currentSecOfDay: se cair fora do viewport, recentraliza
  // (autopan suave) — assim o playhead nunca some quando vídeo avança.
  useEffect(() => {
    if (currentSecOfDay == null) return
    if (currentSecOfDay < viewStart || currentSecOfDay > viewEnd) {
      const half = viewRange / 2
      let ns = currentSecOfDay - half
      if (ns < 0) ns = 0
      if (ns + viewRange > DAY_SECONDS) ns = DAY_SECONDS - viewRange
      setViewStart(ns); setViewEnd(ns + viewRange)
    }
  }, [currentSecOfDay]) // eslint-disable-line react-hooks/exhaustive-deps

  const playheadPct = currentSecOfDay != null && currentSecOfDay >= viewStart && currentSecOfDay <= viewEnd
    ? secToPct(currentSecOfDay)
    : null
  const showSecondsInTooltip = ticks.step <= 60

  return (
    <div className={cn('relative select-none', className)}>
      {/* Header com indicador de zoom + janela visível — escondido em compact */}
      {!compact && (
      <div className="flex items-center justify-between mb-1.5 text-[10px] text-slate-500 font-mono">
        <span>
          <span className="text-slate-400">{fmtSec(viewStart, showSecondsInTooltip)}</span>
          <span className="mx-1 opacity-50">→</span>
          <span className="text-slate-400">{fmtSec(viewEnd, showSecondsInTooltip)}</span>
        </span>
        <span>
          <span className="text-cyan-300">{zoom.toFixed(zoom < 10 ? 1 : 0)}×</span>
          <span className="mx-2 opacity-30">·</span>
          <span className="opacity-70">scroll = zoom · shift+scroll = pan · drag = pan · 2-click = reset</span>
        </span>
      </div>
      )}

      {/* Track */}
      <div
        ref={trackRef}
        tabIndex={0}
        className="relative w-full bg-white/[0.04] border border-white/10 rounded-md overflow-hidden cursor-grab active:cursor-grabbing focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
        style={{ height: trackHeight, touchAction: 'none' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        {/* Ranges com gravação */}
        {ranges.map((r, i) => {
          const left  = ((Math.max(r.start, viewStart) - viewStart) / viewRange) * 100
          const right = ((Math.min(r.end,   viewEnd)   - viewStart) / viewRange) * 100
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 bg-cyan-500/40 hover:bg-cyan-500/60 transition-colors pointer-events-none"
              style={{ left: `${left}%`, width: `${Math.max(right - left, 0.1)}%` }}
            />
          )
        })}

        {/* Tick lines + labels */}
        {ticks.ticks.map(t => (
          <div
            key={t}
            className="absolute top-0 bottom-0 border-l border-white/10 pointer-events-none"
            style={{ left: `${secToPct(t)}%` }}
          >
            <span
              className="absolute bottom-0.5 left-1 text-[9px] font-mono text-slate-500 whitespace-nowrap pointer-events-none"
            >
              {fmtSec(t, ticks.step < 60)}
            </span>
          </div>
        ))}

        {/* Playhead */}
        {playheadPct != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
            style={{ left: `${playheadPct}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-amber-400" />
          </div>
        )}

        {/* Hover tooltip */}
        {hoverSec != null && (
          <div
            className="absolute -top-6 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/90 border border-white/10 text-[10px] font-mono text-white pointer-events-none whitespace-nowrap shadow-lg z-10"
            style={{ left: `${secToPct(hoverSec)}%` }}
          >
            {fmtSec(hoverSec, showSecondsInTooltip)}
          </div>
        )}
      </div>

      {/* Mini-mapa: barra fina mostrando o viewport relativo ao dia inteiro */}
      {!compact && (
      <div className="relative h-1.5 mt-1.5 bg-white/[0.04] rounded-full overflow-hidden">
        <div
          className="absolute top-0 bottom-0 bg-cyan-400/30 rounded-full"
          style={{
            left:  `${(viewStart / DAY_SECONDS) * 100}%`,
            width: `${(viewRange / DAY_SECONDS) * 100}%`,
          }}
        />
        {/* Playhead no mini-mapa */}
        {currentSecOfDay != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none"
            style={{ left: `${(currentSecOfDay / DAY_SECONDS) * 100}%` }}
          />
        )}
      </div>
      )}
    </div>
  )
}

function pad(n: number): string { return String(n).padStart(2, '0') }
