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
  const [dragging, setDragging] = useState<'a' | 'b' | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)

  // Reset local state quando câmera mudar
  useEffect(() => {
    setA(existing?.a ?? [0.1, 0.5])
    setB(existing?.b ?? [0.9, 0.5])
    setLabel(existing?.label ?? '')
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
    setLine(cameraId, { a, b, label: label.trim() || undefined, enabled: true })
    onClose()
  }

  function onCancel() {
    setA(existing?.a ?? [0.1, 0.5])
    setB(existing?.b ?? [0.9, 0.5])
    setLabel(existing?.label ?? '')
    onClose()
  }

  function onRemove() {
    removeLine(cameraId)
    onClose()
  }

  if (!active) return null

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-30 cursor-crosshair"
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(null)}
      onPointerLeave={() => setDragging(null)}
    >
      {/* Overlay escuro semitransparente — destaca o modo edicao */}
      <div className="absolute inset-0 bg-black/30 pointer-events-none" />

      {/* SVG da linha + endpoints */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <line
          x1={`${a[0] * 100}%`} y1={`${a[1] * 100}%`}
          x2={`${b[0] * 100}%`} y2={`${b[1] * 100}%`}
          stroke="#ec4899" strokeWidth={3} strokeDasharray="8 6"
          style={{ filter: 'drop-shadow(0 0 6px #ec4899)' }}
        />
      </svg>

      {/* Endpoint A — clickable area */}
      <div
        className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500 ring-2 ring-white shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center text-[10px] font-bold text-white"
        style={{ left: `${a[0] * 100}%`, top: `${a[1] * 100}%` }}
        onPointerDown={(e) => { e.preventDefault(); setDragging('a') }}
      >A</div>

      {/* Endpoint B */}
      <div
        className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500 ring-2 ring-white shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center text-[10px] font-bold text-white"
        style={{ left: `${b[0] * 100}%`, top: `${b[1] * 100}%` }}
        onPointerDown={(e) => { e.preventDefault(); setDragging('b') }}
      >B</div>

      {/* Painel de controles — canto inferior */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur rounded-lg border border-white/20 shadow-2xl p-3 min-w-[320px]">
        <div className="text-xs text-slate-300 mb-2">
          Arraste os pontos <span className="text-pink-400 font-bold">A</span> e <span className="text-pink-400 font-bold">B</span> sobre a linha de contagem.
        </div>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Rótulo (ex: Entrada, Caixa, Portão)"
          className="w-full px-2 py-1.5 rounded bg-slate-800 text-slate-100 text-xs border border-slate-700 focus:border-pink-500 focus:outline-none mb-2"
        />
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
