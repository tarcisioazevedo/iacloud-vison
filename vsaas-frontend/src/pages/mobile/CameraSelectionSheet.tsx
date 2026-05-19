import { useState, useMemo } from 'react'
import { Search, X, Camera, MapPin } from 'lucide-react'
import { CameraThumb } from '../../components/mobile/CameraThumb'
import { cn } from '../../lib/utils'

export function CameraSelectionSheet({
  cameras,
  onSelect,
  onClose
}: {
  cameras: any[]
  onSelect: (camId: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [selectedSite, setSelectedSite] = useState<string>('all')

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
      const matchSite = selectedSite === 'all' || siteLabel === selectedSite
      return matchSearch && matchSite
    })
  }, [cameras, search, selectedSite])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 dark:bg-slate-950 animate-in slide-in-from-bottom-full duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Selecionar Câmera</h2>
        <button onClick={onClose} className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 active:scale-95 transition-transform">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Search & Filters */}
      <div className="px-4 py-3 bg-white dark:bg-slate-900 shrink-0 border-b border-slate-200 dark:border-slate-800">
        <div className={cn("flex items-center gap-2.5 bg-slate-100 dark:bg-slate-800 rounded-2xl px-3.5 py-2.5", sites.length > 0 && "mb-3")}>
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar câmera..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none"
            autoFocus
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-slate-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {sites.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
            <button 
              onClick={() => setSelectedSite('all')}
              className={cn(
                'px-3 py-1.5 rounded-full text-[11px] font-bold transition-all shrink-0 border shadow-sm',
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
                  'px-3 py-1.5 rounded-full text-[11px] font-bold transition-all shrink-0 border shadow-sm',
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

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Camera className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-semibold">Nenhuma câmera encontrada</p>
          </div>
        ) : (
          filtered.map(cam => {
            const isOnline = cam.status === 'ACTIVE'
            return (
              <button
                key={cam.id}
                onClick={() => onSelect(cam.id)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-left active:scale-[0.98] transition-all"
              >
                <div className="w-16 h-12 rounded-xl shrink-0 relative overflow-hidden bg-black">
                  <CameraThumb cameraId={cam.id} isOnline={isOnline} className="w-full h-full object-cover" />
                  <span className={cn('absolute top-1 left-1 w-1.5 h-1.5 rounded-full z-10', isOnline ? 'bg-emerald-400' : 'bg-red-400')} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{cam.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-1 mt-0.5 font-medium">
                    {cam.site?.name ? (
                      <>
                        <MapPin className="w-3 h-3 shrink-0" />
                        {cam.site.clienteFinal?.name ? `${cam.site.clienteFinal.name} › ${cam.site.name}` : cam.site.name}
                      </>
                    ) : 'Sem site'}
                  </p>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
