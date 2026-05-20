import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, RefreshCw, Camera, MapPin, Star, Plus, X } from 'lucide-react'
import { useCameras } from '../../api/client'
import { cn } from '../../lib/utils'
import { MobilePlayerSheet, CameraEntry } from './MobilePlayerSheet'
import { CameraSelectionSheet } from './CameraSelectionSheet'
import { CameraThumb }     from '../../components/mobile/CameraThumb'
import { CameraThumbLive } from '../../components/mobile/CameraThumbLive'
import { useMobileGridLayout } from '../../hooks/useMobileGridLayout'
import { useFavoriteCameras } from '../../hooks/useFavoriteCameras'
import { haptic } from '../../lib/haptic'
import { motion, AnimatePresence } from 'framer-motion'

function GridIcon({ cols, active }: { cols: 1|2|3|4; active: boolean }) {
  const c = active ? '#00D2FF' : '#475569'
  if (cols === 1) return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="4" rx="1.5" fill={c} opacity=".8"/>
      <rect x="3" y="11" width="18" height="4" rx="1.5" fill={c} opacity=".8"/>
      <rect x="3" y="17" width="18" height="4" rx="1.5" fill={c} opacity=".8"/>
    </svg>
  )
  if (cols === 2) return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect x="3" y="3" width="8" height="8" rx="1.5" fill={c} opacity=".8"/>
      <rect x="13" y="3" width="8" height="8" rx="1.5" fill={c} opacity=".8"/>
      <rect x="3" y="13" width="8" height="8" rx="1.5" fill={c} opacity=".8"/>
      <rect x="13" y="13" width="8" height="8" rx="1.5" fill={c} opacity=".8"/>
    </svg>
  )
  if (cols === 3) return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      {[0,7,14].flatMap(cx => [0,7,14].map(cy => (
        <rect key={cx+''+cy} x={3+cx} y={3+cy} width="5" height="5" rx="1" fill={c} opacity=".8"/>
      )))}
    </svg>
  )
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      {[0,5,10,15].flatMap(cx => [0,5,10,15].map(cy => (
        <rect key={cx+''+cy} x={3+cx} y={3+cy} width="4" height="4" rx="0.5" fill={c} opacity=".8"/>
      )))}
    </svg>
  )
}

