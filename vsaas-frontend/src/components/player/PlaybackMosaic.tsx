/**
 * PlaybackMosaic — Mosaico de reprodução sincronizada multi-câmera.
 *
 * Estratégia de sincronização: Soft Sync via playbackRate (Alt 3 do plano).
 *  - Pre-roll barrier: aguarda canplay de todos os players antes de tocar
 *  - Master clock: 1 player escolhido como referência (geralmente o primeiro)
 *  - Slaves usam playbackRate adjustment (0.95-1.05) para convergir suavemente
 *  - Drift > 500ms: seek hard (situação extrema)
 *  - Drift < 50ms: rate=1.0 (estado estável)
 *
 * Consume RecordingPlayer-style URL: GET /recordings/stream?cameraId=X&from=ISO&to=ISO
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Play, Pause, Maximize2, Loader2, AlertCircle, Camera, Layout as LayoutIcon,
  Download, X, Gauge, Clock,
} from 'lucide-react'
import { BASE_URL, useCameras } from '../../api/client'

// ── Types ──────────────────────────────────────────────────────────────────

type LayoutId = '1x1' | '1x2' | '2x2' | '2x3' | '3x3' | '4x4'

const LAYOUTS: Record<LayoutId, { cols: number; rows: number; tiles: number }> = {
  '1x1': { cols: 1, rows: 1, tiles: 1 },
  '1x2': { cols: 2, rows: 1, tiles: 2 },
  '2x2': { cols: 2, rows: 2, tiles: 4 },
  '2x3': { cols: 3, rows: 2, tiles: 6 },
  '3x3': { cols: 3, rows: 3, tiles: 9 },
  '4x4': { cols: 4, rows: 4, tiles: 16 },
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const

interface Props {
  cameraIds: string[]
  from: Date
  to: Date
  initialLayout?: LayoutId
  /** Callback para exportar — abre modal de exportação no parent */
  onExport?: (cameraIds: string[], from: Date, to: Date) => void
  onClose?: () => void
}

// ── Component ──────────────────────────────────────────────────────────────

