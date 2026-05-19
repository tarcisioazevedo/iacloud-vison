/**
 * MobileTimeline — scrubber horizontal de gravações para mobile.
 *
 * Melhorias v2:
 *  - Drag suave: playhead move localmente durante o arraste, onSeek só dispara
 *    no pointerUp → elimina stutter no HLS (seek único, não contínuo).
 *  - Timezone: labels e bubble exibem horário local (UTC offset do browser).
 *  - Legenda compacta.
 */
import { useRef, useCallback, useState } from 'react'
import { cn } from '../../lib/utils'
import { type TimelineEvent, useSpriteManifest } from '../../api/client'

export type TimelineFilter = 'all' | 'motion' | 'continuous'

interface Props {
  bitmap:        string
  motionBitmap?: string
  /** Posição atual em segundos desde meia-noite UTC (vinda do player) */
  currentSec:    number
  totalSec?:     number
  /** Chamado só ao soltar o dedo/mouse — evita seeks contínuos durante arraste */
  onSeek:        (sec: number) => void
  events?:       TimelineEvent[]
  /** Filtro de tipo: 'all' exibe tudo, 'motion' só segmentos com movimento, 'continuous' só contínuos */
  filter?:       TimelineFilter
  className?:    string
  cameraId?:     string | null
  day?:          string | null
}

const DAY_SEC = 86_400
const DAY_MIN = 1_440

// O componente já recebe 'currentSec' e o bitmap como LOCAL TIME (costurados pelo parent).
// O único local que precisa converter de volta para UTC é a busca dos sprites!
const TZ_OFFSET_SEC = -(new Date().getTimezoneOffset() * 60)

function formatHHMM(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}

// Labels do eixo X removidos daqui (agora são dinâmicos)

