/**
 * TripwireEditor — UI para configurar a linha de contagem da câmera.
 *
 * Mostrado em modo "editar". O operador arrasta os endpoints A e B para
 * posicionar a linha sobre o local desejado (ex: porta, caixa, portão).
 *
 * Coordenadas normalizadas (0..1) — funciona em qualquer aspect ratio.
 *
 * UX:
 *   - Click em "Editar tripwire" entra no modo editor
 *   - Endpoints A e B aparecem como círculos arrastáveis
 *   - Mouse/touch move atualiza posição em tempo real
 *   - "Salvar" persiste no store, "Cancelar" descarta
 *   - "Remover" deleta a linha da câmera
 */
import { useEffect, useRef, useState } from 'react'
import { useTripwireStore } from '../../stores/useTripwireStore'

interface Props {
  cameraId: string
  /** Quando true, mostra o editor sobreposto. Default false. */
  active: boolean
  onClose: () => void
}

export function TripwireEditor({ cameraId, active, onClose }: Props) {
  const existing = useTripwireStore(s => s.lines[cameraId])
  const setLine = useTripwireStore(s => s.setLine)
  const removeLine = useTripwireStore(s => s.removeLine)
  const resetCounter = useTripwireStore(s => s.resetCounter)

  // Estado local — só persiste no save
  const [a, setA] = useState<[number, number]>(existing?.a ?? [0.1, 0.5])
  const [b, setB] = useState<[number, number]>(existing?.b ?? [0.9, 0.5])
  const [label, setLabel] = useState(existing?.label ?? '')
  const [inDirection, setInDirection] = useState<'left' | 'right'>(existing?.inDirection ?? 'left')
  const [labelIn,  setLabelIn]  = useState(existing?.labelIn  ?? 'IN')
  const [labelOut, setLabelOut] = useState(existing?.labelOut ?? 'OUT')
  const [dragging, setDragging] = useState<'a' | 'b' | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)

  // Reset local state quando câmera mudar
  useEffect(() => {
    setA(existing?.a ?? [0.1, 0.5])
    setB(existing?.b ?? [0.9, 0.5])
    setLabel(existing?.label ?? '')
    setInDirection(existing?.inDirection ?? 'left')
    setLabelIn(existing?.labelIn ?? 'IN')
    setLabelOut(existing?.labelOut ?? 'OUT')
  }, [cameraId, existing])

  function pointerToNorm(e: React.PointerEvent): [number, number] {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return [0, 0]
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return
    const p = pointerToNorm(e)
    if (dragging === 'a') setA(p)
    else setB(p)
  }

  function onSave() {
    setLine(cameraId, {
      a, b,
      label: label.trim() || undefined,
      enabled: true,
      inDirection,
      labelIn:  labelIn.trim()  || 'IN',
      labelOut: labelOut.trim() || 'OUT',
    })
    onClose()
  }

  function onCancel() {
    setA(existing?.a ?? [0.1, 0.5])
    setB(existing?.b ?? [0.9, 0.5])
    setLabel(existing?.label ?? '')
    setInDirection(existing?.inDirection ?? 'left')
    setLabelIn(existing?.labelIn ?? 'IN')
    setLabelOut(existing?.labelOut ?? 'OUT')
    onClose()
  }

  function onRemove() {
    removeLine(cameraId)
    onClose()
  }

  if (!active) return null

  function onEndpointDown(which: 'a' | 'b') {
    return (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      setDragging(which)
    }
  }

  function onEndpointUp(e: React.PointerEvent) {
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    setDragging(null)
  }

  function onEndpointMove(which: 'a' | 'b') {
    return (e: React.PointerEvent) => {
      if (dragging !== which) return
      const p = pointerToNorm(e)
      if (which === 'a') setA(p)
      else setB(p)
    }
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-40 cursor-crosshair"
      style={{ pointerEvents: 'auto' }}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(null)}
      onPointerLeave={() => setDragging(null)}
    >
      {/* Overlay escuro semitransparente — destaca o modo edicao */}
      <div className="absolute inset-0 bg-black/30 pointer-events-none" />

      {/* SVG da linha + seta indicando o lado IN.
          A seta perpendicular ajuda o operador a visualizar qual lado conta
          como entrada. Click no botao "Inverter" troca para o outro lado. */}
      {(() => {
        // Calculo da seta IN (em % do viewport SVG, sem precisar do rect real)
        const midX = (a[0] + b[0]) / 2
        const midY = (a[1] + b[1]) / 2
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const len = Math.sqrt(dx * dx + dy * dy) || 0.0001
        // Perpendicular CCW (em coords de canvas, y cresce p/ baixo)
        const normX = -dy / len
        const normY =  dx / len
        const sign = inDirection === 'left' ? 1 : -1
        const arrowLen = 0.06  // 6% da diagonal
        const tipX = midX + sign * normX * arrowLen
        const tipY = midY + sign * normY * arrowLen
        return (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
            <line
              x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              stroke="#ec4899" strokeWidth={0.005}
              strokeDasharray="0.015 0.01"
              vectorEffect="non-scaling-stroke"
              style={{ filter: 'drop-shadow(0 0 6px #ec4899)' }}
            />
            {/* Seta IN — verde, perpendicular ao meio */}
            <line
              x1={midX} y1={midY} x2={tipX} y2={tipY}
              stroke="#10b981" strokeWidth={0.004}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={tipX} cy={tipY} r={0.008} fill="#10b981" />
          </svg>
        )
      })()}

      {/* Endpoint A — usa setPointerCapture pra continuar recebendo events
          mesmo se o cursor sair do circulo durante o drag. */}
      <div
        className="absolute size-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500 ring-2 ring-white shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center text-xs font-bold text-white touch-none select-none"
        style={{ left: `${a[0] * 100}%`, top: `${a[1] * 100}%`, pointerEvents: 'auto' }}
        onPointerDown={onEndpointDown('a')}
        onPointerMove={onEndpointMove('a')}
        onPointerUp={onEndpointUp}
        onPointerCancel={onEndpointUp}
      >A</div>

      {/* Endpoint B */}
      <div
        className="absolute size-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500 ring-2 ring-white shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center text-xs font-bold text-white touch-none select-none"
        style={{ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, pointerEvents: 'auto' }}
        onPointerDown={onEndpointDown('b')}
        onPointerMove={onEndpointMove('b')}
        onPointerUp={onEndpointUp}
        onPointerCancel={onEndpointUp}
      >B</div>

      {/* Painel de controles — canto inferior */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur rounded-lg border border-white/20 shadow-2xl p-3 min-w-[360px]">
        <div className="text-xs text-slate-300 mb-2">
          Arraste <span className="text-pink-400 font-bold">A</span> e <span className="text-pink-400 font-bold">B</span> sobre a linha. A seta <span className="text-emerald-400 font-bold">verde</span> aponta para o lado <span className="text-emerald-400 font-bold">IN</span> (entrada).
        </div>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Rótulo da linha (ex: Faixa de pedestres)"
          className="w-full px-2 py-1.5 rounded bg-slate-800 text-slate-100 text-xs border border-slate-700 focus:border-pink-500 focus:outline-none mb-2"
        />
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="text-[10px] text-emerald-400 font-bold uppercase">Lado IN ↑</label>
            <input
              type="text"
              value={labelIn}
              onChange={(e) => setLabelIn(e.target.value)}
              placeholder="Subindo"
              className="w-full px-2 py-1 rounded bg-slate-800 text-emerald-100 text-xs border border-emerald-700/40 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-rose-400 font-bold uppercase">Lado OUT ↓</label>
            <input
              type="text"
              value={labelOut}
              onChange={(e) => setLabelOut(e.target.value)}
              placeholder="Descendo"
              className="w-full px-2 py-1 rounded bg-slate-800 text-rose-100 text-xs border border-rose-700/40 focus:border-rose-500 focus:outline-none"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setInDirection(d => d === 'left' ? 'right' : 'left')}
          className="w-full mb-2 px-3 py-1.5 text-xs rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-100 border border-emerald-500/40 font-medium flex items-center justify-center gap-2"
          title="Troca qual lado da linha conta como IN"
        >
          ⇄ Inverter direção
        </button>
        <div className="flex gap-2 justify-end">
          {existing && (
            <button
              type="button"
              onClick={onRemove}
              className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-500 text-white font-medium"
            >Remover</button>
          )}
          {existing && (
            <button
              type="button"
              onClick={() => { resetCounter(cameraId) }}
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white font-medium"
            >Zerar contador</button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium"
          >Cancelar</button>
          <button
            type="button"
            onClick={onSave}
            className="px-3 py-1.5 text-xs rounded bg-pink-600 hover:bg-pink-500 text-white font-medium"
          >Salvar</button>
        </div>
      </div>
    </div>
  )
}
