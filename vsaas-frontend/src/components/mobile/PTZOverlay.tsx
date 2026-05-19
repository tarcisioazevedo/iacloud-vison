/**
 * PTZOverlay — joystick virtual para controle PTZ no mobile.
 *
 * v2:
 *  - Presets carregados diretamente da API
 *  - Botão "Salvar preset" com nome customizável
 *  - Goto preset funcional via /ptz/presets/:id/goto
 *  - Swipe horizontal nos presets (scroll nativo)
 */
import { useRef, useCallback, useState, useEffect } from 'react'
import { X, ZoomIn, ZoomOut, Crosshair, Plus, Trash2, Loader2, Star } from 'lucide-react'
import {
  sendPtzCommand, PtzCommand,
  listPtzPresets, savePtzPreset, gotoPtzPreset, deletePtzPreset,
  PtzPreset,
} from '../../api/client'
import { cn } from '../../lib/utils'

interface Props {
  cameraId: string
  onClose:  () => void
}

const THROTTLE_MS = 150
const DEAD_ZONE   = 18   // px — zona morta no centro do joystick
const JOYSTICK_R  = 56   // px — raio do pad

function angleToCommand(dx: number, dy: number): PtzCommand {
  const angle = Math.atan2(dy, dx) * (180 / Math.PI)
  if (angle > -45  && angle <=  45)  return 'right'
  if (angle >  45  && angle <= 135)  return 'down'
  if (angle > 135  || angle <= -135) return 'left'
  return 'up'
}

function magnitude(dx: number, dy: number) {
  return Math.sqrt(dx*dx + dy*dy)
}

