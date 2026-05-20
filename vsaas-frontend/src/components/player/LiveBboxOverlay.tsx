/**
 * LiveBboxOverlay — desenha bounding boxes em tempo real sobre o LivePlayer.
 *
 * Renderiza um <canvas> absolutamente posicionado sobre o <video> (ou <img>).
 * Coordenadas vêm normalizadas (0..1) do worker, então funciona com qualquer
 * resolução. Usa requestAnimationFrame para suavidade.
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
import type { DetectionPayload } from '../../hooks/useLiveDetections'

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

  // Mantém ref do payload mais recente para o loop RAF
  useEffect(() => {
    lastPayloadRef.current = payload
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

    function draw() {
      const p = lastPayloadRef.current
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      if (p && showBoxes && enabledTypes.size > 0) {
        const cw = canvas!.width
        const ch = canvas!.height
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        for (const det of p.d) {
          if (!enabledTypes.has(det.t)) continue
          if (det.c < minConfidence) continue

          const [bx, by, bw, bh] = det.b
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

            ctx!.fillStyle = col.bg
            ctx!.fillRect(x - 1, tagY, tagW, tagH)
            ctx!.fillStyle = col.fg
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
