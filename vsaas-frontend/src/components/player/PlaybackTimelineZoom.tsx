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
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { cn } from '../../lib/utils'

interface TimelineEvent {
  /** ISO UTC */
  at:       string
  type:     string
  severity: string
  label?:   string | null
}

interface TimelineBookmark {
  at:    string
  endAt: string | null
  color: string
  title: string
}

/**
 * Buraco de gravação > 5 min — renderizado como faixa hachurada rose
 * sobre a track pra alertar o operador "aqui não tem footage".
 */
export interface TimelineGap {
  /** ms desde epoch — início do gap. */
  startMs: number
  endMs:   number
  durSec:  number
}

/**
 * Sprite-sheet de uma hora — usado pra preview no hover (padrão YouTube).
 * Cada `url` aponta pra 1 JPG com grid `cols × rows` de frames `frameWidth × frameHeight`.
 * Frame N cobre o intervalo [firstFrameAt + N*frameInterval, +1*frameInterval).
 */
export interface SpriteHour {
  hour:          number
  url:           string
  frameInterval: number
  cols:          number
  rows:          number
  frameWidth:    number
  frameHeight:   number
  frameCount:    number
  firstFrameAt:  string
  sizeBytes:     number
}

interface Props {
  /** Bitmap 1440 chars '0'|'1' por minuto (gravação contínua/cobertura). */
  bitmap?: string
  /** Bitmap 1440 — minuto tem ao menos 1 segment com hasMotion=true. */
  motionBitmap?: string
  /** Array 1440 — # de segments cobrindo cada minuto (heatmap por intensidade). */
  intensity?: number[]
  /** Eventos AnalyticsEvent do dia — desenhados como dots na faixa "Eventos". */
  events?: TimelineEvent[]
  /** Bookmarks do dia — desenhados como estrelas/ranges na faixa "Bookmarks". */
  bookmarks?: TimelineBookmark[]
  /**
   * Posição atual do playhead, em segundos desde 00:00 UTC do dia.
   * `null` ou `undefined` = posição desconhecida (player ainda não emitiu
   * timeupdate) → cursor não é renderizado.
   */
  currentSecOfDay?: number | null
  /** Callback ao clicar/seekar — segundos desde 00:00 do dia. */
  onSeek?: (secOfDay: number) => void
  /** Day base ISO (YYYY-MM-DD) — usado opcionalmente em onSeekIso. */
  dayUtcDate?: string
  /** Variante: callback com ISO 8601 absoluto (útil para multi-câmera). */
  onSeekIso?: (iso: string) => void
  /**
   * Callback ao tentar criar bookmark no instante (right-click na timeline).
   * Recebe segundos do dia. RecordingsPage abre modal pra título/cor.
   */
  onCreateBookmark?: (secOfDay: number) => void
  className?: string
  /** Altura da track principal (cobertura). Default 56px. */
  trackHeight?: number
  /**
   * Modo compacto: esconde header (zoom badge + range) e mini-mapa, deixando
   * apenas o track. Útil pra embedar dentro de tiles do mosaico onde espaço
   * é restrito. Hover tooltip e click-to-seek continuam funcionando.
   */
  compact?: boolean
  /**
   * Sprite-sheets por hora pra preview no hover. Quando ausente, hover só
   * mostra a linha-guia + relógio (modo legacy). Quando presente, mostra
   * miniatura do frame correspondente acima da linha-guia.
   */
  spriteHours?: SpriteHour[]
  /**
   * Buracos > 5min sem gravação. Renderizados como faixa hachurada rose
   * sobre a track pra avisar "tela preta se clicar aqui".
   */
  gaps?: TimelineGap[]
}

type TrackKey = 'recording' | 'motion' | 'events' | 'bookmarks'
const TRACKS_KEY = 'icv:timeline:tracks'
function loadTracks(): Record<TrackKey, boolean> {
  try {
    const v = localStorage.getItem(TRACKS_KEY)
    if (v) {
      const o = JSON.parse(v)
      return {
        recording: o.recording !== false,
        motion:    o.motion    !== false,
        events:    o.events    !== false,
        bookmarks: o.bookmarks !== false,
      }
    }
  } catch {}
  return { recording: true, motion: true, events: true, bookmarks: true }
}
function saveTracks(t: Record<TrackKey, boolean>): void {
  try { localStorage.setItem(TRACKS_KEY, JSON.stringify(t)) } catch {}
}

const DAY_SECONDS  = 24 * 60 * 60   // 86400
const DAY_MINUTES  = 24 * 60        // 1440
const ZOOM_MIN     = 1              // dia inteiro
const ZOOM_MAX     = DAY_MINUTES    // 1 minuto fullscreen
const DRAG_THRESH  = 4              // px — abaixo disso é click
// Raio em px pra detectar mouseDown no handle do playhead. Aumentado pra
// 24px (≈3x o tamanho visual do handle) — mais "perdoante" com mouse não preciso.
const PLAYHEAD_HIT_PX = 24

/**
 * Converte secOfDay (UTC) para HH:MM[:SS] em horário de Brasília (UTC-3).
 * Operadores BR — sempre BRT, sem toggle.
 */
