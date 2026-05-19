/**
 * MobilePlayerSheet v5
 *
 * Novos recursos (v5):
 *   - Digital Zoom: pinch-to-zoom no vídeo (1× a 5×), duplo-tap reseta
 *   - Landscape: ao girar para horizontal auto-entra em fullscreen
 *   - Speed estendida: 0.125× → 0.25× → 0.5× → 1× → 2× → 4× → 8× → 16×
 *   - Frame-by-frame: botões ◀▶ aparecem quando pausado
 *   - Exportação MP4: trecho de 30s/1min/2min/5min centrado no instante atual
 *
 * Gestos no vídeo:
 *   - Pinch           → zoom (1×–5×)
 *   - Swipe L/R       → câmera anterior / próxima (só com zoom=1)
 *   - Tap zona lateral → ±10s (playback)
 *   - Duplo tap        → fullscreen (zoom=1) ou reset zoom (zoom>1)
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Maximize2, Camera, MapPin, Crosshair,
  Volume2, VolumeX, Mic, MicOff,
  ChevronLeft, ChevronRight, CalendarDays,
  Play, Pause, Gauge, Radio,
  SkipBack, SkipForward, Download, StepBack, StepForward,
  Loader2, Check, AlertCircle,
} from 'lucide-react'
import { LivePlayer }                             from '../../components/player/LivePlayer'
import { PlaybackPlayer, PlaybackPlayerRef }     from '../../components/player/PlaybackPlayer'
import { MobileTimeline, TimelineFilter }         from '../../components/mobile/MobileTimeline'
import { PTZOverlay }                            from '../../components/mobile/PTZOverlay'
import { usePlaybackTimeline, usePlaybackIndex, issuePlaybackToken, BASE_URL } from '../../api/client'
import { useTalkback }                           from '../../hooks/useTalkback'
import { haptic }                                from '../../lib/haptic'
import { cn }                                    from '../../lib/utils'
import { format, parseISO }                      from 'date-fns'
import { ptBR }                                  from 'date-fns/locale'

// ─── Types ───────────────────────────────────────────────────────────────────
export interface CameraEntry {
  id:    string
  name:  string
  site?: string
}

interface Props {
  cameras:           CameraEntry[]
  initialIndex?:     number
  initialTab?:       'live' | 'playback'
  initialTimestamp?: string
  onClose:           () => void
}

type Mode    = 'live' | 'playback'
type ExportState = 'idle' | 'preparing' | 'downloading' | 'done' | 'error'

const SPEEDS: readonly number[] = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16]
const EXPORT_DURATIONS = [30, 60, 120, 300] as const  // segundos

const SWIPE_MIN    = 60
const TAP_MAX_MOVE = 18
const DTAP_MS      = 280
const SIDE_ZONE    = 0.28
const ZOOM_MIN     = 1
const ZOOM_MAX     = 5
import { todayLocalIso, localDayStartMs, shiftDay as shiftDayUtil, localSecOfDay, isoDate } from '../../lib/day-utils'

export function todayLocal() {
  return todayLocalIso()
}

export function dayLabel(day: string) {
  try { return format(parseISO(day), "d 'de' MMM", { locale: ptBR }) } catch { return day }
}

function secToHms(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

function exportDurationLabel(sec: number) {
  if (sec < 60) return `${sec}s`
  return `${sec / 60}min`
}

// ─── Component ───────────────────────────────────────────────────────────────
export function MobilePlayerSheet({
  cameras, initialIndex = 0,
  initialTab = 'live', initialTimestamp,
  onClose,
}: Props) {

  const [camIdx, setCamIdx] = useState(initialIndex)
  const cam = cameras[camIdx] ?? cameras[0]

  const [mode, setMode] = useState<Mode>(initialTab)
  const [day, setDay]   = useState(
    initialTimestamp ? initialTimestamp.slice(0, 10) : todayLocal()
  )
  const [currentSec, setCurrentSec] = useState(() => {
    if (!initialTimestamp) return 0
    return localSecOfDay(new Date(initialTimestamp))
  })

  const [speed, setSpeed]               = useState<number>(1)
  const [playing, setPlaying]           = useState(true)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [showDayPicker, setShowDayPicker] = useState(false)
  const [showPtz, setShowPtz]           = useState(false)
  const [liveMuted, setLiveMuted]       = useState(true)

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const [zoomLevel, setZoomLevel]       = useState(1)

  // ── Timeline filter ───────────────────────────────────────────────────────
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all')

  // ── Export ────────────────────────────────────────────────────────────────
  const [showExportMenu, setShowExportMenu]   = useState(false)
  const [exportDuration, setExportDuration]   = useState<30|60|120|300>(60)
  const [exportState, setExportState]         = useState<ExportState>('idle')
  const [exportError, setExportError]         = useState<string | null>(null)

  // Feedback visual dos taps laterais
  const [skipHint, setSkipHint] = useState<{ dir: 'left'|'right'; id: number } | null>(null)
  // Arraste horizontal durante swipe
  const [swipeDx, setSwipeDx]   = useState(0)

  const talkback  = useTalkback(cam.id)
  const playerRef = useRef<PlaybackPlayerRef | null>(null)

  // Gestures — ponteiros ativos rastreados por ID
  const activePointersRef = useRef<Map<number, {x: number; y: number}>>(new Map())
  const pinchRef   = useRef<{ initDist: number; initZoom: number } | null>(null)
  const gestureRef = useRef<{ startX: number; startY: number; startTime: number } | null>(null)
  const lastTapRef = useRef<{ time: number; x: number } | null>(null)
  const pendingTapRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Timeline — backend handles timezone via tzOffsetMin param (set in api/client.ts)
  const { data: tlData } = usePlaybackTimeline(cam.id, day)

  const { data: idxData } = usePlaybackIndex(cam.id)
  const availableDays = idxData?.days?.map(d => d.day) ?? []
  const bitmap        = tlData?.bitmap ?? ''
  const motionBitmap  = tlData?.motionBitmap ?? ''
  const events        = tlData?.events ?? []

  const localStartIso = useMemo(() => new Date(`${day}T00:00:00`).toISOString(), [day])
  const localEndIso   = useMemo(() => new Date(`${day}T23:59:59.999`).toISOString(), [day])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // ── Landscape → auto fullscreen ───────────────────────────────────────────
  useEffect(() => {
    function handleOrientationChange() {
      const isLandscape = window.screen?.orientation
        ? window.screen.orientation.type.includes('landscape')
        : window.innerWidth > window.innerHeight

      if (isLandscape && !document.fullscreenElement) {
        const el = document.querySelector('[data-player-container]') as HTMLElement | null
        el?.requestFullscreen?.().then(() => {
          ;(screen.orientation as any)?.lock?.('landscape').catch(() => {})
        }).catch(() => {})
      }
    }

    screen.orientation?.addEventListener?.('change', handleOrientationChange)
    window.addEventListener('orientationchange', handleOrientationChange)
    return () => {
      screen.orientation?.removeEventListener?.('change', handleOrientationChange)
      window.removeEventListener('orientationchange', handleOrientationChange)
    }
  }, [])

  // ── Câmera switch ─────────────────────────────────────────────────────────
  function goToCamera(idx: number) {
    const target = Math.max(0, Math.min(cameras.length - 1, idx))
    if (target === camIdx) return
    setCamIdx(target)
    setMode('live')
    setCurrentSec(0)
    setShowPtz(false)
    setZoomLevel(1)
    talkback.stop()
  }

  const handleTimeUpdate = useCallback((sec: number) => setCurrentSec(sec), [])

  const handleSeek = useCallback((sec: number) => {
    setCurrentSec(sec)
    if (mode !== 'playback') setMode('playback')
    playerRef.current?.seekTo(sec)
  }, [mode])

  function skip(deltaSec: number) {
    if (mode === 'live') {
      const nowSec = localSecOfDay(new Date())
      const next = Math.max(0, Math.min(86399, nowSec + deltaSec))
      setCurrentSec(next)
      setMode('playback')
    } else {
      const next = Math.max(0, Math.min(86399, currentSec + deltaSec))
      setCurrentSec(next)
      if (playerRef.current?.skipRelative) {
        playerRef.current.skipRelative(deltaSec)
      } else {
        playerRef.current?.seekTo(next)
      }
    }
  }

  function showSkipHint(dir: 'left' | 'right') {
    const id = Date.now()
    setSkipHint({ dir, id })
    setTimeout(() => setSkipHint(h => h?.id === id ? null : h), 700)
  }

  function goLive() {
    setMode('live')
    setShowPtz(false)
    talkback.stop()
  }

  function changeDay(delta: number) {
    const nd = shiftDayUtil(day, delta)
    if (nd > todayLocal()) return
    setDay(nd)
    setCurrentSec(0)
    setMode('playback')
  }

  function captureScreenshot() {
    const video = document.querySelector('[data-player-container] video') as HTMLVideoElement | null
    if (!video) return
    haptic(40)
    const c = document.createElement('canvas')
    c.width = video.videoWidth; c.height = video.videoHeight
    c.getContext('2d')?.drawImage(video, 0, 0)

    const dataUrl  = c.toDataURL('image/jpeg', 0.9)
    const filename = `vsaas-${cam.name.replace(/[^a-zA-Z0-9]/g,'_')}-${Date.now()}.jpg`

    // Tenta Web Share API (nativo iOS/Android) antes de fazer download
    if (navigator.canShare?.({ files: [] as File[] })) {
      c.toBlob(blob => {
        if (!blob) return
        const file = new File([blob], filename, { type: 'image/jpeg' })
        navigator.share({ title: `Câmera: ${cam.name}`, files: [file] }).catch(() => {
          // Fallback se o share cancelar
          const a = document.createElement('a')
          a.href = dataUrl; a.download = filename; a.click()
        })
      }, 'image/jpeg', 0.9)
    } else {
      const a = document.createElement('a')
      a.href = dataUrl; a.download = filename; a.click()
    }
  }

  function doFullscreen(el: HTMLElement) {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      el.requestFullscreen?.().then(() => {
        ;(screen.orientation as any)?.lock?.('landscape').catch(() => {})
      }).catch(() => {})
    }
  }

  // ── Exportação MP4 ────────────────────────────────────────────────────────
  async function startExport() {
    if (mode !== 'playback') {
      setExportError('Mude para o modo playback antes de exportar')
      return
    }
    setExportState('preparing')
    setExportError(null)

    try {
      const halfSec    = exportDuration / 2
      const fromSec    = Math.max(0,     currentSec - halfSec)
      const toSec      = Math.min(86399, currentSec + halfSec)
      const hr = String(Math.floor(fromSec / 3600)).padStart(2, '0')
      const mi = String(Math.floor((fromSec % 3600) / 60)).padStart(2, '0')
      const se = String(Math.floor(fromSec % 60)).padStart(2, '0')
      const fromIso = new Date(`${day}T${hr}:${mi}:${se}`).toISOString()

      const hrT = String(Math.floor(toSec / 3600)).padStart(2, '0')
      const miT = String(Math.floor((toSec % 3600) / 60)).padStart(2, '0')
      const seT = String(Math.floor(toSec % 60)).padStart(2, '0')
      const toIso = new Date(`${day}T${hrT}:${miT}:${seT}`).toISOString()

      // Emite ticket de playback para o range de exportação
      const result = await issuePlaybackToken(cam.id, fromIso, toIso)
      const ticket = (result as any).ticket as string

      setExportState('downloading')
      haptic(50)

      const exportUrl  = `${BASE_URL}/playback/${cam.id}/export.mp4?ticket=${encodeURIComponent(ticket)}`
      const filename   = `vsaas-${cam.name.replace(/[^a-zA-Z0-9]/g,'_')}-${fromIso.slice(0,19)}.mp4`

      // Tenta Web Share API — compartilhamento nativo (iOS/Android)
      if (navigator.share) {
        try {
          await navigator.share({ title: `Clip: ${cam.name}`, url: exportUrl })
          setExportState('done')
          setTimeout(() => { setExportState('idle'); setShowExportMenu(false) }, 3000)
          return
        } catch { /* fallback para download */ }
      }

      // Fallback: download direto
      const a = document.createElement('a')
      a.href = exportUrl; a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)

      setExportState('done')
      setTimeout(() => { setExportState('idle'); setShowExportMenu(false) }, 3000)
    } catch (err: any) {
      setExportError(err?.message ?? 'Falha ao exportar')
      setExportState('error')
      setTimeout(() => setExportState('idle'), 4000)
    }
  }

  // ── Gesture handlers ──────────────────────────────────────────────────────
  function onVideoPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (activePointersRef.current.size >= 2) {
      // Dois dedos: inicia pinch zoom
      const pts = [...activePointersRef.current.values()]
      const initDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      pinchRef.current   = { initDist, initZoom: zoomLevel }
      gestureRef.current = null  // cancela swipe em andamento
      setSwipeDx(0)
    } else {
      gestureRef.current = { startX: e.clientX, startY: e.clientY, startTime: Date.now() }
      setSwipeDx(0)
    }
  }

  function onVideoPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Pinch zoom (2 dedos)
    if (activePointersRef.current.size >= 2 && pinchRef.current) {
      const pts  = [...activePointersRef.current.values()]
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
        pinchRef.current.initZoom * (dist / pinchRef.current.initDist),
      ))
      setZoomLevel(newZoom)
      return
    }

    // Swipe câmera (1 dedo, zoom=1)
    if (!gestureRef.current || e.buttons !== 1) return
    if (zoomLevel > 1.05) return  // não swipe quando ampliado
    const dx = e.clientX - gestureRef.current.startX
    const dy = e.clientY - gestureRef.current.startY
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 10) {
      setSwipeDx(dx)
    }
  }

  function onVideoPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(e.pointerId)

    // Fim do pinch: reseta tracker mas mantém zoom
    if (pinchRef.current && activePointersRef.current.size < 2) {
      pinchRef.current = null
      return
    }

    const g = gestureRef.current
    if (!g) return
    gestureRef.current = null

    const dx   = e.clientX - g.startX
    const dy   = e.clientY - g.startY
    const dt   = Date.now() - g.startTime
    const dist = Math.hypot(dx, dy)

    setSwipeDx(0)

    // Swipe câmera (só com zoom=1)
    if (zoomLevel <= 1.05 && Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) {
      goToCamera(camIdx + (dx < 0 ? 1 : -1))
      return
    }

    // Tap
    if (dist <= TAP_MAX_MOVE && dt < 500) {
      const now  = Date.now()
      const last = lastTapRef.current

      // Duplo tap: ±10s nas laterais (YouTube style) ou reset zoom/fullscreen no centro
      if (last && now - last.time < DTAP_MS) {
        lastTapRef.current = null
        if (pendingTapRef.current) { clearTimeout(pendingTapRef.current); pendingTapRef.current = null }
        
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const relX = e.clientX - rect.left
        const zone = relX / rect.width
        
        if (zone < SIDE_ZONE && zoomLevel <= 1.05) {
          skip(-10)
          showSkipHint('left')
        } else if (zone > 1 - SIDE_ZONE && zoomLevel <= 1.05) {
          skip(10)
          showSkipHint('right')
        } else {
          if (zoomLevel > 1.05) {
            setZoomLevel(1)
          } else {
            doFullscreen(e.currentTarget as HTMLElement)
          }
        }
        return
      }

      lastTapRef.current = { time: now, x: e.clientX }

      pendingTapRef.current = setTimeout(() => {
        pendingTapRef.current = null
        if (!lastTapRef.current) return
        lastTapRef.current = null
      }, DTAP_MS + 20)
    }
  }

  function onVideoPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(e.pointerId)
    gestureRef.current = null
    pinchRef.current   = null
    setSwipeDx(0)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="ps-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        key="ps-sheet"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="fixed inset-0 z-50 flex flex-col bg-slate-950 overflow-hidden"
        style={{ height: '100dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b border-slate-800/60">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{cam.name}</p>
              {cameras.length > 1 && (
                <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400 font-mono font-medium">
                  {camIdx + 1}/{cameras.length}
                </span>
              )}
            </div>
            {cam.site && (
              <p className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium">
                <MapPin className="w-3 h-3 shrink-0" />{cam.site}
              </p>
            )}
          </div>

          {cameras.length > 1 && (
            <div className="flex items-center gap-1 mx-2 shrink-0">
              <button onClick={() => goToCamera(camIdx - 1)} disabled={camIdx === 0}
                className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 disabled:opacity-25 shadow-sm">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => goToCamera(camIdx + 1)} disabled={camIdx === cameras.length - 1}
                className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 disabled:opacity-25 shadow-sm">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={captureScreenshot}
              className="p-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 shadow-sm">
              <Camera className="w-4 h-4" />
            </button>
            <button onClick={() => doFullscreen(document.querySelector('[data-player-container]') as HTMLElement)}
              className="p-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 shadow-sm">
              <Maximize2 className="w-4 h-4" />
            </button>
            <button onClick={onClose}
              className="p-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 shadow-sm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Vídeo ──────────────────────────────────────────────────────── */}
        <div
          data-player-container
          className="relative w-full bg-black shrink-0 overflow-hidden touch-none"
          style={{
            aspectRatio: '16/9',
            maxHeight: '35dvh',
            transform: swipeDx ? `translateX(${swipeDx * 0.35}px)` : undefined,
            transition: swipeDx === 0 ? 'transform 0.2s ease' : 'none',
          }}
          onPointerDown={onVideoPointerDown}
          onPointerMove={onVideoPointerMove}
          onPointerUp={onVideoPointerUp}
          onPointerCancel={onVideoPointerCancel}
        >
          {/* Inner zoom wrapper */}
          <div
            className="absolute inset-0 origin-center transition-transform duration-100"
            style={{ transform: zoomLevel !== 1 ? `scale(${zoomLevel})` : undefined }}
          >
            {mode === 'live' ? (
              <LivePlayer
                key={cam.id}
                cameraId={cam.id}
                muted={liveMuted}
                showOverlay={false}
                fit="contain"
                className="w-full h-full !border-0 !rounded-none"
              />
            ) : (
              <PlaybackPlayer
                key={`${cam.id}-${day}`}
                ref={playerRef}
                cameraId={cam.id}
                fromIso={localStartIso}
                toIso={localEndIso}
                dayUtcDate={day}
                initialRate={speed}
                initialSeekSec={currentSec}
                minimal
                paused={!playing}
                className="w-full h-full !border-0 !rounded-none"
                onTimeUpdate={handleTimeUpdate}
              />
            )}
          </div>

          {/* PTZ overlay */}
          {mode === 'live' && showPtz && (
            <PTZOverlay cameraId={cam.id} onClose={() => setShowPtz(false)} />
          )}

          {/* Indicador de zoom */}
          {zoomLevel > 1.05 && (
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-bold pointer-events-none">
              {zoomLevel.toFixed(1)}×
            </div>
          )}

          {/* Indicador hint de reset zoom */}
          {zoomLevel > 1.05 && (
            <div className="absolute bottom-2 inset-x-0 flex justify-center pointer-events-none">
              <span className="text-[9px] text-white/50">Duplo toque para resetar zoom</span>
            </div>
          )}

          {/* Swipe hint */}
          {swipeDx !== 0 && Math.abs(swipeDx) > 20 && (
            <div className={cn(
              'absolute inset-y-0 flex items-center px-4 pointer-events-none',
              swipeDx > 0 ? 'left-0' : 'right-0',
            )}>
              <div className="rounded-full bg-white/10 p-3">
                {swipeDx > 0
                  ? <ChevronLeft className="w-6 h-6 text-white" />
                  : <ChevronRight className="w-6 h-6 text-white" />
                }
              </div>
            </div>
          )}

          {/* Feedback ±10s */}
          <AnimatePresence>
            {skipHint && (
              <motion.div
                key={skipHint.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 pointer-events-none',
                  skipHint.dir === 'left' ? 'left-4' : 'right-4',
                )}
              >
                <div className="flex flex-col items-center gap-1 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm">
                  {skipHint.dir === 'left'
                    ? <SkipBack  className="w-6 h-6 text-white" />
                    : <SkipForward className="w-6 h-6 text-white" />
                  }
                  <span className="text-white text-xs font-bold">10s</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Dots de câmeras */}
          {cameras.length > 1 && Math.abs(swipeDx) > 10 && (
            <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5 pointer-events-none">
              {cameras.map((_, i) => (
                <div key={i} className={cn(
                  'w-1.5 h-1.5 rounded-full transition-all',
                  i === camIdx ? 'bg-white w-3' : 'bg-white/40',
                )} />
              ))}
            </div>
          )}
        </div>

        {/* ── Barra de controles ──────────────────────────────────────────── */}
        <div className="px-3 py-2 flex items-center gap-2 shrink-0 border-b border-slate-200 dark:border-slate-800/60">
          {mode === 'live' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-[11px] font-bold text-red-400 shrink-0">
              <Radio className="w-3.5 h-3.5" />Ao vivo
            </span>
          ) : (
            <button onClick={goLive}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 active:bg-slate-300 dark:active:bg-slate-700 shrink-0 shadow-sm">
              <Radio className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />Ao vivo
            </button>
          )}

          <span className="flex-1" />

          {/* Export button */}
          <button
            onClick={() => { setShowExportMenu(p => !p); setShowSpeedMenu(false); setExportError(null) }}
            disabled={mode !== 'playback'}
            className={cn('p-2 rounded-xl border transition-all shadow-sm',
              showExportMenu
                ? 'bg-violet-500/20 border-violet-500/40 text-violet-500 dark:text-violet-400'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 disabled:opacity-30')}>
            {exportState === 'preparing' || exportState === 'downloading'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : exportState === 'done'
              ? <Check className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              : <Download className="w-4 h-4" />
            }
          </button>

          <button onClick={() => setLiveMuted(m => !m)}
            className={cn('p-2 rounded-xl border transition-all shadow-sm',
              liveMuted ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400' : 'bg-cyan-50 dark:bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-400')}>
            {liveMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button onClick={talkback.start}
            className={cn('p-2 rounded-xl border transition-all shadow-sm',
              talkback.isActive ? 'bg-emerald-50 dark:bg-emerald-500/20 border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
              : talkback.status === 'error' ? 'bg-red-50 dark:bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
              : (talkback.status === 'connecting' || talkback.status === 'requesting-mic')
                ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 animate-pulse'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400')}>
            {talkback.isActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>

          <button
            onClick={() => { if (mode !== 'live') setMode('live'); setShowPtz(p => !p) }}
            className={cn('flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-[11px] font-bold transition-all shadow-sm',
              showPtz && mode === 'live'
                ? 'bg-cyan-50 dark:bg-cyan-500/20 border-cyan-500/50 text-cyan-600 dark:text-cyan-400'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400')}>
            <Crosshair className="w-3.5 h-3.5" />PTZ
          </button>

          {mode === 'playback' && (
            <button
              onClick={() => { setShowSpeedMenu(p => !p); setShowExportMenu(false) }}
              className={cn('flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-[11px] font-bold transition-all shadow-sm',
                showSpeedMenu ? 'bg-amber-50 dark:bg-amber-500/20 border-amber-500/50 text-amber-600 dark:text-amber-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400')}
            >
              <Gauge className="w-3.5 h-3.5" /> {speed}x
            </button>
          )}
        </div>

        {/* ── Speed menu ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {showSpeedMenu && mode === 'playback' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden shrink-0 border-b border-slate-800/60"
            >
              <div className="px-4 py-3 flex gap-2 overflow-x-auto scrollbar-hide">
                {SPEEDS.map(s => (
                  <button
                    key={s}
                    onClick={() => { setSpeed(s); setShowSpeedMenu(false); playerRef.current?.setRate(s) }}
                    className={cn(
                      'px-3 py-1.5 rounded-xl text-xs font-bold border shrink-0 shadow-sm transition-all',
                      speed === s 
                        ? 'bg-amber-500 text-white border-amber-600 dark:border-amber-400' 
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 active:bg-slate-50 dark:active:bg-slate-700'
                    )}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Export menu ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {showExportMenu && mode === 'playback' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden shrink-0 border-b border-slate-800/60"
            >
              <div className="px-4 py-3 flex flex-col gap-2">
                <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-500 uppercase tracking-wide">
                  Exportar vídeo MP4 — centrado em {secToHms(currentSec)}
                </p>
                <div className="flex gap-2">
                  {EXPORT_DURATIONS.map(d => (
                    <button
                      key={d}
                      onClick={() => setExportDuration(d)}
                      className={cn(
                        'flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all shadow-sm',
                        exportDuration === d
                          ? 'bg-violet-50 dark:bg-violet-500/20 border-violet-500/40 text-violet-600 dark:text-violet-300'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 active:bg-slate-50 dark:active:bg-slate-700',
                      )}>
                      {exportDurationLabel(d)}
                    </button>
                  ))}
                </div>

                <button
                  onClick={startExport}
                  disabled={exportState === 'preparing' || exportState === 'downloading'}
                  className={cn(
                    'flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm',
                    exportState === 'error'
                      ? 'bg-red-50 dark:bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400'
                      : 'bg-violet-50 dark:bg-violet-500/20 border border-violet-500/40 text-violet-600 dark:text-violet-300 active:opacity-70 disabled:opacity-50',
                  )}>
                  {exportState === 'preparing' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Preparando...</>
                  ) : exportState === 'downloading' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Baixando...</>
                  ) : exportState === 'done' ? (
                    <><Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />Download iniciado!</>
                  ) : exportState === 'error' ? (
                    <><AlertCircle className="w-4 h-4" />{exportError ?? 'Erro ao exportar'}</>
                  ) : (
                    <><Download className="w-4 h-4" />Baixar {exportDurationLabel(exportDuration)}</>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Painel GRAVAÇÕES ────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide w-full px-4 pt-2.5 pb-4 space-y-2.5"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>

          <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-500 uppercase tracking-wide">Gravações</p>

          {/* Dia */}
          <div className="flex items-center gap-2">
            <button onClick={() => changeDay(-1)}
              className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 shadow-sm">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setShowDayPicker(p => !p)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white shadow-sm">
              <CalendarDays className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400" />
              {dayLabel(day)}
              {day === todayLocal() && (
                <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 text-[9px] font-bold">HOJE</span>
              )}
            </button>
            <button onClick={() => changeDay(1)} disabled={day >= todayLocal()}
              className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 disabled:opacity-30 shadow-sm">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {showDayPicker && availableDays.length > 0 && (
            <div className="grid grid-cols-5 gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              {availableDays.slice(0, 30).map(d => (
                <button key={d}
                  onClick={() => { setDay(d); setShowDayPicker(false); setCurrentSec(0); setMode('playback') }}
                  className={cn('py-1.5 rounded-lg text-[10px] font-semibold transition-all',
                    d === day ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-200 dark:active:bg-slate-700')}>
                  {d.slice(5)}
                </button>
              ))}
            </div>
          )}

          {/* Filtro de tipo de gravação */}
          <div className="flex gap-1.5 mb-1.5">
            {([
              { key: 'all',        label: 'Todos'      },
              { key: 'motion',     label: 'Movimento'  },
              { key: 'continuous', label: 'Contínuo'   },
            ] as { key: TimelineFilter; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTimelineFilter(key)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all shadow-sm',
                  timelineFilter === key
                    ? key === 'motion'
                      ? 'bg-amber-50 dark:bg-amber-500/20 border-amber-500/40 text-amber-600 dark:text-amber-300'
                      : key === 'continuous'
                      ? 'bg-emerald-50 dark:bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                      : 'bg-cyan-50 dark:bg-cyan-500/20 border-cyan-500/40 text-cyan-600 dark:text-cyan-300'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 active:bg-slate-50 dark:active:bg-slate-700',
                )}>
                {label}
              </button>
            ))}
          </div>

          <MobileTimeline
            cameraId={cam.id}
            day={day}
            bitmap={bitmap}
            motionBitmap={motionBitmap}
            currentSec={currentSec}
            events={events}
            filter={timelineFilter}
            onSeek={handleSeek}
          />

          {tlData?.realCoveragePct !== undefined && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-600">
                Cobertura: <span className={cn('font-bold',
                  tlData.realCoveragePct > 80 ? 'text-emerald-400' :
                  tlData.realCoveragePct > 40 ? 'text-amber-400' : 'text-red-400')}>
                  {tlData.realCoveragePct.toFixed(0)}%
                </span>
              </span>
              {tlData.gaps && tlData.gaps.length > 0 && (
                <span className="text-amber-500/60">
                  {tlData.gaps.length} intervalo{tlData.gaps.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          {/* Transport (playback) */}
          {mode === 'playback' && (
            <div className="flex items-center gap-2 pt-0.5">
              {/* Frame back */}
              <button
                onClick={() => { setPlaying(false); playerRef.current?.stepFrame(-1) }}
                className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 active:bg-slate-700">
                <StepBack className="w-4 h-4" />
              </button>

              <button onClick={() => skip(-10)}
                className="flex flex-col items-center gap-0.5 p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 active:bg-slate-700">
                <SkipBack className="w-4 h-4" />
                <span className="text-[8px] font-bold">10s</span>
              </button>

              <button
                onClick={() => { setPlaying(p => !p); playerRef.current?.togglePlay() }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-xs font-semibold active:opacity-70">
                {playing ? <><Pause className="w-4 h-4" />Pausar</> : <><Play className="w-4 h-4" />Play</>}
              </button>

              <button onClick={() => skip(10)}
                className="flex flex-col items-center gap-0.5 p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 active:bg-slate-700">
                <SkipForward className="w-4 h-4" />
                <span className="text-[8px] font-bold">10s</span>
              </button>

              {/* Frame forward */}
              <button
                onClick={() => { setPlaying(false); playerRef.current?.stepFrame(1) }}
                className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 active:bg-slate-700">
                <StepForward className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Speed + timestamp */}
          {mode === 'playback' && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold text-white min-w-[72px]">
                {secToHms(currentSec)}
              </span>
              <span className="flex-1" />
              <div className="relative">
                <button onClick={() => setShowSpeedMenu(p => !p)}
                  className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white">
                  <Gauge className="w-3.5 h-3.5 text-slate-400" />
                  {speed < 1 ? `${speed}×` : `${speed}×`}
                </button>
                {showSpeedMenu && (
                  <div className="absolute bottom-full right-0 mb-1 grid grid-cols-2 gap-1 p-1.5 rounded-xl bg-slate-800 border border-slate-700 shadow-xl z-10 min-w-[100px]">
                    {SPEEDS.map(s => (
                      <button key={s}
                        onClick={() => { setSpeed(s); setShowSpeedMenu(false); playerRef.current?.setRate(s) }}
                        className={cn('px-3 py-1.5 rounded-lg text-xs font-bold text-center',
                          s === speed ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 active:bg-slate-700')}>
                        {s}×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {talkback.status === 'error' && talkback.errorMsg && (
            <p className="text-[10px] text-red-400/80 text-center">{talkback.errorMsg}</p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
