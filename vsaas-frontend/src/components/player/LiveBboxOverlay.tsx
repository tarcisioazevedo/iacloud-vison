/**
 * LiveBboxOverlay — desenha bounding boxes em tempo real sobre o LivePlayer.
 *
 * Renderiza um <canvas> absolutamente posicionado sobre o <video> (ou <img>).
 * Coordenadas vêm normalizadas (0..1) do worker, então funciona com qualquer
 * resolução. Usa requestAnimationFrame para suavidade.
 *
 * Renderiza também:
 *   - Track ID dentro do bbox (chip cinza no canto superior direito)
 *   - Cor por estado: novo (cinza) → ativo (cor do tipo) → cruzou IN (verde)
 *     → cruzou OUT (vermelho)
 *   - Linha de tripwire configurada (em magenta)
 *   - Contador IN/OUT persistente no canto superior esquerdo
 *
 * Detecção de cruzamento: para cada track com ID, comparamos centro do
 * bbox em N-1 vs N. Se o segmento (prev, cur) intersecta a linha (a, b),
 * conta um crossing. Direção: sinal do produto cruzado (a→b) × (prev→cur).
 *
 * Filtros aplicados client-side via props `enabledTypes`:
 *   Set vazio = não desenha nada (mas mantém SSE conectado, contagem ainda
 *   funciona). Útil para o operador "desligar overlay" sem perder os dados.
 */
import { useEffect, useRef } from 'react'
import type { DetectionPayload } from '../../hooks/useLiveDetections'
import { useTripwireStore, type TripwireLine } from '../../stores/useTripwireStore'

export interface BboxOverlayProps {
  payload: DetectionPayload | null
  enabledTypes: Set<string>           // se vazio, não desenha; "all" via Set([...])
  showLabels?: boolean                // default true
  showBoxes?: boolean                 // default true
  minConfidence?: number              // 0..1, default 0
  className?: string
  cameraId?: string                   // pra tripwire por câmera
}

