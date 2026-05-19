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
import {
  getLiveToken, getWhepUrl, getWhepMediamtxUrl, getLiveAvailability,
  getCameraDiagnostics, type CameraDiagnostics,
  BASE_URL, type LiveSourceKind,
} from '../../api/client'
import { cn } from '../../lib/utils'
import { haptic } from '../../lib/haptic'

type PlayerStatus = 'idle' | 'connecting' | 'live' | 'fallback' | 'error' | 'disabled'

/**
 * Modo de ajuste de imagem dentro do tile:
 *   'contain' — preserva aspect, deixa tarja preta (letterbox/pillarbox)
 *   'cover'   — preenche o tile cortando bordas (mantém aspect)
 *   'auto'    — usa 'cover' quando aspect do stream é PRÓXIMO do tile
 *               (diferença relativa < AUTO_FIT_TOLERANCE), caso contrário
 *               cai pra 'contain' pra não cortar significativamente
 *               câmeras retrato/fisheye/4:3. Default sensato pra mosaicos.
 */
export type LiveFit = 'contain' | 'cover' | 'auto'

interface LivePlayerProps {
  cameraId: string
  mode?: 'auto' | 'whep' | 'mjpeg'
  muted?: boolean
  showOverlay?: boolean
  minimalError?: boolean
  onStatus?: (s: PlayerStatus) => void
  className?: string
  cameraName?: string
  paused?: boolean
  fit?: LiveFit
}

