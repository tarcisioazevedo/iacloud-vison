/**
 * PlaybackPlayer — player HLS pra revisão de gravações.
 *
 * Diferente do LivePlayer (WebRTC sub-segundo), este consome manifest
 * VOD via hls.js. Suporta seek arbitrário, velocidade variável (0.5×→4×),
 * e exibe tempo atual/total.
 *
 * Como o ticket dura 30min e a gravação pode ser longa, o componente
 * renova o manifest quando o ticket está perto de expirar (a cada vez
 * que a janela seekedTo/range mudar significativamente).
 */
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import Hls from 'hls.js'
import {
  Play, Pause, FastForward, Rewind, Maximize2, Minimize2,
  Volume2, VolumeX, AlertCircle, Loader2,
} from 'lucide-react'
import { issuePlaybackToken, BASE_URL } from '../../api/client'
import { cn } from '../../lib/utils'

interface PlaybackPlayerProps {
  cameraId: string
  /** Início do range a reproduzir (UTC). */
  fromIso: string
  /** Fim do range a reproduzir (UTC). */
  toIso: string
  /** Velocidade inicial. Default 1.0. */
  initialRate?: number
  /** Disparado a cada `timeupdate` do <video>. Útil pra sincronizar timeline UI. */
  onTimeUpdate?: (currentSec: number, durationSec: number) => void
  className?: string
  /**
   * Modo minimal: esconde a barra de controles (play/pause/scrubber/speed/mute).
   * Útil pra embedar em tiles do mosaico onde o controle é externo (timeline
   * por tile, atalhos de teclado etc.). Loading/error overlays continuam.
   */
  minimal?: boolean
  /** Auto-play (default: true em playback). Mosaico pode setar false pra
   *  controlar manualmente. */
  autoPlay?: boolean
}

export interface PlaybackPlayerRef {
  /** Move o playhead pra `sec` segundos relativos ao início do manifest. */
  seekTo: (sec: number) => void
  /** Toggle play/pause. */
  togglePlay: () => void
  /** Define velocidade (0.5, 1, 2, 4). */
  setRate: (rate: number) => void
}

const SPEEDS = [0.5, 1, 2, 4] as const

