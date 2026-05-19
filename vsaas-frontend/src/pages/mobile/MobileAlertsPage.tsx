/**
 * MobileAlertsPage — M4 v2
 *
 * - Filtros: Todos / Movimento / Offline / IA / Online
 * - Tap → abre player + marca como lido (acknowledgeReview)
 * - Botão "Marcar todos" → bulkAckReview
 * - SSE real-time: EventSource em /notifications/stream
 * - Pull-to-refresh (gesto)
 * - App badge count via navigator.setAppBadge
 * - Haptic feedback ao marcar
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Bell, Activity, WifiOff, AlertTriangle,
  Cpu, Car, User, RefreshCw, ChevronRight, Play, CheckCheck, Wifi,
} from 'lucide-react'
import { useReviewItems, acknowledgeReview, bulkAckReview } from '../../api/client'
import { cn } from '../../lib/utils'
import { MobilePlayerSheet, CameraEntry } from './MobilePlayerSheet'
import { useMobileSSE }      from '../../hooks/useMobileSSE'
import { usePullToRefresh }  from '../../hooks/usePullToRefresh'
import { haptic }            from '../../lib/haptic'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Event metadata ────────────────────────────────────────────────────────────
const EVENT_META: Record<string, {
  label:    string
  Icon:     React.FC<{ className?: string }>
  color:    string
  bg:       string
  border:   string
  bar:      string
  pill:     string
  pillText: string
}> = {
  MOTION: {
    label: 'Movimento detectado', Icon: Activity,
    color: 'text-amber-400',   bg: 'bg-amber-500/5',    border: 'border-amber-500/20',
    bar: 'bg-amber-500',       pill: 'bg-amber-500',    pillText: 'text-slate-950',
  },
  CAMERA_OFFLINE: {
    label: 'Câmera offline',    Icon: WifiOff,
    color: 'text-red-400',     bg: 'bg-red-500/5',      border: 'border-red-500/20',
    bar: 'bg-red-500',         pill: 'bg-red-500',      pillText: 'text-white',
  },
  CAMERA_ONLINE: {
    label: 'Câmera reconectada', Icon: Wifi,
    color: 'text-emerald-400', bg: 'bg-emerald-500/5',  border: 'border-emerald-500/20',
    bar: 'bg-emerald-500',     pill: 'bg-emerald-500',  pillText: 'text-slate-950',
  },
  INTRUSION: {
    label: 'Intrusão detectada', Icon: AlertTriangle,
    color: 'text-red-400',     bg: 'bg-red-500/5',      border: 'border-red-500/20',
    bar: 'bg-red-500',         pill: 'bg-red-500',      pillText: 'text-white',
  },
  FACE_DETECTED: {
    label: 'Rosto detectado',   Icon: User,
    color: 'text-violet-400',  bg: 'bg-violet-500/5',   border: 'border-violet-500/20',
    bar: 'bg-violet-500',      pill: 'bg-violet-500',   pillText: 'text-white',
  },
  PLATE_DETECTED: {
    label: 'Placa detectada',   Icon: Car,
    color: 'text-cyan-400',    bg: 'bg-cyan-500/5',     border: 'border-cyan-500/20',
    bar: 'bg-cyan-500',        pill: 'bg-cyan-500',     pillText: 'text-slate-950',
  },
  PERSON_DETECTED: {
    label: 'Pessoa detectada',  Icon: User,
    color: 'text-violet-400',  bg: 'bg-violet-500/5',   border: 'border-violet-500/20',
    bar: 'bg-violet-500',      pill: 'bg-violet-500',   pillText: 'text-white',
  },
  VEHICLE_DETECTED: {
    label: 'Veículo detectado', Icon: Car,
    color: 'text-cyan-400',    bg: 'bg-cyan-500/5',     border: 'border-cyan-500/20',
    bar: 'bg-cyan-500',        pill: 'bg-cyan-500',     pillText: 'text-slate-950',
  },
}

const DEFAULT_META = {
  label: 'Evento',    Icon: Bell,
  color: 'text-slate-400', bg: 'bg-slate-800/50', border: 'border-slate-700',
  bar: 'bg-slate-600',    pill: 'bg-slate-600',   pillText: 'text-white',
}

// ── Filter categories ─────────────────────────────────────────────────────────
const FILTERS = [
  { key: 'all',       label: 'Todos',     types: null },
  { key: 'motion',    label: 'Movimento', types: ['MOTION'] },
  { key: 'offline',   label: 'Offline',   types: ['CAMERA_OFFLINE'] },
  { key: 'ia',        label: 'IA',        types: ['FACE_DETECTED','PLATE_DETECTED','PERSON_DETECTED','VEHICLE_DETECTED','INTRUSION'] },
  { key: 'online',    label: 'Online',    types: ['CAMERA_ONLINE'] },
] as const

type FilterKey = typeof FILTERS[number]['key']

// ── App badge ─────────────────────────────────────────────────────────────────
function updateBadge(count: number) {
  try {
    if ('setAppBadge' in navigator) {
      if (count > 0) (navigator as any).setAppBadge(count)
      else           (navigator as any).clearAppBadge()
    }
  } catch { /* ignore */ }
}

