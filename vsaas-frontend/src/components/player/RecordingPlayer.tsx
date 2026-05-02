/**
 * RecordingPlayer — player avançado de gravações com timeline integrada.
 *
 * Foco em UX de revisão (NLE-style):
 *   - Play/Pause (espaço)
 *   - Frame anterior / próximo (← / →) — pausa e avança 1/fps
 *   - Skip configurável (5s, 10s, 30s, 1min, 5min, 10min)
 *   - Velocidade: 0.25× / 0.5× / 1× / 2× / 4× / 8×
 *   - Volume + auto-select de áudio (1° track auto, ou dropdown se múltiplas)
 *   - Modo de fit (contain / cover / fill) — alterna 3 modos
 *   - Fullscreen
 *   - Prev/next bookmark (≪ / ≫)
 *   - Timeline integrada (RecordingTimeline) com seek por click
 *
 * URL do video: ${BASE_URL}/recordings/stream?cameraId=...&from=ISO&to=ISO
 * (pode retornar HLS no futuro — usamos hls.js se a URL terminar em .m3u8;
 *  caso contrário, atribuímos direto via <video src>).
 *
 * Nota: o endpoint pode ainda não existir. UI continua funcionando — só o
 * vídeo fica em estado de erro.
 */
import {
  useEffect, useMemo, useRef, useState, useCallback,
} from 'react'
import Hls from 'hls.js'
import {
  Play, Pause, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  SkipBack, SkipForward, Volume2, VolumeX, Maximize2, Minimize2,
  Gauge, Maximize, AlertCircle, Loader2,
} from 'lucide-react'
import { BASE_URL, type Bookmark } from '../../api/client'
import { RecordingTimeline } from '../timeline/RecordingTimeline'
import { cn } from '../../lib/utils'