export function PlaybackMosaic({
  cameraIds, from, to, initialLayout = '2x2', onExport, onClose,
}: Props) {
  const [layout, setLayout] = useState<LayoutId>(initialLayout)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const [ready, setReady] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [currentTime, setCurrentTime] = useState(0) // segundos relativos ao 'from'
  const totalSec = useMemo(() => Math.max(0, (+to - +from) / 1000), [from, to])

  // Refs aos elementos <video> de cada câmera
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())

  const tilesCount = LAYOUTS[layout].tiles
  const visibleCameras = cameraIds.slice(0, tilesCount)
  const masterCameraId = visibleCameras[0]

  // Pre-roll barrier: todos os videos pausam até `ready` cobrir todos
  const allReady = visibleCameras.every(id => ready.has(id))

  // ── Soft Sync Loop (master clock + playbackRate adjust) ─────────────────
  useEffect(() => {
    if (!playing || !allReady) return

    let rafId = 0
    function tick() {
      const master = videoRefs.current.get(masterCameraId)
      if (!master) {
        rafId = requestAnimationFrame(tick)
        return
      }
      const masterT = master.currentTime
      setCurrentTime(masterT)

      // Sincroniza slaves
      for (const camId of visibleCameras) {
        if (camId === masterCameraId) continue
        const slave = videoRefs.current.get(camId)
        if (!slave) continue
        const drift = slave.currentTime - masterT

        if (Math.abs(drift) >= 0.5) {
          // Hard seek — situação extrema (rede cortou, buffering pesado)
          slave.currentTime = masterT
          slave.playbackRate = speed
        } else if (Math.abs(drift) >= 0.05) {
          // Soft sync: ajusta rate para convergir
          // drift positivo = slave adiantado → diminui rate
          slave.playbackRate = drift > 0 ? speed * 0.95 : speed * 1.05
        } else {
          slave.playbackRate = speed  // estado estável
        }
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [playing, allReady, masterCameraId, visibleCameras, speed])

  // ── Aplicar speed em todos quando muda ──────────────────────────────────
  useEffect(() => {
    for (const camId of visibleCameras) {
      const v = videoRefs.current.get(camId)
      if (v) v.playbackRate = speed
    }
  }, [speed, visibleCameras])

  // ── Aplicar play/pause ──────────────────────────────────────────────────
  useEffect(() => {
    if (!allReady) return
    for (const camId of visibleCameras) {
      const v = videoRefs.current.get(camId)
      if (!v) continue
      if (playing) v.play().catch(() => {})
      else v.pause()
    }
  }, [playing, allReady, visibleCameras])

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleVideoReady(cameraId: string) {
    setReady(prev => {
      if (prev.has(cameraId)) return prev
      const next = new Set(prev)
      next.add(cameraId)
      return next
    })
  }

  function handleVideoError(cameraId: string, msg: string) {
    setErrors(prev => {
      const next = new Map(prev)
      next.set(cameraId, msg)
      return next
    })
  }

  function setVideoRef(cameraId: string, el: HTMLVideoElement | null) {
    if (el) videoRefs.current.set(cameraId, el)
    else videoRefs.current.delete(cameraId)
  }

  function seekAll(toSec: number) {
    const clamped = Math.max(0, Math.min(toSec, totalSec))
    setCurrentTime(clamped)
    for (const camId of visibleCameras) {
      const v = videoRefs.current.get(camId)
      if (v) v.currentTime = clamped
    }
  }

  function togglePlay() {
    if (!allReady) return
    setPlaying(p => !p)
  }

  function enterFullscreen() {
    const root = document.getElementById('playback-mosaic-root')
    if (!root) return
    if (document.fullscreenElement) document.exitFullscreen()
    else root.requestFullscreen?.()
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (e.code === 'ArrowLeft')  seekAll(currentTime - (e.shiftKey ? 30 : 5))
      if (e.code === 'ArrowRight') seekAll(currentTime + (e.shiftKey ? 30 : 5))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentTime, totalSec, allReady])

  const fromIso = from.toISOString()
  const toIso   = to.toISOString()

  return (
    <div
      id="playback-mosaic-root"
      className="fixed inset-0 z-40 bg-black/95 backdrop-blur-sm flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <LayoutIcon className="w-4 h-4 text-cyan-400" />
            Mosaico de Reprodução Sincronizada
          </h2>
          <span className="text-[11px] text-slate-400">
            {visibleCameras.length} câmera{visibleCameras.length === 1 ? '' : 's'} ·{' '}
            {from.toLocaleString('pt-BR')} → {to.toLocaleString('pt-BR')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Layout selector */}
          <select
            value={layout}
            onChange={e => setLayout(e.target.value as LayoutId)}
            className="bg-white/5 border border-white/10 text-xs text-white rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
          >
            {(Object.keys(LAYOUTS) as LayoutId[]).map(l => (
              <option key={l} value={l} className="bg-space-900">{l} ({LAYOUTS[l].tiles} câm)</option>
            ))}
          </select>

          {onExport && (
            <button
              onClick={() => onExport(visibleCameras, from, to)}
              className="px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-xs font-medium hover:bg-violet-500/30 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Exportar Mosaico
            </button>
          )}

          <button
            onClick={enterFullscreen}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400"
            title="Tela cheia"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400"
              title="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Pre-roll barrier overlay */}
      {!allReady && (
        <div className="absolute inset-0 z-30 bg-black/70 flex items-center justify-center">
          <div className="text-center text-white">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-cyan-400" />
            <p className="text-sm font-semibold">Sincronizando câmeras...</p>
            <p className="text-xs text-slate-400 mt-1">
              {ready.size} / {visibleCameras.length} prontas
            </p>
          </div>
        </div>
      )}

      {/* Grid de vídeos */}
      <div
        className="flex-1 grid gap-1 p-2 bg-black"
        style={{
          gridTemplateColumns: `repeat(${LAYOUTS[layout].cols}, 1fr)`,
          gridTemplateRows:    `repeat(${LAYOUTS[layout].rows}, 1fr)`,
        }}
      >
        {visibleCameras.map(camId => {
          const isMaster = camId === masterCameraId
          const err = errors.get(camId)
          const isReady = ready.has(camId)
          const url = `${BASE_URL}/recordings/stream?cameraId=${camId}&from=${fromIso}&to=${toIso}`

          return (
            <div
              key={camId}
              className={`relative bg-slate-900 rounded overflow-hidden ${
                isMaster ? 'ring-1 ring-cyan-500/50' : ''
              }`}
            >
              {/* Badge master */}
              {isMaster && (
                <span className="absolute top-1 left-1 z-10 text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/80 text-white font-mono">
                  MASTER
                </span>
              )}
              <span className="absolute top-1 right-1 z-10 text-[9px] px-1.5 py-0.5 rounded bg-black/70 text-white font-mono">
                {camId.slice(0, 6)}
              </span>

              <video
                ref={el => setVideoRef(camId, el)}
                src={url}
                muted={!isMaster}  // só master tem áudio (evita eco)
                playsInline
                preload="auto"
                className="w-full h-full object-contain"
                onLoadedData={() => handleVideoReady(camId)}
                onCanPlayThrough={() => handleVideoReady(camId)}
                onError={() => handleVideoError(camId, 'Erro ao carregar stream')}
              />

              {!isReady && !err && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                </div>
              )}
              {err && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-rose-400 text-xs gap-1 bg-black/80">
                  <AlertCircle className="w-6 h-6" />
                  <span>{err}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Controles inferiores */}
      <div className="border-t border-white/10 bg-black/50 p-3 space-y-2">
        {/* Timeline */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-cyan-400 font-mono w-20 tabular-nums">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={totalSec}
            step={0.1}
            value={currentTime}
            onChange={e => seekAll(+e.target.value)}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-white/10 accent-cyan-500"
          />
          <span className="text-xs text-slate-400 font-mono w-20 tabular-nums">
            {formatTime(totalSec)}
          </span>
        </div>

        {/* Botões + speed */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => seekAll(currentTime - 30)}
            disabled={!allReady}
            className="px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
            title="−30s"
          >
            −30s
          </button>
          <button
            onClick={() => seekAll(currentTime - 5)}
            disabled={!allReady}
            className="px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
            title="−5s"
          >
            −5s
          </button>

          <button
            onClick={togglePlay}
            disabled={!allReady}
            className="w-10 h-10 rounded-full bg-cyan-500 hover:bg-cyan-600 text-white flex items-center justify-center transition disabled:opacity-50"
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>

          <button
            onClick={() => seekAll(currentTime + 5)}
            disabled={!allReady}
            className="px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
            title="+5s"
          >
            +5s
          </button>
          <button
            onClick={() => seekAll(currentTime + 30)}
            disabled={!allReady}
            className="px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
            title="+30s"
          >
            +30s
          </button>

          <div className="w-px h-6 bg-white/10 mx-2" />

          {/* Speed */}
          <div className="flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={speed}
              onChange={e => setSpeed(+e.target.value)}
              className="bg-white/5 border border-white/10 text-xs text-white rounded px-2 py-1 focus:outline-none"
            >
              {SPEEDS.map(s => <option key={s} value={s} className="bg-space-900">{s}×</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`
}