// ── Component ─────────────────────────────────────────────────────────────────
export function MobileAlertsPage() {
  const { data, isLoading, mutate } = useReviewItems({ limit: '60' })
  const [filter, setFilter]   = useState<FilterKey>('all')
  const [playerState, setPlayerState] = useState<{
    cameras: CameraEntry[]; timestamp?: string
  } | null>(null)
  // Optimistic reviewed IDs (set ao abrir item, antes do server confirmar)
  const [localReviewed, setLocalReviewed] = useState<Set<string>>(new Set())
  const [bulking, setBulking] = useState(false)
  // Toast de novo alerta via SSE
  const [sseToast, setSseToast] = useState<string | null>(null)

  const items: any[] = data?.items ?? data?.events ?? []

  // Unreviewd count (server + optimistic)
  const unreviewedCount = items.filter(i =>
    !i.reviewedAt && !i.reviewed && !localReviewed.has(i.id)
  ).length

  // Sync badge
  useEffect(() => { updateBadge(unreviewedCount) }, [unreviewedCount])

  // SSE real-time
  useMobileSSE(useCallback((alert) => {
    // Recarrega a lista
    mutate()
    // Toast temporário
    const msg = alert.cameraName ? `${alert.title} — ${alert.cameraName}` : alert.title
    setSseToast(msg)
    setTimeout(() => setSseToast(null), 4000)
    haptic([50, 30, 50])
  }, [mutate]))

  // Pull-to-refresh
  const { pullProgress, isRefreshing, containerProps } = usePullToRefresh({
    onRefresh: async () => { await mutate() },
  })

  const activeFilter = FILTERS.find(f => f.key === filter)!
  const filterTypes  = activeFilter.types as readonly string[] | null
  const filtered = filterTypes === null
    ? items
    : items.filter(i => filterTypes.includes(i.eventType ?? i.type ?? ''))

  async function openPlayer(item: any) {
    const cameraId   = item.cameraId   ?? item.camera?.id
    const cameraName = item.cameraName ?? item.camera?.name ?? 'Câmera'
    const cameraSite = item.siteName   ?? item.camera?.site?.name
    const timestamp  = item.detectedAt ?? item.occurredAt ?? item.createdAt

    if (!cameraId) return

    haptic(40)
    setPlayerState({
      cameras: [{ id: cameraId, name: cameraName, site: cameraSite }],
      timestamp,
    })

    // Marcar como lido (otimístico + server)
    if (item.id && !item.reviewedAt && !item.reviewed && !localReviewed.has(item.id)) {
      setLocalReviewed(prev => new Set([...prev, item.id]))
      acknowledgeReview(item.id).catch(() => {})
    }
  }

  async function markAllRead() {
    const unread = items
      .filter(i => !i.reviewedAt && !i.reviewed && !localReviewed.has(i.id))
      .map(i => i.id)
      .filter(Boolean)
    if (!unread.length) return
    haptic([40, 20, 40])
    setBulking(true)
    setLocalReviewed(prev => new Set([...prev, ...unread]))
    try {
      await bulkAckReview(unread)
      await mutate()
    } catch {
      // Reverte o otimístico em caso de erro
      setLocalReviewed(prev => {
        const next = new Set(prev)
        unread.forEach(id => next.delete(id))
        return next
      })
    } finally {
      setBulking(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 relative transition-colors duration-300">

      {/* ── SSE Toast ──────────────────────────────────────────────────────── */}
      {sseToast && (
        <div className="absolute top-0 inset-x-0 z-30 mx-3 mt-2 px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl flex items-center gap-2 animate-in slide-in-from-top-2 duration-200">
          <Bell className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400 shrink-0" />
          <p className="text-xs text-slate-900 dark:text-white truncate font-medium">{sseToast}</p>
        </div>
      )}

      {/* ── Pull indicator ─────────────────────────────────────────────────── */}
      {(pullProgress > 0 || isRefreshing) && (
        <div className="flex justify-center py-2 shrink-0">
          <div className={cn(
            'w-6 h-6 rounded-full border-2 border-cyan-500 flex items-center justify-center transition-transform',
            isRefreshing ? 'animate-spin border-t-transparent' : '',
          )} style={{ transform: `scale(${Math.min(1, pullProgress)})` }}>
            {!isRefreshing && <RefreshCw className="w-3 h-3 text-cyan-400" style={{ transform: `rotate(${pullProgress * 360}deg)` }} />}
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">Alertas de IA & Eventos</h1>
          {unreviewedCount > 0 && (
            <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold shadow-sm">
              {unreviewedCount > 99 ? '99+' : unreviewedCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {unreviewedCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={bulking}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-medium active:bg-slate-300 dark:active:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Marcar lidos
            </button>
          )}
          <button
            onClick={() => mutate()}
            className="p-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-300 dark:active:bg-slate-700 transition-colors"
          >
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── Filter pills ─────────────────────────────────────────────────── */}
      <div className="px-4 pb-3 flex gap-2 overflow-x-auto scrollbar-hide shrink-0">
        {FILTERS.map(({ key, label }) => {
          const isActive = filter === key
          const fTypes   = (FILTERS.find(f => f.key === key)?.types ?? null) as readonly string[] | null
          const count    = fTypes === null
            ? items.length
            : items.filter(i => fTypes.includes(i.eventType ?? i.type ?? '')).length

          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0',
                isActive 
                  ? 'bg-cyan-500 text-white dark:text-slate-950 shadow-md shadow-cyan-500/20' 
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-700 border border-slate-200 dark:border-slate-700',
              )}
            >
              {label}
              {count > 0 && (
                <span className={cn(
                  'min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full text-[9px] font-bold',
                  isActive ? 'bg-black/20 text-white dark:bg-slate-950/30 dark:text-slate-950' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── List (pull-to-refresh container) ─────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto px-4 pb-4 space-y-2"
        {...containerProps}
      >
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[76px] rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-transparent animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
            <Cpu className="w-10 h-10 mb-3 opacity-25" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Nenhum alerta detectado</p>
            <p className="text-xs mt-1 text-slate-500 dark:text-slate-600">
              {filter === 'all' ? 'A inteligência artificial não detectou eventos' : 'Nenhum evento nesta categoria'}
            </p>
          </div>
        ) : filtered.map((item, idx) => {
          const type       = item.eventType ?? item.type ?? 'MOTION'
          const meta       = EVENT_META[type] ?? DEFAULT_META
          const Icon       = meta.Icon
          const reviewed   = !!(item.reviewedAt ?? item.reviewed) || localReviewed.has(item.id)
          const ts         = item.detectedAt ?? item.occurredAt ?? item.createdAt
          const timeAgo    = ts ? formatDistanceToNow(new Date(ts), { locale: ptBR, addSuffix: true }) : '—'
          const hasThumb   = !!(item.thumbUrl ?? item.frameUrl ?? item.snapshotUrl)
          const thumbUrl   = item.thumbUrl ?? item.frameUrl ?? item.snapshotUrl
          const cameraName = item.cameraName ?? item.camera?.name ?? 'Câmera'
          const siteName   = item.siteName   ?? item.camera?.site?.name
          const hasCamera  = !!(item.cameraId ?? item.camera?.id)
          const canPlayback = hasCamera && !!ts

          return (
            <button
              key={item.id ?? idx}
              onClick={() => canPlayback && openPlayer(item)}
              className={cn(
                'w-full flex items-stretch gap-0 rounded-2xl border overflow-hidden text-left transition-all duration-200',
                'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md',
                reviewed && 'opacity-60 grayscale-[30%]',
                canPlayback && 'active:scale-[0.98]',
              )}
            >
              {/* Left color bar */}
              <div className={cn('w-1 shrink-0', meta.bar)} />

              <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-3">
                {/* Icon circle */}
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", meta.bg)}>
                  <Icon className={cn('w-4 h-4', meta.color)} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={cn('text-sm font-bold truncate', meta.color)}>
                      {meta.label}
                    </p>
                    {!reviewed && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 truncate font-medium">{cameraName}</p>
                  {siteName && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{siteName}</p>
                  )}
                  <p className="text-[10px] text-slate-500 dark:text-slate-600 mt-1 font-medium">{timeAgo}</p>
                </div>

                {/* Thumbnail or chevron */}
                {hasThumb ? (
                  <div className="w-16 h-16 mr-2 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 relative border border-slate-200 dark:border-slate-700">
                    <img
                      src={thumbUrl}
                      alt="frame"
                      className="w-full h-full object-cover"
                      onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }}
                    />
                    {canPlayback && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
                        <Play className="w-5 h-5 text-white/90 fill-white/90 drop-shadow-md" />
                      </div>
                    )}
                  </div>
                ) : canPlayback ? (
                  <ChevronRight className="w-5 h-5 text-slate-400 dark:text-slate-600 shrink-0 mr-2" />
                ) : null}
              </div>
            </button>
          )
        })}

        {filtered.length > 0 && (
          <p className="text-center text-[10px] font-medium text-slate-500 dark:text-slate-700 pt-2 pb-4">
            {filtered.length} evento{filtered.length !== 1 ? 's' : ''} — últimos 60
          </p>
        )}
      </div>

      {playerState && (
        <MobilePlayerSheet
          cameras={playerState.cameras}
          initialIndex={0}
          initialTab={playerState.timestamp ? 'playback' : 'live'}
          initialTimestamp={playerState.timestamp}
          onClose={() => setPlayerState(null)}
        />
      )}
    </div>
  )
}
