/**
 * LivePlayer — player de live baseado em WebRTC (WHEP) com fallback
 * SNAPSHOT-POLL (substituiu MJPEG, que dependia de codec mismatch fix
 * complicado no go2rtc 1.9.x).
 *
 * Fluxo:
 *   1. GET /cameras/:id/live-token?kind=whep   → ticket JWT de 60s
 *   2. Cria RTCPeerConnection com iceServers da resposta
 *   3. Gera SDP offer → POST /live/:id/whep?ticket=… → recebe SDP answer
 *   4. Stream chega em pc.ontrack → videoRef.current.srcObject
 *   5. Se ICE falhar ou timeout 10s sem mídia → cai para snapshot-poll
 *      (GET /live/:id/snapshot-jpeg renovado a cada 5s via cache-buster)
 *
 * Props:
 *   cameraId     — id da câmera
 *   mode         — 'auto' | 'whep' | 'mjpeg' (default: 'auto')
 *   muted        — boolean, default true
 *   showOverlay  — mostra nome, latência, indicador live
 *   onStatus     — callback com status atual ('connecting' | 'live' | 'fallback' | 'error')
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Maximize2, Minimize2, Volume2, VolumeX, Camera as CameraIcon,
  Wifi, WifiOff, RefreshCw, AlertTriangle, Activity,
} from 'lucide-react'
import { getLiveToken, getWhepUrl, BASE_URL } from '../../api/client'
import { cn } from '../../lib/utils'

type PlayerStatus = 'idle' | 'connecting' | 'live' | 'fallback' | 'error' | 'disabled'

interface LivePlayerProps {
  cameraId: string
  mode?: 'auto' | 'whep' | 'mjpeg'
  muted?: boolean
  showOverlay?: boolean
  onStatus?: (s: PlayerStatus) => void
  className?: string
  cameraName?: string
}

// Timeout para WHEP cair pra snapshot-poll. Aumentado iterativamente:
//   4s  → muito agressivo, mosaico caía falsamente
//   10s → ainda sofria com 16 tiles paralelos
//   15s → robusto. Em redes corporativas com STUN bloqueado o ICE pode
//         demorar até ~10s pra falhar; precisamos dar tempo. Trade-off:
//         primeiro frame demora mais quando NÃO há WHEP, mas o
//         auto-retry-WHEP-no-fallback (30s loop) compensa.
const WHEP_TIMEOUT_MS = 15_000

export function LivePlayer({
  cameraId,
  mode = 'auto',
  muted = true,
  showOverlay = true,
  onStatus,
  className,
  cameraName,
}: LivePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef    = useRef<RTCPeerConnection | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Snapshot-poll fallback: timers que ressuscitamos quando WHEP falha.
  const snapPollRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const snapTokenRef  = useRef<{ ticket: string; expiresAt: number } | null>(null)
  // Tolerância a erros transitórios — só mostra UI de erro depois de N falhas
  // seguidas. Conta zera no primeiro <img onLoad> bem-sucedido.
  const errorCountRef = useRef(0)
  // Timer de auto-retry WHEP quando estamos em fallback. Tentamos voltar pro
  // WebRTC a cada 30s (custo ~zero se mantém em fallback; ganho enorme se
  // o problema era transitório e WHEP volta).
  const whepRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Backoff de auto-reconnect quando status=error. Começa em 5s e dobra até
  // 60s — evita martelar o backend se câmera estiver mesmo offline.
  const reconnectBackoffRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [mjpegSrc, setMjpegSrc] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(muted)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [bitrate, setBitrate] = useState<number | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [resolution, setResolution] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)     // força reconexão ao incrementar

  const setStat = useCallback((s: PlayerStatus) => {
    setStatus(s)
    onStatus?.(s)
  }, [onStatus])

  // ── Cleanup helper ─────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    if (abortRef.current)   { abortRef.current.abort(); abortRef.current = null }
    if (snapPollRef.current) { clearInterval(snapPollRef.current); snapPollRef.current = null }
    if (whepRetryRef.current) { clearTimeout(whepRetryRef.current); whepRetryRef.current = null }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    snapTokenRef.current = null
    errorCountRef.current = 0
    if (pcRef.current) {
      try { pcRef.current.getSenders().forEach(s => s.track?.stop()) } catch {}
      try { pcRef.current.close() } catch {}
      pcRef.current = null
    }
    if (videoRef.current) {
      try {
        const s = videoRef.current.srcObject as MediaStream | null
        s?.getTracks().forEach(t => t.stop())
        videoRef.current.srcObject = null
      } catch {}
    }
  }, [])

  // ── Start Snapshot-Poll (fallback quando WHEP falha) ────────────────────
  // Substituiu o antigo MJPEG fallback. Razão: go2rtc 1.9.x precisa de um
  // producer ffmpeg com codec MJPEG explícito por stream pra que
  // /api/stream.mjpeg retorne bytes; configurar isso por câmera é frágil
  // (sintaxe diferente por versão, codec mismatch H264+AAC->MJPEG, etc).
  //
  // O endpoint /live/:id/snapshot-jpeg não depende de go2rtc — usa ffmpeg
  // local do backend e retorna 1 frame JPEG. Renovamos a URL a cada 5s
  // (cache-buster) e o <img> faz nova request HTTP. Latência alta (3-9s
  // primeiro frame) mas robusto: funciona em qualquer ambiente.
  //
  // Token do snapshot dura 60s; renovamos automaticamente a cada 50s.
  const startSnapshotPoll = useCallback(async () => {
    cleanup()
    setStat('connecting')
    setMjpegSrc(null)

    const refreshToken = async () => {
      const t = await getLiveToken(cameraId, 'snapshot')
      snapTokenRef.current = { ticket: t.ticket, expiresAt: Date.now() + 50_000 }
      setResolution(t.camera.resolution ?? null)
      return t.ticket
    }

    const buildUrl = (ticket: string) =>
      `${BASE_URL}/live/${cameraId}/snapshot-jpeg?ticket=${encodeURIComponent(ticket)}&_=${Date.now()}`

    try {
      const ticket = await refreshToken()
      setMjpegSrc(buildUrl(ticket))
      setStat('fallback')

      // Tick a cada 5s para refresh do <img> (cache-buster força nova GET).
      // Se o ticket está perto de expirar, renova primeiro.
      snapPollRef.current = setInterval(async () => {
        try {
          let cur = snapTokenRef.current
          if (!cur || Date.now() > cur.expiresAt) {
            await refreshToken()
            cur = snapTokenRef.current
          }
          if (cur) setMjpegSrc(buildUrl(cur.ticket))
        } catch {
          /* erro transitório — próximo tick retenta. <img onError>
             marca state error se a URL atual falhar de fato. */
        }
      }, 5_000)
    } catch (err: any) {
      setErrMsg(err?.response?.data?.message ?? err?.message ?? 'Erro desconhecido')
      setStat('error')
    }
  }, [cameraId, cleanup, setStat])

  // ── Start WHEP ─────────────────────────────────────────────────────────
  const startWhep = useCallback(async () => {
    cleanup()
    setStat('connecting')
    setMjpegSrc(null)
    setErrMsg(null)

    abortRef.current = new AbortController()

    let token
    try {
      token = await getLiveToken(cameraId, 'whep')
    } catch (err: any) {
      if (err?.response?.data?.message?.includes('desabilitado')) {
        setStat('disabled')
        return
      }
      if (mode === 'auto') return startSnapshotPoll()
      setErrMsg(err?.response?.data?.message ?? err?.message ?? 'Falha ao obter ticket')
      setStat('error')
      return
    }

    setResolution(token.camera.resolution ?? null)

    if (token.liveMode === 'DISABLED') { setStat('disabled'); return }
    if (token.liveMode === 'MJPEG_ONLY') return startSnapshotPoll()

    const pc = new RTCPeerConnection({ iceServers: token.iceServers })
    pcRef.current = pc

    // Apenas recvonly (audio+video)
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })

    pc.ontrack = (ev) => {
      if (!videoRef.current) return
      const [stream] = ev.streams
      videoRef.current.srcObject = stream
      // Track recebida → cancela timeout de fallback
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
      // WebRTC voltou — zera contadores de erro/backoff. Próxima queda
      // recomeça do delay mínimo (5s) em vez de continuar crescendo.
      errorCountRef.current = 0
      reconnectBackoffRef.current = 0
      setStat('live')
    }

    pc.onconnectionstatechange = () => {
      if (!pc) return
      const st = pc.connectionState
      if (st === 'failed' || st === 'closed' || st === 'disconnected') {
        if (status === 'live') {
          // caiu durante a playback — tenta reconectar
          setTimeout(() => setNonce(n => n + 1), 1500)
        } else if (mode === 'auto' && status !== 'fallback') {
          startSnapshotPoll()
        }
      }
    }

    // Timeout: se em 4s não chegar stream, cai pra MJPEG
    timeoutRef.current = setTimeout(() => {
      if (status !== 'live' && mode === 'auto') {
        startSnapshotPoll()
      }
    }, WHEP_TIMEOUT_MS)

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // aguardar ICE gathering (trickle off — simplifica)
      await new Promise<void>(resolve => {
        if (pc.iceGatheringState === 'complete') resolve()
        else {
          const handler = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', handler)
              resolve()
            }
          }
          pc.addEventListener('icegatheringstatechange', handler)
          // fallback 2s
          setTimeout(resolve, 2000)
        }
      })

      const resp = await fetch(getWhepUrl(cameraId, token.ticket), {
        method: 'POST',
        headers: { 'content-type': 'application/sdp' },
        body: pc.localDescription!.sdp,
        signal: abortRef.current.signal,
      })

      if (!resp.ok) {
        throw new Error(`WHEP ${resp.status}`)
      }

      const answerSdp = await resp.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    } catch (err: any) {
      if (err.name === 'AbortError') return
      if (mode === 'auto') return startSnapshotPoll()
      setErrMsg(err?.message ?? 'Falha WebRTC')
      setStat('error')
    }
  }, [cameraId, mode, cleanup, setStat, status, startSnapshotPoll])

  // ── Start based on mode ───────────────────────────────────────────────
  useEffect(() => {
    if (mode === 'mjpeg') startSnapshotPoll()
    else startWhep()
    return cleanup
    // nonce dispara reconexão sem mudar deps estruturais
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, mode, nonce])

  // ── Auto-retry WHEP a cada 30s quando estamos em fallback ─────────────
  // Justificativa: WHEP pode ter falhado por problema transitório (negociação
  // SDP demorou, ICE bloqueou) ou por fila no go2rtc. Tentar novamente em
  // background é barato — se sucesso, ganhamos vídeo fluido (sub-segundo)
  // de graça; se falha, continuamos no snapshot-poll sem prejuízo. Evita
  // o usuário ficar preso em snapshots pra sempre quando a causa raiz
  // do erro original já se resolveu.
  useEffect(() => {
    if (status !== 'fallback' || mode !== 'auto') return
    whepRetryRef.current = setTimeout(() => {
      // Tenta WHEP de novo via incremento de nonce — o useEffect principal
      // dispara cleanup() e depois startWhep().
      setNonce(n => n + 1)
    }, 30_000)
    return () => {
      if (whepRetryRef.current) { clearTimeout(whepRetryRef.current); whepRetryRef.current = null }
    }
  }, [status, mode])

  // ── Auto-reconnect com backoff exponencial quando status=error ─────────
  // Em vez de obrigar o usuário a clicar "Reconectar", tentamos sozinhos
  // com delay crescente: 5s, 10s, 20s, 40s, max 60s. Reseta para 0 quando
  // qualquer reconexão dá certo (zerado em onLoad/ontrack). Crítico para
  // VMS sem operador presente (NOC remoto, totem público).
  useEffect(() => {
    if (status !== 'error') return
    const cur = reconnectBackoffRef.current || 5_000
    const next = Math.min(cur * 2 || 5_000, 60_000)
    reconnectTimerRef.current = setTimeout(() => {
      reconnectBackoffRef.current = next
      setNonce(n => n + 1)
    }, cur)
    return () => {
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    }
  }, [status])

  // ── Stats polling (bitrate/latency) ───────────────────────────────────
  useEffect(() => {
    if (status !== 'live') return
    const id = setInterval(async () => {
      const pc = pcRef.current
      if (!pc) return
      try {
        const stats = await pc.getStats()
        let bytes = 0
        let jitter = 0
        let frames = 0
        stats.forEach(r => {
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            bytes = r.bytesReceived ?? 0
            jitter = (r.jitter ?? 0) * 1000
            frames = r.framesPerSecond ?? 0
          }
        })
        setBitrate(bytes)
        setLatencyMs(Math.round(jitter))
        if (frames) setResolution(r => r) // placeholder para reuso
      } catch {}
    }, 2000)
    return () => clearInterval(id)
  }, [status])

  // ── Fullscreen ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  function toggleFullscreen() {
    const el = videoRef.current?.parentElement
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen()
  }

  function reconnect() {
    // Reset do backoff — clique manual significa "quero tentar AGORA",
    // não respeitar o delay de auto-reconnect.
    reconnectBackoffRef.current = 0
    errorCountRef.current = 0
    setNonce(n => n + 1)
  }

  return (
    <div
      className={cn(
        'relative rounded-xl overflow-hidden bg-black group border border-white/10',
        className,
      )}
    >
      {/* WHEP video */}
      {!mjpegSrc && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMuted}
          className="w-full h-full object-contain"
        />
      )}

      {/* Snapshot-poll fallback (variável `mjpegSrc` mantida por compat com
          o restante do componente — agora carrega URL de snapshot-jpeg).
          Tolerância: precisa de N erros seguidos pra mostrar UI de erro;
          onLoad zera o contador e recupera de erro/connecting automaticamente. */}
      {mjpegSrc && (
        <img
          src={mjpegSrc}
          alt="Live snapshot"
          className="w-full h-full object-contain"
          onLoad={() => {
            // Frame chegou — recupera de qualquer estado degradado.
            // Útil quando o tick anterior falhou e o atual passou
            // (rede instável, ffmpeg em fila, etc).
            errorCountRef.current = 0
            reconnectBackoffRef.current = 0
            setErrMsg(null)
            // Se estávamos em 'error' ou 'connecting', volta pra 'fallback'
            // — assim o overlay vermelho some e usuário vê o frame.
            setStatus(s => (s === 'error' || s === 'connecting') ? 'fallback' : s)
          }}
          onError={() => {
            // Tolerar falhas isoladas: o setInterval do snapshot-poll
            // continua tentando a cada 5s. Só após 3 falhas seguidas
            // marcamos status=error (que mostra overlay + Reconectar).
            // Antes disso, fica silencioso — usuário vê o último frame.
            errorCountRef.current += 1
            if (errorCountRef.current >= 3) {
              setErrMsg('Falha ao carregar snapshot — RTSP inacessível?')
              setStat('error')
            }
          }}
        />
      )}

      {/* Loading */}
      <AnimatePresence>
        {status === 'connecting' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-space-900/80 backdrop-blur-sm"
          >
            <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mb-2" />
            <p className="text-xs text-slate-300 font-medium">Conectando live...</p>
            <p className="text-[10px] text-slate-500 mt-1">Negociando WebRTC</p>
          </motion.div>
        )}

        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-space-900/90 backdrop-blur-sm"
          >
            <AlertTriangle className="w-8 h-8 text-rose-400 mb-2" />
            <p className="text-xs font-semibold text-rose-300">Falha no stream</p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-xs text-center px-4">{errMsg}</p>
            {/* Auto-reconnect com backoff já está rodando em background — o
                botão é só um "tentar agora" pra não esperar o timer. */}
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              Reconectando automaticamente…
            </p>
            <button
              onClick={reconnect}
              className="mt-2 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30"
            >
              <RefreshCw className="w-3 h-3" />
              Tentar agora
            </button>
          </motion.div>
        )}

        {status === 'disabled' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-space-900/90"
          >
            <WifiOff className="w-8 h-8 text-slate-500 mb-2" />
            <p className="text-xs text-slate-400">Live desabilitado para esta câmera</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlay */}
      {showOverlay && (status === 'live' || status === 'fallback') && (
        <>
          {/* Top-left: camera name + status */}
          <div className="absolute top-2 left-2 flex items-center gap-2 pointer-events-none">
            <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-white/10 text-[10px] font-semibold text-white flex items-center gap-1.5">
              <div className={cn('w-1.5 h-1.5 rounded-full animate-pulse', status === 'live' ? 'bg-rose-500' : 'bg-amber-500')} />
              {status === 'live' ? 'LIVE' : 'SNAPSHOT'}
            </div>
            {cameraName && (
              <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-white/10 text-[10px] font-medium text-white truncate max-w-[200px]">
                {cameraName}
              </div>
            )}
          </div>

          {/* Top-right: stats */}
          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
            {status === 'live' && bitrate !== null && (
              <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-white/10 text-[9px] font-mono text-cyan-300 flex items-center gap-1">
                <Activity className="w-2.5 h-2.5" />
                {formatBytes(bitrate)}
              </div>
            )}
            {resolution && (
              <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-white/10 text-[9px] font-mono text-slate-300">
                {resolution}
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMuted(m => !m)}
                className="p-1.5 rounded-md bg-black/40 hover:bg-black/60 text-white"
                title={isMuted ? 'Ativar som' : 'Mutar'}
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={reconnect}
                className="p-1.5 rounded-md bg-black/40 hover:bg-black/60 text-white"
                title="Reconectar"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-md bg-black/40 hover:bg-black/60 text-white"
              title={isFullscreen ? 'Sair tela cheia' : 'Tela cheia'}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes > 1_000) return `${(bytes / 1_000).toFixed(0)} kB`
  return `${bytes} B`
}
