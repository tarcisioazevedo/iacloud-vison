/**
 * RecordingsPage — revisão de gravações HLS por câmera + dia.
 *
 * Layout (3 colunas):
 *   ┌────────┬─────────────────────────────────────────┐
 *   │ Lista  │           PlaybackPlayer                │
 *   │ câmeras│                                          │
 *   │        │                                          │
 *   │ + busca│         (vídeo + controles)              │
 *   │ + site │                                          │
 *   │ filtro │                                          │
 *   ├────────┼─────────────────────────────────────────┤
 *   │ Date   │  Timeline (heatmap por minuto)          │
 *   │ picker │  + jump-to-now / +1h / -1h              │
 *   └────────┴─────────────────────────────────────────┘
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Film, Search, Calendar, ChevronLeft, ChevronRight,
  Camera as CameraIcon, ArrowLeft, Filter, Clock,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PlaybackPlayer, type PlaybackPlayerRef } from '../components/player/PlaybackPlayer'
import { PlaybackTimelineZoom } from '../components/player/PlaybackTimelineZoom'
import { useCameras, usePlaybackTimeline, usePlaybackIndex } from '../api/client'
import { cn } from '../lib/utils'

function todayUtcIso(): string {
  // YYYY-MM-DD do dia ATUAL em UTC. Ajustar pra TZ local seria nice-to-have
  // mas backend trabalha em UTC; manter consistência aqui.
  return new Date().toISOString().slice(0, 10)
}

function dayShift(day: string, deltaDays: number): string {
  const d = new Date(day + 'T00:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

function dayRangeIso(day: string): { fromIso: string; toIso: string } {
  return {
    fromIso: `${day}T00:00:00.000Z`,
    toIso:   `${day}T23:59:59.999Z`,
  }
}

export function RecordingsPage() {
  const { data, isLoading: camsLoading } = useCameras()
  const cameras: any[] = data?.cameras ?? []
  const [q, setQ] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [day, setDay] = useState<string>(todayUtcIso())
  const [currentSecOfDay, setCurrentSecOfDay] = useState(0)

  const playerRef = useRef<PlaybackPlayerRef>(null)

  const sites = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of cameras) if (c.site) seen.set(c.site.id, c.site.name)
    return [...seen.entries()]
  }, [cameras])

  const filtered = useMemo(() => cameras.filter(c => {
    if (q && !c.name?.toLowerCase().includes(q.toLowerCase())) return false
    if (siteFilter && c.site?.id !== siteFilter) return false
    // Só faz sentido listar câmeras com recordEnabled. Backend filtra na
    // gravação, mas pra UX clara, escondemos câmeras sem recording.
    if (c.recordEnabled === false) return false
    return true
  }), [cameras, q, siteFilter])

  // Auto-seleciona a primeira câmera quando lista carrega
  useEffect(() => {
    if (!selectedCameraId && filtered.length > 0) {
      setSelectedCameraId(filtered[0].id)
    }
  }, [filtered, selectedCameraId])

  const selectedCamera = cameras.find(c => c.id === selectedCameraId)

  // Bitmap do dia selecionado (heatmap timeline)
  const { data: timeline } = usePlaybackTimeline(selectedCameraId, day)
  // Índice de dias com gravação (pro date picker indicar quais dias têm conteúdo)
  const { data: index } = usePlaybackIndex(selectedCameraId)

  const daysWithRecording = useMemo(() => {
    return new Set(index?.days?.map(d => d.day) ?? [])
  }, [index])

  const range = useMemo(() => dayRangeIso(day), [day])

  function handleSeek(secOfDay: number) {
    playerRef.current?.seekTo(secOfDay)
  }

  function changeDay(delta: number) {
    setDay(d => dayShift(d, delta))
    setCurrentSecOfDay(0)
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
            <Film className="w-5 h-5 text-amber-500 dark:text-amber-400" />
            Gravações
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            HLS playback · revisar histórico por câmera e dia
          </p>
        </div>
        <Link
          to="/live"
          className={cn(
            'px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors',
            'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900',
            'dark:bg-white/5 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white',
          )}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar ao mosaico
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Sidebar — câmeras */}
        <GlassCard className="p-3 lg:col-span-1 max-h-[80vh] overflow-y-auto">
          <div className={cn(
            'space-y-2 sticky top-0 z-10 pb-2 border-b',
            'bg-white border-slate-200',
            'dark:bg-space-900 dark:border-white/5',
          )}>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar câmera..."
                className={cn(
                  'w-full pl-8 pr-3 py-1.5 text-xs rounded-md focus:outline-none border',
                  'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-amber-500',
                  'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-500/50',
                )}
              />
            </div>
            {sites.length > 0 && (
              <select
                value={siteFilter}
                onChange={e => setSiteFilter(e.target.value)}
                className={cn(
                  'w-full px-2 py-1.5 text-xs rounded-md border',
                  'bg-slate-50 border-slate-200 text-slate-900',
                  'dark:bg-white/5 dark:border-white/10 dark:text-white',
                )}
              >
                <option value="">Todos os sites</option>
                {sites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            <p className="text-[10px] text-slate-500 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              {filtered.length} {filtered.length === 1 ? 'câmera' : 'câmeras'} com gravação habilitada
            </p>
          </div>

          {camsLoading ? (
            <p className="text-xs text-slate-500 text-center py-8">Carregando…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8 px-2">
              Nenhuma câmera com <em>recordEnabled</em>.
            </p>
          ) : (
            <ul className="space-y-1 mt-2">
              {filtered.map(c => (
                <li
                  key={c.id}
                  onClick={() => { setSelectedCameraId(c.id); setCurrentSecOfDay(0) }}
                  className={cn(
                    'p-2 rounded-lg border cursor-pointer transition',
                    c.id === selectedCameraId
                      ? 'border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-500/10'
                      : cn(
                          'border-slate-200 bg-slate-50 hover:border-amber-300',
                          'dark:border-white/5 dark:bg-white/[0.03] dark:hover:border-amber-500/30',
                        ),
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className={cn(
                      'w-6 h-6 rounded flex items-center justify-center shrink-0',
                      c.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400',
                    )}>
                      <CameraIcon className="w-3 h-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate text-slate-900 dark:text-white">{c.name}</p>
                      <p className="text-[10px] truncate text-slate-500 dark:text-slate-500">{c.site?.name ?? '—'}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-600">
                        Retém {c.recordRetainDays ?? 7}d · {c.recordMode}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Player + timeline */}
        <div className="lg:col-span-3 flex flex-col gap-3">
          {selectedCamera ? (
            <>
              {/* Day picker */}
              <GlassCard className="p-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="w-4 h-4 shrink-0 text-amber-500 dark:text-amber-400" />
                  <button
                    onClick={() => changeDay(-1)}
                    className={cn(
                      'p-1 rounded',
                      'bg-slate-100 hover:bg-slate-200 text-slate-700',
                      'dark:bg-white/5 dark:hover:bg-white/10 dark:text-white',
                    )}
                    title="Dia anterior"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="date"
                    value={day}
                    onChange={e => { setDay(e.target.value); setCurrentSecOfDay(0) }}
                    className={cn(
                      'px-2 py-1 text-xs rounded-md border',
                      'bg-slate-50 border-slate-200 text-slate-900',
                      'dark:bg-white/5 dark:border-white/10 dark:text-white',
                    )}
                  />
                  <button
                    onClick={() => changeDay(1)}
                    className={cn(
                      'p-1 rounded',
                      'bg-slate-100 hover:bg-slate-200 text-slate-700',
                      'dark:bg-white/5 dark:hover:bg-white/10 dark:text-white',
                    )}
                    title="Próximo dia"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { setDay(todayUtcIso()); setCurrentSecOfDay(0) }}
                    className={cn(
                      'px-2 py-1 text-[11px] rounded font-semibold',
                      'bg-slate-100 hover:bg-slate-200 text-slate-700',
                      'dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-300',
                    )}
                  >
                    Hoje
                  </button>

                  <div className="flex-1" />

                  {timeline && (
                    <div className="flex items-center gap-1 text-[10px] text-slate-500">
                      <Clock className="w-3 h-3" />
                      <span>
                        <span className="font-semibold text-cyan-700 dark:text-cyan-300">
                          {timeline.coverageMin}min
                        </span>{' '}
                        de gravação neste dia
                      </span>
                    </div>
                  )}

                  {daysWithRecording.size > 0 && !daysWithRecording.has(day) && (
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded border',
                      'text-amber-700 bg-amber-100 border-amber-200',
                      'dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20',
                    )}>
                      Sem gravação neste dia
                    </span>
                  )}
                </div>
              </GlassCard>

              {/* Player */}
              <PlaybackPlayer
                ref={playerRef}
                cameraId={selectedCamera.id}
                fromIso={range.fromIso}
                toIso={range.toIso}
                onTimeUpdate={(cur) => setCurrentSecOfDay(cur)}
                className="aspect-video"
              />

              {/* Timeline interativa com zoom (scroll) + pan (drag) + click-to-seek.
                  Suporta zoom até 1 minuto na tela cheia — útil pra localizar
                  evento curto (passagem de pessoa, blink de led etc.). */}
              <GlassCard className="p-3">
                <PlaybackTimelineZoom
                  bitmap={timeline?.bitmap}
                  currentSecOfDay={currentSecOfDay}
                  dayUtcDate={day}
                  onSeek={handleSeek}
                />
                <p className="text-[10px] text-slate-500 mt-2">
                  Cyan = gravação · âmbar = playhead · scroll = zoom (ancorado no cursor)
                  · drag = pan · 2-click = reset · shift+scroll = pan
                </p>
              </GlassCard>
            </>
          ) : (
            <GlassCard className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-slate-500">
              <Film className="w-12 h-12 mb-2 opacity-40" />
              <p className="text-sm">Selecione uma câmera na lista lateral pra começar.</p>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  )
}