export function MobileCamerasPage() {
  const { data, isLoading, mutate } = useCameras()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState<'all' | 'online' | 'offline' | 'favs'>('all')
  const { mode, setMode }     = useMobileGridLayout()
  const { isFav, toggle: toggleFav } = useFavoriteCameras()
  
  const [playerState, setPlayerState] = useState<{
    cameras: CameraEntry[]; initialIndex: number
  } | null>(null)
  
  const [selectedSite, setSelectedSite] = useState<string>('all')
  const [page, setPage] = useState(0)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // Load user for integrator info
  const userStr = localStorage.getItem('icv-user')
  const user = userStr ? JSON.parse(userStr) : null
  const integratorName = user?.integrator?.name || user?.name || 'Sistema VSaaS'
  const userId = user?.id || 'guest'

  // Custom grid configuration: key is `${mode}-${site}-${page}-${slotIndex}`
  // Value is cameraId. 
  // Carregado do localStorage para persistir o dashboard VMS do usuário.
  const [gridConfig, setGridConfig] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(`vsaas-mobile-grid-${userId}`)
      if (saved) return JSON.parse(saved)
      
      // Fallback para migrar a chave antiga genérica se existir
      const old = localStorage.getItem('vsaas-mobile-grid')
      if (old) {
        localStorage.setItem(`vsaas-mobile-grid-${userId}`, old)
        return JSON.parse(old)
      }
      return {}
    } catch { return {} }
  })

  useEffect(() => {
    localStorage.setItem(`vsaas-mobile-grid-${userId}`, JSON.stringify(gridConfig))
  }, [gridConfig, userId])

  // Selecting a camera for a specific slot
  const [selectingSlotKey, setSelectingSlotKey] = useState<string | null>(null)

  const cameras: any[] = data?.cameras ?? []

  const sites = useMemo(() => {
    const s = new Set<string>()
    cameras.forEach(c => { 
      if (c.site?.name) {
        const tenantName = c.site.clienteFinal?.name
        s.add(tenantName ? `${tenantName} › ${c.site.name}` : c.site.name)
      } 
    })
    return Array.from(s).sort()
  }, [cameras])

  const filtered = useMemo(() => {
    return cameras.filter(c => {
      const tenantName = c.site?.clienteFinal?.name
      const siteLabel = c.site?.name ? (tenantName ? `${tenantName} › ${c.site.name}` : c.site.name) : ''

      const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
        siteLabel.toLowerCase().includes(search.toLowerCase())
      const matchFilter =
        filter === 'all'     ? true :
        filter === 'online'  ? c.status === 'ACTIVE' :
        filter === 'offline' ? c.status !== 'ACTIVE' :
        /* favs */             isFav(c.id)
      const matchSite = selectedSite === 'all' || siteLabel === selectedSite
      return matchSearch && matchFilter && matchSite
    })
  }, [cameras, search, filter, selectedSite, isFav])

  const onlineCount = filtered.filter(c => c.status === 'ACTIVE').length
  const offlineCount = filtered.length - onlineCount

  // Deep link
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || !data?.cameras?.length) return
    const cam = (data.cameras as any[]).find((c: any) => c.id === openId)
    if (cam) {
      const allEntries: CameraEntry[] = (data.cameras as any[]).map((c: any) => ({
        id: c.id, name: c.name, site: c.site?.name,
      }))
      const idx = allEntries.findIndex(c => c.id === openId)
      setPlayerState({ cameras: allEntries, initialIndex: Math.max(0, idx) })
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, data])

  function openPlayer(cam: any, contextCameras: any[]) {
    const filteredEntries = contextCameras.map((c: any) => ({
      id: c.id, name: c.name, site: c.site?.name,
    }))
    const idx = contextCameras.findIndex((c: any) => c.id === cam.id)
    setPlayerState({ cameras: filteredEntries, initialIndex: Math.max(0, idx) })
  }

  const isGrid   = mode === 2 || mode === 3 || mode === 4
  const itemsPerPage = mode === 2 ? 4 : mode === 3 ? 9 : mode === 4 ? 16 : filtered.length

  // Encontrar a página máxima configurada pelo usuário para o modo/site atual
  let maxConfiguredPage = 0
  if (isGrid) {
    for (const key of Object.keys(gridConfig)) {
      if (gridConfig[key] && gridConfig[key] !== 'empty' && key.startsWith(`${mode}-${selectedSite}-`)) {
        const parts = key.split('-')
        const pIdx = parseInt(parts[2], 10)
        if (!isNaN(pIdx) && pIdx > maxConfiguredPage) maxConfiguredPage = pIdx
      }
    }
  }

  // Base pages calculation + always allow 1 empty page at the end
  const basePages = isGrid ? Math.max(1, Math.ceil(filtered.length / itemsPerPage)) : 1
  const totalPages = isGrid ? Math.max(basePages, maxConfiguredPage + 2) : 1

  // Handle scroll snap to update current page indicator
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const container = e.currentTarget
    const scrollLeft = container.scrollLeft
    const width = container.clientWidth
    if (width > 0) {
      const newPage = Math.round(scrollLeft / width)
      if (newPage !== page) setPage(newPage)
    }
  }

  // Reset scroll when mode/filter changes
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTo({ left: 0, behavior: 'instant' })
    setPage(0)
  }, [mode, filter, selectedSite])

  const gridCols = mode === 2 ? 'grid-cols-2 grid-rows-2' : mode === 3 ? 'grid-cols-3 grid-rows-3' : 'grid-cols-4 grid-rows-4'

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors duration-300">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 flex flex-col shrink-0">
        
        {/* Integrator & Site Selector */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider truncate mr-2">{integratorName}</p>
          {sites.length > 0 && (
            <select
              value={selectedSite}
              onChange={e => setSelectedSite(e.target.value)}
              className="text-[11px] bg-transparent text-cyan-600 dark:text-cyan-400 font-bold outline-none cursor-pointer text-right max-w-[150px] truncate"
            >
              <option value="all">Todos os Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight flex items-baseline gap-2">
              Câmeras
              <span className="text-[10px] font-semibold text-slate-500">
                (<span className="text-emerald-500">{onlineCount}</span> / <span className="text-red-500">{offlineCount}</span>)
              </span>
            </h1>
          </div>
          
          <div className="flex items-center gap-1">
            {([1,2,3,4] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={cn(
                  'p-1.5 rounded-lg transition shadow-sm',
                  mode === m ? 'bg-cyan-500/15 border border-cyan-500/30' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50',
                )}>
                <GridIcon cols={m} active={mode === m} />
              </button>
            ))}
            <button onClick={() => mutate()}
              className="ml-1 p-2 rounded-xl bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-700 border border-slate-200 dark:border-slate-700/50 shadow-sm">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Search & Filters ── */}
      {!isGrid && (
        <div className="px-4 mb-3 shrink-0">
          <div className="flex items-center gap-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-3.5 py-2.5 shadow-sm">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar câmera..."
              className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-slate-400 dark:text-slate-500 active:text-slate-600 dark:active:text-white">
                ×
              </button>
            )}
          </div>
        </div>
      )}
          
      {/* Pílulas de filtro permanentemente visíveis */}
      <div className={cn("px-4 mb-3 flex gap-2 shrink-0 overflow-x-auto scrollbar-hide", isGrid && "pt-1")}>
        {([
          { key: 'all',     label: 'Todas'      },
          { key: 'online',  label: 'Online'     },
          { key: 'offline', label: 'Offline'    },
          { key: 'favs',    label: '★ Favs' },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={cn(
              'px-3 py-1.5 rounded-full text-[11px] font-bold transition-all shrink-0 border shadow-sm',
              filter === key
                ? key === 'favs' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-500'
                : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700',
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className={cn(
        'flex-1 min-h-0', // min-h-0 allows flex child to shrink properly
        !isGrid ? 'px-4 pb-4 overflow-y-auto space-y-2' : ''
      )}>
        {isLoading ? (
          <div className={cn(isGrid ? `grid ${gridCols} gap-0.5 h-full pb-2` : 'space-y-2')}>
            {Array.from({ length: isGrid ? itemsPerPage : 5 }).map((_, i) => (
              <div key={i} className={cn(
                'bg-white dark:bg-slate-900 border border-slate-200 dark:border-transparent animate-pulse',
                isGrid ? 'w-full h-full rounded-none' : 'h-20 rounded-xl',
              )} />
            ))}
          </div>
        ) : filtered.length === 0 && !isGrid ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 flex-1">
            <Camera className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-semibold">Nenhuma câmera</p>
          </div>

        ) : isGrid ? (
          /* ── GRID VIEW (SWIPE CAROUSEL) ─────────────────────────── */
          <div className="flex flex-col h-full">
            <div 
              ref={scrollerRef}
              onScroll={handleScroll}
              className="flex-1 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
            >
              {Array.from({ length: totalPages }).map((_, pageIdx) => {
                // Determine slots for this page
                const contextCameras = filtered.slice(pageIdx * itemsPerPage, (pageIdx + 1) * itemsPerPage)
                
                return (
                  <div key={pageIdx} className="w-full h-full shrink-0 snap-center pb-2">
                    <div className={cn(`grid ${gridCols} gap-0.5 h-full w-full`)}>
                      {Array.from({ length: itemsPerPage }).map((_, slotIdx) => {
                        const slotKey = `${mode}-${selectedSite}-${pageIdx}-${slotIdx}`
                        const customCamId = gridConfig[slotKey]
                        
                        // Pick camera: user custom assigned, OR fallback to auto-fill
                        const cam = customCamId === 'empty' ? null : (customCamId 
                          ? cameras.find(c => c.id === customCamId) 
                          : contextCameras[slotIdx])
                        
                        if (cam) {
                          const isOnline = cam.status === 'ACTIVE'
                          return (
                            <div key={slotKey} className="relative w-full h-full group bg-black rounded-none overflow-hidden border border-slate-200 dark:border-slate-800/60 shadow-sm">
                              <button
                                onClick={() => openPlayer(cam, contextCameras)}
                                className="absolute inset-0 w-full h-full active:opacity-80 transition-opacity"
                              >
                                {mode !== 4
                                  ? <CameraThumbLive cameraId={cam.id} isOnline={isOnline} className="absolute inset-0 w-full h-full object-contain" />
                                  : <CameraThumb     cameraId={cam.id} isOnline={isOnline} className="absolute inset-0 w-full h-full object-contain" />
                                }
                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 z-10 pointer-events-none">
                                  <div className="flex items-center gap-1">
                                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', isOnline ? 'bg-emerald-400' : 'bg-red-400')} />
                                    <p className={cn('text-white font-semibold truncate', mode === 3 ? 'text-[8px]' : mode === 4 ? 'text-[6px]' : 'text-[10px]')}>
                                      {cam.name}
                                    </p>
                                  </div>
                                </div>
                              </button>
                              
                              {/* Remove slot button */}
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation()
                                  setGridConfig(prev => ({ ...prev, [slotKey]: 'empty' }))
                                }}
                                className="absolute top-1 right-1 p-3 -m-1.5 rounded-xl bg-black/50 backdrop-blur-sm text-white/90 z-30 shadow-sm active:bg-red-500/80 transition-colors flex items-center justify-center"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          )
                        }

                        // Empty slot
                        return (
                          <button 
                            key={slotKey} 
                            onClick={() => setSelectingSlotKey(slotKey)}
                            className="w-full h-full rounded-none bg-slate-200/50 dark:bg-slate-800/30 border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-500 active:bg-slate-200 dark:active:bg-slate-800/50 transition-colors"
                          >
                            <Plus className={cn("shrink-0", mode === 4 ? 'w-4 h-4' : 'w-6 h-6')} />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center pb-2 pt-1">
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: totalPages }).map((_, i) => (
                    <div key={i} className={cn(
                      'h-1.5 rounded-full transition-all shrink-0',
                      i === page ? 'w-4 bg-cyan-500' : 'w-1.5 bg-slate-300 dark:bg-slate-700'
                    )} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── LIST VIEW ──────────────────────────────────────── */
          <AnimatePresence mode="popLayout">
            {filtered.map((cam, idx) => {
              const isOnline = cam.status === 'ACTIVE'
              return (
                <motion.button
                  layout
                  initial={{ opacity: 0, y: 15, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2, delay: Math.min(idx * 0.04, 0.4) }}
                  key={cam.id}
                  onClick={() => openPlayer(cam, filtered)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all',
                    isOnline
                      ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800/50 opacity-70 grayscale-[20%]',
                  )}
                >
                  <div className="w-16 h-12 rounded-xl shrink-0 relative overflow-hidden bg-black">
                    <CameraThumb cameraId={cam.id} isOnline={isOnline} className="w-full h-full object-cover" />
                    <span className={cn('absolute top-1 left-1 w-1.5 h-1.5 rounded-full z-10', isOnline ? 'bg-emerald-400' : 'bg-red-400')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{cam.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 flex items-center gap-1 font-medium">
                      {cam.site?.name ? (
                        <>
                          <MapPin className="w-3 h-3 shrink-0" />
                          {cam.site.clienteFinal?.name ? `${cam.site.clienteFinal.name} › ${cam.site.name}` : cam.site.name}
                        </>
                      ) : 'Sem site'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <button onClick={e => { e.stopPropagation(); haptic(40); toggleFav(cam.id) }} className="p-1">
                        <Star className={cn('w-3.5 h-3.5', isFav(cam.id) ? 'text-amber-400 fill-amber-400' : 'text-slate-600')} />
                      </button>
                    </div>
                  </div>
                </motion.button>
              )
            })}
          </AnimatePresence>
        )}
      </div>

      {playerState && (
        <MobilePlayerSheet
          cameras={playerState.cameras}
          initialIndex={playerState.initialIndex}
          onClose={() => setPlayerState(null)}
        />
      )}

      {selectingSlotKey && (
        <CameraSelectionSheet
          cameras={cameras} // All cameras for selection
          onClose={() => setSelectingSlotKey(null)}
          onSelect={(camId) => {
            setGridConfig(prev => ({ ...prev, [selectingSlotKey]: camId }))
            setSelectingSlotKey(null)
          }}
        />
      )}
    </div>
  )
}