export function MobileTimeline({
  bitmap, motionBitmap, currentSec, totalSec = DAY_SEC,
  onSeek, events = [], filter = 'all', className = '',
  cameraId, day
}: Props) {
  const barRef     = useRef<HTMLDivElement>(null)
  // Posição durante o arraste (null = não está arrastando)
  const [dragSec, setDragSec] = useState<number | null>(null)

  const secFromX = useCallback((clientX: number): number => {
    const bar = barRef.current
    if (!bar) return 0
    const { left, width } = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - left) / width))
    return Math.round(ratio * totalSec)
  }, [totalSec])

  // Segundo exibido: dragSec durante arraste, currentSec normalmente
  const displaySec = dragSec ?? currentSec
  const playheadPct = (displaySec / totalSec) * 100

  // Build segment blocks respeitando o filtro
  type Block = { start: number; end: number; hasMotion: boolean }
  const blocks: Block[] = []
  let cur: Block | null = null
  for (let m = 0; m < DAY_MIN; m++) {
    const hasRec = (bitmap?.[m] ?? '0') === '1'
    const hasMot = (motionBitmap?.[m] ?? '0') === '1'
    // Aplica filtro: 'motion' só inclui minutos COM motion; 'continuous' só SEM motion
    const passesFilter =
      filter === 'all'        ? hasRec :
      filter === 'motion'     ? (hasRec && hasMot) :
      /* continuous */          (hasRec && !hasMot)
    if (passesFilter) {
      if (!cur) cur = { start: m, end: m + 1, hasMotion: hasMot }
      else { cur.end = m + 1; cur.hasMotion = cur.hasMotion || hasMot }
    } else {
      if (cur) { blocks.push(cur); cur = null }
    }
  }
  if (cur) blocks.push(cur)

  // ── Controle de Zoom ──
  const [zoom, setZoom] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  function getZoomPct(z: number) {
    switch (z) {
      case 1: return 100
      case 2: return 200
      case 3: return 400
      case 4: return 600
      case 5: return 1200
      case 6: return 2400
      default: return 100
    }
  }

  function handleZoom(delta: number) {
    setZoom(z => {
      const newZ = Math.max(1, Math.min(6, z + delta))
      // Manter o playhead visível ao dar zoom
      if (containerRef.current && newZ !== z) {
        const cw = containerRef.current.clientWidth
        const newWidth = cw * (getZoomPct(newZ) / 100)
        const scroll = (playheadPct / 100) * newWidth - (cw / 2)
        setTimeout(() => {
          containerRef.current?.scrollTo({ left: Math.max(0, scroll), behavior: 'smooth' })
        }, 10)
      }
      return newZ
    })
  }

  // ── Labels Dinâmicos ──
  // A largura do container agora cresce de forma não-linear para comportar mais labels:
  // Zoom 5 = 1200% de largura (comporta labels de 15 min tranquilamente)
  // Zoom 6 = 2400% de largura (comporta labels de 5 min sem overlap)
  let stepSecs = 10800 // 3 hours (Zoom 1)
  if (zoom === 6) stepSecs = 300 // 5 mins
  else if (zoom === 5) stepSecs = 900 // 15 mins (usando 15 mins em vez de 16 para alinhamento redondo do relógio)
  else if (zoom === 4) stepSecs = 1800 // 30 mins
  else if (zoom === 3) stepSecs = 3600 // 1 hour
  else if (zoom === 2) stepSecs = 7200 // 2 hours
  
  const LABEL_SECS = Array.from({ length: Math.floor(DAY_SEC / stepSecs) + 1 }, (_, i) => i * stepSecs)

  // ── Scrubbing Preview ──
  const { data: spriteManifest } = useSpriteManifest(cameraId ?? null, day ?? null)

  function getSpriteStyle(sec: number): React.CSSProperties | undefined {
    if (!spriteManifest || dragSec === null) return undefined
    // O Sprite API usa UTC absoluto! Precisamos reverter o 'sec' (que é local) para UTC
    const utcSec = ((sec - TZ_OFFSET_SEC) % DAY_SEC + DAY_SEC) % DAY_SEC
    const utcHour = Math.floor(utcSec / 3600) % 24
    const sh = spriteManifest.hours.find(h => h.hour === utcHour)
    if (!sh || sh.frameCount === 0) return undefined

    const frameIdx = Math.floor((utcSec % 3600) / sh.frameInterval)
    if (frameIdx >= sh.frameCount) return undefined

    const col = frameIdx % sh.cols
    const row = Math.floor(frameIdx / sh.cols)
    const W = 120
    const ratio = W / sh.frameWidth

    return {
      backgroundImage: `url(${sh.url})`,
      backgroundPosition: `-${col * sh.frameWidth * ratio}px -${row * sh.frameHeight * ratio}px`,
      backgroundSize: `${sh.cols * sh.frameWidth * ratio}px ${sh.rows * sh.frameHeight * ratio}px`,
      width: `${W}px`,
      height: `${sh.frameHeight * ratio}px`,
    }
  }

  return (
    <div className={cn('select-none flex flex-col w-full min-w-0 overflow-hidden', className)}>
      {/* Controles de Zoom e Legenda */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3 px-1 font-medium">
          <span className="flex items-center gap-1 text-[9px] text-slate-600 dark:text-slate-400">
            <span className="w-2 h-2 rounded-sm bg-emerald-500/60 inline-block shadow-sm" />Gravação
          </span>
          <span className="flex items-center gap-1 text-[9px] text-slate-600 dark:text-slate-400">
            <span className="w-2 h-2 rounded-sm bg-amber-500/70 inline-block shadow-sm" />Movimento
          </span>
          <span className="flex items-center gap-1 text-[9px] text-slate-600 dark:text-slate-400">
            <span className="w-2 h-2 rounded-full bg-violet-400 inline-block shadow-sm" />IA
          </span>
        </div>
        
        <div className="flex items-center gap-1">
          <button onClick={() => handleZoom(-1)} disabled={zoom <= 1} className="p-1 rounded bg-slate-200 dark:bg-slate-800 disabled:opacity-30">
            <span className="text-[10px] font-bold px-1 text-slate-600 dark:text-slate-400">-</span>
          </button>
          <span className="text-[9px] font-mono text-slate-500">{zoom}x</span>
          <button onClick={() => handleZoom(1)} disabled={zoom >= 6} className="p-1 rounded bg-slate-200 dark:bg-slate-800 disabled:opacity-30">
            <span className="text-[10px] font-bold px-1 text-slate-600 dark:text-slate-400">+</span>
          </button>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="overflow-x-auto scrollbar-hide w-full"
      >
        <div style={{ width: `${getZoomPct(zoom)}%` }} className="relative py-4">
          
          {/* Labels de horário (horário local) */}
          <div className="flex justify-between px-1 mb-1 absolute top-0 w-full pointer-events-none">
            {LABEL_SECS.map(s => (
              <span key={s} className="text-[9px] font-medium text-slate-500 dark:text-slate-400" style={{ position: 'absolute', left: `${(s / DAY_SEC) * 100}%`, transform: 'translateX(-50%)' }}>
                {formatHHMM(s)}
              </span>
            ))}
          </div>

          {/* Barra do timeline */}
          <div
            ref={barRef}
            className="relative h-8 rounded-lg bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 shadow-inner overflow-visible cursor-pointer touch-none mt-1"
            onPointerDown={e => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              const s = secFromX(e.clientX)
              setDragSec(s)
            }}
            onPointerMove={e => {
              if (e.buttons !== 1) return
              setDragSec(secFromX(e.clientX))
            }}
            onPointerUp={e => {
              const s = secFromX(e.clientX)
              setDragSec(null)
              onSeek(s)
            }}
            onPointerCancel={() => setDragSec(null)}
          >
            {/* Interior arredondado separado para overflow:hidden não cortar o bubble */}
            <div className="absolute inset-0 rounded-lg overflow-hidden">
              {/* Segmentos de gravação */}
              {blocks.map((b, i) => (
                <div
                  key={i}
                  className={cn(
                    'absolute top-0 h-full',
                    b.hasMotion ? 'bg-amber-500/70' : 'bg-emerald-500/60',
                  )}
                  style={{
                    left:  `${(b.start / DAY_MIN) * 100}%`,
                    width: `${((b.end - b.start) / DAY_MIN) * 100}%`,
                  }}
                />
              ))}

              {/* Pontos de eventos IA */}
              {events.map((ev, i) => {
                const d = new Date(ev.at)
                // O timeline representa o dia LOCAL (0 a 86400).
                // A data nativamente processa a string UTC e ajusta para as horas locais do browser.
                const sec = d.getHours()*3600 + d.getMinutes()*60 + d.getSeconds()
                return (
                  <div
                    key={i}
                    className="absolute top-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 -translate-x-0.5"
                    style={{ left: `${(sec / totalSec) * 100}%` }}
                    title={ev.type}
                  />
                )
              })}
            </div>

            {/* Playhead — fora do overflow:hidden para o bubble aparecer acima */}
            <div
              className="absolute top-0 h-full w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)] z-10 pointer-events-none"
              style={{ left: `${playheadPct}%` }}
            >
              {/* Scrubbing Preview (Thumbnail + Bubble) */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col items-center gap-1">
                {dragSec !== null && spriteManifest && (
                  <div 
                    className="rounded-lg shadow-lg overflow-hidden bg-slate-900 border border-slate-700/50"
                    style={getSpriteStyle(displaySec)}
                  />
                )}
                
                {/* Bubble com horário local */}
                <div className={cn(
                  'px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap shadow-sm',
                  dragSec !== null
                    ? 'bg-cyan-400 text-slate-950 scale-110'
                    : 'bg-cyan-500 text-slate-950',
                )}>
                  {formatHHMM(displaySec)}
                </div>
              </div>
              {/* Triângulo */}
              <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
