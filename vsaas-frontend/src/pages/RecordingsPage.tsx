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
  Save, Trash2, ChevronDown, RefreshCw, Info, Activity,
  Mail, Phone, AlertTriangle, DollarSign, ArrowUpCircle, X, Check,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PremiumHero } from '../components/hierarchy'
import { PlaybackPlayer, type PlaybackPlayerRef } from '../components/player/PlaybackPlayer'
import { PlaybackTimelineZoom } from '../components/player/PlaybackTimelineZoom'
import { StatusTab } from '../components/recordings/StatusTab'
import { useCameras, usePlaybackTimeline, usePlaybackIndex, api, formatApiError } from '../api/client'
import { cn } from '../lib/utils'

type Tab = 'playback' | 'status' | 'storage' | 'config'

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function dayShift(day: string, deltaDays: number): string {
  const d = new Date(day + 'T00:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

/**
 * Range ISO UTC para playback. Aceita filtro opcional de hora ("HH:MM" 24h)
 * pra delimitar a janela dentro do dia. Default: dia inteiro 00:00–23:59.
 */
function dayRangeIso(day: string, fromHour = '00:00', toHour = '23:59'): { fromIso: string; toIso: string } {
  const fh = /^\d{2}:\d{2}$/.test(fromHour) ? fromHour : '00:00'
  const th = /^\d{2}:\d{2}$/.test(toHour)   ? toHour   : '23:59'
  return {
    fromIso: `${day}T${fh}:00.000Z`,
    toIso:   `${day}T${th}:59.999Z`,
  }
}

/**
 * Monta range ISO a partir de dia + horas (HH:MM em UTC). Se startHour/endHour
 * forem nulos, usa 00:00→23:59 (dia inteiro). Retorna toIso > fromIso.
 */
function hourRangeIso(day: string, startHour: string | null, endHour: string | null): { fromIso: string; toIso: string } {
  const startH = startHour ?? '00:00'
  const endH   = endHour ?? '23:59'
  return {
    fromIso: `${day}T${startH}:00.000Z`,
    toIso:   `${day}T${endH}:59.999Z`,
  }
}

/** Converte segundos do dia (0..86400) → "HH:MM" UTC. */
function secOfDayToHHMM(sec: number): string {
  const h = Math.max(0, Math.min(23, Math.floor(sec / 3600)))
  const m = Math.max(0, Math.min(59, Math.floor((sec % 3600) / 60)))
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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
  // Filtro de hora (HH:MM, UTC). null = dia inteiro (00:00→23:59).
  const [startHour, setStartHour] = useState<string | null>(null)
  const [endHour, setEndHour]     = useState<string | null>(null)

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

  const range = useMemo(() => hourRangeIso(day, startHour, endHour),
    [day, startHour, endHour])

  function handleSeek(secOfDay: number) {
    playerRef.current?.seekTo(secOfDay)
  }

  function changeDay(delta: number) {
    setDay(d => dayShift(d, delta))
    setCurrentSecOfDay(0)
  }

  const TABS = [
    { id: 'playback' as const, icon: Play, label: 'Playback' },
    { id: 'status' as const, icon: Activity, label: 'Status' },
    { id: 'storage' as const, icon: HardDrive, label: 'Storage' },
    { id: 'config' as const, icon: Settings2, label: 'Configuração' },
  ]

  return (
    <div className="space-y-3">
      {/* Hero premium (Onda 6.F) */}
      <PremiumHero
        emoji="🎬"
        title="Gravações"
        subtitle="Playback HLS · storage S3/R2 · configuração de retenção · scrub timeline"
        accent="amber"
        tags={[
          { label: 'HLS', color: 'amber' },
          { label: 'S3/R2', color: 'emerald' },
        ]}
      />

      <div className="flex items-center justify-end flex-wrap gap-3">
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
              startHour={startHour}
              setStartHour={setStartHour}
              endHour={endHour}
              setEndHour={setEndHour}
              currentSecOfDay={currentSecOfDay}
              setCurrentSecOfDay={setCurrentSecOfDay}
              handleSeek={handleSeek}
              playerRef={playerRef}
            />
          )}
          {tab === 'status' && <StatusTab cameras={filtered} />}
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
  range, startHour, setStartHour, endHour, setEndHour,
  currentSecOfDay, setCurrentSecOfDay, handleSeek, playerRef,
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

        {/* Filtro de hora — restringe range do resgate (UTC) */}
        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-white/5 flex items-center gap-2 flex-wrap">
          <Clock className="w-3.5 h-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
          <span className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Hora (UTC)</span>
          <label className="text-[10px] text-slate-500">de</label>
          <input
            type="time"
            value={startHour ?? '00:00'}
            onChange={e => { setStartHour(e.target.value); setCurrentSecOfDay(0) }}
            className={cn(
              'px-2 py-1 text-xs rounded-md border w-[88px]',
              'bg-slate-50 border-slate-200 text-slate-900',
              'dark:bg-white/5 dark:border-white/10 dark:text-white',
            )}
          />
          <label className="text-[10px] text-slate-500">até</label>
          <input
            type="time"
            value={endHour ?? '23:59'}
            onChange={e => { setEndHour(e.target.value); setCurrentSecOfDay(0) }}
            className={cn(
              'px-2 py-1 text-xs rounded-md border w-[88px]',
              'bg-slate-50 border-slate-200 text-slate-900',
              'dark:bg-white/5 dark:border-white/10 dark:text-white',
            )}
          />
          {/* Atalhos rápidos */}
          {[
            { label: 'Dia inteiro', s: null,    e: null    },
            { label: 'Manhã',       s: '06:00', e: '12:00' },
            { label: 'Tarde',       s: '12:00', e: '18:00' },
            { label: 'Noite',       s: '18:00', e: '23:59' },
            { label: 'Última hora', s: secOfDayToHHMM(Math.max(0, currentSecOfDay - 3600)),
              e: secOfDayToHHMM(Math.min(86399, currentSecOfDay)) },
          ].map(p => (
            <button
              key={p.label}
              onClick={() => { setStartHour(p.s); setEndHour(p.e); setCurrentSecOfDay(0) }}
              className={cn(
                'px-2 py-1 text-[10px] rounded-md border font-medium transition',
                ((p.s === startHour && p.e === endHour) ||
                 (p.s === null && startHour === null && endHour === null))
                  ? 'bg-cyan-100 border-cyan-300 text-cyan-700 dark:bg-cyan-500/20 dark:border-cyan-500/40 dark:text-cyan-300'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-white/5 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/10',
              )}
            >
              {p.label}
            </button>
          ))}
          {(startHour !== null || endHour !== null) && (
            <button
              onClick={() => { setStartHour(null); setEndHour(null) }}
              className="text-[10px] text-rose-500 hover:underline"
              title="Limpar filtro de hora"
            >
              limpar
            </button>
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

      {/* Fallback de clips do vault — quando HLS não tem cobertura no dia */}
      {(!timeline || (timeline.coverageMin ?? 0) === 0) && (
        <VaultClipsFallback cameraId={selectedCamera.id} day={day} />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// VAULT CLIPS FALLBACK — exibe clips do edge box (Frigate) quando não há HLS
// ═══════════════════════════════════════════════════════════════════════════
function VaultClipsFallback({ cameraId, day }: { cameraId: string; day: string }) {
  const [clips, setClips] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<any>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // ?at= no querystring (vindo de link externo)
  const atParam = useMemo(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('at')
  }, [])

  useEffect(() => {
    setLoading(true)
    setSelectedKey(null)
    const from = `${day}T00:00:00.000Z`
    const to   = `${day}T23:59:59.999Z`
    api.get(`/vault/cameras/${cameraId}/clips`, { params: { from, to } })
      .then(r => {
        setClips(r.data?.clips ?? [])
        setMeta({
          truncated:      r.data?.truncated,
          totalAvailable: r.data?.totalAvailable,
          edgeNode:       r.data?.edgeNode,
          reason:         r.data?.reason,
        })
        // Auto-seleciona o clip mais próximo do `at` se vier no querystring
        if (atParam && r.data?.clips?.length) {
          const target = new Date(atParam).getTime()
          const closest = r.data.clips
            .filter((c: any) => c.type === 'clip')
            .reduce((best: any, c: any) => {
              const dist = Math.abs(new Date(c.timestamp).getTime() - target)
              return !best || dist < best.dist ? { c, dist } : best
            }, null)
          if (closest) setSelectedKey(closest.c.key)
        }
      })
      .catch(() => setClips([]))
      .finally(() => setLoading(false))
  }, [cameraId, day, atParam])

  const onlyClips = clips.filter(c => c.type === 'clip')
  const onlySnaps = clips.filter(c => c.type === 'snap' || c.type === 'thumb')
  const selectedClip = onlyClips.find(c => c.key === selectedKey)

  if (loading) {
    return (
      <GlassCard className="p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </GlassCard>
    )
  }

  if (clips.length === 0) {
    return (
      <GlassCard className="p-6 text-center text-sm text-slate-500">
        <Info className="w-5 h-5 mx-auto mb-2 opacity-50" />
        <p>Sem gravação contínua nem clips de evento neste dia.</p>
        {meta?.reason === 'no_edge_node_or_vault_configured' && (
          <p className="text-xs mt-2 text-amber-600">
            Esta câmera não tem edge box vinculado — gravação só seria possível
            via fluxo cloud-direct (não configurado).
          </p>
        )}
      </GlassCard>
    )
  }

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs">
          <p className="font-semibold text-slate-900 dark:text-white">
            Sem gravação HLS contínua — exibindo clips de detecção do edge box
          </p>
          <p className="text-slate-500 mt-0.5">
            {onlyClips.length} clip{onlyClips.length !== 1 ? 's' : ''} ·
            {' '}{onlySnaps.length} snapshot{onlySnaps.length !== 1 ? 's' : ''}
            {meta?.truncated && ` (mostrando primeiros ${clips.length} de ${meta.totalAvailable})`}
          </p>
        </div>
      </div>

      {/* Player do clip selecionado */}
      {selectedClip?.presignedUrl && (
        <div className="rounded-lg overflow-hidden bg-black aspect-video">
          <video
            src={selectedClip.presignedUrl}
            controls
            autoPlay
            className="w-full h-full"
            key={selectedClip.key}
          />
        </div>
      )}

      {/* Timeline simples de clips — botões clicáveis em ordem cronológica */}
      <div className="space-y-1 max-h-[40vh] overflow-y-auto">
        {onlyClips.map(c => {
          const isSelected = c.key === selectedKey
          const isAtMatch  = atParam && Math.abs(new Date(c.timestamp).getTime() - new Date(atParam).getTime()) < 30_000
          return (
            <button
              key={c.key}
              onClick={() => setSelectedKey(c.key)}
              className={cn(
                'w-full p-2 rounded-lg text-left flex items-center gap-2 text-xs transition border',
                isSelected
                  ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10'
                  : isAtMatch
                    ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10'
                    : 'border-transparent hover:bg-slate-50 dark:hover:bg-white/5',
              )}
            >
              <Play className={cn(
                'w-3 h-3 shrink-0',
                isSelected ? 'text-cyan-600' : 'text-slate-400',
              )} />
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {new Date(c.timestamp).toLocaleTimeString('pt-BR')}
              </span>
              <span className="flex-1 truncate text-slate-400 text-[10px]">{c.key.split('/').pop()}</span>
              <span className="text-[10px] text-slate-500">{c.sizeMB.toFixed(2)} MB</span>
              {isAtMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-800">match</span>}
            </button>
          )
        })}
      </div>
    </GlassCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE TAB
// ═══════════════════════════════════════════════════════════════════════════
function StorageTab({ selectedCamera }: { selectedCamera: any }) {
  // Role do usuário define UI: CLIENTE_* vê dashboard simplificado (consumo +
  // R$ + contato do integrador); INTEGRADOR_* / SUPER_ADMIN vê browser de S3.
  const userRole = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
  const isClienteFinal = userRole.startsWith('CLIENTE_')

  if (isClienteFinal) {
    return <ClienteFinalStorageDashboard />
  }
  return <IntegradorStorageBrowser selectedCamera={selectedCamera} />
}

// ─── Dashboard limpo para CLIENTE_FINAL ──────────────────────────────────────
// Consume /storage/me/usage (Sprint 1 enriquecido com R$ estimado, contato do
// integrador, freshness e info de cancelamento). Sem browse cru.
function ClienteFinalStorageDashboard() {
  const [usage, setUsage] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [planModalOpen, setPlanModalOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/storage/me/usage')
      .then(r => setUsage(r.data))
      .catch(() => setUsage(null))
      .finally(() => setLoading(false))
  }, [reloadKey])

  if (loading) {
    return (
      <GlassCard className="p-8 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </GlassCard>
    )
  }
  if (!usage) {
    return (
      <GlassCard className="p-8 flex flex-col items-center justify-center min-h-[40vh] text-slate-500">
        <HardDrive className="w-12 h-12 mb-3 opacity-40" />
        <p className="text-sm font-medium">Não foi possível carregar dados de storage</p>
        <button onClick={() => setReloadKey(k => k + 1)} className="mt-3 text-xs text-cyan-600 hover:underline">
          Tentar novamente
        </button>
      </GlassCard>
    )
  }

  const usedGB           = usage.usedGB ?? 0
  const quotaGB          = usage.quotaGB
  const pct              = usage.usagePct
  const status           = usage.status as 'ok' | 'warning' | 'critical' | 'unmetered'
  const estimatedBrl     = usage.estimatedMonthlyBrl ?? 0
  const lastUpdated      = usage.lastUpdatedAt
  const integradorContact = usage.integradorContact as { name: string; email: string | null; phone: string | null } | null
  const cancellation     = usage.cancellation as { canceledAt: string; cancelGraceUntil: string } | null

  const statusColor = {
    ok:        'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/20',
    warning:   'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/20',
    critical:  'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/20',
    unmetered: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-500/20',
  }[status]

  return (
    <div className="space-y-3">
      {/* Banner de cancelamento (LGPD graça) */}
      {cancellation && (
        <GlassCard className="p-4 border-amber-300 dark:border-amber-500/40">
          <div className="flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold text-amber-700 dark:text-amber-400">
                Cancelamento em andamento — período de graça LGPD
              </p>
              <p className="text-slate-600 dark:text-slate-400 mt-1">
                Suas gravações ficarão acessíveis até{' '}
                <strong>{new Date(cancellation.cancelGraceUntil).toLocaleDateString('pt-BR')}</strong>.
                Após essa data, o conteúdo será permanentemente removido. Para reativar a conta,
                entre em contato com seu integrador.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Cards de consumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
            <HardDrive className="w-4 h-4" />
            Armazenamento usado
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {usedGB.toFixed(2)} <span className="text-sm font-normal text-slate-500">GB</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {usage.objectCount?.toLocaleString('pt-BR') ?? 0} arquivos · janela de {usage.retainDays}d
          </p>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
            <Activity className="w-4 h-4" />
            Cota acordada
          </div>
          {quotaGB != null ? (
            <>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {quotaGB.toFixed(0)} <span className="text-sm font-normal text-slate-500">GB</span>
              </p>
              <div className="mt-2 space-y-1">
                <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                  <div
                    className={cn('h-full transition-all', {
                      'bg-emerald-500': status === 'ok',
                      'bg-amber-500':   status === 'warning',
                      'bg-rose-500':    status === 'critical',
                    })}
                    style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold', statusColor)}>
                    {pct?.toFixed(1)}%
                  </span>
                  <span className="text-slate-500">{(quotaGB - usedGB).toFixed(2)} GB livres</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-slate-400">sem cota</p>
              <p className="text-xs text-slate-500 mt-1">uso conforme contrato com integrador</p>
            </>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
            <DollarSign className="w-4 h-4" />
            Custo estimado/mês
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            R$ {estimatedBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            base R2 · valor final pode variar conforme plano
          </p>
        </GlassCard>
      </div>

      {/* CTA: solicitar mudança de plano */}
      <button
        onClick={() => setPlanModalOpen(true)}
        className={cn(
          'w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-medium transition',
          'bg-cyan-500 hover:bg-cyan-600 text-white shadow-sm',
          'dark:bg-cyan-600 dark:hover:bg-cyan-500'
        )}
      >
        <ArrowUpCircle className="w-4 h-4" />
        Mudar plano de retenção
      </button>
      {planModalOpen && (
        <RetentionPlanModal
          onClose={() => setPlanModalOpen(false)}
          onChanged={() => { setPlanModalOpen(false); setReloadKey(k => k + 1) }}
        />
      )}

      {/* Contato do integrador */}
      {integradorContact && (
        <GlassCard className="p-4">
          <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
            Suporte do seu integrador
          </p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-cyan-100 dark:bg-cyan-500/20 flex items-center justify-center text-sm font-semibold text-cyan-600 dark:text-cyan-400">
              {integradorContact.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-white">{integradorContact.name}</p>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
                {integradorContact.email && (
                  <a href={`mailto:${integradorContact.email}`} className="flex items-center gap-1 hover:text-cyan-600">
                    <Mail className="w-3 h-3" /> {integradorContact.email}
                  </a>
                )}
                {integradorContact.phone && (
                  <a href={`tel:${integradorContact.phone}`} className="flex items-center gap-1 hover:text-cyan-600">
                    <Phone className="w-3 h-3" /> {integradorContact.phone}
                  </a>
                )}
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Footer — freshness + reload */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span className="flex items-center gap-1">
          <Info className="w-3 h-3" />
          {lastUpdated
            ? <>atualizado em {new Date(lastUpdated).toLocaleString('pt-BR')}</>
            : 'sem dados de atualização'}
        </span>
        <button
          onClick={() => setReloadKey(k => k + 1)}
          className="flex items-center gap-1 hover:text-cyan-600 transition"
        >
          <RefreshCw className="w-3 h-3" /> recarregar
        </button>
      </div>
    </div>
  )
}

// ─── Modal de mudança de plano (CLIENTE_ADMIN) ───────────────────────────────
// Lista planos disponíveis do catálogo + chama POST /retention/clientes/:id/plan.
// Sprint 2: workflow é AUTO_APPROVED — efeito imediato. Hook para approval futura.
function RetentionPlanModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [plans, setPlans] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [me, setMe] = useState<any>(null)
  const [resolutionFilter, setResolutionFilter] = useState<string>('HD')

  useEffect(() => {
    Promise.all([
      api.get('/retention/plans').then(r => r.data),
      api.get('/auth/me').then(r => r.data).catch(() => null),
    ]).then(([p, u]) => {
      setPlans(p.plans ?? [])
      setMe(u)
    }).finally(() => setLoading(false))
  }, [])

  const cfId = me?.user?.clienteFinalId ?? me?.clienteFinalId
  const filtered = plans.filter(p => p.resolution === resolutionFilter || p.resolution === 'ANY')

  async function submit() {
    if (!selectedId || !cfId) return
    setSubmitting(true)
    try {
      await api.post(`/retention/clientes/${cfId}/plan`, { retentionPlanId: selectedId })
      onChanged()
    } catch (err) {
      alert('Não foi possível mudar o plano. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Escolher plano de retenção</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex gap-2 flex-wrap">
            {['ANY', 'VGA', 'HD', 'FHD', 'UHD_4K'].map(r => (
              <button
                key={r}
                onClick={() => setResolutionFilter(r)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-lg font-medium transition',
                  resolutionFilter === r
                    ? 'bg-cyan-500 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                )}
              >
                {r === 'UHD_4K' ? '4K' : r === 'ANY' ? 'Live Only' : r}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map(p => {
                const isSelected = selectedId === p.id
                const usdBrl     = 5.30
                const markupInt  = 1.30      // estimativa (real vem do contract no backend)
                const finalBrl   = (Number(p.pricePerCameraMonthUsd) * markupInt * usdBrl).toFixed(2)
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      'p-3 rounded-xl text-left transition border-2',
                      isSelected
                        ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10'
                        : 'border-slate-200 dark:border-white/10 hover:border-cyan-300 bg-white dark:bg-white/5'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {p.retainDays === 0 ? 'sem gravação' : `gravação ${p.retainDays} dia${p.retainDays > 1 ? 's' : ''}`}
                        </p>
                      </div>
                      {isSelected && <Check className="w-5 h-5 text-cyan-500 flex-shrink-0" />}
                    </div>
                    <p className="text-base font-bold text-slate-900 dark:text-white mt-2">
                      ~ R$ {finalBrl}<span className="text-xs font-normal text-slate-500">/cam/mês</span>
                    </p>
                  </button>
                )
              })}
              {filtered.length === 0 && (
                <p className="col-span-2 text-center text-sm text-slate-500 py-8">
                  Nenhum plano disponível para esta resolução.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 dark:border-white/10">
          <p className="flex-1 text-xs text-slate-500">
            <Info className="w-3 h-3 inline mr-1" />
            O plano é aplicado a todas as câmeras sem plano específico.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!selectedId || submitting || !cfId}
            className={cn(
              'px-4 py-2 text-sm rounded-lg font-medium transition',
              !selectedId || submitting || !cfId
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-white/5'
                : 'bg-cyan-500 text-white hover:bg-cyan-600'
            )}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Confirmar mudança'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Browser de S3 para INTEGRADOR_ADMIN / SUPER_ADMIN ───────────────────────
// Mantém o comportamento original (browse de objetos) que o role superior usa
// pra investigar gravações de qualquer cliente.
function IntegradorStorageBrowser({ selectedCamera }: { selectedCamera: any }) {
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
  // Sprint 2 — catálogo de planos disponível para atribuição por câmera
  const [plans, setPlans] = useState<any[]>([])
  const [savingPlan, setSavingPlan] = useState<string | null>(null)

  useEffect(() => {
    api.get('/retention/plans')
      .then(r => setPlans(r.data?.plans ?? []))
      .catch(() => setPlans([]))
  }, [])

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

  // Sprint 2 — atribui plano à câmera (ou remove override se planoId='')
  async function changeCameraPlan(cam: any, planId: string) {
    setSavingPlan(cam.id)
    try {
      await api.post(`/retention/cameras/${cam.id}/plan`, {
        retentionPlanId: planId || null,
      })
      refetchCameras()
    } catch (err) {
      alert(formatApiError(err))
    } finally {
      setSavingPlan(null)
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

                  {/* Sprint 2 — Plano de retenção (catálogo) */}
                  {plans.length > 0 && (
                    <select
                      value={cam.retentionPlanId ?? ''}
                      onChange={e => changeCameraPlan(cam, e.target.value)}
                      disabled={savingPlan === cam.id}
                      className={cn(
                        'px-2 py-1 text-[10px] rounded border max-w-[140px]',
                        'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white',
                        savingPlan === cam.id && 'opacity-50',
                      )}
                      title="Plano comercial (cascata: câmera → cliente → integrador)"
                    >
                      <option value="">— herdado —</option>
                      {plans.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}

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