export function PTZOverlay({ cameraId, onClose }: Props) {
  const padRef       = useRef<HTMLDivElement>(null)
  const knobRef      = useRef<HTMLDivElement>(null)
  const activeCmd    = useRef<PtzCommand | null>(null)
  const lastSent     = useRef(0)
  const rafRef       = useRef<number>(0)
  const [knobPos, setKnobPos]       = useState({ x: 0, y: 0 })
  const [activeDir, setActiveDir]   = useState<PtzCommand | null>(null)
  const [zoomDir, setZoomDir]       = useState<'in' | 'out' | null>(null)
  const zoomIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Presets state
  const [presets, setPresets]           = useState<PtzPreset[]>([])
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [savingPreset, setSavingPreset] = useState(false)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')
  const [activePreset, setActivePreset] = useState<string | null>(null)

  // Load presets on mount
  useEffect(() => {
    setPresetsLoading(true)
    listPtzPresets(cameraId)
      .then(d => setPresets(d.presets))
      .catch(() => {})
      .finally(() => setPresetsLoading(false))
  }, [cameraId])

  // Continuous command loop using RAF
  const sendLoop = useCallback(() => {
    const now = Date.now()
    if (activeCmd.current && now - lastSent.current >= THROTTLE_MS) {
      lastSent.current = now
      sendPtzCommand(cameraId, activeCmd.current, 0.6).catch(() => {})
    }
    rafRef.current = requestAnimationFrame(sendLoop)
  }, [cameraId])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(sendLoop)
    return () => {
      cancelAnimationFrame(rafRef.current)
      sendPtzCommand(cameraId, 'stop', 0).catch(() => {})
    }
  }, [cameraId, sendLoop])

  const stopMovement = useCallback(() => {
    activeCmd.current = null
    setActiveDir(null)
    setKnobPos({ x: 0, y: 0 })
    sendPtzCommand(cameraId, 'stop', 0).catch(() => {})
  }, [cameraId])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons !== 1) return
    const pad = padRef.current
    if (!pad) return
    const rect  = pad.getBoundingClientRect()
    const cx    = rect.left + rect.width  / 2
    const cy    = rect.top  + rect.height / 2
    const dx    = e.clientX - cx
    const dy    = e.clientY - cy
    const dist  = magnitude(dx, dy)
    const clamp = Math.min(dist, JOYSTICK_R)
    const ratio = clamp / dist || 0
    setKnobPos({ x: dx * ratio, y: dy * ratio })

    if (dist > DEAD_ZONE) {
      const cmd = angleToCommand(dx, dy)
      activeCmd.current = cmd
      setActiveDir(cmd)
    } else {
      activeCmd.current = null
      setActiveDir(null)
    }
  }, [])

  // Zoom buttons
  function startZoom(dir: 'in' | 'out') {
    setZoomDir(dir)
    const cmd: PtzCommand = dir === 'in' ? 'zoomIn' : 'zoomOut'
    sendPtzCommand(cameraId, cmd, 0.5).catch(() => {})
    zoomIntervalRef.current = setInterval(() => {
      sendPtzCommand(cameraId, cmd, 0.5).catch(() => {})
    }, THROTTLE_MS)
  }
  function stopZoom() {
    setZoomDir(null)
    if (zoomIntervalRef.current) clearInterval(zoomIntervalRef.current)
    sendPtzCommand(cameraId, 'stop', 0).catch(() => {})
  }

  async function handleSavePreset() {
    const name = newPresetName.trim()
    if (!name) return
    setSavingPreset(true)
    try {
      const p = await savePtzPreset(cameraId, name)
      setPresets(prev => [...prev, p])
      setNewPresetName('')
      setShowSaveInput(false)
    } catch { /* ignore */ }
    finally { setSavingPreset(false) }
  }

  async function handleGotoPreset(p: PtzPreset) {
    setActivePreset(p.id)
    try {
      await gotoPtzPreset(cameraId, p.id)
    } catch { /* ignore */ }
    setTimeout(() => setActivePreset(null), 1500)
  }

  async function handleDeletePreset(p: PtzPreset, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await deletePtzPreset(cameraId, p.id)
      setPresets(prev => prev.filter(x => x.id !== p.id))
    } catch { /* ignore */ }
  }

  const dirLabel: Record<PtzCommand, string> = {
    up: '↑', down: '↓', left: '←', right: '→',
    zoomIn: '+', zoomOut: '−', stop: '●',
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col pointer-events-none">
      {/* Top bar */}
      <div className="pointer-events-auto flex items-center justify-between px-3 py-2 bg-white/80 dark:bg-black/60 backdrop-blur-sm border-b border-slate-200/50 dark:border-transparent">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-cyan-400">CONTROLE PTZ</span>
          {activeDir && (
            <span className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/30 text-xs text-cyan-300 font-mono">
              {dirLabel[activeDir]}
            </span>
          )}
        </div>
        <button onClick={onClose}
          className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 shadow-sm">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main controls area */}
      <div className="flex-1 flex items-end justify-between px-4 pb-4 pointer-events-auto">

        {/* ── Joystick ────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-3">
          <span className="text-[10px] text-slate-500">Direção</span>

          <div
            ref={padRef}
            className="relative w-32 h-32 rounded-full bg-slate-200/80 dark:bg-slate-900/80 border-2 border-slate-300 dark:border-slate-700 touch-none cursor-pointer select-none backdrop-blur-sm shadow-[inset_0_2px_8px_rgba(0,0,0,0.1)] dark:shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)]"
            onPointerDown={e => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              handlePointerMove(e)
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={stopMovement}
            onPointerCancel={stopMovement}
          >
            <div className="absolute inset-2 rounded-full border border-slate-300/50 dark:border-slate-700/50" />
            <div className="absolute inset-6 rounded-full border border-slate-300/40 dark:border-slate-700/40" />

            {(['up','down','left','right'] as const).map((dir) => {
              const pos: Record<string, string> = {
                up:    'top-2 left-1/2 -translate-x-1/2',
                down:  'bottom-2 left-1/2 -translate-x-1/2',
                left:  'left-2 top-1/2 -translate-y-1/2',
                right: 'right-2 top-1/2 -translate-y-1/2',
              }
              const arrows: Record<string, string> = { up:'↑', down:'↓', left:'←', right:'→' }
              return (
                <span key={dir} className={cn(
                  'absolute text-xs font-bold transition',
                  pos[dir],
                  activeDir === dir ? 'text-cyan-400' : 'text-slate-600',
                )}>
                  {arrows[dir]}
                </span>
              )
            })}

            <div
              ref={knobRef}
              className={cn(
                'absolute w-10 h-10 rounded-full top-1/2 left-1/2 transition-shadow',
                activeDir
                  ? 'bg-cyan-500 shadow-[0_0_12px_rgba(0,210,255,0.6)]'
                  : 'bg-white dark:bg-slate-600 shadow-sm dark:shadow-none',
              )}
              style={{
                transform: `translate(calc(-50% + ${knobPos.x}px), calc(-50% + ${knobPos.y}px))`,
                transition: activeDir ? 'none' : 'transform 0.15s ease, background-color 0.15s',
              }}
            />
          </div>

          <span className="text-[10px] text-slate-600">Arraste para mover</span>
        </div>

        {/* ── Right column: Zoom ───────────────────────────────────── */}
        <div className="flex flex-col items-center gap-3">
          <span className="text-[10px] text-slate-500">Zoom</span>

          <button
            className={cn(
              'w-12 h-12 rounded-2xl border flex items-center justify-center active:scale-95 transition-all shadow-sm',
              zoomDir === 'in'
                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-500 dark:text-cyan-400'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
            )}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startZoom('in') }}
            onPointerUp={stopZoom} onPointerCancel={stopZoom}
          >
            <ZoomIn className="w-5 h-5" />
          </button>

          <div className="w-1.5 h-16 rounded-full bg-slate-300 dark:bg-slate-800 relative overflow-hidden shadow-inner">
            <div className={cn(
              'absolute bottom-0 w-full rounded-full transition-all duration-300',
              zoomDir === 'in' ? 'h-full bg-cyan-500' :
              zoomDir === 'out' ? 'h-1/4 bg-cyan-500' : 'h-1/2 bg-slate-400 dark:bg-slate-600',
            )} />
          </div>

          <button
            className={cn(
              'w-12 h-12 rounded-2xl border flex items-center justify-center active:scale-95 transition-all shadow-sm',
              zoomDir === 'out'
                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-500 dark:text-cyan-400'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
            )}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startZoom('out') }}
            onPointerUp={stopZoom} onPointerCancel={stopZoom}
          >
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Presets bar ───────────────────────────────────────────── */}
      <div className="pointer-events-auto px-3 pb-3 space-y-2">
        {/* Save input */}
        {showSaveInput ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') setShowSaveInput(false) }}
              placeholder="Nome do preset..."
              className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 outline-none focus:border-cyan-500 shadow-sm"
            />
            <button
              onClick={handleSavePreset}
              disabled={savingPreset || !newPresetName.trim()}
              className="px-3 py-1.5 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold disabled:opacity-50 flex items-center gap-1"
            >
              {savingPreset ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
              Salvar
            </button>
            <button onClick={() => setShowSaveInput(false)}
              className="p-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shadow-sm">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {/* Botão salvar preset */}
            <button
              onClick={() => setShowSaveInput(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 font-medium shrink-0 active:bg-slate-100 dark:active:bg-slate-700 shadow-sm"
            >
              <Plus className="w-3 h-3" />
              Preset
            </button>

            {presetsLoading && <Loader2 className="w-3 h-3 animate-spin text-slate-500 shrink-0" />}

            {presets.map(p => (
              <div key={p.id} className="relative group shrink-0">
                <button
                  onClick={() => handleGotoPreset(p)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all shadow-sm',
                    activePreset === p.id
                      ? 'bg-cyan-500/20 border-cyan-500 text-cyan-600 dark:text-cyan-300'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-slate-700',
                  )}
                >
                  {activePreset === p.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Star className="w-3 h-3 text-amber-400" />
                  }
                  {p.name}
                </button>
                {/* Delete — long-press or visible X */}
                <button
                  onClick={e => handleDeletePreset(p, e)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  style={{ fontSize: '8px' }}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