function fmtTime(secOfDay: number, withSec = false): string {
  let s = secOfDay - 3 * 3600  // BRT = UTC-3 (sem horário de verão)
  s = ((s % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return withSec ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(h)}:${pad(m)}`
}

export function PlaybackTimelineZoom({
  bitmap, motionBitmap, intensity, events, bookmarks,
  currentSecOfDay, onSeek, onSeekIso, onCreateBookmark,
  dayUtcDate, className, trackHeight = 56, compact = false,
  spriteHours, gaps,
}: Props) {
  // Index de sprite por hora pra lookup O(1) durante hover (60Hz).
  const spriteByHour = useMemo(() => {
    const m: Record<number, SpriteHour> = {}
    for (const s of spriteHours ?? []) m[s.hour] = s
    return m
  }, [spriteHours])

  // Pre-load <img> dos sprites do dia. CSS `background-image` numa <div>
  // não dispara prefetch antes do hover — sem isso, o primeiro hover de
  // cada hora pisca em branco esperando o JPG baixar. Isso garante que
  // mover o mouse pela timeline já mostra o frame imediatamente.
  useEffect(() => {
    if (!spriteHours?.length) return
    const imgs: HTMLImageElement[] = []
    for (const s of spriteHours) {
      const img = new Image()
      img.src = s.url
      imgs.push(img)
    }
    return () => { imgs.forEach(i => { i.src = '' }) }
  }, [spriteHours])

  // Toggles de visibilidade por faixa (persistidos em localStorage)
  const [tracksOn, setTracksOn] = useState<Record<TrackKey, boolean>>(loadTracks())
  function toggleTrack(k: TrackKey) {
    const next = { ...tracksOn, [k]: !tracksOn[k] }
    setTracksOn(next); saveTracks(next)
  }
  const trackRef = useRef<HTMLDivElement>(null)

  // Viewport: faixa de segundos visíveis. Inicia mostrando o dia inteiro.
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd,   setViewEnd]   = useState(DAY_SECONDS)

  // Estado de drag. mode='pan' (drag livre) ou 'scrub' (arrastando o playhead).
  // 'pan' calcula deltaX→panSec; 'scrub' chama onSeek com debounce.
  const dragRef = useRef<{
    mode: 'pan' | 'scrub'
    startX: number; startView: number; deltaX: number; pxPerSec: number
  } | null>(null)
  const [hoverSec, setHoverSec] = useState<number | null>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  // scrubSec — posição local do cursor DURANTE o drag, desacoplada do vídeo.
  // Por que separar de currentSecOfDay? Quando o usuário arrasta rápido,
  // emitSeek dispara HLS seek (50-200ms async). Se o playhead esperar o
  // currentSecOfDay (que vem do video.currentTime via timeupdate), ele lagga
  // dezenas de frames atrás do mouse — sensação de "cursor difícil de mover".
  // Solução: durante scrub, cursor segue o mouse INSTANTANEAMENTE via scrubSec
  // (1 setState por rAF); emitSeek roda throttled (~30Hz) em paralelo. Mouseup
  // limpa scrubSec → cursor volta a refletir currentSecOfDay (vídeo).
  const [scrubSec, setScrubSec] = useState<number | null>(null)

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

  // Helper: calcula posição em px do playhead na track atual (ou null se fora).
  function playheadPx(): number | null {
    if (currentSecOfDay == null) return null
    if (currentSecOfDay < viewStart || currentSecOfDay > viewEnd) return null
    const el = trackRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return rect.left + ((currentSecOfDay - viewStart) / viewRange) * rect.width
  }

  // Helper: emite seek (sec arredondado) chamando onSeek + onSeekIso.
  function emitSeek(sec: number): void {
    const floored = Math.max(0, Math.min(DAY_SECONDS - 1, Math.floor(sec)))
    onSeek?.(floored)
    if (onSeekIso && dayUtcDate) {
      const ms = new Date(`${dayUtcDate}T00:00:00.000Z`).getTime() + floored * 1000
      onSeekIso(new Date(ms).toISOString())
    }
  }

  // ── Interaction model SIMPLIFICADO (paradigma de player de vídeo) ─────
  //
  // Filosofia: como YouTube/Twitch — qualquer mouseDown/drag no track
  // SEMPRE move o cursor (scrub). Sem "modos" implícitos, sem threshold.
  // Resultado: clique em qualquer pixel → cursor pula. Drag → cursor segue.
  // Tremor de mão não importa, não há conflito click vs pan.
  //
  // Pan do viewport: agora é gesto EXPLÍCITO via SHIFT+drag (ou shift+wheel
  // que já existia). Operador que precisar pan sabe usar shift.
  //
  // Wheel (sem shift) = zoom (mantém)
  // Double-click = reset zoom (mantém)
  // Setas = step de tempo (mantém)

  // Refs estáveis pra emitSeek e xToSec — usadas pelos listeners globais
  // INLINE registrados no mouseDown. Solução pra evitar stale-closures
  // que useCallback não resolveu (ref garante sempre versão atual).
  const emitSeekRef = useRef(emitSeek)
  const xToSecRef   = useRef(xToSec)
  emitSeekRef.current = emitSeek
  xToSecRef.current   = xToSec

  // ── Hover guide: tracking do mouse via document mousemove + rAF ─────
  //
  // Listener global pega QUALQUER movimento sobre a área da timeline,
  // independente de overlays (dots, bookmarks, playhead handle). Coalesce
  // com requestAnimationFrame pra não fazer setState 60Hz (custaria render
  // a cada move). Entry/exit detectados via bounding box.
  useEffect(() => {
    let rafId: number | null = null
    let lastClientX = 0
    let lastInside = false

    function tick() {
      rafId = null
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const inside =
        lastClientX >= rect.left && lastClientX <= rect.right
      if (inside) {
        setHoverSec(xToSecRef.current(lastClientX))
        lastInside = true
      } else if (lastInside) {
        setHoverSec(null)
        lastInside = false
      }
    }

    function handler(e: MouseEvent) {
      lastClientX = e.clientX
      // Quick check pra evitar agendar rAF se o mouse está claramente fora
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      // Rejeita rapidamente se mouse está fora vertical (acima/abaixo da timeline)
      if (e.clientY < rect.top - 20 || e.clientY > rect.bottom + 20) {
        if (lastInside) {
          if (rafId != null) { cancelAnimationFrame(rafId); rafId = null }
          setHoverSec(null)
          lastInside = false
        }
        return
      }
      if (rafId != null) return
      rafId = requestAnimationFrame(tick)
    }

    document.addEventListener('mousemove', handler)
    return () => {
      document.removeEventListener('mousemove', handler)
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const el = trackRef.current; if (!el) return
    const rect = el.getBoundingClientRect()

    // Shift+drag = pan do viewport (gesto explícito).
    if (e.shiftKey) {
      dragRef.current = {
        mode:      'pan',
        startX:    e.clientX,
        startView: viewStart,
        deltaX:    0,
        pxPerSec:  rect.width / viewRange,
      }
      e.preventDefault()
      return
    }

    // Default: scrub do cursor SEMPRE — paradigma player de vídeo.
    dragRef.current = {
      mode:      'scrub',
      startX:    e.clientX,
      startView: viewStart,
      deltaX:    0,
      pxPerSec:  rect.width / viewRange,
    }
    setIsScrubbing(true)

    // 1. Posição inicial (com snap se perto de evento/bookmark).
    const initialSec = hoverInfo?.snappedSec ?? xToSec(e.clientX)
    setScrubSec(initialSec)   // cursor visual pula imediatamente
    emitSeek(initialSec)      // vídeo começa a buscar (async)

    // 2. INLINE handlers no document. Estratégia desacoplada:
    //    - setScrubSec a cada rAF (60Hz) → cursor segue mouse INSTANTANEAMENTE
    //    - emitSeek throttled a ~30Hz (a cada 33ms) → não satura HLS
    //    - mouseup: emitSeek final + libera scrubSec
    let rafId: number | null = null
    let lastX = e.clientX
    let lastEmit = performance.now()

    const onMove = (ev: MouseEvent) => {
      lastX = ev.clientX
      if (rafId != null) return  // já tem frame agendado
      rafId = requestAnimationFrame(() => {
        rafId = null
        const sec = xToSecRef.current(lastX)
        setScrubSec(sec)  // visual: cursor cola no mouse, sem roundtrip
        // Throttle emitSeek: HLS aguenta ~30 seeks/sec sem stutter.
        const now = performance.now()
        if (now - lastEmit >= 33) {
          lastEmit = now
          emitSeekRef.current(sec)
        }
      })
    }
    const onUp = (ev: MouseEvent) => {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null }
      // Seek final preciso (não throttled) — onde o usuário soltou.
      const finalSec = xToSecRef.current(ev.clientX)
      emitSeekRef.current(finalSec)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
      dragRef.current = null
      setIsScrubbing(false)
      // Mantém scrubSec por 1 frame até currentSecOfDay alcançar — evita
      // "snap back" visual se HLS demorar a confirmar. Limpamos após 200ms.
      setTimeout(() => setScrubSec(null), 200)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    e.preventDefault()
  }

  // Durante scrub, força cursor "grabbing" no body inteiro — feedback
  // visual continua mesmo se mouse sair do track.
  useEffect(() => {
    if (!isScrubbing) return
    const prev = document.body.style.cursor
    document.body.style.cursor = 'grabbing'
    return () => { document.body.style.cursor = prev }
  }, [isScrubbing])

  // Largura real da track via ResizeObserver — usada pra calcular densidade
  // de ticks (quantos labels cabem com legibilidade). Sem isso, o step
  // ficaria fixo em 3h pra dia inteiro mesmo em telas wide; com ele,
  // ajusta automaticamente entre 1h (telas comuns) e 30min (4K).
  const [trackPx, setTrackPx] = useState(1500)
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width
      if (w && w > 100) setTrackPx(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // onMouseMove local trata APENAS o PAN. Hover é responsabilidade do
  // listener global (document mousemove + rAF) — chamar setHoverSec aqui
  // duplicaria render cada move (60+Hz vs 60Hz com rAF).
  const onMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current
    if (drag?.mode !== 'pan') return  // não-pan: hover é com listener global

    // PAN do viewport (shift+drag)
    drag.deltaX = e.clientX - drag.startX
    if (Math.abs(drag.deltaX) < DRAG_THRESH) return
    const panSec = -drag.deltaX / drag.pxPerSec
    let newStart = drag.startView + panSec
    if (newStart < 0) newStart = 0
    if (newStart + viewRange > DAY_SECONDS) newStart = DAY_SECONDS - viewRange
    setViewStart(newStart); setViewEnd(newStart + viewRange)
  }

  // onMouseUp local trata apenas pan (cleanup). Scrub é tratado por global handler.
  const onMouseUp = (_e: React.MouseEvent) => {
    if (dragRef.current?.mode === 'pan') {
      dragRef.current = null
    }
  }
  const onMouseLeave = () => {
    setHoverSec(null)
    // Pan local é cancelado se mouse sai do track sem mouseUp.
    // Scrub continua via window listeners.
    if (dragRef.current?.mode === 'pan') dragRef.current = null
  }

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

  // ── Marcas de tempo: cadência adaptativa por zoom + largura real ──────
  // Algoritmo: cada label de hora tem ~58px (cabe "00:00" sem cortar).
  // Calcula quantos ticks cabem com legibilidade na largura atual e
  // escolhe o step "nice" que mais se aproxima.
  // Resultado: dia inteiro em tela 1500px → step = 1h (era 3h, denso demais).
  const ticks = useMemo(() => {
    const targetTickPx = 75  // espaço mínimo entre labels pra leitura confortável
    const maxTicks = Math.max(6, Math.floor(trackPx / targetTickPx))
    const idealStep = viewRange / maxTicks
    // Steps "bonitos" em segundos. Ordenado.
    const NICE = [
      1, 2, 5, 10, 15, 30,                     // 1s, 2s, 5s, 10s, 15s, 30s (zoom muito alto)
      60, 120, 300, 600, 900, 1800,            // 1m, 2m, 5m, 10m, 15m, 30m
      3600, 2 * 3600, 3 * 3600, 6 * 3600, 12 * 3600,  // 1h, 2h, 3h, 6h, 12h
    ]
    const step = NICE.find(n => n >= idealStep) ?? NICE[NICE.length - 1]
    const first = Math.ceil(viewStart / step) * step
    const out: number[] = []
    for (let t = first; t <= viewEnd; t += step) out.push(t)

    // Minor ticks: 1/5 do step do major, sem label. Só renderiza se
    // espaçamento >= 8px (senão fica linha colada em linha, ilegível).
    const minorStep = step / 5
    const minorPxSpacing = (minorStep / viewRange) * trackPx
    const minorTicks: number[] = []
    if (minorPxSpacing >= 8) {
      const fm = Math.ceil(viewStart / minorStep) * minorStep
      for (let t = fm; t <= viewEnd; t += minorStep) {
        // Não duplica majors
        if (Math.abs(t % step) > 0.5 && Math.abs((t % step) - step) > 0.5) {
          minorTicks.push(t)
        }
      }
    }
    return { step, ticks: out, minorTicks }
  }, [viewStart, viewEnd, viewRange, trackPx])

  // Delega pro helper top-level (sempre BRT — operador brasileiro).
  function fmtSec(sec: number, withSec = false): string {
    return fmtTime(sec, withSec)
  }

  // ── Hover info enriquecido — usado pelo tooltip premium ───────────────
  //
  // Pra cada posição do mouse na timeline, calcula:
  //   - hasRecording: se o minuto correspondente tem '1' no bitmap
  //   - nearestEvent: evento mais próximo dentro de ±SNAP_PX (em segundos)
  //   - nearestBookmark: bookmark mais próximo dentro de ±SNAP_PX
  //   - offsetFromPlayhead: distância (segundos) do cursor até o playhead
  //
  // SNAP magnético: se cursor está perto de um evento/bookmark, "puxa" o
  // hoverSec pra coincidir com o timestamp exato — click vira seek-to-event.
  const SNAP_PX = 6  // raio em px pra snap magnético

  const hoverInfo = useMemo(() => {
    if (hoverSec == null) return null

    // Tem gravação naquele minuto?
    const minute = Math.floor(hoverSec / 60)
    const hasRecording = !!(bitmap && bitmap[minute] === '1')

    // Distância em segundos equivalente a SNAP_PX no zoom atual
    const snapSec = (SNAP_PX / 100) * viewRange  // estimativa baseada em viewRange

    // Evento mais próximo (dentro de ±snapSec)
    let nearestEvent: { sec: number; ev: TimelineEvent } | null = null
    if (events && dayUtcDate) {
      const dayStartMs = new Date(`${dayUtcDate}T00:00:00.000Z`).getTime()
      let bestDist = snapSec
      for (const ev of events) {
        const sec = (new Date(ev.at).getTime() - dayStartMs) / 1000
        const d = Math.abs(sec - hoverSec)
        if (d < bestDist) { bestDist = d; nearestEvent = { sec, ev } }
      }
    }

    // Bookmark mais próximo (dentro de ±snapSec)
    let nearestBookmark: { sec: number; bm: TimelineBookmark } | null = null
    if (bookmarks && dayUtcDate) {
      const dayStartMs = new Date(`${dayUtcDate}T00:00:00.000Z`).getTime()
      let bestDist = snapSec
      for (const bm of bookmarks) {
        const sec = (new Date(bm.at).getTime() - dayStartMs) / 1000
        const d = Math.abs(sec - hoverSec)
        if (d < bestDist) { bestDist = d; nearestBookmark = { sec, bm } }
      }
    }

    // Snap: se há evento ou bookmark perto, snap pra ele
    const snappedSec =
      nearestEvent     != null ? nearestEvent.sec
    : nearestBookmark  != null ? nearestBookmark.sec
    : hoverSec

    // Offset do playhead atual (sinal indica "à frente" ou "atrás")
    const offsetSec = currentSecOfDay != null ? snappedSec - currentSecOfDay : null

    return { snappedSec, hasRecording, nearestEvent, nearestBookmark, offsetSec }
  }, [hoverSec, bitmap, events, bookmarks, dayUtcDate, viewRange, currentSecOfDay])

  /** Formata offset relativo (`+2m 14s`, `−1h 5m`, `agora`). */
  function fmtOffset(sec: number): string {
    if (Math.abs(sec) < 1) return 'agora'
    const sign = sec >= 0 ? '+' : '−'
    const abs = Math.abs(sec)
    if (abs < 60)    return `${sign}${Math.round(abs)}s`
    if (abs < 3600)  return `${sign}${Math.floor(abs / 60)}m ${Math.round(abs % 60)}s`
    return `${sign}${Math.floor(abs / 3600)}h ${Math.floor((abs % 3600) / 60)}m`
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

  // Fix D — Auto-pan ao primeiro range na 1ª vez que o bitmap chega.
  //
  // Cenário: operador abre /recordings → viewport default = dia inteiro
  // (00:00→23:59 UTC = 21:00 dia anterior → 20:59 BRT). Mas a câmera só
  // gravou das 18:00 às 23:59 UTC (15:00→20:59 BRT). Sem auto-pan, a
  // faixa cyan aparece colada no canto direito — operador precisa fazer
  // zoom+pan manualmente pra centralizar.
  //
  // Estratégia: quando recebe bitmap NÃO-VAZIO pela primeira vez E o
  // viewport ainda é o default (dia inteiro), pula pra cobrir o range
  // gravado com 10% de "respiro" nas pontas.
  const didAutoPanRef = useRef(false)
  useEffect(() => {
    if (didAutoPanRef.current) return
    if (!bitmap || bitmap.length !== 1440) return
    // Acha primeiro e último minuto com gravação
    let firstMin = -1, lastMin = -1
    for (let m = 0; m < 1440; m++) {
      if (bitmap[m] === '1') { if (firstMin < 0) firstMin = m; lastMin = m }
    }
    if (firstMin < 0) return  // nenhuma gravação no dia, mantém viewport
    // Só auto-pan se viewport ainda é o default (dia inteiro)
    if (viewStart !== 0 || viewEnd !== DAY_SECONDS) {
      didAutoPanRef.current = true
      return
    }
    const startSec = firstMin * 60
    const endSec   = (lastMin + 1) * 60
    const span     = endSec - startSec
    const padding  = Math.max(span * 0.1, 300)  // 10% ou 5min, o que for maior
    const ns = Math.max(0, startSec - padding)
    const ne = Math.min(DAY_SECONDS, endSec + padding)
    if (ne - ns < 600) return  // span muito curto (<10min), mantém zoom-out
    setViewStart(ns); setViewEnd(ne)
    didAutoPanRef.current = true
  }, [bitmap]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset do flag de auto-pan quando bitmap muda de "vazio" pra "preenchido"
  // (ex: usuário troca de dia). Evita sticking em viewport antigo.
  useEffect(() => {
    if (!bitmap || bitmap.length !== 1440 || bitmap.indexOf('1') < 0) {
      didAutoPanRef.current = false
    }
  }, [bitmap])

  // Posição efetiva do playhead: scrubSec (instantânea, durante drag) tem
  // precedência sobre currentSecOfDay (do vídeo, lagga sem isso).
  const displaySec = scrubSec != null ? scrubSec : currentSecOfDay
  const playheadPct = displaySec != null && displaySec >= viewStart && displaySec <= viewEnd
    ? secToPct(displaySec)
    : null
  const showSecondsInTooltip = ticks.step <= 60

  // ── Memoização de faixas pesadas ────────────────────────────────────────
  // Estes JSX subtrees rodavam loops 1440× a cada hover/scrub re-render.
  // Memoizamos pra só recomputar quando dados/viewport mudam — hover passa
  // a custar quase nada (só re-render do badge HH:MM:SS + linha-guia).
  const intensityHeatmap = useMemo(() => {
    if (!tracksOn.recording || !intensity || intensity.length !== 1440) return null
    const peak = Math.max(6, ...intensity)
    const out: React.ReactNode[] = []
    let runStart = -1
    let runVal   = -1
    for (let m = 0; m <= 1440; m++) {
      const v = m < 1440 ? intensity[m] : -2
      if (v !== runVal) {
        if (runStart >= 0 && runVal > 0) {
          const startSec = runStart * 60
          const endSec   = m * 60
          if (endSec >= viewStart && startSec <= viewEnd) {
            const left  = ((Math.max(startSec, viewStart) - viewStart) / viewRange) * 100
            const right = ((Math.min(endSec,   viewEnd)   - viewStart) / viewRange) * 100
            // Opacidade balanceada: visível sobre fundo escuro do overlay
            // (slate-900) mas não satura quando há muitos segments. Min 0.30
            // garante contraste sobre o background.
            const opacity = Math.min(0.75, 0.30 + (runVal / peak) * 0.45)
            out.push(
              <div
                key={`r-${runStart}`}
                className="absolute pointer-events-none"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(right - left, 0.1)}%`,
                  top: '15%', bottom: '15%',
                  background: `rgb(34 211 238 / ${opacity})`,
                }}
              />,
            )
          }
        }
        runStart = m; runVal = v
      }
    }
    return out
  }, [tracksOn.recording, intensity, viewStart, viewEnd, viewRange])

  const motionRanges = useMemo(() => {
    if (!tracksOn.motion || !motionBitmap || motionBitmap.length !== 1440) return null
    const out: React.ReactNode[] = []
    let runStart = -1
    for (let m = 0; m <= 1440; m++) {
      const isM = m < 1440 && motionBitmap[m] === '1'
      if (isM && runStart < 0) runStart = m
      else if (!isM && runStart >= 0) {
        const startSec = runStart * 60
        const endSec   = m * 60
        if (endSec >= viewStart && startSec <= viewEnd) {
          const left  = ((Math.max(startSec, viewStart) - viewStart) / viewRange) * 100
          const right = ((Math.min(endSec,   viewEnd)   - viewStart) / viewRange) * 100
          out.push(
            <div
              key={`m-${runStart}`}
              className="absolute pointer-events-none bg-amber-400/70"
              style={{
                left: `${left}%`,
                width: `${Math.max(right - left, 0.1)}%`,
                top: '4%', height: '8%',
              }}
              title="Movimento"
            />,
          )
        }
        runStart = -1
      }
    }
    return out
  }, [tracksOn.motion, motionBitmap, viewStart, viewEnd, viewRange])

  const fallbackRanges = useMemo(() => {
    if (!tracksOn.recording || intensity) return null
    return ranges.map((r, i) => {
      const left  = ((Math.max(r.start, viewStart) - viewStart) / viewRange) * 100
      const right = ((Math.min(r.end,   viewEnd)   - viewStart) / viewRange) * 100
      return (
        <div
          key={`r-${i}`}
          className="absolute pointer-events-none bg-cyan-500/20"
          style={{
            left: `${left}%`,
            width: `${Math.max(right - left, 0.1)}%`,
            top: '15%', bottom: '15%',
          }}
        />
      )
    })
  }, [tracksOn.recording, intensity, ranges, viewStart, viewEnd, viewRange])

  return (
    <div className={cn('relative select-none', className)}>
      {/* Header com indicador de zoom + janela visível — escondido em compact */}
      {!compact && (
      <div className="flex items-center justify-between mb-1.5 text-[10px] text-slate-500 font-mono">
        <span className="flex items-center gap-2">
          <span className="text-slate-400">{fmtSec(viewStart, showSecondsInTooltip)}</span>
          <span className="opacity-50">→</span>
          <span className="text-slate-400">{fmtSec(viewEnd, showSecondsInTooltip)}</span>
          {/* Wall-clock "live" do playhead (BRT) — só aparece quando há posição */}
          {currentSecOfDay != null && (
            <span className="ml-2 text-amber-300 tabular-nums">
              ⏱ {fmtSec(currentSecOfDay, true)}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {/* Toggles de faixas — cada um com cor da faixa */}
          {([
            { k: 'recording' as const, label: 'Cobertura', color: 'cyan' },
            { k: 'motion'    as const, label: 'Motion',    color: 'amber' },
            { k: 'events'    as const, label: 'Eventos',   color: 'sky' },
            { k: 'bookmarks' as const, label: 'Bookmarks', color: 'amber' },
          ]).map(t => (
            <button
              key={t.k}
              type="button"
              onClick={() => toggleTrack(t.k)}
              className={cn(
                'px-1.5 py-0.5 rounded border font-semibold transition',
                tracksOn[t.k]
                  ? t.color === 'cyan'
                    ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300'
                    : t.color === 'sky'
                      ? 'bg-sky-500/15 border-sky-400/40 text-sky-300'
                      : 'bg-amber-500/15 border-amber-400/40 text-amber-300'
                  : 'bg-white/[0.03] border-white/10 text-slate-500 line-through',
              )}
              title={`${tracksOn[t.k] ? 'Esconder' : 'Mostrar'} faixa ${t.label}`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-2 text-cyan-300">{zoom.toFixed(zoom < 10 ? 1 : 0)}×</span>
          <span className="mx-1 opacity-30">·</span>
          <span className="opacity-70">click/drag = ir · scroll = zoom · shift+drag = pan · 2-click = reset · btn direito = bookmark</span>
        </span>
      </div>
      )}

      {/* Header de contexto temporal (estilo Sharpview/VMS pro). Mostra
          mês + ano da gravação visível, alinhado à esquerda em fonte
          discreta. No nosso caso o range é sempre 1 dia, então sempre
          1 mês — aparece como "MAI 2026" + dia da semana.
          Renderiza em qualquer modo (incluindo compact) pra dar contexto
          mesmo no overlay do player. */}
      {dayUtcDate && (() => {
        const d = new Date(`${dayUtcDate}T12:00:00.000Z`)  // 12h evita drift
        const monthName = d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase().replace('.', '')
        const dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
        const dayNum = d.getUTCDate()
        return (
          <div className="flex items-baseline justify-end gap-2 mb-1 px-1 text-white/60 select-none">
            <span className="text-[11px] font-bold tracking-wider">{monthName}</span>
            <span className="text-[10px] opacity-70">·</span>
            <span className="text-[10px] uppercase tabular-nums">{dayName}, {String(dayNum).padStart(2,'0')}</span>
          </div>
        )
      })()}

      {/* Track */}
      <div
        ref={trackRef}
        tabIndex={0}
        className={cn(
          // Background sólido escuro garante contraste das linhas/labels
          // quando timeline está em overlay sobre vídeo (céu noturno, parede
          // clara, etc). Slate-900/85 dá visual definido sem ficar opaco demais.
          'relative w-full bg-slate-900/85 border border-white/15 rounded-md focus:outline-none focus:ring-1 focus:ring-cyan-500/40',
          // Cursor adaptativo: 'cell' (mira de seleção) sobre área com gravação,
          // 'pointer' sobre área vazia. Visualmente comunica "aqui dá pra clicar
          // pra ver vídeo" vs "área sem dado". Durante drag/scrub, ?:active
          // → grabbing assume.
          hoverInfo?.hasRecording ? 'cursor-cell' : 'cursor-pointer',
          'active:cursor-grabbing',
        )}
        // overflow: clip-x permite a miniatura de sprite-preview escapar
        // verticalmente (acima da timeline) sem quebrar o clip horizontal
        // que precisa cortar ranges em pan/zoom. `overflow: hidden` clássico
        // não permitiria essa assimetria.
        style={{
          height: trackHeight, touchAction: 'none',
          overflowX: 'clip', overflowY: 'visible',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          // Right-click cria bookmark no instante. Suprime menu nativo
          // do browser pra não competir. Pan/scrub/zoom não usam right-click.
          if (!onCreateBookmark) return
          e.preventDefault()
          const sec = hoverInfo?.snappedSec ?? xToSec(e.clientX)
          onCreateBookmark(Math.floor(sec))
        }}
      >
        {/* Faixas memoizadas — só recomputam quando dados/viewport mudam,
            não a cada hover. Cobertura (heatmap intensity OU bitmap fallback)
            + Motion. */}
        {intensityHeatmap}
        {fallbackRanges}
        {motionRanges}

        {/* ── Macro-gaps (>5min) — listras rose hachuradas pra alertar
            visualmente "aqui não tem footage, vai dar tela preta".
            Renderizadas ACIMA da cobertura (z-5) mas abaixo da hover guide. */}
        {gaps && gaps.length > 0 && dayUtcDate && (() => {
          const dayStartMs = new Date(`${dayUtcDate}T00:00:00.000Z`).getTime()
          return gaps.map((g, i) => {
            const gStartSec = (g.startMs - dayStartMs) / 1000
            const gEndSec   = (g.endMs   - dayStartMs) / 1000
            if (gEndSec < viewStart || gStartSec > viewEnd) return null
            const left  = ((Math.max(gStartSec, viewStart) - viewStart) / viewRange) * 100
            const right = ((Math.min(gEndSec,   viewEnd)   - viewStart) / viewRange) * 100
            const durMin = Math.round(g.durSec / 60)
            return (
              <div
                key={`gap-${i}`}
                className="absolute pointer-events-none"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(right - left, 0.1)}%`,
                  top: 0, bottom: 0,
                  zIndex: 5,
                  // Visual atenuado: sombra suave em vez de alerta agressivo.
                  // Operador percebe "área sem footage" sem competir com a
                  // faixa cyan principal. Hachura mais sutil + sem bordas.
                  backgroundImage: 'repeating-linear-gradient(135deg, rgba(244,63,94,0.10) 0 6px, rgba(244,63,94,0.02) 6px 14px)',
                }}
                title={`Sem gravação: ${durMin} min (${new Date(g.startMs).toISOString().slice(11,19)} → ${new Date(g.endMs).toISOString().slice(11,19)} UTC)`}
              />
            )
          })
        })()}

        {/* ── Faixa "Eventos" — dots coloridos no rodapé ─────────────────
            Severity → cor: CRITICAL=rose, WARNING=amber, INFO=sky.
            Tooltip nativo (title) revela tipo + horário. */}
        {tracksOn.events && events && events.map((ev, i) => {
          const dayStartMs = dayUtcDate
            ? new Date(`${dayUtcDate}T00:00:00.000Z`).getTime()
            : 0
          const evMs = new Date(ev.at).getTime()
          const sec  = (evMs - dayStartMs) / 1000
          if (sec < viewStart || sec > viewEnd) return null
          const color = ev.severity === 'CRITICAL' ? 'bg-rose-500'
                     : ev.severity === 'WARNING'  ? 'bg-amber-500'
                     : /* INFO/default */          'bg-sky-400'
          return (
            <div
              key={`e-${i}`}
              className={cn(
                'absolute -translate-x-1/2 w-1.5 h-1.5 rounded-full ring-1 ring-black/40 pointer-events-auto cursor-help',
                color,
              )}
              style={{ left: `${secToPct(sec)}%`, bottom: '6%' }}
              title={`${ev.type}${ev.label ? ` (${ev.label})` : ''} · ${fmtSec(sec, true)}`}
            />
          )
        })}

        {/* ── Faixa "Bookmarks" — estrelas no topo, range opcional ─── */}
        {tracksOn.bookmarks && bookmarks && bookmarks.map((b, i) => {
          const dayStartMs = dayUtcDate
            ? new Date(`${dayUtcDate}T00:00:00.000Z`).getTime()
            : 0
          const startMs = new Date(b.at).getTime()
          const endMs   = b.endAt ? new Date(b.endAt).getTime() : null
          const startSec = (startMs - dayStartMs) / 1000
          const endSec   = endMs != null ? (endMs - dayStartMs) / 1000 : null
          if (startSec < viewStart - 60 || startSec > viewEnd + 60) return null
          // Range (com endAt) → faixa horizontal estreita; sem endAt → estrela.
          if (endSec != null && endSec - startSec > 30) {
            const left  = ((Math.max(startSec, viewStart) - viewStart) / viewRange) * 100
            const right = ((Math.min(endSec,   viewEnd)   - viewStart) / viewRange) * 100
            return (
              <div
                key={`bm-${i}`}
                className="absolute pointer-events-auto cursor-help"
                style={{
                  left: `${left}%`, width: `${Math.max(right - left, 0.4)}%`,
                  top: '4%', height: '8%',
                  background: b.color,
                  opacity: 0.65,
                }}
                title={`★ ${b.title}`}
                />
            )
          }
          return (
            <div
              key={`bm-${i}`}
              className="absolute -translate-x-1/2 text-xs leading-none pointer-events-auto cursor-help drop-shadow"
              style={{ left: `${secToPct(startSec)}%`, top: '2%', color: b.color }}
              title={`★ ${b.title} · ${fmtSec(startSec, true)}`}
            >
              ★
            </div>
          )
        })}

        {/* Minor ticks — linhas verticais finas, sem label, ocupam só o
            terço inferior da track. Adiciona granularidade visual sem
            poluir. Step = major/5, só renderizam se ≥8px de espaçamento. */}
        {ticks.minorTicks.map(t => (
          <div
            key={`mt-${t}`}
            className="absolute bottom-0 pointer-events-none border-l border-white/15"
            style={{ left: `${secToPct(t)}%`, height: '35%' }}
          />
        ))}

        {/* Major ticks + labels — linha vertical full-height + label HH:MM */}
        {ticks.ticks.map(t => (
          <div
            key={t}
            className="absolute top-0 bottom-0 border-l border-white/30 pointer-events-none"
            style={{ left: `${secToPct(t)}%` }}
          >
            <span
              className="absolute bottom-0.5 left-1 text-[10px] font-mono font-semibold text-white/90 whitespace-nowrap pointer-events-none tabular-nums"
              style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
            >
              {fmtSec(t, ticks.step < 60)}
            </span>
          </div>
        ))}

        {/* Playhead — linha grossa + handle bem visível + badge HH:MM:SS.
            Hit zone invisível (48px) generosa pra "agarrar" sem precisar
            mira pixel-perfect. Linha 2px (era 0.5) + handle 24px com glow.
            Badge mostra `displaySec` (scrubSec durante drag, currentSecOfDay
            no idle) — operador vê o tempo exato do cursor enquanto arrasta. */}
        {playheadPct != null && displaySec != null && (
          <div
            className="absolute top-0 bottom-0 bg-amber-400 pointer-events-none shadow-[0_0_12px_rgba(251,191,36,0.8)] z-20"
            style={{ left: `${playheadPct}%`, width: '2px', marginLeft: '-1px' }}
          >
            {/* Badge wall-clock acima do handle. */}
            <div className={cn(
              'absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-amber-500 text-black text-[11px] font-mono font-bold tabular-nums whitespace-nowrap pointer-events-none shadow-md transition-transform',
              isScrubbing && 'scale-110',
            )}>
              {fmtSec(displaySec, true)}
            </div>
            {/* Hit zone invisível 48×100% — área generosa pra detectar mouseDown.
                Relay de mouseMove pra manter hoverSec atualizado quando mouse
                passa sobre o handle (sem isso linha-guia congela). */}
            <div
              className={cn(
                'absolute top-0 bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto',
                isScrubbing ? 'cursor-grabbing' : 'cursor-ew-resize',
              )}
              style={{ width: '48px' }}
              title="Arraste para navegar"
            />
            {/* Handle visual: bolinha 24px (era 16) com ring duplo. */}
            <div
              className={cn(
                'absolute left-1/2 -translate-x-1/2 rounded-full bg-amber-400 ring-4 ring-amber-300/40 pointer-events-none shadow-[0_0_10px_rgba(251,191,36,1)] transition-all',
                isScrubbing
                  ? 'w-7 h-7 -top-3 ring-amber-300/60'
                  : 'w-6 h-6 -top-2.5',
              )}
            />
            {/* Triângulo apontando pra baixo, debaixo do handle — chama
                atenção visual e mostra direção do tempo. */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-0 h-0 pointer-events-none"
              style={{
                top: '24px',
                borderLeft:  '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop:   '6px solid rgb(251 191 36)',
              }}
            />
          </div>
        )}

        {/* Hover guide — linha vertical guia branca tracejada acompanhando o
            mouse + relógio HH:MM:SS no topo. Branca contrasta tanto com o
            heatmap cyan (gravação) quanto com slate (vazio). z-25 pra
            sempre ficar visível (acima do playhead amber z-20).
            Badge alinhado no topo da timeline (top:1px) — fica DENTRO do
            container `overflow-hidden`, sempre visível, e flippa pro lado
            esquerdo se a guia está perto da borda direita pra não vazar. */}
        {hoverInfo != null && hoverSec != null && !isScrubbing && (() => {
          const pct = secToPct(hoverInfo.snappedSec)
          // Flip do badge: se cursor está no terço direito, badge cresce pra
          // esquerda em vez de centralizado (evita corte na borda).
          const flipLeft = pct > 80
          const flipRight = pct < 20

          // Sprite preview: localiza o frame que cobre `snappedSec`. O sprite
          // é por hora UTC; cada frame cobre `frameInterval` segundos a partir
          // de `firstFrameAt`. Se o segundo está fora dos frames disponíveis
          // (ex: gravação só começou no minuto 35), preview some.
          const sec = hoverInfo.snappedSec
          const hourUtc = Math.floor(sec / 3600) % 24
          const sprite = spriteByHour[hourUtc]
          let preview: { url: string; bgX: number; bgY: number; w: number; h: number; bgW: number; bgH: number } | null = null
          if (sprite && dayUtcDate) {
            // Segundos desde firstFrameAt do sprite (pode ser >0 ou <0 se o
            // sprite começou depois do início da hora).
            const firstMs = new Date(sprite.firstFrameAt).getTime()
            const dayMs   = new Date(`${dayUtcDate}T00:00:00.000Z`).getTime()
            const targetMs = dayMs + sec * 1000
            const offsetSec = (targetMs - firstMs) / 1000
            const idx = Math.floor(offsetSec / sprite.frameInterval)
            if (idx >= 0 && idx < sprite.frameCount) {
              const col = idx % sprite.cols
              const row = Math.floor(idx / sprite.cols)
              preview = {
                url: sprite.url,
                bgX: -col * sprite.frameWidth,
                bgY: -row * sprite.frameHeight,
                w:   sprite.frameWidth,
                h:   sprite.frameHeight,
                bgW: sprite.cols * sprite.frameWidth,
                bgH: sprite.rows * sprite.frameHeight,
              }
            }
          }
          return (
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: `${pct}%`,
                width: '2px',
                marginLeft: '-1px',
                zIndex: 25,
                background: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.85) 0 4px, transparent 4px 7px)',
              }}
            >
              {/* Bolinha branca no topo — chama atenção */}
              <div
                className="absolute -top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white ring-1 ring-slate-400 shadow-md"
              />

              {/* Sprite preview — miniatura do frame da gravação naquele
                  instante (padrão YouTube). Posicionado acima da linha-guia
                  com gap de 10px pra dar respiro do badge HH:MM:SS.
                  Flippa pra esquerda/direita perto das bordas pra não vazar. */}
              {preview && (
                <div
                  className={cn(
                    'absolute rounded shadow-2xl ring-1 ring-white/30 pointer-events-none overflow-hidden',
                    flipLeft  && 'right-2',
                    flipRight && 'left-2',
                    !flipLeft && !flipRight && 'left-1/2 -translate-x-1/2',
                  )}
                  style={{
                    bottom: `calc(100% + 6px)`,
                    width:  `${preview.w}px`,
                    height: `${preview.h}px`,
                    backgroundImage:    `url(${preview.url})`,
                    backgroundPosition: `${preview.bgX}px ${preview.bgY}px`,
                    backgroundSize:     `${preview.bgW}px ${preview.bgH}px`,
                    backgroundRepeat:   'no-repeat',
                  }}
                />
              )}
              {/* Relógio HH:MM:SS — colado na linha-guia, dentro da timeline.
                  Flippa pra esquerda/direita conforme posição pra não vazar. */}
              <div
                className={cn(
                  'absolute top-1 px-1.5 py-0.5 rounded bg-slate-900/90 border border-white/20 text-white text-[10px] font-mono font-bold tabular-nums whitespace-nowrap shadow-lg',
                  flipLeft  && 'right-2',
                  flipRight && 'left-2',
                  !flipLeft && !flipRight && 'left-1/2 -translate-x-1/2',
                )}
              >
                {fmtSec(hoverInfo.snappedSec, true)}
              </div>
            </div>
          )
        })()}

        {/* Hover tooltip — só mostra info EXTRA quando snap ativa em
            evento/bookmark (o horário já está no badge da linha-guia).
            Posicionado embaixo (na faixa inferior do track) pra não
            ser cortado pelo overflow-hidden externo. */}
        {hoverInfo != null && hoverSec != null && !isScrubbing &&
         (hoverInfo.nearestEvent || hoverInfo.nearestBookmark) && (
          <div
            className="absolute -translate-x-1/2 rounded shadow-xl pointer-events-none whitespace-nowrap z-30 text-white border bg-slate-900/95 border-white/20 px-1.5 py-0.5 text-[9px] font-mono"
            style={{ left: `${secToPct(hoverInfo.snappedSec)}%`, bottom: '2px' }}
          >
            {hoverInfo.nearestEvent && (
              <span>● {hoverInfo.nearestEvent.ev.type}{hoverInfo.nearestEvent.ev.label ? ` (${hoverInfo.nearestEvent.ev.label})` : ''}</span>
            )}
            {hoverInfo.nearestBookmark && !hoverInfo.nearestEvent && (
              <span>★ {hoverInfo.nearestBookmark.bm.title}</span>
            )}
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
