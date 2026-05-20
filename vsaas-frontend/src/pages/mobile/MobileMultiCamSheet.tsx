/**
 * MobileMultiCamSheet — mosaico de câmeras ao vivo no mobile.
 *
 * Features:
 *  - Grade 1×1 / 2×2 com LivePlayer em cada slot
 *  - Tap em slot → expande em tela cheia (MobilePlayerSheet)
 *  - Tap longo / botão troca → abre seletor de câmera para aquele slot
 *  - Status indicator por câmera (🟢 live / 🔴 offline / ⏳ connecting)
 *  - Swipe down para fechar
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import { X, Grid2x2, Square, Camera, Loader2, Search } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { LivePlayer }                   from '../../components/player/LivePlayer'
import { MobilePlayerSheet, CameraEntry } from './MobilePlayerSheet'
import { useCameras }                   from '../../api/client'
import { cn }                           from '../../lib/utils'
import { haptic }                       from '../../lib/haptic'

interface Props {
  /** Câmeras a mostrar inicialmente (pode ser null para slot vazio) */
  initialCameras?: (CameraEntry | null)[]
  onClose: () => void
}

type SlotStatus = 'idle' | 'connecting' | 'live' | 'fallback' | 'error' | 'disabled'

function StaggeredLivePlayer({ cameraId, idx, onStatus }: { cameraId: string, idx: number, onStatus: (s: SlotStatus) => void }) {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setActive(true), idx * 400)
    return () => clearTimeout(t)
  }, [idx])

  if (!active) return <div className="absolute inset-0 bg-black flex items-center justify-center text-slate-600"><Loader2 className="w-5 h-5 animate-spin" /></div>

  return (
    <LivePlayer
      cameraId={cameraId}
      muted
      showOverlay={false}
      minimalError={true}
      fit="contain"
      className="absolute inset-0 w-full h-full !border-0 !rounded-none"
      onStatus={onStatus}
    />
  )
}