export interface RecordingPlayerProps {
  cameraId: string
  /** Timestamp inicial do playback */
  startAt?: Date
  /** Modo de redimensionamento */
  fitMode?: 'contain' | 'cover' | 'fill'
  /** Auto-tocar ao carregar */
  autoPlay?: boolean
  /** Callback de tempo atual (para sync timeline externa) */
  onTimeUpdate?: (t: Date) => void
  /** Bookmarks visíveis para navegação prev/next */
  bookmarks?: Bookmark[]
  className?: string
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const
type Speed = typeof SPEEDS[number]

const SKIP_OPTIONS_SEC = [5, 10, 30, 60, 300, 600] as const
type SkipSec = typeof SKIP_OPTIONS_SEC[number]

const FIT_MODES: ('contain' | 'cover' | 'fill')[] = ['contain', 'cover', 'fill']

interface AudioTrackOption {
  id:    number
  label: string
}

// `AudioTrack` / `AudioTrackList` são API não-padronizadas (suportadas em
// Chrome/Safari mas não declaradas na lib DOM padrão do TS). Definimos
// mínimo aqui para acessar `.label`, `.language`, `.enabled` e iterar.
interface IcvAudioTrack {
  label?:    string
  language?: string
  enabled:   boolean
}
interface IcvAudioTrackList {
  length: number
  [index: number]: IcvAudioTrack
}

export function RecordingPlayer({
  cameraId,
  startAt,
  fitMode: fitModeProp = 'contain',
  autoPlay = true,
  onTimeUpdate,
  bookmarks = [],
  className,
}: RecordingPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef     = useRef<HTMLVideoElement>(null)
  const hlsRef       = useRef<Hls | null>(null)

  // ── Janela de stream ─────────────────────────────────────────────────
  // Usamos uma janela default de 24h ao redor do startAt — o backend fica
  // responsável por servir um manifest contínuo dentro dela.
  const initialFrom = useMemo(() => {
    const base = startAt ?? new Date()
    return new Date(base.getTime() - 12 * 60 * 60 * 1000)
  }, [startAt?.getTime()])
  const initialTo = useMemo(() => {
    const base = startAt ?? new Date()
    return new Date(base.getTime() + 12 * 60 * 60 * 1000)
  }, [startAt?.getTime()])

  // ── Estado UI ────────────────────────────────────────────────────────
  const [playing, setPlaying]     = useState(false)
  const [muted, setMuted]         = useState(false)
  const [volume, setVolume]       = useState(1)
  const [speed, setSpeed]         = useState<Speed>(1)
  const [skip, setSkip]           = useState<SkipSec>(10)
  const [fps, setFps]             = useState(30)
  const [fitMode, setFitMode]     = useState<'contain' | 'cover' | 'fill'>(fitModeProp)
  const [fullscreen, setFullscreen] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([])
  const [activeAudio, setActiveAudio] = useState<number | null>(null)
  const [currentSec, setCurrentSec] = useState(0)
  const [duration, setDuration]   = useState(0)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [showSkipMenu, setShowSkipMenu]   = useState(false)
  const [showAudioMenu, setShowAudioMenu] = useState(false)

  // Tempo absoluto atual (para timeline + onTimeUpdate). Computa-se a partir
  // de currentSec deslocado de initialFrom (assumindo manifest começa em from).
  const currentDate = useMemo(
    () => new Date(initialFrom.getTime() + currentSec * 1000),
    [initialFrom, currentSec],
  )

  // ── Mount HLS / src ──────────────────────────────────────────────────
  const streamUrl = useMemo(() => {
    const qs = new URLSearchParams({
      cameraId,
      from: initialFrom.toISOString(),
      to:   initialTo.toISOString(),
    })
    return `${BASE_URL}/recordings/stream?${qs.toString()}`
  }, [cameraId, initialFrom, initialTo])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    setLoading(true)
    setError(null)

    // Cleanup previous HLS
    if (hlsRef.current) {
      try { hlsRef.current.destroy() } catch {}
      hlsRef.current = null
    }

    // Detecta HLS pelo path; senão, usa src direto (mp4/webm/etc).
    const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('format=hls')

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false })
      hlsRef.current = hls
      hls.loadSource(streamUrl)
      hls.attachMedia(v)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false)
        if (autoPlay) v.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError(data.details ?? 'Falha no stream')
          setLoading(false)
        }
      })
    } else {
      // Browser nativo (Safari) ou non-HLS.
      v.src = streamUrl
      const onLoaded = () => {
        setLoading(false)
        if (autoPlay) v.play().catch(() => {})
      }
      const onErr = () => {
        setError('Falha ao carregar gravação')
        setLoading(false)
      }
      v.addEventListener('loadedmetadata', onLoaded)
      v.addEventListener('error', onErr)
      return () => {
        v.removeEventListener('loadedmetadata', onLoaded)
        v.removeEventListener('error', onErr)
      }
    }

    return () => {
      if (hlsRef.current) {
        try { hlsRef.current.destroy() } catch {}
        hlsRef.current = null
      }
    }
  }, [streamUrl, autoPlay])

  // ── Listeners do <video> ─────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const handlePlay  = () => setPlaying(true)
    const handlePause = () => setPlaying(false)
    const handleTime  = () => {
      setCurrentSec(v.currentTime)
      const abs = new Date(initialFrom.getTime() + v.currentTime * 1000)
      onTimeUpdate?.(abs)
    }
    const handleDuration = () => setDuration(v.duration || 0)
    const handleRateChange = () => setSpeed(v.playbackRate as Speed)
    const handleVolumeChange = () => {
      setVolume(v.volume)
      setMuted(v.muted)
    }

    // audioTracks (Safari/Chrome têm `audioTracks` API; degrada graciosamente).
    const detectAudio = () => {
      const tracks = (v as unknown as { audioTracks?: IcvAudioTrackList }).audioTracks
      if (!tracks || tracks.length === 0) {
        setAudioTracks([])
        setActiveAudio(null)
        return
      }
      const opts: AudioTrackOption[] = []
      let active: number | null = null
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i]
        opts.push({ id: i, label: t.label || t.language || `Áudio ${i + 1}` })
        if (t.enabled) active = i
      }
      // Auto-select primeiro se nenhum ativo.
      if (active === null && opts.length > 0) {
        tracks[0].enabled = true
        active = 0
      }
      setAudioTracks(opts)
      setActiveAudio(active)
    }

    v.addEventListener('play', handlePlay)
    v.addEventListener('pause', handlePause)
    v.addEventListener('timeupdate', handleTime)
    v.addEventListener('durationchange', handleDuration)
    v.addEventListener('loadedmetadata', detectAudio)
    v.addEventListener('ratechange', handleRateChange)
    v.addEventListener('volumechange', handleVolumeChange)
    return () => {
      v.removeEventListener('play', handlePlay)
      v.removeEventListener('pause', handlePause)
      v.removeEventListener('timeupdate', handleTime)
      v.removeEventListener('durationchange', handleDuration)
      v.removeEventListener('loadedmetadata', detectAudio)
      v.removeEventListener('ratechange', handleRateChange)
      v.removeEventListener('volumechange', handleVolumeChange)
    }
  }, [initialFrom, onTimeUpdate])

  // Aplica startAt → seeka quando metadata carregar.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !startAt) return
    const offsetSec = (startAt.getTime() - initialFrom.getTime()) / 1000
    if (offsetSec >= 0) {
      const apply = () => { v.currentTime = offsetSec }
      if (v.readyState >= 1) apply()
      else v.addEventListener('loadedmetadata', apply, { once: true })
    }
  }, [startAt, initialFrom])

  // ── Controles ────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [])

  const stepFrame = useCallback((dir: 1 | -1) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    v.currentTime = Math.max(0, v.currentTime + dir * (1 / Math.max(1, fps)))
  }, [fps])

  const skipBy = useCallback((sec: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(duration || Infinity, v.currentTime + sec))
  }, [duration])

  const applySpeed = useCallback((s: Speed) => {
    const v = videoRef.current
    if (v) v.playbackRate = s
    setSpeed(s)
    setShowSpeedMenu(false)
  }, [])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
  }, [])

  const onVolumeChange = useCallback((value: number) => {
    const v = videoRef.current
    if (!v) return
    v.volume = value
    if (value > 0) v.muted = false
  }, [])

  const cycleFit = useCallback(() => {
    const idx = FIT_MODES.indexOf(fitMode)
    setFitMode(FIT_MODES[(idx + 1) % FIT_MODES.length])
  }, [fitMode])

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen()
  }, [])

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const setAudioTrack = useCallback((id: number) => {
    const v = videoRef.current
    if (!v) return
    const tracks = (v as unknown as { audioTracks?: IcvAudioTrackList }).audioTracks
    if (!tracks) return
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].enabled = i === id
    }
    setActiveAudio(id)
    setShowAudioMenu(false)
  }, [])

  // ── Bookmark prev/next ───────────────────────────────────────────────
  const sortedBookmarks = useMemo(
    () => [...bookmarks].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [bookmarks],
  )

  const seekToBookmark = useCallback((dir: 1 | -1) => {
    if (sortedBookmarks.length === 0) return
    const v = videoRef.current
    if (!v) return
    const curMs = currentDate.getTime()
    let target: Bookmark | null = null
    if (dir === 1) {
      target = sortedBookmarks.find(b => new Date(b.startAt).getTime() > curMs + 100) ?? null
    } else {
      const reversed = [...sortedBookmarks].reverse()
      target = reversed.find(b => new Date(b.startAt).getTime() < curMs - 100) ?? null
    }
    if (target) {
      const offset = (new Date(target.startAt).getTime() - initialFrom.getTime()) / 1000
      if (offset >= 0) v.currentTime = offset
    }
  }, [sortedBookmarks, currentDate, initialFrom])

  // ── Atalhos ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Não atrapalha digitação em inputs.
      const tgt = e.target as HTMLElement
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        if (e.shiftKey) skipBy(-skip)
        else stepFrame(-1)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        if (e.shiftKey) skipBy(skip)
        else stepFrame(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, stepFrame, skipBy, skip])

  // ── Seek vindo da timeline ───────────────────────────────────────────
  const onTimelineSeek = useCallback((ts: Date) => {
    const v = videoRef.current
    if (!v) return
    const offset = (ts.getTime() - initialFrom.getTime()) / 1000
    if (offset >= 0) v.currentTime = offset
  }, [initialFrom])

  // Sample fps a partir do primeiro frame (quando webkitDecodedFrameCount
  // estiver disponível; senão mantém 30 default).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let timer: ReturnType<typeof setInterval> | null = null
    let lastFrames = 0
    let lastT = 0
    const tryDetect = () => {
      const w = v as unknown as { webkitDecodedFrameCount?: number }
      const frames = w.webkitDecodedFrameCount
      if (frames === undefined) return
      const t = v.currentTime
      if (lastFrames > 0 && t > lastT) {
        const measured = (frames - lastFrames) / Math.max(0.5, t - lastT)
        if (measured > 5 && measured < 120) setFps(Math.round(measured))
        if (timer) clearInterval(timer)
      }
      lastFrames = frames
      lastT = t
    }
    timer = setInterval(tryDetect, 1000)
    return () => { if (timer) clearInterval(timer) }
  }, [streamUrl])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex flex-col w-full bg-black rounded-xl overflow-hidden border border-white/10',
        className,
      )}
    >
      {/* Vídeo */}
      <div className="relative w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
        <video
          ref={videoRef}
          className="w-full h-full"
          style={{ objectFit: fitMode }}
          playsInline
        />

        {/* Loading */}
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        )}

        {/* Erro */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            <AlertCircle className="w-8 h-8 text-rose-400 mb-2" />
            <p className="text-xs font-semibold text-rose-300">Falha no stream</p>
            <p className="text-[10px] text-slate-400 mt-1 max-w-xs text-center px-4">{error}</p>
          </div>
        )}
      </div>

      {/* Controles */}
      <div className="flex flex-col gap-2 px-3 py-2 bg-slate-900/95 dark:bg-slate-950/95 border-t border-white/5">
        {/* Linha 1: timeline */}
        <RecordingTimeline
          cameraId={cameraId}
          initialFrom={initialFrom}
          initialTo={initialTo}
          currentTime={currentDate}
          onSeek={onTimelineSeek}
          compact
        />

        {/* Linha 2: botões */}
        <div className="flex items-center gap-1 flex-wrap">
          {/* Bookmarks prev/next */}
          {sortedBookmarks.length > 0 && (
            <button
              onClick={() => seekToBookmark(-1)}
              title="Bookmark anterior"
              className="p-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          )}

          {/* Skip back */}
          <div className="flex items-center">
            <button
              onClick={() => skipBy(-skip)}
              title={`Voltar ${skip}s`}
              className="px-2 py-1.5 rounded-l-md text-slate-300 hover:bg-white/10 hover:text-white text-[11px] font-mono flex items-center gap-1"
            >
              <SkipBack className="w-3.5 h-3.5" /> -{skip}s
            </button>
            <div className="relative">
              <button
                onClick={() => setShowSkipMenu(s => !s)}
                title="Configurar skip"
                className="px-1.5 py-1.5 rounded-r-md text-slate-400 hover:bg-white/10 hover:text-white border-l border-white/10"
              >
                <ChevronRight className={cn('w-3 h-3 transition-transform', showSkipMenu && 'rotate-90')} />
              </button>
              {showSkipMenu && (
                <div className="absolute bottom-full mb-1 left-0 bg-slate-800 border border-white/10 rounded-md shadow-xl z-30 min-w-[80px]">
                  {SKIP_OPTIONS_SEC.map(s => (
                    <button
                      key={s}
                      onClick={() => { setSkip(s); setShowSkipMenu(false) }}
                      className={cn(
                        'block w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-white/10',
                        s === skip ? 'text-cyan-300' : 'text-slate-300',
                      )}
                    >
                      {s < 60 ? `${s}s` : `${s / 60}min`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Frame back */}
          <button
            onClick={() => stepFrame(-1)}
            title="Frame anterior (←)"
            className="p-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            title={playing ? 'Pausar (espaço)' : 'Tocar (espaço)'}
            className="p-2 rounded-md bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          {/* Frame fwd */}
          <button
            onClick={() => stepFrame(1)}
            title="Próximo frame (→)"
            className="p-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Skip fwd */}
          <button
            onClick={() => skipBy(skip)}
            title={`Avançar ${skip}s`}
            className="px-2 py-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white text-[11px] font-mono flex items-center gap-1"
          >
            +{skip}s <SkipForward className="w-3.5 h-3.5" />
          </button>

          {sortedBookmarks.length > 0 && (
            <button
              onClick={() => seekToBookmark(1)}
              title="Próximo bookmark"
              className="p-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          )}

          {/* Tempo atual */}
          <div className="px-2 text-[11px] font-mono text-slate-400 tabular-nums">
            {formatHMS(currentSec)} / {formatHMS(duration)}
          </div>

          <div className="ml-auto flex items-center gap-1">
            {/* Speed */}
            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu(s => !s)}
                className="px-2 py-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white text-[11px] font-mono flex items-center gap-1"
                title="Velocidade"
              >
                <Gauge className="w-3.5 h-3.5" /> {speed}×
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full mb-1 right-0 bg-slate-800 border border-white/10 rounded-md shadow-xl z-30 min-w-[70px]">
                  {SPEEDS.map(s => (
                    <button
                      key={s}
                      onClick={() => applySpeed(s)}
                      className={cn(
                        'block w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-white/10',
                        s === speed ? 'text-cyan-300' : 'text-slate-300',
                      )}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Volume */}
            <div className="flex items-center gap-1">
              <button
                onClick={toggleMute}
                title={muted ? 'Ativar áudio' : 'Mutar'}
                className="p-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white"
              >
                {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="w-16 accent-cyan-400"
              />
            </div>

            {/* Audio tracks (só aparece se múltiplas) */}
            {audioTracks.length > 1 && (
              <div className="relative">
                <button
                  onClick={() => setShowAudioMenu(s => !s)}
                  className="px-2 py-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white text-[10px] font-mono"
                  title="Trilha de áudio"
                >
                  AUD
                </button>
                {showAudioMenu && (
                  <div className="absolute bottom-full mb-1 right-0 bg-slate-800 border border-white/10 rounded-md shadow-xl z-30 min-w-[140px]">
                    {audioTracks.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setAudioTrack(t.id)}
                        className={cn(
                          'block w-full text-left px-2 py-1 text-[11px] hover:bg-white/10',
                          t.id === activeAudio ? 'text-cyan-300' : 'text-slate-300',
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Fit mode */}
            <button
              onClick={cycleFit}
              title={`Modo: ${fitMode}`}
              className="px-2 py-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white text-[10px] font-mono uppercase flex items-center gap-1"
            >
              <Maximize className="w-3.5 h-3.5" />
              {fitMode}
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              title={fullscreen ? 'Sair tela cheia' : 'Tela cheia'}
              className="p-1.5 rounded-md text-slate-300 hover:bg-white/10 hover:text-white"
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatHMS(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}