export const PlaybackPlayer = forwardRef<PlaybackPlayerRef, PlaybackPlayerProps>(
  function PlaybackPlayer(props, ref) {
    const { cameraId, fromIso, toIso, initialRate = 1, onTimeUpdate, className,
            minimal = false, autoPlay = true } = props

    const videoRef = useRef<HTMLVideoElement>(null)
    const hlsRef = useRef<Hls | null>(null)

    const [loading, setLoading] = useState(true)
    const [error, setError]     = useState<string | null>(null)
    const [playing, setPlaying] = useState(false)
    const [muted, setMuted]     = useState(true)
    const [rate, setRateState]  = useState(initialRate)
    const [current, setCurrent] = useState(0)
    const [duration, setDuration] = useState(0)
    const [isFs, setIsFs]       = useState(false)

    // Imperative API pro parent (timeline → seekTo, etc)
    useImperativeHandle(ref, () => ({
      seekTo: (sec: number) => {
        if (videoRef.current) videoRef.current.currentTime = sec
      },
      togglePlay: () => {
        const v = videoRef.current
        if (!v) return
        if (v.paused) v.play().catch(() => {})
        else v.pause()
      },
      setRate: (r: number) => setRateState(r),
    }), [])

    // ── Carrega manifest + plug hls.js ────────────────────────────────────
    //
    // Roda quando cameraId/range muda. Mata HLS anterior antes de criar novo
    // pra evitar leak de event listeners + segment fetch órfão.
    useEffect(() => {
      let cancelled = false
      setLoading(true)
      setError(null)

      ;(async () => {
        try {
          // 1. Pede ticket pro range desejado
          const { manifestUrl } = await issuePlaybackToken(cameraId, fromIso, toIso)
          if (cancelled || !videoRef.current) return

          const fullUrl = `${BASE_URL}${manifestUrl}`

          // 2. Limpa HLS anterior
          if (hlsRef.current) {
            hlsRef.current.destroy()
            hlsRef.current = null
          }

          // 3. Estratégia de player. ORDEM IMPORTA:
          //
          //    a. hls.js (Chrome, Firefox, Edge, Safari Desktop com MSE)
          //       — usar SEMPRE quando suportado. Por quê? Chrome retorna
          //       'maybe' em canPlayType('application/vnd.apple.mpegurl')
          //       (truthy!) mas NÃO tem suporte HLS nativo — cair no
          //       branch "Safari" produz erro silencioso de manifest.
          //    b. Safari iOS / WebKit estrito — não suporta MSE → hls.js
          //       falha com isSupported()=false. Aí sim caímos em
          //       <video src=manifest.m3u8> nativo.
          //    c. Browser pré-histórico — mensagem clara.
          const video = videoRef.current
          if (Hls.isSupported()) {
            const hls = new Hls({
              // Manifest é VOD curto (poucos segundos de carregamento), não
              // precisamos low-latency tweaks. Defaults bons.
              maxBufferLength: 30,           // 30s buffer ahead — economiza banda
              enableWorker: true,            // parse em worker thread (perf)
            })
            hlsRef.current = hls
            hls.loadSource(fullUrl)
            hls.attachMedia(video)

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (cancelled) return
              setLoading(false)
              setDuration(video.duration || 0)
              // Auto-play explícito — atributo `autoPlay` do <video> é
              // unreliable em alguns browsers quando src é setado via JS.
              // Como estamos muted=true por default, navegador permite.
              if (autoPlay) {
                video.play().catch(err => {
                  // NotAllowedError: política de auto-play. Operador
                  // aperta play manualmente — não é erro fatal.
                  console.debug('[playback] autoplay blocked:', err.name)
                })
              }
            })

            hls.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal) {
                setError(`HLS: ${data.details ?? data.type}`)
                setLoading(false)
              }
            })
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari iOS / WebKit sem MSE — HLS é nativo via <video src=...>
            video.src = fullUrl
            video.addEventListener('loadedmetadata', () => {
              if (!cancelled) {
                setLoading(false)
                setDuration(video.duration)
                if (autoPlay) {
                  video.play().catch(err => {
                    console.debug('[playback] autoplay blocked (Safari):', err.name)
                  })
                }
              }
            }, { once: true })
            video.addEventListener('error', () => {
              if (!cancelled) { setError('Falha ao carregar manifest (Safari)'); setLoading(false) }
            }, { once: true })
          } else {
            setError('Seu navegador não suporta HLS playback')
            setLoading(false)
          }
        } catch (err: any) {
          if (cancelled) return
          setError(err?.response?.data?.message ?? err?.message ?? 'Erro ao carregar gravação')
          setLoading(false)
        }
      })()

      return () => {
        cancelled = true
        if (hlsRef.current) {
          hlsRef.current.destroy()
          hlsRef.current = null
        }
      }
    }, [cameraId, fromIso, toIso])

    // ── Sync video state ↔ React state ────────────────────────────────────
    useEffect(() => {
      const v = videoRef.current
      if (!v) return
      v.playbackRate = rate
    }, [rate])

    useEffect(() => {
      const v = videoRef.current
      if (!v) return
      v.muted = muted
    }, [muted])

    useEffect(() => {
      const v = videoRef.current
      if (!v) return
      const onPlay  = () => setPlaying(true)
      const onPause = () => setPlaying(false)
      const onTime  = () => {
        setCurrent(v.currentTime)
        if (v.duration && v.duration !== duration) setDuration(v.duration)
        onTimeUpdate?.(v.currentTime, v.duration)
      }
      const onEnd = () => setPlaying(false)
      v.addEventListener('play',  onPlay)
      v.addEventListener('pause', onPause)
      v.addEventListener('timeupdate', onTime)
      v.addEventListener('ended', onEnd)
      return () => {
        v.removeEventListener('play',  onPlay)
        v.removeEventListener('pause', onPause)
        v.removeEventListener('timeupdate', onTime)
        v.removeEventListener('ended', onEnd)
      }
    }, [duration, onTimeUpdate])

    useEffect(() => {
      const handler = () => setIsFs(!!document.fullscreenElement)
      document.addEventListener('fullscreenchange', handler)
      return () => document.removeEventListener('fullscreenchange', handler)
    }, [])

    function toggleFs() {
      const wrap = videoRef.current?.parentElement
      if (!wrap) return
      if (document.fullscreenElement) document.exitFullscreen()
      else wrap.requestFullscreen()
    }

    function fmt(sec: number): string {
      if (!isFinite(sec) || sec < 0) return '00:00'
      const h = Math.floor(sec / 3600)
      const m = Math.floor((sec % 3600) / 60)
      const s = Math.floor(sec % 60)
      const pad = (n: number) => String(n).padStart(2, '0')
      return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
    }

    return (
      <div className={cn('relative bg-black rounded-lg overflow-hidden border border-white/10 group', className)}>
        <video
          ref={videoRef}
          autoPlay={autoPlay}
          playsInline
          muted
          className="w-full h-full object-contain bg-black"
          onClick={() => {
            const v = videoRef.current
            if (!v) return
            if (v.paused) v.play().catch(() => {})
            else v.pause()
          }}
        />

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mb-2" />
            <p className="text-xs text-slate-300">Carregando gravação…</p>
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
            <AlertCircle className="w-8 h-8 text-rose-400 mb-2" />
            <p className="text-xs text-rose-300 font-semibold">Falha no playback</p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-xs text-center px-4">{error}</p>
          </div>
        )}

        {/* Controles inferiores — aparecem com hover (escondidos em minimal) */}
        {!loading && !error && !minimal && (
          <div className="absolute bottom-0 inset-x-0 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent
                          opacity-0 group-hover:opacity-100 transition flex items-center gap-2">
            <button
              onClick={() => {
                const v = videoRef.current
                if (!v) return
                if (v.paused) v.play().catch(() => {})
                else v.pause()
              }}
              className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
              title={playing ? 'Pausar (espaço)' : 'Tocar'}
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            </button>
            <button
              onClick={() => {
                const v = videoRef.current
                if (v) v.currentTime = Math.max(0, v.currentTime - 10)
              }}
              className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
              title="−10s"
            >
              <Rewind className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                const v = videoRef.current
                if (v) v.currentTime = Math.min(duration, v.currentTime + 10)
              }}
              className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
              title="+10s"
            >
              <FastForward className="w-3.5 h-3.5" />
            </button>

            <div className="text-[10px] font-mono text-white/90 tabular-nums px-1">
              {fmt(current)} / {fmt(duration)}
            </div>

            <div className="flex-1" />

            {/* Speed selector */}
            <select
              value={rate}
              onChange={e => setRateState(+e.target.value)}
              className="text-[10px] bg-white/10 hover:bg-white/20 text-white border-0 rounded px-1.5 py-1 cursor-pointer focus:outline-none"
            >
              {SPEEDS.map(s => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>

            <button
              onClick={() => setMuted(m => !m)}
              className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
              title={muted ? 'Ativar áudio' : 'Mutar'}
            >
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={toggleFs}
              className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
              title={isFs ? 'Sair tela cheia' : 'Tela cheia'}
            >
              {isFs ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}

        {/* Badge "PLAYBACK" + indicador velocidade */}
        {!loading && !error && (
          <div className="absolute top-2 left-2 flex items-center gap-2 pointer-events-none">
            <span className="px-2 py-0.5 rounded-full bg-amber-500/90 text-white text-[10px] font-bold flex items-center gap-1">
              PLAYBACK
            </span>
            {rate !== 1 && (
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/90 text-white text-[10px] font-bold">
                {rate}×
              </span>
            )}
          </div>
        )}
      </div>
    )
  },
)
