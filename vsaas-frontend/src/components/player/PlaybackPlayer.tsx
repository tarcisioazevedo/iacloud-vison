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
  Volume2, VolumeX, AlertCircle, Loader2, Film,
} from 'lucide-react'
import { issuePlaybackToken, BASE_URL } from '../../api/client'
import { cn } from '../../lib/utils'

interface PlaybackPlayerProps {
  cameraId: string
  /** Início do range a reproduzir (UTC). */
  fromIso: string
  /** Fim do range a reproduzir (UTC). */
  toIso: string
  /**
   * Dia base UTC (YYYY-MM-DD). Usado pra converter wall-clock (PDT do HLS)
   * em "segundos desde 00:00Z do dia" — o que a timeline UI espera.
   * Quando ausente, fallback é `v.currentTime` direto.
   */
  dayUtcDate?: string
  /** Velocidade inicial. Default 1.0. */
  initialRate?: number
  /**
   * Disparado a cada `timeupdate` do <video>.
   * - Se PDT estiver disponível no manifest: `secOfDay` reflete a hora real do dia.
   * - Caso contrário: fallback para `v.currentTime` (compat com manifests sem PDT).
   */
  onTimeUpdate?: (secOfDay: number, durationSec: number) => void
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
  /**
   * Modelo A — slot pra renderizar a timeline como overlay no rodapé do
   * vídeo (em vez de bloco separado abaixo). Recebe espaço acima dos
   * controles existentes; ambos ficam num único bloco com auto-hide.
   * Quando definido, `autoHideUI` deve ser true pra UX consistente.
   */
  overlayBottom?: React.ReactNode
  /**
   * Auto-hide dos controles + overlayBottom após `autoHideDelayMs` sem
   * movimento. Default true se overlayBottom presente, false caso contrário.
   * Comportamento: aparece em mousemove/focus, some N ms depois.
   * Exceção: vídeo pausado mantém UI permanente (operador navegando).
   */
  autoHideUI?: boolean
  /** Delay em ms pro auto-hide. Default 2500ms. */
  autoHideDelayMs?: number
  /**
   * Slot opcional pra ações extras na toolbar (ex: ⭐ Bookmark, 📷 Snapshot,
   * ✂️ Exportar, 🎬 Cinema). Renderizado entre o time atual e o speed selector.
   */
  toolbarActions?: React.ReactNode
  /**
   * Callback ao clicar no botão Cinema/Fullscreen externos. Quando definido,
   * o botão de fullscreen interno usa esse handler em vez do
   * `requestFullscreen` nativo — útil pra integrar com modo cinema custom
   * que não é fullscreen real do browser.
   */
  onFullscreenToggle?: () => void
  /** Estado externo do cinema mode — pra ícone refletir corretamente. */
  isCinemaActive?: boolean
  /**
   * Seek inicial aplicado logo após o manifest carregar (MANIFEST_PARSED).
   * Recebe segundos-do-dia (0..86400) — mesmo formato de `seekTo`.
   * Resolve o bug de seek disparar antes dos fragments estarem disponíveis.
   */
  initialSeekSec?: number
  /** Força o vídeo a pausar (controlado pelo pai) */
  paused?: boolean
  /**
   * Contexto opcional para enriquecer o empty state (SEM_GRAVACAO).
   * Quando a câmera está OFFLINE/ERROR ou a última gravação é antiga, o
   * componente troca a mensagem genérica por algo acionável — operador
   * entende imediatamente *por que* o período pedido não tem vídeo.
   */
  emptyStateContext?: {
    cameraStatus?: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'DISABLED' | string
    /** ISO timestamp do último segmento gravado pra essa câmera. */
    lastSegmentAt?: string | null
    /** recordingState atual (LIVE/IDLE/STOPPED) — usa pra distinguir falha vs. ocioso. */
    recordingState?: 'LIVE' | 'IDLE' | 'STOPPED'
  }
}

export interface PlaybackPlayerRef {
  /**
   * Move o playhead pra um instante específico.
   * - Se o manifest tem PDT (Program-Date-Time) e `dayUtcDate` foi passado:
   *   interpreta como SEGUNDOS-DO-DIA (0..86400). Resolve qual fragment cobre
   *   o wall-clock e ajusta currentTime relativo ao fragment.
   * - Caso contrário: comportamento antigo — segundos relativos ao manifest.
   */
  seekTo: (secOfDay: number) => void
  /** Toggle play/pause. */
  togglePlay: () => void
  /** Define velocidade (0.5, 1, 2, 4). */
  setRate: (rate: number) => void
}

