/**
 * RecordingTimeline — timeline reusável de gravações para uma câmera.
 *
 * Eixo X = tempo. Renderiza:
 *   - Blocos por segmento: cinza (normal), amarelo (hasMotion), vermelho (hasEvent)
 *   - Bookmarks como flags coloridas (lucide Bookmark) sobrepostos
 *   - Playhead vertical (cyan, 2px) com agulha no topo
 *   - Eixo de tempo com grid adaptativo ao range
 *
 * Interações:
 *   - Click ou drag em qualquer ponto → onSeek(timestamp)
 *     Durante drag, dispara em mousemove com debounce de ~50ms.
 *   - Hover num segmento → tooltip (horário + duração + tamanho)
 *     Se segment.spriteUrl existir, mostra mini thumbnail (160×90).
 *   - Wheel scroll → zoom (ancorado no cursor).
 *   - Shift+drag → pan.
 *   - Botões internos: 1h / 6h / 24h / 7d (presets de range).
 *
 * Props ver `RecordingTimelineProps`. Polling automático (10s) quando
 * `liveUpdate=true`, senão refresh manual via SWR mutate.
 */
import {
  useEffect, useMemo, useRef, useState, useCallback,
} from 'react'
import { Bookmark as BookmarkIcon, Clock } from 'lucide-react'
import {
  useRecordingSegments,
  useBookmarks,
  type RecordingSegment,
  type Bookmark,
} from '../../api/client'
import { cn } from '../../lib/utils'

export interface RecordingTimelineProps {
  cameraId: string
  /** Window inicial (default: últimas 24h) */
  initialFrom?: Date
  initialTo?:   Date
  /** Callback quando usuário arrasta/clica na timeline */
  onSeek?: (timestamp: Date) => void
  /** Callback quando usuário clica num bookmark */
  onBookmarkClick?: (bookmark: Bookmark) => void
  /** Posição atual do playback (linha vertical na timeline) */
  currentTime?: Date
  /** Atualizar timeline em tempo real conforme video toca */
  liveUpdate?: boolean
  /** Compacto (sem labels grandes) — usado no player */
  compact?: boolean
  className?: string
}