// Tolerância do modo 'auto': se |aspect_stream − aspect_tile| / aspect_tile
// for menor que isso, decidimos que o crop é insignificante e usamos 'cover'
// pra eliminar a tarja preta. 0.30 = 30% — empírico revisado:
//   • 16:9 (1.778) em tile 16:9 → diff 0%   → cover (perfeito)
//   • 16:10 (1.6)  em tile 16:9 → diff 10%  → cover (crop ~5% em cada borda)
//   • 4:3  (1.333) em tile 16:9 → diff 25%  → cover (perde ~12.5% topo/base
//                                              de imagem 4:3 — aceitável pra
//                                              eliminar a tarja lateral, que
//                                              em mosaico denso é pior visualmente)
//   • 1:1  (1.0)   em tile 16:9 → diff 44%  → contain (crop seria > 22%, perde
//                                              conteúdo crítico — preserva)
//   • 9:16 (0.5625) em tile 16:9 → diff 68% → contain (retrato, sempre contain)
//
// Por que 30% e não maior:
//   • Operadores de segurança preferem ver TODO o frame (zona de interesse
//     pode estar nas bordas — ex: 4:3 com placa de carro na borda superior).
//   • Mas em mosaico denso (3x3, 4x4, 6x6), as tarjas pretas reduzem a área
//     útil em ~25% — pior que perder 12% da imagem (que continua visível
//     quando o operador expande o tile com tecla F).
const AUTO_FIT_TOLERANCE = 0.30

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
  paused = false,
  minimalError = false,
  // Default 'auto': detecta automaticamente quando o crop é insignificante
  // (aspect quase igual) e usa 'cover' pra eliminar tarjas pretas. Quando o
  // crop seria grande (ex: câmera retrato em tile landscape), cai pra
  // 'contain' pra preservar conteúdo. Override explícito pra 'contain' ou
  // 'cover' continua respeitado.
  fit = 'auto',
}: LivePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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
  // Stats tracking: precisamos do snapshot anterior para calcular bitrate
  // (delta de bytes ÷ delta de tempo) e RTT real (não jitter).
  const prevStatsRef = useRef<{ bytes: number; ts: number; framesDecoded: number } | null>(null)
  // Watchdog de stall: conta quantos ticks consecutivos sem novos frames decodificados.
  // 3 ticks (×2s = 6s) sem progresso = stream congelado → força reconexão.
  const stallTicksRef = useRef(0)
  const STALL_THRESHOLD_TICKS = 3

  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics | null>(null)
  const [mjpegSrc, setMjpegSrc] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(muted)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [bitrate, setBitrate] = useState<number | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [resolution, setResolution] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)     // força reconexão ao incrementar
  // Fonte WebRTC ativa: 'mediamtx' (SRT, baixa latência) | 'go2rtc' (tunnel CF) | null
  const [liveSource, setLiveSource] = useState<LiveSourceKind | null>(null)

  useEffect(() => {
    setIsMuted(muted)
  }, [muted])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted
    }
  }, [isMuted])

  useEffect(() => {
    if (videoRef.current) {
      if (paused) {
        videoRef.current.pause()
      } else {
        videoRef.current.play().catch(() => {})
      }
    }
  }, [paused])

  const setStat = useCallback((s: PlayerStatus) => {
    setStatus(s)
    onStatus?.(s)
    if (s === 'error') {
      try { haptic([40, 50, 40]) } catch (e) {}
    }
  }, [onStatus])

  // ── Auto-fit: decide contain vs cover comparando aspect do stream com tile ──
  // Quando `fit='auto'`, observamos o aspect do stream (via loadedmetadata do
  // <video> ou onLoad do <img>) e do container (via ResizeObserver) e
  // resolvemos para 'cover' se a diferença for pequena, senão 'contain'.
  // Se `fit` for explícito ('contain' | 'cover'), respeitamos sem cálculo.
  const [streamAspect, setStreamAspect] = useState<number | null>(null)
  const [tileAspect,   setTileAspect]   = useState<number | null>(null)

  useEffect(() => {
    if (fit !== 'auto') return
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (w > 0 && h > 0) setTileAspect(w / h)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  const effectiveFit: 'contain' | 'cover' = (() => {
    if (fit !== 'auto') return fit
    // Otimista: enquanto não sabemos o aspect do stream, assumimos 'cover'.
    // 90%+ das câmeras CCTV modernas são 16:9 (mesmo aspect dos tiles padrão),
    // então 'cover' acerta a maioria dos casos sem flash de tarja preta no
    // primeiro frame. Quando o metadata chegar, recalculamos: se for um aspect
    // muito diferente (retrato, fisheye, 4:3 antigo), volta pra 'contain'.
    if (!streamAspect || !tileAspect) return 'cover'
    const diff = Math.abs(streamAspect - tileAspect) / tileAspect
    return diff < AUTO_FIT_TOLERANCE ? 'cover' : 'contain'
  })()

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
      if (mode === 'mjpeg') return startSnapshotPoll()
      setErrMsg(err?.response?.data?.message ?? err?.message ?? 'Falha ao obter ticket')
      setStat('error')
      return
    }

    setResolution(token.camera.resolution ?? null)

    if (token.liveMode === 'DISABLED') { setStat('disabled'); return }
    if (token.liveMode === 'MJPEG_ONLY' && mode === 'mjpeg') return startSnapshotPoll()

    // Escolha de fonte WebRTC: MediaMTX (SRT, baixa latência) > go2rtc (tunnel CF)
    // Falha graceful: se availability fail, vai pra go2rtc (caminho atual)
    let preferredSource: 'mediamtx' | 'go2rtc' = 'go2rtc'
    try {
      const avail = await getLiveAvailability(cameraId)
      if (avail.preferred === 'mediamtx' && avail.sources.mediamtx?.available) {
        preferredSource = 'mediamtx'
      }
    } catch {
      // se availability falhou, segue com go2rtc — não bloqueia
    }
    setLiveSource(preferredSource)

    const pc = new RTCPeerConnection({ iceServers: token.iceServers })
    pcRef.current = pc

    // Apenas recvonly (audio+video)
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })

    pc.ontrack = (ev) => {
      if (!videoRef.current) return
      const [stream] = ev.streams
      videoRef.current.srcObject = stream

      // Tuning anti-travamento: força jitter buffer pequeno (~150ms) e
      // alvo de playout baixo. Sem isso o Chrome bufferiza até 1-3s em
      // redes com jitter alto, dando sensação de delay e freeze percebido.
      //   - playoutDelayHint: 0.15s (150ms) — alvo de delay sentido
      //   - jitterBufferTarget: 200ms — buffer mínimo
      // Ambos são "hints" — browser pode ajustar pra cima sob jitter real.
      try {
        // playoutDelayHint e jitterBufferTarget são APIs experimentais (Chrome 96+)
        // sem typings DOM. Cast pra any contorna o TS sem afetar runtime.
        const rec = ev.receiver as any
        rec.playoutDelayHint = 0.15
        if ('jitterBufferTarget' in rec) {
          rec.jitterBufferTarget = 200
        }
      } catch { /* APIs experimentais — ignora se browser não suporta */ }

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
        } else if (mode === 'mjpeg' && status !== 'fallback') {
          startSnapshotPoll()
        }
      }
    }

    // Timeout: se em 4s não chegar stream, cai pra MJPEG
    timeoutRef.current = setTimeout(() => {
      if (mode === 'mjpeg') {
        startSnapshotPoll()
      } else {
        setStat('error')
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

      // URL escolhida com base no preferredSource decidido logo acima
      const whepUrl = preferredSource === 'mediamtx'
        ? getWhepMediamtxUrl(cameraId, token.ticket, 'main')
        : getWhepUrl(cameraId, token.ticket)

      let resp = await fetch(whepUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/sdp' },
        body: pc.localDescription!.sdp,
        signal: abortRef.current.signal,
      })

      // Se MediaMTX falhou (path não existe ou Box ainda não pushou SRT),
      // tenta automaticamente go2rtc via tunnel como fallback. Mantém a UX
      // resiliente: usuário não percebe a degradação.
      if (!resp.ok && preferredSource === 'mediamtx') {
        const fallbackUrl = getWhepUrl(cameraId, token.ticket)
        resp = await fetch(fallbackUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/sdp' },
          body: pc.localDescription!.sdp,
          signal: abortRef.current.signal,
        })
        if (resp.ok) setLiveSource('go2rtc')
      }

      if (!resp.ok) {
        // 503 + STREAM_OFFLINE = câmera não está pushing → mensagem amigável
        // em vez de "WHEP 503" críptico. Backend retorna JSON com hint humano.
        if (resp.status === 503) {
          try {
            const body = await resp.json() as { error?: string; message?: string; hint?: string }
            if (body?.error === 'STREAM_OFFLINE') {
              const fullMsg = body.message ?? 'Câmera desconectada'
              throw new Error(fullMsg)
            }
          } catch (_e) { /* fallback abaixo */ }
        }
        throw new Error(`WHEP ${resp.status}`)
      }

      const answerSdp = await resp.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    } catch (err: any) {
      if (err.name === 'AbortError') return
      if (mode === 'mjpeg') return startSnapshotPoll()
      setErrMsg(err?.message ?? 'Falha WebRTC')
      setStat('error')
      // Em paralelo, busca diagnóstico para mostrar info útil em vez de só "WHEP 500"
      getCameraDiagnostics(cameraId).then(d => setDiagnostics(d)).catch(() => { /* ignore */ })
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
  // Corrigido:
  //   bitrate — delta de bytesReceived ÷ delta de tempo, expresso em kbps.
  //             Antes mostrava bytes acumulados (crescendo até MB).
  //   latency — RTT real do candidate-pair (round-trip time WebRTC).
  //             Antes mostrava jitter*1000 (já em ms × 1000 = valor errado).
  // Frame count também: usa framesDecoded em vez de framesPerSecond (mais
  // estável; FPS instantâneo varia muito).
  useEffect(() => {
    if (status !== 'live') {
      prevStatsRef.current = null
      return
    }
    stallTicksRef.current = 0
    const id = setInterval(async () => {
      const pc = pcRef.current
      if (!pc) return
      try {
        const stats = await pc.getStats()
        let bytes = 0
        let framesDecoded = 0
        let rttMs: number | null = null
        stats.forEach(r => {
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            bytes = r.bytesReceived ?? 0
            framesDecoded = (r as any).framesDecoded ?? 0
          }
          // RTT vem do candidate-pair ativo (selected nominated).
          // Browsers expõem em segundos via currentRoundTripTime.
          if (r.type === 'candidate-pair' && (r as any).state === 'succeeded' && (r as any).nominated) {
            const rtt = (r as any).currentRoundTripTime
            if (typeof rtt === 'number') rttMs = Math.round(rtt * 1000)
          }
        })

        const now = Date.now()
        const prev = prevStatsRef.current

        // Bitrate em kbps: ((bytesAgora - bytesAntes) × 8 bits) ÷ deltaSegundos ÷ 1000
        if (prev && bytes >= prev.bytes) {
          const deltaBytes = bytes - prev.bytes
          const deltaSec   = (now - prev.ts) / 1000
          if (deltaSec > 0) {
            const kbps = (deltaBytes * 8) / 1000 / deltaSec
            setBitrate(Math.round(kbps))
          }
        }

        // Watchdog de stall RTP — frame congelado:
        // Se framesDecoded não avança 3 ticks seguidos (~6s) E não estamos pausados,
        // o stream travou (câmera/upstream parou de enviar ou navegador parou de decodificar).
        // Força reconexão completa em vez de deixar o usuário com tela parada sem feedback.
        const v = videoRef.current
        const isPaused = v?.paused ?? false
        if (prev && !isPaused) {
          if (framesDecoded === prev.framesDecoded) {
            stallTicksRef.current++
            if (stallTicksRef.current >= STALL_THRESHOLD_TICKS) {
              // Stall confirmado → log + reconnect
              console.warn('[LivePlayer] stall detectado: frames congelados >6s. Reconectando.')
              stallTicksRef.current = 0
              setNonce(n => n + 1)  // dispara re-effect e cria peer connection novo
              return
            }
          } else {
            // Decodificou frame novo → reseta contador
            stallTicksRef.current = 0
          }
        }
        prevStatsRef.current = { bytes, ts: now, framesDecoded }

        if (rttMs !== null) setLatencyMs(rttMs)
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

  const fitClass = effectiveFit === 'cover' ? 'object-cover' : 'object-contain'

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative rounded-xl overflow-hidden bg-black group border border-slate-200 dark:border-white/10',
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
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (v.videoWidth > 0 && v.videoHeight > 0) {
              setStreamAspect(v.videoWidth / v.videoHeight)
            }
          }}
          className={cn('w-full h-full', fitClass)}
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
          className={cn('w-full h-full', fitClass)}
          onLoad={(e) => {
            const img = e.currentTarget
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setStreamAspect(img.naturalWidth / img.naturalHeight)
            }
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
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">Conectando live...</p>
            <p className="text-[10px] text-slate-500 mt-1">Negociando WebRTC</p>
          </motion.div>
        )}

        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-space-900/90 backdrop-blur-sm px-4"
          >
            <AlertTriangle className={cn(
              minimalError ? 'w-5 h-5' : 'w-8 h-8 mb-2',
              diagnostics?.status === 'OFFLINE' || diagnostics?.status === 'NEVER_STREAMED'
                ? 'text-amber-400'  // câmera offline = problema do cliente, não nosso
                : 'text-rose-400',  // erro real
            )} />
            {!minimalError && (
              <>
                <p className={cn(
                  'text-xs font-semibold',
                  diagnostics?.status === 'OFFLINE' || diagnostics?.status === 'NEVER_STREAMED'
                    ? 'text-amber-300' : 'text-rose-300',
                )}>
                  {diagnostics?.status === 'OFFLINE'        ? 'Câmera desconectada' :
                   diagnostics?.status === 'NEVER_STREAMED' ? 'Câmera nunca conectou' :
                   diagnostics?.status === 'RECOVERING'    ? 'Reconectando…' :
                   'Falha no stream'}
                </p>
                <p className="text-[10px] text-slate-400 mt-1 max-w-sm text-center">
                  {diagnostics?.hint ?? errMsg ?? 'Erro desconhecido'}
                </p>
                {diagnostics?.push && (
                  <div className="mt-2 text-[9px] text-slate-500 font-mono space-y-0.5 text-center">
                    {diagnostics.push.lastFrameAt && (
                      <div>Último frame: {new Date(diagnostics.push.lastFrameAt).toLocaleString('pt-BR')}</div>
                    )}
                    {diagnostics.recording.lastSegmentAt && (
                      <div>Última gravação: {new Date(diagnostics.recording.lastSegmentAt).toLocaleString('pt-BR')}</div>
                    )}
                    {diagnostics.recording.segmentsLast24h > 0 && (
                      <div>{diagnostics.recording.segmentsLast24h} segmentos gravados nas últimas 24h</div>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  Tentando reconectar a cada poucos segundos…
                </p>
                <button
                  onClick={() => {
                    setDiagnostics(null)
                    reconnect()
                  }}
                  className="mt-2 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30"
                >
                  <RefreshCw className="w-3 h-3" />
                  Tentar agora
                </button>
              </>
            )}
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
            <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-slate-200 dark:border-white/10 text-[10px] font-semibold text-white flex items-center gap-1.5">
              <div className={cn('w-1.5 h-1.5 rounded-full animate-pulse', status === 'live' ? 'bg-rose-500' : 'bg-amber-500')} />
              {status === 'live' ? 'LIVE' : 'SNAPSHOT'}
            </div>
            {cameraName && (
              <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-slate-200 dark:border-white/10 text-[10px] font-medium text-white truncate max-w-[200px]">
                {cameraName}
              </div>
            )}
            {/* Indicador de fonte ativa — só aparece em hover (info técnica) */}
            {status === 'live' && liveSource && (
              <div
                className={cn(
                  'px-1.5 py-0.5 rounded-md backdrop-blur-sm border text-[9px] font-mono opacity-0 group-hover:opacity-100 transition',
                  liveSource === 'mediamtx'
                    ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                    : 'bg-amber-500/20 border-amber-400/40 text-amber-300',
                )}
                title={
                  liveSource === 'mediamtx'
                    ? 'Fonte: MediaMTX SRT (~300-500ms)'
                    : 'Fonte: go2rtc tunnel CF (~600-1200ms)'
                }
              >
                {liveSource === 'mediamtx' ? 'SRT' : 'TUN'}
              </div>
            )}
          </div>

          {/* Top-right: stats — bitrate / latência / resolução */}
          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
            {status === 'live' && bitrate !== null && (
              <div
                className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-slate-200 dark:border-white/10 text-[9px] font-mono text-cyan-300 flex items-center gap-1"
                title="Banda consumida pelo stream (delta de bytes ÷ tempo)"
              >
                <Activity className="w-2.5 h-2.5" />
                {formatBytes(bitrate)}
              </div>
            )}
            {status === 'live' && latencyMs !== null && (
              <div
                className={cn(
                  'px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border text-[9px] font-mono flex items-center gap-1',
                  // RTT bom < 100ms (verde), aceitável 100-300ms (âmbar), ruim > 300ms (vermelho)
                  latencyMs < 100  ? 'text-emerald-300 border-emerald-400/40'
                  : latencyMs < 300 ? 'text-amber-300 border-amber-400/40'
                  :                   'text-rose-300 border-rose-400/40',
                )}
                title="RTT round-trip time (candidate-pair WebRTC)"
              >
                {latencyMs}ms
              </div>
            )}
            {resolution && (
              <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-slate-200 dark:border-white/10 text-[9px] font-mono text-slate-600 dark:text-slate-300">
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

/** Formata bitrate em kbps para display compacto.
 *  • < 1000 kbps → "850 kbps"
 *  • ≥ 1000 kbps → "2.4 Mbps"
 *  Esperamos valores típicos: SD ~500 kbps, HD ~2-4 Mbps, FullHD ~4-8 Mbps. */
function formatBytes(kbps: number): string {
  if (!kbps || kbps < 1) return '— kbps'
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
  return `${Math.round(kbps)} kbps`
}
