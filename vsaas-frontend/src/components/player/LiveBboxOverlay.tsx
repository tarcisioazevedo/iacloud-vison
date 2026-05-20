/**
 * LiveBboxOverlay — desenha bounding boxes em tempo real sobre o LivePlayer.
 *
 * Renderiza um <canvas> absolutamente posicionado sobre o <video>. Coords
 * vêm normalizadas (0..1) do worker, funciona com qualquer resolução.
 * Usa requestAnimationFrame para suavidade.
 *
 * Inclui:
 *   - Track ID chip dentro do bbox (canto superior direito)
 *   - Cor cinza pra tracks novos (<1.5s); cor do tipo pra tracks confirmados
 *   - Pulse de alpha pra itens críticos (faca, arma, etc)
 *   - Ghost filter: descarta person com aspect ratio inválido ou muito
 *     pequena (capôs de carros, sombras detectados como pessoa).
 */
import { useEffect, useRef } from 'react'
import type { DetectionPayload } from '../../hooks/useLiveDetections'

export interface BboxOverlayProps {
  payload: DetectionPayload | null
  enabledTypes: Set<string>           // se vazio, não desenha
  showLabels?: boolean                // default true
  showBoxes?: boolean                 // default true
  minConfidence?: number              // 0..1, default 0
  className?: string
}

const COLOR_MAP: Record<string, { stroke: string; bg: string; fg: string }> = {
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

/**
 * Filtra ghost detections: 'person' em capô de carro, sombra ou reflexo
 * detectados como pedestre em CCTV noturno. Pessoa em pé tem aspect ratio
 * w/h tipicamente < 0.6 (alta). Bbox quadrado/horizontal e quase certo
 * lixo. Também descarta bbox muito pequeno (artefato).
 */
function isGhostPerson(t: string, bw: number, bh: number): boolean {
  if (t !== 'person') return false
  if (bw / bh > 0.9) return true
  if (bh < 0.04) return true
  return false
}

const TRACK_TTL_MS = 5_000  // Esquece tracks invisíveis há >5s

interface TrackState {
  firstSeenAt: number
  lastSeenAt:  number
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
  const trackStateRef = useRef<Map<string, TrackState>>(new Map())

  // Mantém ref do payload mais recente para o loop RAF + atualiza tracks
  useEffect(() => {
    lastPayloadRef.current = payload
    if (!payload) return
    const now = Date.now()
    for (const det of payload.d) {
      if (!det.i) continue
      const [, , bw, bh] = det.b
      if (isGhostPerson(det.t, bw, bh)) continue
      const existing = trackStateRef.current.get(det.i)
      if (existing) {
        existing.lastSeenAt = now
      } else {
        trackStateRef.current.set(det.i, { firstSeenAt: now, lastSeenAt: now })
      }
    }
    // Cleanup tracks invisíveis há >TTL
    for (const [id, state] of trackStateRef.current.entries()) {
      if (now - state.lastSeenAt > TRACK_TTL_MS) {
        trackStateRef.current.delete(id)
      }
    }
  }, [payload])

  // ResizeObserver — ajusta canvas.width/height quando o container muda
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

  // Render loop — RAF mantém ~60fps independente do SSE rate
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function draw() {
      const p = lastPayloadRef.current
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      const cw = canvas!.width
      const ch = canvas!.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)

      if (p && showBoxes && enabledTypes.size > 0) {
        const now = Date.now()
        for (const det of p.d) {
          if (!enabledTypes.has(det.t)) continue
          if (det.c < minConfidence) continue

          const [bx, by, bw, bh] = det.b
          if (isGhostPerson(det.t, bw, bh)) continue

          const x = bx * cw
          const y = by * ch
          const w = bw * cw
          const h = bh * ch

          const baseColor = colorFor(det.t)
          const trackId = det.i
          const trackState = trackId ? trackStateRef.current.get(trackId) : undefined
          const isCritical = CRITICAL_TYPES.has(det.t)

          let stroke = baseColor.stroke
          let labelBg = baseColor.bg
          let labelFg = baseColor.fg
          let alpha = 1

          if (isCritical) {
            const phase = (performance.now() % 1000) / 1000
            alpha = 0.6 + 0.4 * Math.abs(Math.sin(phase * Math.PI))
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
            ctx!.fillStyle = 'rgba(15, 23, 42, 0.85)'
            ctx!.fillRect(idX, idY, idW, idH)
            ctx!.fillStyle = '#cbd5e1'
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