// Presets do toolbar (em ms).
const RANGE_PRESETS: { label: string; ms: number }[] = [
  { label: '1h',  ms: 60 * 60 * 1000 },
  { label: '6h',  ms: 6 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d',  ms: 7 * 24 * 60 * 60 * 1000 },
]

const MIN_RANGE_MS = 5 * 60 * 1000           // 5 minutos é o zoom máximo
const MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 dias é o zoom mínimo

function formatTime(d: Date, withSec = false): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const h = pad(d.getHours()), m = pad(d.getMinutes())
  if (withSec) return `${h}:${m}:${pad(d.getSeconds())}`
  return `${h}:${m}`
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${formatTime(d, true)}`
}

function formatBytes(bytesStr: string): string {
  const b = Number(bytesStr) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDurationSec(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), sr = s % 60
  if (m < 60) return sr ? `${m}m${sr}s` : `${m}m`
  const h = Math.floor(m / 60), mr = m % 60
  return mr ? `${h}h${mr}m` : `${h}h`
}

/** Cor do bloco do segmento (eventos > motion > normal). */
function segmentColor(seg: RecordingSegment): string {
  if (seg.hasEvent) return 'rgb(244 63 94)'      // rose-500
  if (seg.hasMotion) return 'rgb(250 204 21)'    // yellow-400
  return 'rgb(100 116 139)'                       // slate-500
}

/**
 * Calcula tick spacing do eixo X em função do range total. Retorna `[stepMs, format]`
 * onde format é função (Date → string).
 */
function tickStrategy(rangeMs: number): { stepMs: number; fmt: (d: Date) => string } {
  if (rangeMs <= 30 * 60 * 1000) return { stepMs: 5 * 60 * 1000, fmt: d => formatTime(d, false) }
  if (rangeMs <= 2  * 60 * 60 * 1000) return { stepMs: 15 * 60 * 1000, fmt: d => formatTime(d, false) }
  if (rangeMs <= 6  * 60 * 60 * 1000) return { stepMs: 30 * 60 * 1000, fmt: d => formatTime(d, false) }
  if (rangeMs <= 24 * 60 * 60 * 1000) return { stepMs: 2  * 60 * 60 * 1000, fmt: d => formatTime(d, false) }
  if (rangeMs <= 3  * 24 * 60 * 60 * 1000) return {
    stepMs: 6 * 60 * 60 * 1000,
    fmt: d => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${formatTime(d)}`,
  }
  return {
    stepMs: 24 * 60 * 60 * 1000,
    fmt: d => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`,
  }
}

interface HoverState {
  segment:    RecordingSegment | null
  pageX:      number
  pageY:      number
  trackY:     number
}

export function RecordingTimeline({
  cameraId,
  initialFrom,
  initialTo,
  onSeek,
  onBookmarkClick,
  currentTime,
  liveUpdate = false,
  compact = false,
  className,
}: RecordingTimelineProps) {
  // Janela visível (estado interno; controlada por presets/zoom/pan).
  const [from, setFrom] = useState<Date>(() => initialFrom ?? new Date(Date.now() - 24 * 60 * 60 * 1000))
  const [to,   setTo  ] = useState<Date>(() => initialTo   ?? new Date())

  // Atualiza quando props initialFrom/To mudam (uso em modo controlado).
  useEffect(() => {
    if (initialFrom) setFrom(initialFrom)
    if (initialTo)   setTo(initialTo)
  }, [initialFrom?.getTime(), initialTo?.getTime()])

  // ── Live update: empurra `to` pra agora a cada 5s quando ativo ────────
  useEffect(() => {
    if (!liveUpdate) return
    const id = setInterval(() => {
      const span = to.getTime() - from.getTime()
      const newTo = new Date()
      setTo(newTo)
      setFrom(new Date(newTo.getTime() - span))
    }, 5_000)
    return () => clearInterval(id)
  }, [liveUpdate, from, to])

  const refreshInterval = liveUpdate ? 10_000 : 0

  const { data: segData } = useRecordingSegments(cameraId, from, to, { refreshInterval })
  const { data: bmData  } = useBookmarks(cameraId, from, to)
  const segments = segData?.segments ?? []
  const bookmarks = bmData?.bookmarks ?? []

  // ── Geometria ─────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)

  useEffect(() => {
    if (!trackRef.current) return
    const el = trackRef.current
    const ro = new ResizeObserver(() => setTrackWidth(el.clientWidth))
    ro.observe(el)
    setTrackWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const rangeMs = Math.max(1, to.getTime() - from.getTime())

  /** Converte um timestamp em px X dentro do track. */
  const tsToX = useCallback((ts: number) => {
    return ((ts - from.getTime()) / rangeMs) * trackWidth
  }, [from, rangeMs, trackWidth])

  /** Converte px X (relativo ao track) em timestamp Date. */
  const xToTs = useCallback((x: number): Date => {
    const clamped = Math.max(0, Math.min(trackWidth, x))
    const ts = from.getTime() + (clamped / Math.max(1, trackWidth)) * rangeMs
    return new Date(ts)
  }, [from, rangeMs, trackWidth])

  // ── Drag/click + pan (shift) ─────────────────────────────────────────
  const dragRef = useRef<{
    isDragging: boolean
    isPan:      boolean
    startX:     number
    startFromMs: number
    startToMs:   number
    lastSeekAt: number
  } | null>(null)

  const onMouseDown = (e: React.MouseEvent) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    dragRef.current = {
      isDragging: true,
      isPan: e.shiftKey,
      startX: x,
      startFromMs: from.getTime(),
      startToMs: to.getTime(),
      lastSeekAt: 0,
    }

    if (!e.shiftKey) {
      // Click/drag normal → emite seek imediato.
      onSeek?.(xToTs(x))
    }
  }

  const onMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left

    // Atualiza hover do segmento (sempre).
    updateHover(e, x, rect)

    if (!drag?.isDragging) return

    if (drag.isPan) {
      // Pan horizontal: move from/to pelo delta de px.
      const dx = x - drag.startX
      const deltaMs = -dx / Math.max(1, trackWidth) * (drag.startToMs - drag.startFromMs)
      setFrom(new Date(drag.startFromMs + deltaMs))
      setTo(new Date(drag.startToMs + deltaMs))
    } else {
      // Drag de seek com debounce 50ms.
      const now = performance.now()
      if (now - drag.lastSeekAt >= 50) {
        drag.lastSeekAt = now
        onSeek?.(xToTs(x))
      }
    }
  }

  const onMouseUp = () => {
    dragRef.current = null
  }

  // Handler global de mouseup (fora do track) — finaliza drag mesmo se soltar fora.
  useEffect(() => {
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // ── Hover tooltip + thumbnail ─────────────────────────────────────────
  const [hover, setHover] = useState<HoverState | null>(null)

  const updateHover = (e: React.MouseEvent, x: number, rect: DOMRect) => {
    const ts = xToTs(x).getTime()
    const seg = segments.find(s => {
      const a = new Date(s.startedAt).getTime()
      const b = new Date(s.endedAt).getTime()
      return ts >= a && ts <= b
    })
    if (seg) {
      setHover({
        segment: seg,
        pageX: e.clientX,
        pageY: e.clientY,
        trackY: rect.top,
      })
    } else {
      setHover(null)
    }
  }

  const onMouseLeave = () => setHover(null)

  // ── Wheel zoom (ancorado no cursor) ──────────────────────────────────
  const onWheel = (e: React.WheelEvent) => {
    if (!trackRef.current) return
    e.preventDefault()
    const rect = trackRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const cursorTs = xToTs(x).getTime()

    // deltaY > 0 = zoom out, deltaY < 0 = zoom in.
    const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25
    let newRange = rangeMs * factor
    newRange = Math.min(MAX_RANGE_MS, Math.max(MIN_RANGE_MS, newRange))

    // Mantém o ts sob o cursor estável.
    const ratio = trackWidth ? x / trackWidth : 0.5
    const newFrom = cursorTs - ratio * newRange
    const newTo   = cursorTs + (1 - ratio) * newRange
    setFrom(new Date(newFrom))
    setTo(new Date(newTo))
  }

  // ── Renderização: ticks, segmentos, bookmarks, playhead ──────────────
  const ticks = useMemo(() => {
    if (!trackWidth) return []
    const { stepMs, fmt } = tickStrategy(rangeMs)
    const result: { x: number; label: string }[] = []
    // Alinha o primeiro tick ao múltiplo do step.
    const startMs = Math.ceil(from.getTime() / stepMs) * stepMs
    for (let t = startMs; t <= to.getTime(); t += stepMs) {
      const x = tsToX(t)
      if (x < 0 || x > trackWidth) continue
      result.push({ x, label: fmt(new Date(t)) })
    }
    return result
  }, [from, to, rangeMs, trackWidth, tsToX])

  // Playhead (currentTime) — só renderiza se dentro da janela.
  const playheadX = currentTime
    ? tsToX(currentTime.getTime())
    : null
  const playheadVisible = playheadX !== null && playheadX >= 0 && playheadX <= trackWidth

  // Aplica preset de range (ancorado no fim atual `to`).
  function applyPreset(ms: number) {
    const newTo = liveUpdate ? new Date() : to
    setTo(newTo)
    setFrom(new Date(newTo.getTime() - ms))
  }

  return (
    <div className={cn('w-full select-none', className)}>
      {/* Toolbar (escondido em modo compact) */}
      {!compact && (
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatDateTime(from)}</span>
            <span className="text-slate-400 dark:text-slate-600">→</span>
            <span>{formatDateTime(to)}</span>
          </div>
          <div className="flex items-center gap-1">
            {RANGE_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.ms)}
                className="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Track principal */}
      <div
        ref={trackRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
        className={cn(
          'relative w-full rounded-md bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 overflow-hidden cursor-crosshair',
          compact ? 'h-10' : 'h-14',
        )}
        style={{ touchAction: 'none' }}
      >
        {/* Background grid (ticks verticais) */}
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-slate-200/70 dark:border-white/5 pointer-events-none"
            style={{ left: `${t.x}px` }}
          />
        ))}

        {/* Blocos de segmentos */}
        {trackWidth > 0 && segments.map(seg => {
          const startMs = new Date(seg.startedAt).getTime()
          const endMs   = new Date(seg.endedAt).getTime()
          // Clip ao viewport
          const a = Math.max(startMs, from.getTime())
          const b = Math.min(endMs, to.getTime())
          if (b <= a) return null
          const x  = tsToX(a)
          const w  = Math.max(1, tsToX(b) - x)
          return (
            <div
              key={seg.id}
              className="absolute"
              style={{
                left: `${x}px`,
                width: `${w}px`,
                top: compact ? '4px' : '8px',
                bottom: compact ? '4px' : '8px',
                background: segmentColor(seg),
                opacity: 0.85,
                borderRadius: '2px',
              }}
              data-segment-id={seg.id}
            />
          )
        })}

        {/* Bookmarks (flags) */}
        {trackWidth > 0 && bookmarks.map(bm => {
          const ts = new Date(bm.startAt).getTime()
          if (ts < from.getTime() || ts > to.getTime()) return null
          const x = tsToX(ts)
          return (
            <button
              key={bm.id}
              onClick={(e) => {
                e.stopPropagation()
                onBookmarkClick?.(bm)
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title={`${bm.title} — ${formatDateTime(new Date(bm.startAt))}`}
              className="absolute top-0 z-10 -translate-x-1/2 hover:scale-110 transition"
              style={{ left: `${x}px` }}
            >
              <BookmarkIcon
                className="w-3.5 h-3.5 drop-shadow"
                style={{ color: bm.color, fill: bm.color }}
              />
            </button>
          )
        })}

        {/* Playhead (currentTime) */}
        {playheadVisible && (
          <>
            <div
              className="absolute top-0 bottom-0 z-20 pointer-events-none"
              style={{
                left: `${playheadX}px`,
                width: '2px',
                background: 'rgb(34 211 238)', // cyan-400
                boxShadow: '0 0 6px rgba(34,211,238,0.8)',
              }}
            />
            {/* Agulha no topo */}
            <div
              className="absolute top-0 z-20 -translate-x-1/2 pointer-events-none"
              style={{
                left: `${playheadX}px`,
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '6px solid rgb(34 211 238)',
              }}
            />
          </>
        )}

        {/* Tick labels (overlay no fundo do track) */}
        {!compact && ticks.map((t, i) => (
          <div
            key={`l${i}`}
            className="absolute bottom-0 text-[9px] text-slate-500 dark:text-slate-400 font-mono pointer-events-none -translate-x-1/2"
            style={{ left: `${t.x}px`, lineHeight: 1 }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* Legenda (escondida em compact) */}
      {!compact && (
        <div className="flex items-center gap-3 mt-1.5 px-1 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'rgb(100 116 139)' }} />
            Gravação
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'rgb(250 204 21)' }} />
            Movimento
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'rgb(244 63 94)' }} />
            Evento
          </span>
          <span className="ml-auto opacity-60">scroll = zoom · shift+drag = pan</span>
        </div>
      )}

      {/* Tooltip + sprite preview */}
      {hover?.segment && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${hover.pageX + 12}px`,
            top:  `${hover.pageY + 12}px`,
          }}
        >
          <div className="rounded-lg bg-slate-900/95 dark:bg-slate-950/95 border border-white/10 text-white shadow-xl p-2 text-[11px] backdrop-blur-sm">
            {hover.segment.spriteUrl && (
              <img
                src={hover.segment.spriteUrl}
                alt=""
                className="rounded mb-1.5 object-cover"
                style={{ width: '160px', height: '90px' }}
              />
            )}
            <div className="font-mono text-cyan-300">
              {formatDateTime(new Date(hover.segment.startedAt))}
            </div>
            <div className="font-mono text-slate-300">
              → {formatDateTime(new Date(hover.segment.endedAt))}
            </div>
            <div className="mt-0.5 flex gap-2 text-[10px] text-slate-400">
              <span>{formatDurationSec(hover.segment.durationSec)}</span>
              <span>·</span>
              <span>{formatBytes(hover.segment.sizeBytes)}</span>
              <span>·</span>
              <span>{hover.segment.fps}fps</span>
            </div>
            {(hover.segment.hasEvent || hover.segment.hasMotion) && (
              <div className="mt-1 flex gap-1">
                {hover.segment.hasEvent && (
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-rose-500/20 text-rose-300 font-semibold">
                    EVENTO
                  </span>
                )}
                {hover.segment.hasMotion && (
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-yellow-500/20 text-yellow-300 font-semibold">
                    MOVIMENTO
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