export function MobileMultiCamSheet({ initialCameras = [], onClose }: Props) {
  const { data } = useCameras()
  const allCameras: CameraEntry[] = (data?.cameras ?? []).map((c: any) => {
    const tenantName = c.site?.clienteFinal?.name
    const siteLabel = c.site?.name ? (tenantName ? `${tenantName} › ${c.site.name}` : c.site.name) : undefined
    return {
      id: c.id, name: c.name, site: siteLabel,
    }
  })

  // 4 slots (2×2), inicializa com as câmeras passadas
  const [slots, setSlots] = useState<(CameraEntry | null)[]>(() => {
    const base: (CameraEntry | null)[] = [null, null, null, null]
    initialCameras.slice(0, 4).forEach((c, i) => { base[i] = c })
    return base
  })

  const [grid, setGrid]           = useState<1 | 4>(4)   // 1 = tela cheia 1 cam, 4 = 2×2
  const [selectorSlot, setSelectorSlot] = useState<number | null>(null)  // seletor de câmera
  const [playerSheet, setPlayerSheet]   = useState<{ cameras: CameraEntry[]; idx: number } | null>(null)
  const [statuses, setStatuses]  = useState<Record<number, SlotStatus>>({})
  const [search, setSearch] = useState('')
  const [selectedSite, setSelectedSite] = useState<string>('all')

  const sites = useMemo(() => {
    const s = new Set<string>()
    allCameras.forEach(c => { if (c.site) s.add(c.site) })
    return Array.from(s).sort()
  }, [allCameras])

  const filteredCameras = useMemo(() => {
    return allCameras.filter(c => {
      const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
                          (c.site || '').toLowerCase().includes(search.toLowerCase())
      const matchSite = selectedSite === 'all' || c.site === selectedSite
      return matchSearch && matchSite
    })
  }, [allCameras, search, selectedSite])

  const handleStatus = useCallback((idx: number, s: SlotStatus) => {
    setStatuses(prev => ({ ...prev, [idx]: s }))
  }, [])

  function assignCamera(slotIdx: number, cam: CameraEntry | null) {
    setSlots(prev => {
      const next = [...prev]
      next[slotIdx] = cam
      return next
    })
    setSelectorSlot(null)
    haptic(cam ? 20 : 10)
  }

  function openFullscreen(idx: number) {
    const cam = slots[idx]
    if (!cam) return
    const list = slots.filter(Boolean) as CameraEntry[]
    const listIdx = list.findIndex(c => c.id === cam.id)
    setPlayerSheet({ cameras: list, idx: Math.max(0, listIdx) })
  }

  // Câmeras que já estão nos slots (para não duplicar no seletor)
  const usedIds = new Set(slots.filter(Boolean).map(c => c!.id))

  const activeSlots = slots.filter(Boolean).length

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/80"
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        drag="y"
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0, bottom: 0.3 }}
        onDragEnd={(_, info) => { if (info.offset.y > 80) onClose() }}
        className="fixed bottom-0 inset-x-0 z-50 bg-slate-50 dark:bg-slate-950 rounded-t-3xl overflow-hidden flex flex-col transition-colors duration-300"
        style={{ maxHeight: '96vh', height: '96vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-2.5 shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="px-4 pt-2 pb-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Grid2x2 className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
            <span className="text-sm font-bold text-slate-900 dark:text-white">Multi-câmera</span>
            <span className="text-xs text-slate-500">{activeSlots} ativas</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Grid toggle */}
            <button
              onClick={() => setGrid(g => g === 1 ? 4 : 1)}
              className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700"
              title={grid === 4 ? 'Ver câmera inteira' : 'Grade 2×2'}
            >
              {grid === 4 ? <Square className="w-4 h-4" /> : <Grid2x2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Grid de câmeras */}
        <div className={cn(
          'flex-1 p-2 gap-2',
          grid === 4 ? 'grid grid-cols-2' : 'flex',
        )}>
          {slots.slice(0, grid === 1 ? 1 : 4).map((cam, idx) => (
            <div
              key={idx}
              className={cn(
                'relative rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm',
                grid === 1 ? 'flex-1' : 'aspect-video',
              )}
            >
              {cam ? (
                <>
                  <StaggeredLivePlayer
                    cameraId={cam.id}
                    idx={idx}
                    onStatus={s => handleStatus(idx, s)}
                  />

                  {/* Status badge */}
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1 z-10">
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      statuses[idx] === 'live'       ? 'bg-emerald-400' :
                      statuses[idx] === 'fallback'   ? 'bg-amber-400' :
                      statuses[idx] === 'error'      ? 'bg-red-400' :
                      'bg-slate-500 animate-pulse',
                    )} />
                  </div>

                  {/* Camera name */}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 z-10">
                    <p className="text-[10px] font-semibold text-white truncate leading-tight">{cam.name}</p>
                    {cam.site && (
                      <p className="text-[8px] text-slate-400 truncate">{cam.site}</p>
                    )}
                  </div>

                  <div className="absolute top-1.5 right-1.5 flex gap-1 z-30">
                    <button onClick={() => assignCamera(idx, null)} className="p-3 -m-1.5 flex items-center justify-center rounded-xl bg-black/50 text-white/90 backdrop-blur-sm shadow-sm active:bg-red-500/80 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <button 
                    className="absolute inset-0 z-10 bg-transparent" 
                    onDoubleClick={() => openFullscreen(idx)} 
                    onClick={() => setSelectorSlot(idx)} 
                  /></>
              ) : (
                /* Slot vazio → botão para adicionar câmera */
                <button
                  onClick={() => setSelectorSlot(idx)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-600 active:text-slate-400"
                >
                  <Camera className="w-6 h-6" />
                  <span className="text-[10px]">Adicionar câmera</span>
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Câmeras disponíveis — barra horizontal quando não há seletor */}
        {selectorSlot === null && activeSlots < 4 && (
          <div className="px-3 pb-4 shrink-0">
            <p className="text-[10px] text-slate-500 mb-2">Adicionar câmera em slot vazio:</p>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {allCameras.filter(c => !usedIds.has(c.id)).map(cam => (
                <button
                  key={cam.id}
                  onClick={() => {
                    const emptyIdx = slots.findIndex(s => s === null)
                    if (emptyIdx >= 0) assignCamera(emptyIdx, cam)
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 font-medium shrink-0 active:bg-slate-100 dark:active:bg-slate-700"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  {cam.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.div>

      {/* Camera selector sheet */}
      <AnimatePresence>
        {selectorSlot !== null && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-60 bg-black/60"
              onClick={() => setSelectorSlot(null)}
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 inset-x-0 z-70 bg-slate-50 dark:bg-slate-950 rounded-t-3xl border-t border-slate-200 dark:border-slate-800"
              style={{ maxHeight: '60vh' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-center pt-2.5 pb-3">
                <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              </div>
              <div className="px-4 pb-2 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">Selecionar câmera</p>
                  <div className="flex items-center gap-2">
                    {slots[selectorSlot] && (
                      <button
                        onClick={() => assignCamera(selectorSlot, null)}
                        className="text-xs text-red-500 dark:text-red-400 active:text-red-400 dark:active:text-red-300"
                      >
                        Remover
                      </button>
                    )}
                    <button onClick={() => setSelectorSlot(null)}
                      className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Search & Site filter */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2">
                    <Search className="w-4 h-4 text-slate-400 shrink-0" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Buscar câmera..."
                      className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none"
                    />
                    {search && (
                      <button onClick={() => setSearch('')} className="text-slate-400">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {sites.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                      <button 
                        onClick={() => setSelectedSite('all')}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-[10px] font-bold transition-all shrink-0 border shadow-sm',
                          selectedSite === 'all'
                            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-500'
                            : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                        )}>
                        Todos os sites
                      </button>
                      {sites.map(s => (
                        <button 
                          key={s}
                          onClick={() => setSelectedSite(s)}
                          className={cn(
                            'px-3 py-1.5 rounded-full text-[10px] font-bold transition-all shrink-0 border shadow-sm',
                            selectedSite === s
                              ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-500'
                              : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                          )}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-y-auto pb-6 px-4 space-y-2 mt-1">
                {filteredCameras.map(cam => {
                  const inUse = usedIds.has(cam.id) && slots[selectorSlot]?.id !== cam.id
                  return (
                    <button
                      key={cam.id}
                      disabled={inUse}
                      onClick={() => assignCamera(selectorSlot, cam)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition',
                        inUse
                          ? 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/40 opacity-50'
                          : slots[selectorSlot]?.id === cam.id
                          ? 'border-cyan-500/50 bg-cyan-50 dark:bg-cyan-500/10'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 active:bg-slate-50 dark:active:bg-slate-800',
                      )}
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{cam.name}</p>
                        {cam.site && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{cam.site}</p>
                        )}
                      </div>
                      {inUse && <span className="text-[10px] text-slate-500">Em uso</span>}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Expand para fullscreen (MobilePlayerSheet) */}
      {playerSheet && (
        <MobilePlayerSheet
          cameras={playerSheet.cameras}
          initialIndex={playerSheet.idx}
          onClose={() => setPlayerSheet(null)}
        />
      )}
    </>
  )
}
