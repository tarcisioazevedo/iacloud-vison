/**
 * LiveBboxOverlay — desenha bounding boxes em tempo real sobre o LivePlayer.
 *
 * Renderiza um <canvas> absolutamente posicionado sobre o <video> (ou <img>).
 * Coordenadas vêm normalizadas (0..1) do worker, então funciona com qualquer
 * resolução. Usa requestAnimationFrame para suavidade.
 *
 * INTERPOLAÇÃO Frigate-style:
 * O AI worker publica detecções em ~6.6 Hz (a cada ~150ms), mas o vídeo roda
 * a 25-30 fps. Sem interpolação, o bbox "pula" entre posições discretas.
 * Cacheamos a última posição por trackId (campo `i`) e calculamos velocidade
 * (px normalizados / ms) entre amostras consecutivas. Em cada frame do RAF,
 * extrapolamos a posição esperada a partir do tempo decorrido desde a última
 * amostra, suavizando o movimento — o operador vê um bbox que "segue" o
 * objeto de forma fluida, exatamente como nos sistemas profissionais (Frigate,
 * Milestone XProtect Smart Client).
 *
 * Cores por tipo (mockup design):
 *   person   → emerald-500
 *   car/bus  → cyan-500
 *   dog/cat  → amber-500
 *   default  → indigo-500
 *
 * Filtros aplicados client-side via props `enabledTypes`:
 *   Set vazio = não desenha nada (mas mantém SSE conectado, contagem ainda
 *   funciona). Útil para o operador "desligar overlay" sem perder os dados.
 */
import { useEffect, useRef } from 'react'
import type { DetectionPayload, Detection } from '../../hooks/useLiveDetections'

export interface BboxOverlayProps {
  payload: DetectionPayload | null
  enabledTypes: Set<string>           // se vazio, não desenha; "all" via Set([...])
  showLabels?: boolean                // default true
  showBoxes?: boolean                 // default true
  minConfidence?: number              // 0..1, default 0
  className?: string
}