const SPEEDS = [0.5, 1, 2, 4] as const

export const PlaybackPlayer = forwardRef<PlaybackPlayerRef, PlaybackPlayerProps>(
  function PlaybackPlayer(props, ref) {
    const { cameraId, fromIso, toIso, dayUtcDate, initialRate = 1, onTimeUpdate, className,
            minimal = false, autoPlay = true,
            overlayBottom, toolbarActions, onFullscreenToggle, isCinemaActive,
            autoHideDelayMs = 2500, paused = false, emptyStateContext } = props
    const autoHideUI = props.autoHideUI ?? !!overlayBottom

    const videoRef = useRef<HTMLVideoElement>(null)
    const hlsRef = useRef<Hls | null>(null)

    // Ref para o seek inicial: aplicado APÓS MANIFEST_PARSED (quando fragments
    // estão disponíveis). Evita o bug de seekTo disparar antes do manifest
    // carregar e cair no fallback v.currentTime=secOfDay errado.
    const initialSeekSecRef = useRef<number | undefined>(props.initialSeekSec)

    // Retry counter — quando bumpado, força o main effect a re-fetch o manifest
    // mesmo sem mudança de range. Usado pra recuperar de SEM_GRAVACAO residual.
    const [retryCount, setRetryCount] = useState(0)

    // 2026-05-12 — Bug do "Sem gravação residual": quando operador clica
    // `-10s` E o range já está dentro da anchor de ±60min (logo o useEffect
    // principal [cameraId, fromIso, toIso] NÃO re-roda), o estado de erro
    // anterior (`SEM_GRAVACAO`) persiste mesmo que agora o player consiga
    // tocar segments — operador vê empty state com 80+ segments na mão.
    //
    // Fix: cada vez que initialSeekSec muda (= novo seek do operador),
    // se erro era SEM_GRAVACAO, força re-fetch do manifest. Mesma janela
    // pode ter ganho segments novos (gravação contínua); manifest atualizado.
    useEffect(() => {
      initialSeekSecRef.current = props.initialSeekSec
      setError(prev => {
        if (prev === 'SEM_GRAVACAO' && props.initialSeekSec != null) {
          // Trigger re-fetch
          setRetryCount(c => c + 1)
          return null
        }
        return prev
      })
    }, [props.initialSeekSec])

    // 2026-05-12 — Fix loop de re-mount / token bursts.
    // onTimeUpdate vem do LivePage tipicamente como closure inline (`secOfDay
    // => setLivePlayheadSec(secOfDay)`). Closure nova a cada render → toda vez
    // que o pai re-renderiza, o useEffect com onTimeUpdate em deps re-roda,
    // re-attach do listener. Em 30min vimos 52 tokens emitidos vs 10 manifests
    // esperados (5× overhead). Usando ref, mantemos referência sempre atual
    // sem disparar effect.
    const onTimeUpdateRef = useRef(props.onTimeUpdate)
    useEffect(() => { onTimeUpdateRef.current = props.onTimeUpdate }, [props.onTimeUpdate])

    const [loading, setLoading] = useState(true)
    const [error, setError]     = useState<string | null>(null)
    const [playing, setPlaying] = useState(false)
    const [muted, setMuted]     = useState(true)
    const [rate, setRateState]  = useState(initialRate)
    const [current, setCurrent] = useState(0)
    const [duration, setDuration] = useState(0)
    const [isFs, setIsFs]       = useState(false)
    /** Visibilidade da UI overlay (controles + timeline). Quando autoHideUI
     *  está ativo, esconde sozinho após `autoHideDelayMs` ms sem mouse.
     *  Vídeo pausado força permanente (operador está navegando). */
    const [uiVisible, setUiVisible] = useState(true)

    // Epoch ms de 00:00:00Z do dia base — denominador da conversão
    // wall-clock → secOfDay. Memoizado pra evitar new Date() a cada timeupdate.
    const dayStartMs = dayUtcDate
      ? new Date(`${dayUtcDate}T00:00:00.000Z`).getTime()
      : null

    // Imperative API pro parent (timeline → seekTo, etc)
    useImperativeHandle(ref, () => ({
      seekTo: (secOfDay: number) => {
        const v = videoRef.current
        if (!v) return

        // Se temos PDT + dayUtcDate, resolve fragment correto.
        // HLS.js expõe fragments via `hls.levels[level].details.fragments`.
        const hls = hlsRef.current
        if (hls && dayStartMs !== null) {
          const targetEpochMs = dayStartMs + secOfDay * 1000
          const level = hls.levels[hls.currentLevel] ?? hls.levels[0]
          const fragments = (level as any)?.details?.fragments as Array<any> | undefined
          if (fragments && fragments.length > 0) {
            // Acha frag cujo PDT-range cobre targetEpochMs
            const frag = fragments.find(f =>
              f.programDateTime != null &&
              targetEpochMs >= f.programDateTime &&
              targetEpochMs < f.programDateTime + f.duration * 1000,
            )
            if (frag) {
              v.currentTime = frag.start + (targetEpochMs - frag.programDateTime) / 1000
              return
            }
            // Fallback: nenhum frag cobre exatamente — pula pro mais próximo
            const closest = fragments.reduce((best, f) =>
              f.programDateTime != null &&
              Math.abs(f.programDateTime - targetEpochMs) <
              Math.abs((best?.programDateTime ?? Infinity) - targetEpochMs)
                ? f : best, fragments[0])
            if (closest?.programDateTime != null) {
              v.currentTime = closest.start
              return
            }
          }
        }
        // Fallback final: trata como currentTime relativo (compat manifest sem PDT)
        v.currentTime = secOfDay
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
              // ── Buffer (Fix B — fluidez de playback + scrub) ────────────
              // Maior buffer = scrub mais responsivo (não re-baixa segments
              // já vistos) e tolerância a R2 lag. 90s à frente / 30s atrás
              // → scrub de ±30s é instantâneo; segments próximos pré-carregados.
              maxBufferLength:    90,
              maxMaxBufferLength: 180,
              backBufferLength:   30,

              enableWorker: true,            // parse em worker thread (perf)

              // ── Tolerância a timing imperfeito do mpegts ──────────────────
              // Boxes em campo geram .ts com delay de PCR (~0.5–1.5s no início
              // do primeiro keyframe) e gaps entre segments. Sem esses tweaks,
              // HLS.js cai com fragParsingError ou bufferStalledError.
              maxBufferHole: 1.0,            // tolera buracos de 1s no buffer
              maxFragLookUpTolerance: 0.5,   // 500ms de slack ao casar PTS×EXTINF
              highBufferWatchdogPeriod: 3,   // 3s antes de panicar com stall

              // ── Retry em rede (Fix B) ──────────────────────────────────
              // R2 ocasionalmente retorna 503 sob throttle. 6 tentativas
              // (vs 3 default) com delay exponencial cobrem janela de 30s.
              fragLoadingMaxRetry:     6,
              fragLoadingRetryDelay:   500,
              manifestLoadingMaxRetry: 4,
              manifestLoadingRetryDelay: 1000,
              levelLoadingMaxRetry:    4,
              levelLoadingRetryDelay:  500,
            })
            hlsRef.current = hls
            hls.loadSource(fullUrl)
            hls.attachMedia(video)

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (cancelled) return
              setLoading(false)
              setDuration(video.duration || 0)

              // Fix A — emitir secOfDay inicial via PDT do primeiro
              // fragment, MESMO se autoplay foi bloqueado. Sem isso,
              // a timeline esperaria o `timeupdate` que só dispara após
              // o vídeo começar a tocar — cursor ficaria preso em null.
              if (dayStartMs !== null) {
                const level = hls.levels[hls.currentLevel] ?? hls.levels[0]
                const fragments = (level as any)?.details?.fragments as Array<any> | undefined
                if (fragments && fragments.length > 0 && fragments[0].programDateTime != null) {
                  const epochMs = fragments[0].programDateTime as number
                  let initialSec = (epochMs - dayStartMs) / 1000
                  // Fix C — clamp se primeiro frag estiver no dia anterior
                  // (segment cruzando meia-noite UTC). Aceita só [0, 86400].
                  if (initialSec >= 0 && initialSec <= 86400) {
                    onTimeUpdate?.(initialSec, video.duration || 0)
                  }
                }
              }

                // Seek inicial: aplica AQUI (depois do manifest + fragments
              // disponíveis) em vez de via ref imperativa antes do load.
              // Evita o bug de cair no fallback v.currentTime=secOfDay
              // quando o manifest ainda não tinha sido parsado.
              const seekSec = initialSeekSecRef.current
              if (seekSec != null && dayStartMs !== null) {
                const targetEpochMs = dayStartMs + seekSec * 1000
                const level = hls.levels[hls.currentLevel] ?? hls.levels[0]
                const frags = (level as any)?.details?.fragments as Array<any> | undefined
                if (frags && frags.length > 0) {
                  const frag = frags.find((f: any) =>
                    f.programDateTime != null &&
                    targetEpochMs >= f.programDateTime &&
                    targetEpochMs < f.programDateTime + f.duration * 1000,
                  )
                  if (frag) {
                    video.currentTime = frag.start + (targetEpochMs - frag.programDateTime) / 1000
                  } else {
                    // Mais próximo disponível
                    const closest = frags.reduce((best: any, f: any) =>
                      f.programDateTime != null &&
                      Math.abs(f.programDateTime - targetEpochMs) <
                      Math.abs((best?.programDateTime ?? Infinity) - targetEpochMs)
                        ? f : best, frags[0])
                    if (closest?.programDateTime != null) video.currentTime = closest.start
                  }
                }
              }

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

            // Recovery automático de fragParsingError / mediaError.
            // Esses dois NÃO devem ser fatais: tenta `recoverMediaError()`
            // e segue. Só vira erro de UI se o recovery também falhar.
            let mediaErrorRecoveryCount = 0
            // 2026-05-12 — P1-6: ticket de playback dura 30min. Em sessões de
            // revisão >30min o backend retorna 401 nos fragments → HLS para de
            // tocar do nada. Detectamos status 401/403 em fragLoadError e
            // re-emitimos ticket transparente.
            let tokenReissueCount = 0
            const MAX_TOKEN_REISSUES = 3

            hls.on(Hls.Events.ERROR, (_e, data) => {
              if (!data.fatal) return

              // ── Ticket expirado / inválido → re-issue silencioso ──
              const httpStatus = (data.response as any)?.code
              const isAuthFailure =
                (data.details === 'fragLoadError' || data.details === 'manifestLoadError' ||
                 data.details === 'levelLoadError') &&
                (httpStatus === 401 || httpStatus === 403)
              if (isAuthFailure && tokenReissueCount < MAX_TOKEN_REISSUES) {
                tokenReissueCount++
                console.warn(`[playback] ticket auth ${httpStatus} — re-emitindo (${tokenReissueCount}/${MAX_TOKEN_REISSUES})`)
                ;(async () => {
                  try {
                    const { manifestUrl: newUrl } = await issuePlaybackToken(cameraId, fromIso, toIso)
                    if (cancelled || !hlsRef.current) return
                    // recarrega manifest mantendo o player anexado; hls.js
                    // reaproveita o buffer atual e segue a partir do mesmo ponto.
                    hlsRef.current.loadSource(`${BASE_URL}${newUrl}`)
                    hlsRef.current.startLoad()
                  } catch (err) {
                    console.error('[playback] token re-issue failed:', err)
                    setError('SESSAO_EXPIRADA')
                    setLoading(false)
                  }
                })()
                return
              }

              const recoverableMedia =
                data.details === 'fragParsingError' ||
                data.details === 'bufferAppendError' ||
                data.details === 'bufferAppendingError' ||
                data.type === Hls.ErrorTypes.MEDIA_ERROR

              if (recoverableMedia && mediaErrorRecoveryCount < 3) {
                mediaErrorRecoveryCount++
                console.warn(`[playback] HLS media error (${data.details}) — tentativa ${mediaErrorRecoveryCount}/3 de recovery`)
                try {
                  hls.recoverMediaError()
                  return
                } catch (err) {
                  console.error('[playback] recoverMediaError failed:', err)
                }
              }

              if (data.type === Hls.ErrorTypes.NETWORK_ERROR &&
                  data.details !== 'manifestLoadError' &&
                  data.details !== 'manifestParsingError' &&
                  data.details !== 'levelEmptyError') {
                console.warn(`[playback] HLS network error (${data.details}) — tentando startLoad()`)
                try { hls.startLoad(); return } catch {}
              }

              // Mensagens user-friendly por categoria de erro.
              if (data.details === 'levelEmptyError' ||
                  data.details === 'manifestParsingError') {
                // Manifest vazio — câmera sem gravação no período.
                setError('SEM_GRAVACAO')
              } else if (data.details === 'fragParsingError' ||
                         data.details === 'bufferAppendError' ||
                         data.details === 'bufferAppendingError') {
                // Esgotamos as 3 tentativas de recovery → segments
                // realmente corrompidos (formato inválido / muxer da box).
                setError('SEGMENT_CORROMPIDO')
              } else if (data.details === 'manifestLoadError' ||
                         data.details === 'fragLoadError') {
                setError('REDE_INDISPONIVEL')
              } else {
                setError(`HLS: ${data.details ?? data.type}`)
              }
              setLoading(false)
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
      // 2026-05-12: retryCount em deps. Quando bumpado externamente (pelo
      // fix de "Sem gravação residual"), força re-fetch do manifest + nova
      // sessão HLS — mesma janela pode ter ganho segments novos durante o
      // tempo em que o operador estava no empty state.
    }, [cameraId, fromIso, toIso, retryCount])

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
      if (paused) v.pause()
      else if (playing === false) v.play().catch(() => {})
    }, [paused])

    useEffect(() => {
      const v = videoRef.current
      if (!v) return
      const onPlay  = () => setPlaying(true)
      const onPause = () => setPlaying(false)
      const onTime  = () => {
        setCurrent(v.currentTime)
        // setDuration usa updater function pra comparar contra valor atual sem
        // depender de `duration` em closure — assim podemos remover dep e o
        // listener não é re-attached a cada update.
        if (v.duration) setDuration(prev => (prev !== v.duration ? v.duration : prev))

        // Calcula secOfDay via PDT do fragment ATUAL (hls.js mantém um
        // ponteiro pro frag que está rodando). Fallback pra v.currentTime
        // se PDT não disponível (manifest legacy).
        let publishedSec = v.currentTime
        const hls = hlsRef.current
        if (hls && dayStartMs !== null) {
          const level = hls.levels[hls.currentLevel] ?? hls.levels[0]
          const fragments = (level as any)?.details?.fragments as Array<any> | undefined
          if (fragments && fragments.length > 0) {
            // Acha frag cujo intervalo [start, start+duration] cobre v.currentTime
            const frag = fragments.find(f =>
              v.currentTime >= f.start &&
              v.currentTime < f.start + f.duration,
            )
            if (frag?.programDateTime != null) {
              const offsetInFrag = v.currentTime - frag.start
              const epochMs = frag.programDateTime + offsetInFrag * 1000
              publishedSec = (epochMs - dayStartMs) / 1000
            }
          }
        }

        // Fix C — drop updates fora do dia (segments cruzando meia-noite
        // teriam secOfDay negativo no início do range).
        if (publishedSec < 0 || publishedSec > 86400) return
        // Lê via ref pra evitar dep instável no useEffect (vide comentário
        // sobre onTimeUpdateRef acima).
        onTimeUpdateRef.current?.(publishedSec, v.duration)
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
      // 2026-05-12: removidos `duration` e `onTimeUpdate` das deps. Ambos
      // causavam re-attach do listener a cada timeupdate (4Hz) ou a cada
      // render do pai (inline closure). Agora o listener é instalado UMA vez
      // por mount; valores atuais lidos via ref/closure-de-state-updater.
    }, [])

    useEffect(() => {
      const handler = () => setIsFs(!!document.fullscreenElement)
      document.addEventListener('fullscreenchange', handler)
      return () => document.removeEventListener('fullscreenchange', handler)
    }, [])

    function toggleFs() {
      // Se há handler externo (cinema custom), delega; senão fullscreen nativo.
      if (onFullscreenToggle) {
        onFullscreenToggle()
        return
      }
      const wrap = videoRef.current?.parentElement
      if (!wrap) return
      if (document.fullscreenElement) document.exitFullscreen()
      else wrap.requestFullscreen()
    }

    // ── Auto-hide da UI overlay (Modelo A) ─────────────────────────────────
    // Aparece em mousemove sobre o container; some `autoHideDelayMs` depois
    // sem movimento. Vídeo pausado força permanência (operador navegando).
    // Hover sobre a própria toolbar trava visível.
    const containerRef = useRef<HTMLDivElement>(null)
    const hideTimerRef = useRef<number | null>(null)
    useEffect(() => {
      if (!autoHideUI) {
        setUiVisible(true)
        return
      }
      const el = containerRef.current
      if (!el) return

      function clearHideTimer() {
        if (hideTimerRef.current != null) {
          window.clearTimeout(hideTimerRef.current)
          hideTimerRef.current = null
        }
      }
      function scheduleHide() {
        clearHideTimer()
        // Não esconde se está carregando ou em erro (operador precisa ver
        // mensagem). Vídeo pausado tem comportamento normal de auto-hide
        // (operador pode parar pra ver frame sem chrome competindo).
        if (loading || error) return
        hideTimerRef.current = window.setTimeout(() => setUiVisible(false), autoHideDelayMs)
      }
      function show() {
        setUiVisible(true)
        scheduleHide()
      }
      function onLeave() {
        // Saiu do container — esconde rápido (300ms) tanto se tocando
        // quanto pausado (operador focando no frame).
        clearHideTimer()
        if (!loading && !error) {
          hideTimerRef.current = window.setTimeout(() => setUiVisible(false), 300)
        }
      }

      el.addEventListener('mousemove', show)
      el.addEventListener('mouseenter', show)
      el.addEventListener('focusin', show)
      el.addEventListener('mouseleave', onLeave)
      // Estado inicial: aparece e agenda hide.
      show()

      return () => {
        clearHideTimer()
        el.removeEventListener('mousemove', show)
        el.removeEventListener('mouseenter', show)
        el.removeEventListener('focusin', show)
        el.removeEventListener('mouseleave', onLeave)
      }
    }, [autoHideUI, autoHideDelayMs, loading, error, playing])

    // Loading/erro: força UI visível (operador precisa ver mensagem +
    // botões). Pausado NÃO força mais — auto-hide normal aplica também
    // pausado pra ver frame congelado limpo.
    useEffect(() => {
      if (loading || error) setUiVisible(true)
    }, [loading, error])

    function fmt(sec: number): string {
      if (!isFinite(sec) || sec < 0) return '00:00'
      const h = Math.floor(sec / 3600)
      const m = Math.floor((sec % 3600) / 60)
      const s = Math.floor(sec % 60)
      const pad = (n: number) => String(n).padStart(2, '0')
      return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
    }

    return (
      <div
        ref={containerRef}
        className={cn('relative bg-black rounded-lg overflow-hidden border border-white/10 group', className)}
      >
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

        {error && !loading && error === 'SEM_GRAVACAO' && (() => {
          // Smart empty state — calcula contexto pra orientar o operador.
          const status = emptyStateContext?.cameraStatus
          const lastAtIso = emptyStateContext?.lastSegmentAt
          const recState = emptyStateContext?.recordingState
          const lastAt = lastAtIso ? new Date(lastAtIso) : null
          const ageSec = lastAt ? Math.max(0, (Date.now() - lastAt.getTime()) / 1000) : null
          const fmtAge = (s: number): string => {
            if (s < 60) return `${Math.round(s)}s`
            if (s < 3600) return `${Math.round(s / 60)}min`
            if (s < 86400) return `${Math.floor(s / 3600)}h${Math.round((s % 3600) / 60)}min`
            return `${Math.floor(s / 86400)}d`
          }
          const fmtClock = (d: Date): string =>
            d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

          // Cenários ranqueados por especificidade — primeiro match ganha
          const isOffline = status === 'OFFLINE' || status === 'ERROR'
          const isDisabled = status === 'DISABLED'
          const isStale = ageSec !== null && ageSec > 5 * 60 // sem upload > 5min
          const isStopped = recState === 'STOPPED'

          let icon = <Film className="w-10 h-10 text-slate-500 mb-2 opacity-60" />
          let title = 'Sem gravação neste período'
          let hint = 'Use a timeline abaixo para escolher outro horário ou dia que tenha gravação (cyan = com gravação).'
          let tone: 'neutral' | 'warn' | 'danger' = 'neutral'

          if (isOffline) {
            icon = <AlertCircle className="w-10 h-10 text-rose-400 mb-2" />
            title = status === 'ERROR' ? 'Câmera em ERRO' : 'Câmera offline'
            hint = lastAt
              ? `Última gravação há ${fmtAge(ageSec!)} (${fmtClock(lastAt)}). Verifique conectividade.`
              : 'Câmera não está enviando vídeo. Verifique conectividade.'
            tone = 'danger'
          } else if (isDisabled) {
            icon = <Film className="w-10 h-10 text-slate-500 mb-2 opacity-60" />
            title = 'Gravação desabilitada'
            hint = 'Esta câmera está com gravação desligada. Habilite em Câmera → Gravação.'
            tone = 'neutral'
          } else if (isStopped || isStale) {
            icon = <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
            title = 'Pipeline de gravação parado'
            hint = lastAt
              ? `Último segmento há ${fmtAge(ageSec!)} (${fmtClock(lastAt)}). Câmera ${status ?? '—'}; verifique o agente de gravação.`
              : 'Nenhum segmento confirmado recentemente. Verifique o agente de gravação.'
            tone = 'warn'
          } else if (lastAt && ageSec! < 5 * 60) {
            // Câmera ATIVA mas range pedido não tem dados → operador
            // selecionou janela errada (futuro, ou antes do início da gravação)
            title = 'Sem gravação neste período'
            hint = `Câmera está gravando agora (último segmento ${fmtAge(ageSec!)} atrás). Use a timeline abaixo para escolher outro horário.`
          }

          const titleClass = tone === 'danger' ? 'text-rose-200'
                           : tone === 'warn'   ? 'text-amber-200'
                           : 'text-slate-300'
          return (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-4 text-center">
              {icon}
              <p className={cn('text-xs font-semibold', titleClass)}>{title}</p>
              <p className="text-[10px] text-slate-400 mt-1 max-w-xs">{hint}</p>
              {status && (
                <p className="text-[9px] text-slate-500 mt-2 font-mono uppercase tracking-wider">
                  status: {status}{recState ? ` · rec: ${recState}` : ''}
                </p>
              )}
            </div>
          )
        })()}

        {error && !loading && error === 'SEGMENT_CORROMPIDO' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
            <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
            <p className="text-xs text-amber-300 font-semibold">
              Falha de decodificação neste momento
            </p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-sm text-center px-4">
              O navegador não conseguiu decodificar este trecho — geralmente ocorre
              em transições onde a câmera reconectou (codec/parâmetros mudaram).
              Os outros trechos da timeline normalmente funcionam.
            </p>
            <button
              onClick={() => {
                setError(null)
                const v = videoRef.current
                if (v) v.currentTime = (v.currentTime || 0) + 10
              }}
              className="mt-3 px-3 py-1.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30"
            >
              Pular 10s para frente
            </button>
          </div>
        )}

        {error && !loading && error === 'REDE_INDISPONIVEL' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
            <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
            <p className="text-xs text-amber-300 font-semibold">Falha de rede</p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-xs text-center px-4">
              Não foi possível baixar os segmentos. Verifique sua conexão e recarregue.
            </p>
          </div>
        )}

        {error && !loading && error === 'SESSAO_EXPIRADA' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
            <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
            <p className="text-xs text-amber-300 font-semibold">Sessão expirada</p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-xs text-center px-4">
              Não foi possível renovar o acesso. Atualize a página pra continuar.
            </p>
          </div>
        )}

        {error && !loading &&
         error !== 'SEM_GRAVACAO' &&
         error !== 'SEGMENT_CORROMPIDO' &&
         error !== 'REDE_INDISPONIVEL' &&
         error !== 'SESSAO_EXPIRADA' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
            <AlertCircle className="w-8 h-8 text-rose-400 mb-2" />
            <p className="text-xs text-rose-300 font-semibold">Falha no playback</p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-xs text-center px-4">{error}</p>
          </div>
        )}

        {/* ── Toolbar overlay (Modelo A): timeline + controles num único bloco
            no rodapé do vídeo, com auto-hide. Gradient escuro garante
            legibilidade sobre qualquer fundo (céu, parede branca, etc). ──
            2026-05-13: também mostra em SEM_GRAVACAO pra operador conseguir
            navegar pra um período com gravação sem precisar fechar/reabrir. */}
        {!loading && (!error || error === 'SEM_GRAVACAO') && !minimal && (
          <div
            className={cn(
              'absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent',
              'transition-opacity duration-200',
              uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
            // Mouse sobre a toolbar trava visível: cancela o hide timer.
            // Necessário pra operador que para o mouse pra ler relógio/scrubber
            // sem mexer (sem isso, UI sumiria depois de 2.5s parado).
            onMouseEnter={() => {
              setUiVisible(true)
              if (hideTimerRef.current != null) {
                window.clearTimeout(hideTimerRef.current)
                hideTimerRef.current = null
              }
            }}
            onMouseLeave={() => {
              // Sai da toolbar mas pode ainda estar sobre o vídeo —
              // re-agenda hide normal (effect lida via mousemove no container).
              if (videoRef.current && !videoRef.current.paused && !loading && !error) {
                if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current)
                hideTimerRef.current = window.setTimeout(() => setUiVisible(false), autoHideDelayMs)
              }
            }}
          >
            {/* Slot da timeline (overlayBottom) acima da linha de controles.
                Mantém compact=true pra não duplicar header/mini-mapa.
                Background sólido escuro garante contraste ALTO independente
                do conteúdo do vídeo (noturno, claro, com céu, etc) — sem
                isso a timeline some sobre frames escuros como céu noturno. */}
            {overlayBottom && (
              <div className="px-3 pt-2 pb-1 backdrop-blur-sm border-t border-white/10" style={{ background: 'rgba(2,6,23,0.85)' }}>
                {overlayBottom}
              </div>
            )}

            {/* Linha de controles — skip-, play, skip+, time, ações custom, speed, mute, fs.
                Ordem reorganizada (2026-05-09): Play fica entre as setas
                de retroceder/avançar 10s — padrão de player de mídia
                (YouTube, VLC, Apple). Olho cai no centro = botão principal. */}
            <div className="px-3 py-2 flex items-center gap-2">
              <button
                onClick={() => {
                  const v = videoRef.current
                  if (v) v.currentTime = Math.max(0, v.currentTime - 10)
                }}
                className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
                title="−10s (←)"
              >
                <Rewind className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  const v = videoRef.current
                  if (!v) return
                  if (v.paused) v.play().catch(() => {})
                  else v.pause()
                }}
                className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
                title={playing ? 'Pausar (espaço)' : 'Tocar (espaço)'}
              >
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              </button>
              <button
                onClick={() => {
                  const v = videoRef.current
                  if (v) v.currentTime = Math.min(duration, v.currentTime + 10)
                }}
                className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
                title="+10s (→)"
              >
                <FastForward className="w-3.5 h-3.5" />
              </button>

              <div className="text-[10px] font-mono text-white/90 tabular-nums px-1">
                {fmt(current)} / {fmt(duration)}
              </div>

              {/* Slot pra ações contextuais (Bookmark, Snapshot, Export, Cinema) */}
              {toolbarActions && (
                <div className="flex items-center gap-1 ml-2 pl-2 border-l border-white/15">
                  {toolbarActions}
                </div>
              )}

              <div className="flex-1" />

              {/* Speed selector */}
              <select
                value={rate}
                onChange={e => setRateState(+e.target.value)}
                className="text-[10px] bg-white/10 hover:bg-white/20 text-white border-0 rounded px-1.5 py-1 cursor-pointer focus:outline-none"
                title="Velocidade (↑↓)"
              >
                {SPEEDS.map(s => (
                  <option key={s} value={s}>{s}×</option>
                ))}
              </select>

              <button
                onClick={() => setMuted(m => !m)}
                className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
                title={muted ? 'Ativar áudio (M)' : 'Mutar (M)'}
              >
                {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={toggleFs}
                className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
                title={isCinemaActive ? 'Sair (F/Esc)' : 'Tela cheia (F)'}
              >
                {(isFs || isCinemaActive) ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}

        {/* Badge "PLAYBACK" + indicador velocidade — centro superior do vídeo
            pra não competir com o timestamp (canto sup. esq.) impresso pela
            câmera no próprio frame, e ficar simétrico/balanceado visualmente. */}
        {!loading && !error && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
            <span className="px-2 py-0.5 rounded-full bg-amber-500/90 text-white text-[10px] font-bold flex items-center gap-1 shadow-md">
              PLAYBACK
            </span>
            {rate !== 1 && (
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/90 text-white text-[10px] font-bold shadow-md">
                {rate}×
              </span>
            )}
          </div>
        )}
      </div>
    )
  },
)
