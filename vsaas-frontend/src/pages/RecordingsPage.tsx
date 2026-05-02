/**
 * RecordingsPage — central de gravações com tabs integradas.
 *
 * Tabs:
 *   - Playback: revisão HLS por câmera + dia (atual)
 *   - Storage: browser S3 + estatísticas
 *   - Configuração: retenção por câmera (multi-tenant)
 *
 * Multi-tenant:
 *   - Integrador define storageRetainDays padrão
 *   - Câmera pode override com recordRetainDays
 *   - UI mostra origem do valor (herdado vs custom)
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Film, Search, Calendar, ChevronLeft, ChevronRight,
  Camera as CameraIcon, ArrowLeft, Filter, Clock, Play,
  HardDrive, Settings2, Folder, FileVideo, Loader2,
  Save, Trash2, ChevronDown, RefreshCw, Info,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PlaybackPlayer, type PlaybackPlayerRef } from '../components/player/PlaybackPlayer'
import { PlaybackTimelineZoom } from '../components/player/PlaybackTimelineZoom'
import { useCameras, usePlaybackTimeline, usePlaybackIndex, api, formatApiError } from '../api/client'
import { cn } from '../lib/utils'

type Tab = 'playback' | 'storage' | 'config'

function todayUtcIso(): string {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function RecordingsPage() {
  const [tab, setTab] = useState<Tab>('playback')
  const { data, isLoading: camsLoading, refetch: refetchCameras } = useCameras()
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
    if (c.recordEnabled === false) return false
    return true
  }), [cameras, q, siteFilter])

  useEffect(() => {
    if (!selectedCameraId && filtered.length > 0) {
      setSelectedCameraId(filtered[0].id)
    }
  }, [filtered, selectedCameraId])

  const selectedCamera = cameras.find(c => c.id === selectedCameraId)

  const { data: timeline } = usePlaybackTimeline(selectedCameraId, day)
  const { data: index } = usePlaybackIndex(selectedCameraId)

  const daysWithRecording = useMemo(() => {
    return new Set(index?.days?.map((d: any) => d.day) ?? [])
  }, [index])

  const range = useMemo(() => dayRangeIso(day), [day])

  function handleSeek(secOfDay: number) {
    playerRef.current?.seekTo(secOfDay)
  }

  function changeDay(delta: number) {
    setDay(d => dayShift(d, delta))
    setCurrentSecOfDay(0)
  }

  const TABS = [
    { id: 'playback' as const, icon: Play, label: 'Playback' },
    { id: 'storage' as const, icon: HardDrive, label: 'Storage' },
    { id: 'config' as const, icon: Settings2, label: 'Configuração' },
  ]

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
            Playback HLS · storage S3 · configuração de retenção
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tabs */}
          <div className={cn(
            'flex rounded-lg border p-0.5',
            'bg-slate-100 border-slate-200',
            'dark:bg-white/5 dark:border-white/10',
          )}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-all',
                  tab === t.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
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
            Ao Vivo
          </Link>
        </div>
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
                <option value="" style={{ backgroundColor: '#0f172a', color: '#ffffff' }}>Todos os sites</option>
                {sites.map(([id, name]) => (
                  <option key={id} value={id} style={{ backgroundColor: '#0f172a', color: '#ffffff' }}>{name}</option>
                ))}
              </select>
            )}
            <p className="text-[10px] text-slate-500 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              {filtered.length} câmera{filtered.length !== 1 && 's'} com gravação
            </p>
          </div>

          {camsLoading ? (
            <p className="text-xs text-slate-500 text-center py-8">Carregando…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8 px-2">
              Nenhuma câmera com gravação habilitada.
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
                      <p className="text-[10px] truncate text-slate-500">{c.site?.name ?? '—'}</p>
                      <p className="text-[10px] text-slate-500">
                        <span className="text-cyan-600 dark:text-cyan-400">{c.recordRetainDays ?? 7}d</span>
                        {' · '}{c.recordMode || 'ALL'}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Main content */}
        <div className="lg:col-span-3 flex flex-col gap-3">
          {tab === 'playback' && (
            <PlaybackTab
              selectedCamera={selectedCamera}
              day={day}
              setDay={setDay}
              changeDay={changeDay}
              timeline={timeline}
              daysWithRecording={daysWithRecording}
              range={range}
              currentSecOfDay={currentSecOfDay}
              setCurrentSecOfDay={setCurrentSecOfDay}
              handleSeek={handleSeek}
              playerRef={playerRef}
            />
          )}
          {tab === 'storage' && <StorageTab selectedCamera={selectedCamera} />}
          {tab === 'config' && (
            <ConfigTab
              selectedCamera={selectedCamera}
              cameras={filtered}
              refetchCameras={refetchCameras}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBACK TAB
// ═══════════════════════════════════════════════════════════════════════════
function PlaybackTab({
  selectedCamera, day, setDay, changeDay, timeline, daysWithRecording,
  range, currentSecOfDay, setCurrentSecOfDay, handleSeek, playerRef,
}: any) {
  if (!selectedCamera) {
    return (
      <GlassCard className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-slate-500">
        <Film className="w-12 h-12 mb-2 opacity-40" />
        <p className="text-sm">Selecione uma câmera na lista lateral.</p>
      </GlassCard>
    )
  }

  return (
    <>
      {/* Day picker */}
      <GlassCard className="p-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="w-4 h-4 shrink-0 text-amber-500 dark:text-amber-400" />
          <button onClick={() => changeDay(-1)} className={cn(
            'p-1 rounded',
            'bg-slate-100 hover:bg-slate-200 text-slate-700',
            'dark:bg-white/5 dark:hover:bg-white/10 dark:text-white',
          )} title="Dia anterior">
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
          <button onClick={() => changeDay(1)} className={cn(
            'p-1 rounded',
            'bg-slate-100 hover:bg-slate-200 text-slate-700',
            'dark:bg-white/5 dark:hover:bg-white/10 dark:text-white',
          )} title="Próximo dia">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { setDay(todayUtcIso()); setCurrentSecOfDay(0) }} className={cn(
            'px-2 py-1 text-[11px] rounded font-semibold',
            'bg-slate-100 hover:bg-slate-200 text-slate-700',
            'dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-300',
          )}>
            Hoje
          </button>
          <div className="flex-1" />
          {timeline && (
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Clock className="w-3 h-3" />
              <span className="font-semibold text-cyan-700 dark:text-cyan-300">{timeline.coverageMin}min</span>
              {' '}de gravação
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
        onTimeUpdate={(cur: number) => setCurrentSecOfDay(cur)}
        className="aspect-video"
      />

      {/* Timeline */}
      <GlassCard className="p-3">
        <PlaybackTimelineZoom
          bitmap={timeline?.bitmap}
          currentSecOfDay={currentSecOfDay}
          dayUtcDate={day}
          onSeek={handleSeek}
        />
        <p className="text-[10px] text-slate-500 mt-2">
          Cyan = gravação · âmbar = playhead · scroll = zoom · drag = pan
        </p>
      </GlassCard>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE TAB
// ═══════════════════════════════════════════════════════════════════════════
function StorageTab({ selectedCamera }: { selectedCamera: any }) {
  const [stats, setStats] = useState<any>(null)
  const [browse, setBrowse] = useState<any>(null)
  const [prefix, setPrefix] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/storage/stats').then(r => r.data).catch(() => null),
      api.get('/storage/browse', { params: { prefix: selectedCamera?.id || '' } }).then(r => r.data).catch(() => null),
    ]).then(([s, b]) => {
      setStats(s)
      setBrowse(b)
      if (selectedCamera?.id) setPrefix(selectedCamera.id + '/')
    }).finally(() => setLoading(false))
  }, [selectedCamera?.id])

  async function navigateTo(newPrefix: string) {
    setLoading(true)
    try {
      const res = await api.get('/storage/browse', { params: { prefix: newPrefix } })
      setBrowse(res.data)
      setPrefix(newPrefix)
    } finally {
      setLoading(false)
    }
  }

  function goUp() {
    const parts = prefix.split('/').filter(Boolean)
    parts.pop()
    navigateTo(parts.length ? parts.join('/') + '/' : '')
  }

  if (loading) {
    return (
      <GlassCard className="p-8 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </GlassCard>
    )
  }

  if (!stats?.configured && !browse?.bucket) {
    return (
      <GlassCard className="p-8 flex flex-col items-center justify-center min-h-[40vh] text-slate-500">
        <HardDrive className="w-12 h-12 mb-3 opacity-40" />
        <p className="text-sm font-medium">Storage S3 não configurado</p>
        <p className="text-xs mt-1">Configure em Configurações → Storage</p>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-500/20 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {stats?.bucket || browse?.bucket || 'Storage S3'}
              </p>
              <p className="text-xs text-slate-500">
                {stats?.totalObjects?.toLocaleString() || '—'} objetos · {stats?.totalSizeMB?.toLocaleString() || '—'} MB
              </p>
            </div>
          </div>
          <button onClick={() => navigateTo(prefix)} className={cn(
            'p-2 rounded-lg transition',
            'hover:bg-slate-100 dark:hover:bg-white/10',
          )}>
            <RefreshCw className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </GlassCard>

      {/* Browser */}
      <GlassCard className="p-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs mb-3 flex-wrap">
          <button onClick={() => navigateTo('')} className="text-cyan-600 dark:text-cyan-400 hover:underline">
            /
          </button>
          {prefix.split('/').filter(Boolean).map((part, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <button
                onClick={() => navigateTo(arr.slice(0, i + 1).join('/') + '/')}
                className={cn(
                  i === arr.length - 1 ? 'text-slate-700 dark:text-white font-medium' : 'text-cyan-600 dark:text-cyan-400 hover:underline'
                )}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {/* Items */}
        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {prefix && (
            <button onClick={goUp} className={cn(
              'w-full p-2 rounded-lg text-left flex items-center gap-2 text-xs transition',
              'hover:bg-slate-50 dark:hover:bg-white/5',
            )}>
              <Folder className="w-4 h-4 text-amber-500" />
              <span className="text-slate-600 dark:text-slate-400">..</span>
            </button>
          )}
          {browse?.items?.map((item: any) => (
            <div key={item.key} className={cn(
              'p-2 rounded-lg flex items-center gap-2 text-xs transition',
              item.type === 'folder' ? 'hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer' : '',
            )} onClick={() => item.type === 'folder' && navigateTo(item.key)}>
              {item.type === 'folder' ? (
                <Folder className="w-4 h-4 text-amber-500" />
              ) : (
                <FileVideo className="w-4 h-4 text-cyan-500" />
              )}
              <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{item.name}</span>
              {item.size && (
                <span className="text-slate-500 text-[10px]">{formatBytes(item.size)}</span>
              )}
            </div>
          ))}
          {browse?.items?.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">Pasta vazia</p>
          )}
        </div>
      </GlassCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG TAB
// ═══════════════════════════════════════════════════════════════════════════
function ConfigTab({ selectedCamera, cameras, refetchCameras }: any) {
  const [saving, setSaving] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, any>>({})

  function getEdit(camId: string, field: string, defaultVal: any) {
    return edits[camId]?.[field] ?? defaultVal
  }

  function setEdit(camId: string, field: string, value: any) {
    setEdits(e => ({
      ...e,
      [camId]: { ...e[camId], [field]: value },
    }))
  }

  async function saveCamera(cam: any) {
    setSaving(cam.id)
    try {
      await api.patch(`/cameras/${cam.id}`, {
        recordEnabled: getEdit(cam.id, 'recordEnabled', cam.recordEnabled),
        recordMode: getEdit(cam.id, 'recordMode', cam.recordMode),
        recordRetainDays: getEdit(cam.id, 'recordRetainDays', cam.recordRetainDays),
      })
      refetchCameras()
    } catch (err) {
      alert(formatApiError(err))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-3">
      {/* Info */}
      <GlassCard className="p-3 border-cyan-500/20">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-600 dark:text-slate-400">
            <p><strong>Hierarquia de retenção:</strong> Integrador define padrão → Câmera pode override.</p>
            <p className="mt-1">Segmentos mais antigos são deletados automaticamente pelo sistema.</p>
          </div>
        </div>
      </GlassCard>

      {/* Camera list */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          Configuração por Câmera
        </h3>

        <div className="space-y-2">
          {cameras.map((cam: any) => (
            <div key={cam.id} className={cn(
              'p-3 rounded-lg border transition',
              cam.id === selectedCamera?.id
                ? 'border-amber-400 bg-amber-50/50 dark:border-amber-500/50 dark:bg-amber-500/5'
                : 'border-slate-200 dark:border-white/10',
            )}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <CameraIcon className="w-4 h-4 text-slate-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate text-slate-900 dark:text-white">{cam.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{cam.site?.name || '—'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Record enabled */}
                  <label className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={getEdit(cam.id, 'recordEnabled', cam.recordEnabled ?? true)}
                      onChange={e => setEdit(cam.id, 'recordEnabled', e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    Gravar
                  </label>

                  {/* Mode */}
                  <select
                    value={getEdit(cam.id, 'recordMode', cam.recordMode || 'ALL')}
                    onChange={e => setEdit(cam.id, 'recordMode', e.target.value)}
                    className={cn(
                      'px-2 py-1 text-[10px] rounded border',
                      'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white',
                    )}
                  >
                    <option value="ALL">Contínuo</option>
                    <option value="MOTION">Movimento</option>
                    <option value="DISABLED">Desabilitado</option>
                  </select>

                  {/* Retain days */}
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={getEdit(cam.id, 'recordRetainDays', cam.recordRetainDays ?? 7)}
                      onChange={e => setEdit(cam.id, 'recordRetainDays', Number(e.target.value))}
                      className={cn(
                        'w-14 px-2 py-1 text-[10px] rounded border text-center',
                        'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white',
                      )}
                    />
                    <span className="text-[10px] text-slate-500">dias</span>
                  </div>

                  {/* Save */}
                  <button
                    onClick={() => saveCamera(cam)}
                    disabled={saving === cam.id}
                    className={cn(
                      'p-1.5 rounded transition',
                      'bg-cyan-600 text-white hover:bg-cyan-700',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                  >
                    {saving === cam.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}