const COLOR_MAP: Record<string, { stroke: string; bg: string; fg: string }> = {
  // Pessoas / Veículos — verde/ciano
  person:       { stroke: '#10b981', bg: '#10b981', fg: '#022c22' },
  car:          { stroke: '#06b6d4', bg: '#06b6d4', fg: '#083344' },
  truck:        { stroke: '#06b6d4', bg: '#06b6d4', fg: '#083344' },
  bus:          { stroke: '#06b6d4', bg: '#06b6d4', fg: '#083344' },
  motorcycle:   { stroke: '#06b6d4', bg: '#06b6d4', fg: '#083344' },
  bicycle:      { stroke: '#a78bfa', bg: '#a78bfa', fg: '#2e1065' },
  // Animais — âmbar
  dog:          { stroke: '#f59e0b', bg: '#f59e0b', fg: '#451a03' },
  cat:          { stroke: '#f59e0b', bg: '#f59e0b', fg: '#451a03' },
  bird:         { stroke: '#f59e0b', bg: '#f59e0b', fg: '#451a03' },
  horse:        { stroke: '#f59e0b', bg: '#f59e0b', fg: '#451a03' },
  // Objetos — roxo
  backpack:     { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  handbag:      { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  suitcase:     { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  'cell phone': { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  laptop:       { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  umbrella:     { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  bottle:       { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  // Itens de SEGURANÇA críticos — vermelho intenso
  knife:          { stroke: '#ef4444', bg: '#ef4444', fg: '#450a0a' },
  scissors:       { stroke: '#ef4444', bg: '#ef4444', fg: '#450a0a' },
  'baseball bat': { stroke: '#ef4444', bg: '#ef4444', fg: '#450a0a' },
  weapon:         { stroke: '#dc2626', bg: '#dc2626', fg: '#450a0a' },
  // Ambiente — cinza neutro
  chair:        { stroke: '#94a3b8', bg: '#94a3b8', fg: '#0f172a' },
  couch:        { stroke: '#94a3b8', bg: '#94a3b8', fg: '#0f172a' },
  tv:           { stroke: '#94a3b8', bg: '#94a3b8', fg: '#0f172a' },
  'potted plant': { stroke: '#94a3b8', bg: '#94a3b8', fg: '#0f172a' },
  // catch-all
  _default:     { stroke: '#6366f1', bg: '#6366f1', fg: '#1e1b4b' },
}

function colorFor(type: string) {
  return COLOR_MAP[type] ?? COLOR_MAP._default
}

/**
 * Tipos críticos — quando detectados, recebem pulso visual (alpha animado)
 * para chamar atenção do operador. Útil para faca, arma, bastão.
 */
const CRITICAL_TYPES = new Set(['knife', 'scissors', 'baseball bat', 'weapon'])

// ============================================================================
// PARÂMETROS DE INTERPOLAÇÃO
// ============================================================================

/** Intervalo esperado entre payloads do worker (~6.6Hz). Usado para decidir
 * quando estamos "interpolando" (entre amostras) vs "extrapolando" (após). */
const EXPECTED_INTERVAL_MS = 200

/** Após esse tempo sem atualização, começamos a desvanecer (fade out). */
const EXTRAPOLATION_LIMIT_MS = 500

/** Tempo máximo sem ver um track antes de removê-lo do cache. */
const TRACK_TTL_MS = 800

/** Fator de damping aplicado à velocidade durante extrapolação — evita que
 * um bbox "voe" para fora da tela se o objeto parou de se mover. */
const EXTRAPOLATION_DAMPING = 0.7

/** Velocidade máxima permitida (em unidades normalizadas por segundo).
 * 2.0 = um objeto pode atravessar 2 frames inteiros por segundo.
 * Acima disso, achatamos para evitar runaway numa transição de track id. */
const MAX_VELOCITY = 2.0

/** Damping da posição durante interpolação ativa (entre amostras).
 * 1.0 = extrapolação linear pura, 0.85 = suaviza um pouco a inércia. */
const INTERPOLATION_DAMPING = 0.9

/** Estado por trackId mantido entre frames RAF.
 * Cacheia a última posição, dimensões, velocidade e timestamp para que possamos
 * extrapolar a posição esperada em cada frame de animação. */
interface TrackState {
  /** Última detecção observada (cópia, não referência) */
  detection: Detection
  /** Posição/tamanho da última amostra do worker [x, y, w, h] em 0..1 */
  lastBox:   [number, number, number, number]
  /** Velocidade [vx, vy, vw, vh] em unidades normalizadas por ms */
  velocity:  [number, number, number, number]
  /** performance.now() da última amostra do worker */
  lastUpdate: number
}

export function LiveBboxOverlay({
  payload,
  enabledTypes,
  showLabels = true,
  showBoxes  = true,
  minConfidence = 0,
  className,
}: BboxOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number | null>(null)
  const lastPayloadRef = useRef<DetectionPayload | null>(null)

  // Cache de estado por trackId — useRef para evitar re-renders em cada frame.
  // Detecções SEM trackId (campo `i` ausente) não são cacheadas, renderizam
  // direto na posição informada (backward-compat).
  const tracksRef = useRef<Map<string, TrackState>>(new Map())

  // Atualiza cache de tracks quando chega novo payload do SSE.
  // Isso NÃO altera o fluxo de dados — apenas adiciona uma camada de cache
  // entre o payload recebido e o que vai pra tela.
  useEffect(() => {
    lastPayloadRef.current = payload
    if (!payload) return

    const now = performance.now()
    const tracks = tracksRef.current

    for (const det of payload.d) {
      const tid = det.i
      if (!tid) continue  // sem trackId → não interpolável, segue caminho legado

      const prev = tracks.get(tid)
      if (prev) {
        const dt = now - prev.lastUpdate
        if (dt > 0) {
          // Velocidade = delta posição / delta tempo. Unidades: norm/ms.
          // Cap em MAX_VELOCITY para evitar saltos absurdos quando o tracker
          // reidentifica e a caixa pula de canto a canto.
          const maxV = MAX_VELOCITY / 1000  // converte para norm/ms
          const calcV = (a: number, b: number): number => {
            const v = (b - a) / dt
            if (v >  maxV) return  maxV
            if (v < -maxV) return -maxV
            return v
          }
          prev.velocity = [
            calcV(prev.lastBox[0], det.b[0]),
            calcV(prev.lastBox[1], det.b[1]),
            calcV(prev.lastBox[2], det.b[2]),
            calcV(prev.lastBox[3], det.b[3]),
          ]
        }
        prev.lastBox    = [det.b[0], det.b[1], det.b[2], det.b[3]]
        prev.lastUpdate = now
        prev.detection  = det
      } else {
        // Primeira vez que vemos esse track — velocidade zero, sem extrapolar
        // até termos uma segunda amostra para calcular delta.
        tracks.set(tid, {
          detection:  det,
          lastBox:    [det.b[0], det.b[1], det.b[2], det.b[3]],
          velocity:   [0, 0, 0, 0],
          lastUpdate: now,
        })
      }
    }

    // Garbage collect — remove tracks não vistos há TRACK_TTL_MS.
    // Isso permite que objetos saiam do frame naturalmente.
    for (const [tid, state] of tracks) {
      if (now - state.lastUpdate > TRACK_TTL_MS) {
        tracks.delete(tid)
      }
    }
  }, [payload])

  // ResizeObserver — quando o canvas muda de tamanho (rotação, fullscreen, etc),
  // precisamos atualizar canvas.width/height para evitar bbox distorcido.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const ro = new ResizeObserver(() => {
      const rect = parent.getBoundingClientRect()
      // devicePixelRatio para nitidez em telas Retina
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width  = Math.floor(rect.width  * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      canvas.style.width  = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
    })
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  // Render loop — requestAnimationFrame mantém ~60fps independente do SSE rate
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    /**
     * Desenha uma única detecção no canvas. Aceita box já interpolado/extrapolado
     * (não usa det.b diretamente — sempre passa o array `box` calculado).
     */
    function drawDetection(
      det: Detection,
      box: [number, number, number, number],
      cw: number,
      ch: number,
      dpr: number,
      opacityMul: number,
    ) {
      const [bx, by, bw, bh] = box
      const x = bx * cw
      const y = by * ch
      const w = bw * cw
      const h = bh * ch

      const col = colorFor(det.t)
      const isCritical = CRITICAL_TYPES.has(det.t)

      // Pulse animation para itens críticos: alpha oscila entre 0.6 e 1.0
      // em ~500ms (alerta de segurança piscando, padrão de DVRs profissionais).
      let alpha = 1
      if (isCritical) {
        const phase = (performance.now() % 1000) / 1000
        alpha = 0.6 + 0.4 * Math.abs(Math.sin(phase * Math.PI))
      }
      alpha *= opacityMul  // multiplicador de fade-out durante extrapolação

      // Box stroke
      ctx!.globalAlpha = alpha
      ctx!.lineWidth   = (isCritical ? 3 : 2) * dpr
      ctx!.strokeStyle = col.stroke
      ctx!.shadowColor = col.stroke
      ctx!.shadowBlur  = (isCritical ? 16 : 10) * dpr
      ctx!.strokeRect(x, y, w, h)
      ctx!.shadowBlur  = 0
      ctx!.globalAlpha = 1

      // Label
      if (showLabels) {
        const label = `${det.t.toUpperCase()} · ${Math.round(det.c * 100)}%`
        ctx!.font = `bold ${11 * dpr}px ui-monospace, SF Mono, monospace`
        const tm = ctx!.measureText(label)
        const padX = 6 * dpr
        const padY = 3 * dpr
        const tagW = tm.width + padX * 2
        const tagH = 18 * dpr

        // Tag fica acima do box; se não couber (y < tagH), coloca dentro
        const tagY = y > tagH ? y - tagH : y

        ctx!.globalAlpha = alpha
        ctx!.fillStyle = col.bg
        ctx!.fillRect(x - 1, tagY, tagW, tagH)
        ctx!.fillStyle = col.fg
        ctx!.fillText(label, x + padX - 1, tagY + tagH - padY)
        ctx!.globalAlpha = 1
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      if (showBoxes && enabledTypes.size > 0) {
        const cw = canvas!.width
        const ch = canvas!.height
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const now = performance.now()
        const tracks = tracksRef.current

        // ===== Detecções com trackId — desenho interpolado/extrapolado =====
        // Iteramos o cache (não o payload) para que objetos continuem visíveis
        // mesmo nos frames RAF entre dois SSE updates.
        for (const state of tracks.values()) {
          const det = state.detection
          if (!enabledTypes.has(det.t)) continue
          if (det.c < minConfidence) continue

          const elapsed = now - state.lastUpdate

          // Cutoff — track muito velho, não desenha (acima do limite de extrap).
          if (elapsed > EXTRAPOLATION_LIMIT_MS) continue

          // Decide damping/opacidade com base no tempo decorrido:
          //  - elapsed < EXPECTED_INTERVAL_MS (~200ms): interpolação suave
          //  - 200ms < elapsed < 500ms: extrapolação com damping + fade
          let damping: number
          let opacity: number
          if (elapsed < EXPECTED_INTERVAL_MS) {
            damping = INTERPOLATION_DAMPING
            opacity = 1.0
          } else {
            damping = EXTRAPOLATION_DAMPING
            // Fade linear: 1.0 em 200ms → 0.3 em 500ms
            const t = (elapsed - EXPECTED_INTERVAL_MS) /
                      (EXTRAPOLATION_LIMIT_MS - EXPECTED_INTERVAL_MS)
            opacity = 1.0 - t * 0.7
          }

          // Posição extrapolada = última posição + velocidade * tempo decorrido
          // Aplicamos damping para suavizar e evitar overshoot quando o objeto
          // muda de direção bruscamente entre amostras.
          const [lx, ly, lw, lh] = state.lastBox
          const [vx, vy, vw, vh] = state.velocity
          const k = elapsed * damping
          let bx = lx + vx * k
          let by = ly + vy * k
          let bw = lw + vw * k
          let bh = lh + vh * k

          // Clamp para o frame [0,1] — evita rasterizar pixels fora da tela.
          bx = Math.max(0, Math.min(1, bx))
          by = Math.max(0, Math.min(1, by))
          bw = Math.max(0.001, Math.min(1 - bx, bw))
          bh = Math.max(0.001, Math.min(1 - by, bh))

          drawDetection(det, [bx, by, bw, bh], cw, ch, dpr, opacity)
        }

        // ===== Detecções SEM trackId — caminho legado (sem interpolação) =====
        // Mantém compatibilidade com payloads antigos / detecções não confirmadas
        // pelo Norfair. Renderiza direto da posição informada, sem cache.
        const p = lastPayloadRef.current
        if (p) {
          for (const det of p.d) {
            if (det.i) continue  // já desenhado acima via cache
            if (!enabledTypes.has(det.t)) continue
            if (det.c < minConfidence) continue
            drawDetection(det, det.b, cw, ch, dpr, 1.0)
          }
        }
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [enabledTypes, showLabels, showBoxes, minConfidence])

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className ?? ''}`}
    />
  )
}
