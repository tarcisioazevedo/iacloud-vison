import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Bell, HardDrive, Activity, Play, ChevronRight, RefreshCw, MapPin, LayoutGrid, Grid2x2 } from 'lucide-react'
import { useCameras, useMe } from '../../api/client'
import { cn } from '../../lib/utils'
import { MobilePlayerSheet, CameraEntry } from './MobilePlayerSheet'
import { MobileMultiCamSheet }            from './MobileMultiCamSheet'
import { CameraThumb }     from '../../components/mobile/CameraThumb'
import { CameraThumbLive } from '../../components/mobile/CameraThumbLive'
import { useMobileGridLayout } from '../../hooks/useMobileGridLayout'

// Ícone SVG inline para cada modo de grade
function GridIcon({ cols, active }: { cols: 1|2|3|4; active: boolean }) {
  const c = active ? '#00D2FF' : '#475569'
  const g = cols === 1
    ? <rect x="3" y="3" width="18" height="18" rx="2" stroke={c} strokeWidth="1.5" fill="none"/>
    : cols === 2
    ? <><rect x="3" y="3" width="8" height="8" rx="1.5" fill={c} opacity=".8"/><rect x="13" y="3" width="8" height="8" rx="1.5" fill={c} opacity=".8"/><rect x="3" y="13" width="8" height="8" rx="1.5" fill={c} opacity=".8"/><rect x="13" y="13" width="8" height="8" rx="1.5" fill={c} opacity=".8"/></>
    : cols === 3
    ? <>{[0,7,14].map(cx=>[0,7,14].map(cy=><rect key={`${cx}${cy}`} x={3+cx} y={3+cy} width="5" height="5" rx="1" fill={c} opacity=".8"/>))}</>
    : <>{[0,5,10,15].map(cx=>[0,5,10,15].map(cy=><rect key={`${cx}${cy}`} x={3+cx} y={3+cy} width="4" height="4" rx="0.5" fill={c} opacity=".8"/>))}</>
  return <svg width="22" height="22" viewBox="0 0 24 24">{g}</svg>
}