const COLOR_MAP: Record<string, { stroke: string; bg: string; fg: string }> = {
  // Pessoas / Veículos — verde/ciano
  person:       { stroke: '#10b981', bg: '#10b981', fg: '#022c22' },
  car:          { stroke: '#06b6d4', bg: '#06b6d4', fg: '#083344' },
  truck:        { stroke: '#06b6d4', bg: '#06b6d4', fg: '#083344' },
  bus:          { stroke: '#06b6d4', bg: '#06b6d4', fg: '#083344' },
  motorcycle:   { stroke: '#06b6d4', bg: '#06b6d4', fg: '#083344' },
  bicycle:      { stroke: '#a78bfa', bg: '#a78bfa', fg: '#2e1065' },
  dog:          { stroke: '#f59e0b', bg: '#f59e0b', fg: '#451a03' },
  cat:          { stroke: '#f59e0b', bg: '#f59e0b', fg: '#451a03' },
  bird:         { stroke: '#f59e0b', bg: '#f59e0b', fg: '#451a03' },
  horse:        { stroke: '#f59e0b', bg: '#f59e0b', fg: '#451a03' },
  backpack:     { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  handbag:      { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  suitcase:     { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  'cell phone': { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  laptop:       { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  umbrella:     { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  bottle:       { stroke: '#a855f7', bg: '#a855f7', fg: '#3b0764' },
  knife:          { stroke: '#ef4444', bg: '#ef4444', fg: '#450a0a' },
  scissors:       { stroke: '#ef4444', bg: '#ef4444', fg: '#450a0a' },
  'baseball bat': { stroke: '#ef4444', bg: '#ef4444', fg: '#450a0a' },
  weapon:         { stroke: '#dc2626', bg: '#dc2626', fg: '#450a0a' },
  chair:        { stroke: '#94a3b8', bg: '#94a3b8', fg: '#0f172a' },
  couch:        { stroke: '#94a3b8', bg: '#94a3b8', fg: '#0f172a' },
  tv:           { stroke: '#94a3b8', bg: '#94a3b8', fg: '#0f172a' },
  'potted plant': { stroke: '#94a3b8', bg: '#94a3b8', fg: '#0f172a' },
  _default:     { stroke: '#6366f1', bg: '#6366f1', fg: '#1e1b4b' },
}

function colorFor(type: string) {
  return COLOR_MAP[type] ?? COLOR_MAP._default
}

const CRITICAL_TYPES = new Set(['knife', 'scissors', 'baseball bat', 'weapon'])

// Estado de cada track (centro anterior + idade + flag de cruzamento)
interface TrackState {
  prevCenter: [number, number] | null
  lastCenter: [number, number]
  firstSeenAt: number
  lastSeenAt: number
  crossed?: 'in' | 'out'
  crossedAt?: number
}

// Segment intersection (Cohen-Sutherland inspired).
// Retorna true se segmento (p1, p2) intersecta (p3, p4).
// Cross product sign também indica direção do cruzamento.
function segmentsIntersect(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number],
): boolean {
  const ccw = (a: [number, number], b: [number, number], c: [number, number]) =>
    (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
}

// Direção do cruzamento: sinal do produto cruzado da linha vs movimento.
// Linha A→B, ponto prev. Se prev está à esquerda da linha (cross > 0) e
// cur está à direita (cross < 0), direção = 'out' (default). Inverso = 'in'.
//
// inDirection='right' inverte a logica: o operador escolheu que o IN e o
// lado direito (vetor A->B). Util quando a camera ou orientacao natural
// da cena exige IN no outro lado.
function crossingDirection(
  lineA: [number, number], lineB: [number, number],
  prev: [number, number], _cur: [number, number],
  inDirection: 'left' | 'right' = 'left',
): 'in' | 'out' {
  const lineDx = lineB[0] - lineA[0]
  const lineDy = lineB[1] - lineA[1]
  const prevCross = lineDx * (prev[1] - lineA[1]) - lineDy * (prev[0] - lineA[0])
  // prev > 0 = lado esquerdo da linha A->B (em coords de canvas, y cresce p/ baixo)
  // Se prev estava na esquerda e cruzou pra direita = OUT (saiu da zona esquerda)
  // Se inDirection='right', o lado direito e o IN, entao inverte.
  const movedFromLeftToRight = prevCross > 0
  if (inDirection === 'left') {
    return movedFromLeftToRight ? 'out' : 'in'
  } else {
    return movedFromLeftToRight ? 'in' : 'out'
  }
}

const TRACK_TTL_MS = 5_000          // Esquece tracks invisíveis há >5s
const CROSSED_HIGHLIGHT_MS = 1_500  // Pulso visual após cruzamento

export function LiveBboxOverlay({
  payload,
  enabledTypes,
  showLabels = true,
  showBoxes  = true,
  minConfidence = 0,
  className,
  cameraId,
}: BboxOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number | null>(null)
  const lastPayloadRef = useRef<DetectionPayload | null>(null)
  const trackStateRef = useRef<Map<string, TrackState>>(new Map())

  const tripwire = useTripwireStore(s => (cameraId ? s.lines[cameraId] : undefined))
  const increment = useTripwireStore(s => s.increment)

  // Mantém ref do payload mais recente para o loop RAF
  useEffect(() => {
    lastPayloadRef.current = payload

    // Atualiza estado de tracks com novo payload
    if (!payload || !cameraId) return
    const now = Date.now()
    const tripwireEnabled = tripwire?.enabled && tripwire.a && tripwire.b

    const seen = new Set<string>()
    for (const det of payload.d) {
      if (!det.i) continue  // sem trackId, não rastreia cruzamento
      seen.add(det.i)
      const [bx, by, bw, bh] = det.b
      const center: [number, number] = [bx + bw / 2, by + bh / 2]

      const existing = trackStateRef.current.get(det.i)
      if (!existing) {
        trackStateRef.current.set(det.i, {
          prevCenter: null,
          lastCenter: center,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        continue
      }

      // Detecção de cruzamento: segmento (lastCenter, center) = entre o
      // frame N-1 (existing.lastCenter) e o frame atual N (center).
      // existing.prevCenter usado apenas como guardia "tem 2 frames de
      // historico" — evita falsos positivos no track recem-criado.
      if (
        tripwireEnabled && existing.prevCenter && !existing.crossed &&
        segmentsIntersect(existing.lastCenter, center, tripwire!.a, tripwire!.b)
      ) {
        const dir = crossingDirection(
          tripwire!.a, tripwire!.b,
          existing.lastCenter, center,
          tripwire!.inDirection ?? 'left',
        )
        existing.crossed = dir
        existing.crossedAt = now
        increment(cameraId, dir)
      }

      existing.prevCenter = existing.lastCenter
      existing.lastCenter = center
      existing.lastSeenAt = now
      trackStateRef.current.set(det.i, existing)
    }

    // Cleanup tracks invisíveis há >TTL
    for (const [id, state] of trackStateRef.current.entries()) {
      if (now - state.lastSeenAt > TRACK_TTL_MS) {
        trackStateRef.current.delete(id)
      }
    }
  }, [payload, cameraId, tripwire, increment])

  // ResizeObserver — quando o canvas muda de tamanho (rotação, fullscreen, etc),
  // precisamos atualizar canvas.width/height para evitar bbox distorcido.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const ro = new ResizeObserver(() => {
      const rect = parent.getBoundingClientRect()
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

    function drawTripwire(line: TripwireLine, cw: number, ch: number, dpr: number) {
      const ax = line.a[0] * cw
      const ay = line.a[1] * ch
      const bx = line.b[0] * cw
      const by = line.b[1] * ch

      ctx!.save()
      ctx!.strokeStyle = '#ec4899'  // magenta
      ctx!.lineWidth = 3 * dpr
      ctx!.setLineDash([8 * dpr, 6 * dpr])
      ctx!.shadowColor = '#ec4899'
      ctx!.shadowBlur = 8 * dpr
      ctx!.beginPath()
      ctx!.moveTo(ax, ay)
      ctx!.lineTo(bx, by)
      ctx!.stroke()
      ctx!.setLineDash([])
      ctx!.shadowBlur = 0

      // Endpoints
      ctx!.fillStyle = '#ec4899'
      ctx!.beginPath()
      ctx!.arc(ax, ay, 5 * dpr, 0, Math.PI * 2)
      ctx!.fill()
      ctx!.beginPath()
      ctx!.arc(bx, by, 5 * dpr, 0, Math.PI * 2)
      ctx!.fill()

      // Seta perpendicular indicando o lado IN.
      // Vetor da linha: d = (bx-ax, by-ay). Perpendicular CCW = (-dy, dx).
      // Em coords de canvas (y cresce p/ baixo), perpendicular CCW aponta
      // pra ESQUERDA da linha A->B (lado positivo do produto cruzado).
      // Se inDirection='right', desenha a seta na perpendicular oposta.
      const dx = bx - ax
      const dy = by - ay
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const normX = -dy / len   // perpendicular CCW unitaria
      const normY =  dx / len
      const sign = (line.inDirection ?? 'left') === 'left' ? 1 : -1
      const arrowLen = 28 * dpr
      const midX = (ax + bx) / 2
      const midY = (ay + by) / 2
      const tipX = midX + sign * normX * arrowLen
      const tipY = midY + sign * normY * arrowLen

      ctx!.strokeStyle = '#10b981'  // verde — IN
      ctx!.fillStyle   = '#10b981'
      ctx!.lineWidth = 2 * dpr
      ctx!.beginPath()
      ctx!.moveTo(midX, midY)
      ctx!.lineTo(tipX, tipY)
      ctx!.stroke()
      // Cabeca da seta
      const headLen = 8 * dpr
      const angle = Math.atan2(tipY - midY, tipX - midX)
      ctx!.beginPath()
      ctx!.moveTo(tipX, tipY)
      ctx!.lineTo(
        tipX - headLen * Math.cos(angle - Math.PI / 6),
        tipY - headLen * Math.sin(angle - Math.PI / 6),
      )
      ctx!.lineTo(
        tipX - headLen * Math.cos(angle + Math.PI / 6),
        tipY - headLen * Math.sin(angle + Math.PI / 6),
      )
      ctx!.closePath()
      ctx!.fill()
      // Label "IN" perto da ponta da seta
      ctx!.font = `bold ${10 * dpr}px ui-sans-serif, system-ui`
      ctx!.fillStyle = '#022c22'
      const inTm = ctx!.measureText('IN')
      const inBgX = tipX - inTm.width / 2 - 4 * dpr
      const inBgY = tipY + sign * 8 * dpr - (sign > 0 ? 0 : 14 * dpr)
      ctx!.fillStyle = 'rgba(16, 185, 129, 0.95)'
      ctx!.fillRect(inBgX, inBgY, inTm.width + 8 * dpr, 14 * dpr)
      ctx!.fillStyle = '#022c22'
      ctx!.fillText('IN', tipX - inTm.width / 2, inBgY + 11 * dpr)

      // Label opcional do tripwire (no MEIO oposto da seta IN, pra nao colidir)
      if (line.label) {
        ctx!.font = `bold ${10 * dpr}px ui-sans-serif, system-ui`
        const tm = ctx!.measureText(line.label)
        const lblX = midX - sign * normX * 24 * dpr
        const lblY = midY - sign * normY * 24 * dpr
        ctx!.fillStyle = 'rgba(236, 72, 153, 0.9)'
        ctx!.fillRect(lblX - tm.width / 2 - 4 * dpr, lblY - 8 * dpr, tm.width + 8 * dpr, 16 * dpr)
        ctx!.fillStyle = '#fff'
        ctx!.fillText(line.label, lblX - tm.width / 2, lblY + 4 * dpr)
      }
      ctx!.restore()
    }

    function draw() {
      const p = lastPayloadRef.current
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      const cw = canvas!.width
      const ch = canvas!.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)

      // 1. Linha de tripwire (atrás dos bboxes)
      if (tripwire?.enabled) {
        drawTripwire(tripwire, cw, ch, dpr)
      }

      // 2. Bboxes
      if (p && showBoxes && enabledTypes.size > 0) {
        const now = Date.now()
        for (const det of p.d) {
          if (!enabledTypes.has(det.t)) continue
          if (det.c < minConfidence) continue

          const [bx, by, bw, bh] = det.b
          const x = bx * cw
          const y = by * ch
          const w = bw * cw
          const h = bh * ch

          // Cor por estado
          const baseColor = colorFor(det.t)
          const trackId = det.i
          const trackState = trackId ? trackStateRef.current.get(trackId) : undefined
          const isCritical = CRITICAL_TYPES.has(det.t)

          let stroke = baseColor.stroke
          let labelBg = baseColor.bg
          let labelFg = baseColor.fg
          let alpha = 1

          if (isCritical) {
            // Pulse pra crítico — alpha oscila 0.6-1.0
            const phase = (performance.now() % 1000) / 1000
            alpha = 0.6 + 0.4 * Math.abs(Math.sin(phase * Math.PI))
          } else if (trackState?.crossed && trackState.crossedAt && (now - trackState.crossedAt) < CROSSED_HIGHLIGHT_MS) {
            // Acabou de cruzar: verde (IN) ou vermelho (OUT)
            stroke = trackState.crossed === 'in' ? '#10b981' : '#ef4444'
            labelBg = stroke
            labelFg = trackState.crossed === 'in' ? '#022c22' : '#450a0a'
          } else if (trackState && (now - trackState.firstSeenAt) < 1500) {
            // Track novo (<1.5s): cinza
            stroke = '#94a3b8'
            labelBg = '#475569'
            labelFg = '#f1f5f9'
          }

          // Box stroke
          ctx!.globalAlpha = alpha
          ctx!.lineWidth   = (isCritical ? 3 : 2) * dpr
          ctx!.strokeStyle = stroke
          ctx!.shadowColor = stroke
          ctx!.shadowBlur  = (isCritical ? 16 : 8) * dpr
          ctx!.strokeRect(x, y, w, h)
          ctx!.shadowBlur  = 0
          ctx!.globalAlpha = 1

          // Track ID chip (canto superior direito do bbox)
          if (trackId) {
            const idText = `#${trackId.slice(-4)}`
            ctx!.font = `bold ${10 * dpr}px ui-monospace, SF Mono, monospace`
            const idTm = ctx!.measureText(idText)
            const idPad = 3 * dpr
            const idW = idTm.width + idPad * 2
            const idH = 14 * dpr
            const idX = x + w - idW
            const idY = y
            ctx!.fillStyle = 'rgba(15, 23, 42, 0.85)'  // slate-900
            ctx!.fillRect(idX, idY, idW, idH)
            ctx!.fillStyle = '#cbd5e1'  // slate-300
            ctx!.fillText(idText, idX + idPad, idY + idH - idPad - 1)
          }

          // Label de tipo + conf (canto superior esquerdo, acima do box)
          if (showLabels) {
            const label = `${det.t.toUpperCase()} ${Math.round(det.c * 100)}%`
            ctx!.font = `bold ${11 * dpr}px ui-monospace, SF Mono, monospace`
            const tm = ctx!.measureText(label)
            const padX = 6 * dpr
            const padY = 3 * dpr
            const tagW = tm.width + padX * 2
            const tagH = 18 * dpr
            const tagY = y > tagH ? y - tagH : y

            ctx!.fillStyle = labelBg
            ctx!.fillRect(x - 1, tagY, tagW, tagH)
            ctx!.fillStyle = labelFg
            ctx!.fillText(label, x + padX - 1, tagY + tagH - padY)
          }
        }
      }

      // Counter agora e um <div> HTML no LivePlayer (chip), nao no canvas.
      // O canvas tem z-index menor que overlays HTML (como titulo da camera),
      // que escondia o counter desenhado no topo. Mantemos no JSX.
      rafRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [enabledTypes, showLabels, showBoxes, minConfidence, tripwire])

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className ?? ''}`}
    />
  )
}
