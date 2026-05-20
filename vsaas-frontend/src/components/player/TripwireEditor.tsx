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

      {/* SVG: linha A->B em rosa + seta perpendicular verde apontando IN.
          Coordenadas em % do container (SVG mede em px reais via getBBox).
          Stroke em pixels — visivel em qualquer resolucao. */}
      {(() => {
        const aPctX = a[0] * 100
        const aPctY = a[1] * 100
        const bPctX = b[0] * 100
        const bPctY = b[1] * 100
        const midPctX = (aPctX + bPctX) / 2
        const midPctY = (aPctY + bPctY) / 2
        // Perpendicular CCW da direcao A->B (em coords de canvas y-down).
        // Comprimento ~6% da menor dimensao (visivel mas sem cobrir cena).
        const dx = bPctX - aPctX
        const dy = bPctY - aPctY
        const len = Math.sqrt(dx * dx + dy * dy) || 0.0001
        const normX = -dy / len
        const normY =  dx / len
        const sign = inDirection === 'left' ? 1 : -1
        const ARR = 8  // 8% (multiplicador depois do unitario)
        const tipPctX = midPctX + sign * normX * ARR
        const tipPctY = midPctY + sign * normY * ARR
        return (
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {/* Linha do tripwire — rosa pontilhada */}
            <line
              x1={`${aPctX}%`} y1={`${aPctY}%`}
              x2={`${bPctX}%`} y2={`${bPctY}%`}
              stroke="#ec4899" strokeWidth={3}
              strokeDasharray="10 6"
              style={{ filter: 'drop-shadow(0 0 6px #ec4899)' }}
            />
            {/* Seta IN — verde, perpendicular ao meio */}
            <line
              x1={`${midPctX}%`} y1={`${midPctY}%`}
              x2={`${tipPctX}%`} y2={`${tipPctY}%`}
              stroke="#10b981" strokeWidth={3}
              markerEnd="url(#arrow-in)"
              style={{ filter: 'drop-shadow(0 0 4px #10b981)' }}
            />
            <defs>
              <marker id="arrow-in" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L6,3 L0,6 Z" fill="#10b981" />
              </marker>
            </defs>
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

      {/* Painel compacto — canto inferior direito (nao cobre centro do video).
          Largura fixa pequena (260px), permite ver A/B e cena enquanto edita. */}
      <div className="absolute bottom-3 right-3 bg-slate-900/95 backdrop-blur rounded-lg border border-white/20 shadow-2xl p-3 w-[280px] flex flex-col gap-2">
        <div className="text-[10px] text-slate-400 leading-tight">
          Arraste <span className="text-pink-400 font-bold">A</span> e <span className="text-pink-400 font-bold">B</span>. Seta <span className="text-emerald-400 font-bold">verde</span> = lado <span className="text-emerald-400 font-bold">IN</span>.
        </div>

        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Rótulo (ex: Faixa pedestres)"
          className="w-full px-2 py-1.5 rounded bg-slate-800 text-slate-100 text-xs border border-slate-700 focus:border-pink-500 focus:outline-none"
        />

        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="text"
            value={labelIn}
            onChange={(e) => setLabelIn(e.target.value)}
            placeholder="IN"
            title="Nome do lado IN (ex: Subindo)"
            className="px-2 py-1 rounded bg-emerald-900/30 text-emerald-100 text-xs border border-emerald-700/50 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="text"
            value={labelOut}
            onChange={(e) => setLabelOut(e.target.value)}
            placeholder="OUT"
            title="Nome do lado OUT (ex: Descendo)"
            className="px-2 py-1 rounded bg-rose-900/30 text-rose-100 text-xs border border-rose-700/50 focus:border-rose-500 focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setInDirection(d => d === 'left' ? 'right' : 'left')}
          className="px-2 py-1.5 text-xs rounded bg-emerald-800/40 hover:bg-emerald-800/60 text-emerald-100 border border-emerald-600/40 font-medium"
          title="Inverte qual lado e IN"
        >
          ⇄ Inverter IN ↔ OUT
        </button>

        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={onSave}
            className="flex-1 px-2 py-1.5 text-xs rounded bg-pink-600 hover:bg-pink-500 text-white font-bold"
          >Salvar</button>
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
          >Cancelar</button>
        </div>

        {existing && (
          <div className="flex gap-1.5 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={() => resetCounter(cameraId)}
              className="flex-1 px-2 py-1 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
            >Zerar contagem</button>
            <button
              type="button"
              onClick={onRemove}
              className="flex-1 px-2 py-1 text-[10px] rounded bg-red-600/70 hover:bg-red-600 text-white"
            >Remover</button>
          </div>
        )}
      </div>
    </div>
  )
}