export function MobileDashboard() {
  const { data: me } = useMe()
  const { data: camData, mutate } = useCameras()
  const navigate = useNavigate()
  const { mode, setMode } = useMobileGridLayout()
  const [playerState, setPlayerState] = useState<{
    cameras: CameraEntry[]; initialIndex: number
  } | null>(null)
  const [showMultiCam, setShowMultiCam] = useState(false)

  const cameras: any[] = camData?.cameras ?? []
  const online  = cameras.filter(c => c.status === 'ACTIVE').length
  const offline = cameras.filter(c => c.status === 'ERROR' || c.status === 'INACTIVE').length
  const total   = cameras.length

  const firstName = me?.name?.split(' ')[0] ?? 'você'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'

  // Quantas câmeras mostrar por modo
  const camCount = mode === 1 ? 1 : mode === 2 ? 4 : mode === 3 ? 9 : 16
  const visibleCams = cameras.slice(0, camCount)

  // Lista completa como CameraEntry[] para navegação por swipe
  const allEntries: CameraEntry[] = cameras.map((c: any) => ({
    id: c.id, name: c.name, site: c.site?.name,
  }))

  function openPlayer(cam: any) {
    const idx = cameras.findIndex((c: any) => c.id === cam.id)
    setPlayerState({ cameras: allEntries, initialIndex: Math.max(0, idx) })
  }

  // Classes do grid por modo
  const gridCols = mode === 1 ? 'grid-cols-1' : mode === 2 ? 'grid-cols-2' : mode === 3 ? 'grid-cols-3' : 'grid-cols-4'
  const aspectClass = mode === 3 ? 'aspect-square' : mode === 4 ? 'aspect-square' : 'aspect-video'
  // No 4×4 usa snapshot (não live) — 16 streams WebRTC simultâneos é inviável no mobile
  const ThumbComponent = mode === 4 ? 'snapshot' : 'live'

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden transition-colors duration-300">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{greeting},</p>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">{firstName}</h1>
        </div>
        <button onClick={() => mutate()}
          className="p-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 shadow-sm">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ── Conteúdo scrollável ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide min-h-0">

      {/* ── KPI Cards ──────────────────────────────────────────── */}
      <div className="px-4 grid grid-cols-3 gap-2 mb-4 mt-0">
        {[
          { label: 'Online',  value: online,  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-500/20' },
          { label: 'Offline', value: offline, color: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-500/10',     border: 'border-red-500/20'     },
          { label: 'Total',   value: total,   color: 'text-cyan-600 dark:text-cyan-400',    bg: 'bg-cyan-50 dark:bg-cyan-500/10',    border: 'border-cyan-500/20'    },
        ].map(({ label, value, color, bg, border }) => (
          <div key={label} className={cn('rounded-2xl border p-3 shadow-sm', bg, border)}>
            <p className={cn('text-2xl font-bold', color)}>{value}</p>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Câmeras ao vivo — header com toggle de grade ────────── */}
      <div className="px-4 mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">Câmeras ao vivo</p>
        <div className="flex items-center gap-1">
          {/* Grid toggle */}
          {([1,2,3,4] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn(
                'p-1.5 rounded-lg transition-all shadow-sm',
                mode === m ? 'bg-cyan-50 dark:bg-cyan-500/15 border border-cyan-500/30' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700',
              )}>
              <GridIcon cols={m} active={mode === m} />
            </button>
          ))}
          <button onClick={() => navigate('/mobile/cameras')}
            className="ml-1 flex items-center gap-0.5 text-xs font-bold text-cyan-600 dark:text-cyan-400 active:opacity-70 pl-1">
            Todas <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Camera Grid ────────────────────────────────────────── */}
      <div className={cn('px-4 grid gap-2 mb-4', gridCols)}>
        {cameras.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-10 text-slate-500 dark:text-slate-600">
            <Camera className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">Nenhuma câmera cadastrada</p>
          </div>
        )}
        {visibleCams.map(cam => (
          <button
            key={cam.id}
            onClick={() => openPlayer(cam)}
            className={cn(
              'relative rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm active:opacity-80',
              aspectClass,
            )}
          >
            {/* 4×4: snapshot (16 WebRTC simultâneos seria inviável); demais: live */}
            {ThumbComponent === 'live' ? (
              <CameraThumbLive cameraId={cam.id} isOnline={cam.status === 'ACTIVE'} className="absolute inset-0 w-full h-full" />
            ) : (
              <CameraThumb cameraId={cam.id} isOnline={cam.status === 'ACTIVE'} className="absolute inset-0 w-full h-full" />
            )}

            {/* Status dot */}
            <span className={cn(
              'absolute top-1.5 left-1.5 w-2 h-2 rounded-full z-10 shadow',
              cam.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-red-400',
            )} />

            {/* Play overlay */}
            {cam.status === 'ACTIVE' && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className={cn(
                  'rounded-full bg-black/50 flex items-center justify-center',
                  mode === 3 ? 'w-6 h-6' : 'w-8 h-8',
                )}>
                  <Play className={cn('text-white fill-white', mode === 3 ? 'w-3 h-3' : 'w-4 h-4')} />
                </div>
              </div>
            )}

            {/* Footer: nome + site */}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 z-10">
              <p className={cn(
                'text-white font-semibold truncate leading-tight',
                mode === 3 ? 'text-[8px]' : 'text-[10px]',
              )}>
                {cam.name}
              </p>
              {cam.site?.name && mode !== 3 && (
                <p className="flex items-center gap-0.5 text-[9px] text-slate-300/80 truncate leading-tight mt-0.5">
                  <MapPin className="w-2 h-2 shrink-0" />
                  {cam.site.name}
                </p>
              )}
            </div>
          </button>
        ))}

        {/* "Ver mais" card quando há câmeras além das visíveis */}
        {cameras.length > camCount && (
          <button
            onClick={() => navigate('/mobile/cameras')}
            className={cn(
              'relative rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-900/50',
              'flex flex-col items-center justify-center gap-1 active:bg-slate-200/50 dark:active:bg-slate-800/50',
              aspectClass,
            )}
          >
            <LayoutGrid className="w-5 h-5 text-slate-400 dark:text-slate-500" />
            <p className="text-[10px] text-slate-500 font-medium">
              +{cameras.length - camCount} mais
            </p>
          </button>
        )}
      </div>

      {/* ── Atalhos rápidos ────────────────────────────────────── */}
      <div className="px-4 mb-4">
        <p className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Acesso rápido</p>
        <div className="space-y-2">
          {[
            { icon: Camera,    label: 'Ver todas as câmeras', sub: `${total} câmeras cadastradas`,     path: '/mobile/cameras' },
            { icon: Bell,      label: 'Alertas e eventos',    sub: 'Movimentos e câmeras offline',     path: '/mobile/alerts' },
            { icon: HardDrive, label: 'Minhas assinaturas',   sub: 'Planos de armazenamento em nuvem', path: '/mobile/subscriptions' },
          ].map(({ icon: Icon, label, sub, path }) => (
            <button key={path} onClick={() => navigate(path)}
              className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 active:bg-slate-50 dark:active:bg-slate-800 shadow-sm transition-colors">
              <div className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-200 dark:border-transparent">
                <Icon className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white">{label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{sub}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-600 shrink-0" />
            </button>
          ))}

          {/* Multi-cam */}
          <button
            onClick={() => setShowMultiCam(true)}
            className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 active:bg-slate-50 dark:active:bg-slate-800 shadow-sm transition-colors"
          >
            <div className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-200 dark:border-transparent">
              <Grid2x2 className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-white">Multi-câmera</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Ver até 4 câmeras simultâneas</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-600 shrink-0" />
          </button>
        </div>
      </div>

      {/* ── Status geral ───────────────────────────────────────── */}
      <div className="px-4 mb-6">
        <div className={cn(
          'flex items-center gap-3 p-3.5 rounded-2xl border shadow-sm',
          offline > 0 ? 'bg-red-50 dark:bg-red-500/10 border-red-500/20' : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500/20',
        )}>
          <Activity className={cn('w-5 h-5 shrink-0', offline > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')} />
          <div>
            <p className={cn('text-sm font-bold', offline > 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300')}>
              {offline > 0 ? `${offline} câmera${offline > 1 ? 's' : ''} offline` : 'Todas as câmeras online'}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
              {offline > 0 ? 'Verifique a conexão dos dispositivos' : 'Sistema operando normalmente'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Fim do conteúdo scrollável ───────────────────────────── */}
      </div>

      {playerState && (
        <MobilePlayerSheet
          cameras={playerState.cameras}
          initialIndex={playerState.initialIndex}
          onClose={() => setPlayerState(null)}
        />
      )}

      {showMultiCam && (
        <MobileMultiCamSheet
          initialCameras={allEntries.slice(0, 4)}
          onClose={() => setShowMultiCam(false)}
        />
      )}
    </div>
  )
}
