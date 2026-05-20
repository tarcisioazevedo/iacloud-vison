/**
 * CockpitPage — painel unificado de operação CFTV com IA.
 *
 * Layout 3-pane:
 *   • Header sticky com câmera + datetime + tabs de modo de busca
 *   • Left (~65%): Player (live OU playback) com zone overlay + timeline 24h
 *   • Right (~35%): Painel de busca + resultados + bookmarks
 *
 * Modos de busca:
 *   • 📐 Por área — desenha zonas → POST /detections/zone-search
 *   • 💬 Por descrição — texto livre → GET /detections/search-description (tsvector)
 *   • 🧩 Híbrido — em breve (zone + texto)
 *
 * AI Agent chat: drawer global (já existe), botão flutuante no canto.
 *
 * UX premium:
 *   • Live↔Playback toggle no player
 *   • Click no heatmap → seek
 *   • J/L hotkeys: previous/next event
 *   • Click num resultado → seek + popup do clip
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search, Loader2, Camera as CameraIcon, AlertCircle, Trash2, X, Play,
  Sparkles, Zap, Bookmark,
} from 'lucide-react'
import {
  useCameras,
  searchMotionInZones,
  searchByDescription,
  listReviewSegments,
  getTimelineHeatmap,
  eventClipM3u8Url,
  aiDescribeLive,
  aiPoint,
  aiAnalyzeTimeline,
  type PointHit,
  formatApiError,
  type DetectionZone,
  type DetectionFrameRow,
  type DescriptionSearchResult,
  type ReviewSegmentRow,
  type TimelineHeatmapHour,
  useBookmarks,
  createBookmark,
  deleteBookmark,
  type Bookmark as BookmarkRow,
} from '../api/client'
import { LivePlayer } from '../components/player/LivePlayer'
import { PlaybackPlayer, type PlaybackPlayerRef } from '../components/player/PlaybackPlayer'
import { HlsClipPlayer } from '../components/player/HlsClipPlayer'
import { TimelineHeatmap } from '../components/cockpit/TimelineHeatmap'
import { localSecOfDay, isoDate } from '../lib/day-utils'

const OBJECT_TYPES = ['person', 'car', 'truck', 'motorcycle', 'bicycle', 'animal', 'dog', 'cat'] as const

const SUGGESTIONS_DESC = [
  'pessoa com mochila',
  'carro branco',
  'pessoa correndo',
  'moto com 2 pessoas',
  'alguém parado mais de 5min',
]

type SearchMode = 'area' | 'description' | 'hybrid'

interface Zone extends DetectionZone {
  id: string
  color: string
}

const ZONE_COLORS = ['#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#10B981', '#EC4899']

export function CockpitPage() {
  const [params] = useSearchParams()
  const { data: camerasData } = useCameras({ limit: '100' })
  const cameras: Array<{ id: string; name: string }> = camerasData?.cameras ?? []

  const [cameraId, setCameraId] = useState<string>(params.get('cameraId') ?? '')
  const [day, setDay] = useState<string>(() => isoDate(new Date()))
  const [timeFrom, setTimeFrom] = useState<string>('00:00')  // HH:MM
  const [timeTo,   setTimeTo]   = useState<string>('23:59')
  const [mode, setMode] = useState<SearchMode>('area')

  // ── Pagination ──────────────────────────────────────────────────────────
  const PAGE_SIZE = 20
  const [page, setPage] = useState<number>(0)        // página 0-indexed
  const [totalResults, setTotalResults] = useState<number>(0)

  // ── AI describe-live (Gemini lê frame atual) ────────────────────────────
  const [liveDesc, setLiveDesc] = useState<string | null>(null)
  const [livePlate, setLivePlate] = useState<{ text: string; vehicle: string; color: string; conf: number } | null>(null)
  const [describing, setDescribing] = useState(false)

  // ── AI point (Robotics-ER aponta objeto descrito) ───────────────────────
  const [pointQuery, setPointQuery] = useState('')
  const [pointHits, setPointHits] = useState<PointHit[]>([])
  const [pointing, setPointing] = useState(false)

  // ── Timeline AI analysis ────────────────────────────────────────────────
  const [timelineAnalysis, setTimelineAnalysis] = useState<string | null>(null)
  const [analyzingTimeline, setAnalyzingTimeline] = useState(false)

  // ── Playback timeline (substitui LivePlayer quando user clica em hora) ──
  // null = modo LIVE; número = segundos do dia (UTC) para começar playback
  const [playbackStartSec, setPlaybackStartSec] = useState<number | null>(null)
  const [playbackCurrentSec, setPlaybackCurrentSec] = useState<number | null>(null)
  const playbackPlayerRef = useRef<PlaybackPlayerRef | null>(null)

  function seekToHour(secOfDay: number) {
    setSelectedEventId(null) // sai de event clip se estava
    const wasInPlayback = playbackStartSec != null
    setPlaybackStartSec(secOfDay)
    setPlaybackCurrentSec(secOfDay)
    // Se já estava em playback, só re-seek (não re-monta o player)
    if (wasInPlayback && playbackPlayerRef.current) {
      setTimeout(() => playbackPlayerRef.current?.seekTo(secOfDay), 200)
    }
  }

  function backToLive() {
    setPlaybackStartSec(null)
    setPlaybackCurrentSec(null)
  }

  // Reset quando troca câmera ou dia
  useEffect(() => {
    setPlaybackStartSec(null)
    setPlaybackCurrentSec(null)
  }, [cameraId, day])

  // Quando entra em playback pela primeira vez, aguarda mount + seek inicial
  useEffect(() => {
    if (playbackStartSec == null) return
    const t = setTimeout(() => {
      playbackPlayerRef.current?.seekTo(playbackStartSec)
    }, 800)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackStartSec != null ? 'mounted' : 'unmounted'])

  async function analyzeTimelineNow() {
    if (!cameraId) return
    setAnalyzingTimeline(true)
    setTimelineAnalysis(null)
    try {
      const r = await aiAnalyzeTimeline({ cameraId, day })
      setTimelineAnalysis(r.analysis)
    } catch (e) {
      setTimelineAnalysis(formatApiError(e))
    } finally {
      setAnalyzingTimeline(false)
    }
  }

  async function pointNow() {
    if (!cameraId || pointQuery.trim().length < 2) return
    setPointing(true)
    setPointHits([])
    try {
      const r = await aiPoint({ cameraId, query: pointQuery })
      setPointHits(r.items)
      if (r.items.length === 0) {
        setLiveDesc(`Nada encontrado pra "${pointQuery}"`)
      }
    } catch (e) {
      setLiveDesc(formatApiError(e))
    } finally {
      setPointing(false)
    }
  }

  async function describeNow(mode: 'scene' | 'plate') {
    if (!cameraId) return
    setDescribing(true)
    setLiveDesc(null)
    setLivePlate(null)
    try {
      const r = await aiDescribeLive({ cameraId, mode })
      if (r.mode === 'scene') {
        setLiveDesc(r.description)
      } else {
        setLivePlate({
          text: r.plate_text || '(ilegível)',
          vehicle: r.vehicle_type,
          color: r.vehicle_color,
          conf: r.confidence,
        })
        if (!r.plate_text) setLiveDesc(r.reason)
      }
    } catch (e) {
      setLiveDesc(formatApiError(e))
    } finally {
      setDescribing(false)
    }
  }

  // ── Zone search state ───────────────────────────────────────────────────
  const [zones, setZones] = useState<Zone[]>([])
  const [objectTypes, setObjectTypes] = useState<Set<string>>(new Set(['person']))
  const canvasRef = useRef<HTMLDivElement>(null)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)

  // ── Description search state ────────────────────────────────────────────
  const [descQuery, setDescQuery] = useState('')

  // ── Results ─────────────────────────────────────────────────────────────
  const [searching, setSearching] = useState(false)
  const [zoneResults, setZoneResults] = useState<DetectionFrameRow[]>([])
  const [descResults, setDescResults] = useState<DescriptionSearchResult[]>([])
  const [error, setError] = useState<string | null>(null)

  // ── Review segments + heatmap ───────────────────────────────────────────
  const [segments, setSegments] = useState<ReviewSegmentRow[]>([])
  const [heatmap, setHeatmap] = useState<TimelineHeatmapHour[]>(
    Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, alerts: 0 })),
  )

  // ── Selected event for inline clip player ──────────────────────────────
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  // Bounds compostos: dia + horário (timeFrom/timeTo em HH:MM).
  // Atenção: backend espera ISO UTC. Considera os times como UTC pra
  // alinhar com timestamps de DetectionFrame.timestamp (que são UTC).
  const dayBounds = useMemo(() => ({
    from: `${day}T${timeFrom}:00.000Z`,
    to:   `${day}T${timeTo}:59.999Z`,
  }), [day, timeFrom, timeTo])

  // ── Bookmarks ───────────────────────────────────────────────────────────
  // Janela alinhada com dayBounds pra timeline e lista compartilharem fonte.
  const { data: bookmarksData, mutate: refreshBookmarks } = useBookmarks(
    cameraId || null,
    dayBounds.from,
    dayBounds.to,
  )
  const bookmarks: BookmarkRow[] = bookmarksData?.bookmarks ?? []

  const [rightTab, setRightTab] = useState<'results' | 'bookmarks'>('results')
  const [savingBookmark, setSavingBookmark] = useState(false)

  async function saveBookmarkNow() {
    if (!cameraId) return
    setSavingBookmark(true)
    try {
      const now = new Date()
      await createBookmark({
        cameraId,
        title: `Bookmark ${now.toLocaleTimeString('pt-BR')}`,
        color: '#F59E0B',
        startAt: now,
        notes: null,
      })
      await refreshBookmarks()
      setRightTab('bookmarks')
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSavingBookmark(false)
    }
  }

  async function removeBookmark(id: string) {
    await deleteBookmark(id)
    await refreshBookmarks()
  }

  // Bookmarks da lista para a TimelineHeatmap (formato {id, atSec, label})
  const bookmarkMarkers = useMemo(() => {
    return bookmarks.map(b => {
      const sec = localSecOfDay(new Date(b.startAt))
      return { id: b.id, atSec: sec, label: b.title }
    })
  }, [bookmarks])

  // Hotkey 'b' pra criar bookmark
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.key === 'b' || e.key === 'B') && cameraId && !savingBookmark) {
        e.preventDefault()
        saveBookmarkNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, savingBookmark])

  // Carrega heatmap + segments quando câmera/dia muda
  useEffect(() => {
    if (!cameraId) {
      setHeatmap(Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, alerts: 0 })))
      setSegments([])
      return
    }
    getTimelineHeatmap({ cameraId, day }).then(r => setHeatmap(r.hours)).catch(() => {})
    listReviewSegments({
      cameraId,
      from: dayBounds.from,
      to: dayBounds.to,
      limit: 50,
    }).then(r => setSegments(r.segments)).catch(() => {})
  }, [cameraId, day, dayBounds.from, dayBounds.to])

  // ── Drawing zones ───────────────────────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent) {
    if (mode !== 'area' || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    setDrawStart({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
    setDrawCurrent({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!drawStart || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    setDrawCurrent({
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    })
  }
  function handleMouseUp() {
    if (!drawStart || !drawCurrent) return
    const w = Math.abs(drawCurrent.x - drawStart.x)
    const h = Math.abs(drawCurrent.y - drawStart.y)
    if (w > 0.02 && h > 0.02) {
      setZones(prev => [...prev, {
        id:    crypto.randomUUID(),
        x:     Math.min(drawStart.x, drawCurrent.x),
        y:     Math.min(drawStart.y, drawCurrent.y),
        w, h,
        color: ZONE_COLORS[prev.length % ZONE_COLORS.length],
      }])
    }
    setDrawStart(null)
    setDrawCurrent(null)
  }

  const previewRect = drawStart && drawCurrent ? {
    x: Math.min(drawStart.x, drawCurrent.x),
    y: Math.min(drawStart.y, drawCurrent.y),
    w: Math.abs(drawCurrent.x - drawStart.x),
    h: Math.abs(drawCurrent.y - drawStart.y),
  } : null

  function toggleObjectType(t: string) {
    setObjectTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  // ── Search execution ────────────────────────────────────────────────────
  // pageIdx opcional — quando vem do prev/next, mantém os filtros e só muda a página.
  const runSearch = useCallback(async (pageIdx: number = 0) => {
    if (!cameraId) {
      setError('Selecione uma câmera primeiro')
      return
    }
    setError(null)
    setSearching(true)
    try {
      if (mode === 'area') {
        if (zones.length === 0) {
          setError('Desenhe ao menos uma zona no player')
          return
        }
        const r = await searchMotionInZones({
          cameraId,
          from: dayBounds.from,
          to: dayBounds.to,
          zones: zones.map(z => ({ x: z.x, y: z.y, w: z.w, h: z.h })),
          objectTypes: Array.from(objectTypes),
          limit: PAGE_SIZE,
          offset: pageIdx * PAGE_SIZE,
        })
        setZoneResults(r.detections)
        setTotalResults(r.total)
        setPage(pageIdx)
        setDescResults([])
        if (r.total === 0) setError('Nada encontrado nessas zonas e horário')
      } else if (mode === 'description') {
        if (descQuery.trim().length < 2) {
          setError('Descreva o que procura (ao menos 2 caracteres)')
          return
        }
        const r = await searchByDescription({
          cameraId,
          query: descQuery,
          from: dayBounds.from,
          to: dayBounds.to,
        })
        setDescResults(r.results)
        setTotalResults(r.total)
        setPage(0)
        setZoneResults([])
        if (r.results.length === 0) {
          setError('Nenhuma descrição corresponde. Lembre: indexação Gemini precisa estar ativa.')
        }
      }
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSearching(false)
    }
  }, [cameraId, mode, zones, objectTypes, descQuery, dayBounds])

  // Função separada pra navegar entre páginas (mantém o resto dos filtros)
  function gotoPage(p: number) {
    runSearch(p)
  }

  // Limpa tudo — zonas, resultados, descrição, evento selecionado, paginação
  function clearAll() {
    setZones([])
    setZoneResults([])
    setDescResults([])
    setDescQuery('')
    setSelectedEventId(null)
    setError(null)
    setTotalResults(0)
    setPage(0)
  }

  // Hotkeys J/L pra navegar entre resultados
  const allResults = useMemo(() => {
    if (mode === 'area') return zoneResults.map(r => ({ id: 'frame-' + r.timestamp, time: r.timestamp }))
    return descResults.map(r => ({ id: r.id, time: r.startTime }))
  }, [mode, zoneResults, descResults])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (allResults.length === 0) return
      const cur = selectedEventId ? allResults.findIndex(r => r.id === selectedEventId) : -1
      if (e.key === 'l' || e.key === 'L') {
        const next = Math.min(cur + 1, allResults.length - 1)
        setSelectedEventId(allResults[next].id)
      } else if (e.key === 'j' || e.key === 'J') {
        const prev = Math.max(cur - 1, 0)
        setSelectedEventId(allResults[prev].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allResults, selectedEventId])

  const isToday = day === isoDate(new Date())

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-space-950">
      {/* ============ HEADER COMPACTO (h fixa) ============ */}
      <header className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-space-900 flex-wrap">
        <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
          <Sparkles className="w-4 h-4 text-cyan-500" />
          <span className="text-sm">Cockpit</span>
        </div>

        <select
          value={cameraId}
          onChange={e => { setCameraId(e.target.value); setZones([]); setSelectedEventId(null) }}
          className="bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-xs"
        >
          <option value="">— Câmera —</option>
          {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <input
          type="date"
          value={day}
          onChange={e => setDay(e.target.value)}
          className="bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-xs"
        />

        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <input
            type="time"
            value={timeFrom}
            onChange={e => setTimeFrom(e.target.value)}
            className="bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded px-1.5 py-1 text-xs"
            title="De"
          />
          <span>→</span>
          <input
            type="time"
            value={timeTo}
            onChange={e => setTimeTo(e.target.value)}
            className="bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded px-1.5 py-1 text-xs"
            title="Até"
          />
        </div>

        {/* Modos de BUSCA NO HISTÓRICO (não confundir com análise da cena atual) */}
        <div className="flex items-center gap-1">
          <span className="text-[9px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300 font-bold whitespace-nowrap">
            Buscar no histórico:
          </span>
          <div className="flex items-center bg-slate-100 dark:bg-white/5 rounded p-0.5">
            <ModeTab active={mode === 'area'} onClick={() => setMode('area')} icon="📐" label="Por área" sub="SQL" />
            <ModeTab active={mode === 'description'} onClick={() => setMode('description')} icon="🔍" label="Por texto" sub="tsvector" />
          </div>
        </div>

        {(zones.length > 0 || zoneResults.length > 0 || descResults.length > 0 || descQuery) && (
          <button
            onClick={clearAll}
            className="px-2 py-1 rounded text-[11px] text-rose-500 hover:bg-rose-500/10 flex items-center gap-1"
            title="Limpar zonas e resultados"
          >
            <Trash2 className="w-3 h-3" /> Limpar
          </button>
        )}

        {isToday && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/30 animate-pulse">
            ● AO VIVO
          </span>
        )}

        {error && (
          <span className="text-[11px] text-rose-500 flex items-center gap-1 ml-auto">
            <AlertCircle className="w-3 h-3" /> {error}
          </span>
        )}
      </header>

      {/* ============ MAIN — 2 colunas ============ */}
      <div className="flex-1 flex min-h-0 gap-2 p-2">

        {/* ====== LEFT COL: player + timeline + actions ====== */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">

          {/* Player — preenche o espaço disponível */}
          <div
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`flex-1 min-h-0 relative bg-black rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 select-none ${
              mode === 'area' && cameraId ? 'cursor-crosshair' : 'cursor-default'
            }`}
          >
            {!cameraId ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <CameraIcon className="w-12 h-12 mx-auto text-slate-600 mb-2" />
                  <p className="text-slate-400 text-sm">Selecione uma câmera no topo para começar</p>
                </div>
              </div>
            ) : selectedEventId && !selectedEventId.startsWith('frame-') ? (
              <HlsClipPlayer
                key={selectedEventId}
                src={eventClipM3u8Url(selectedEventId)}
                autoPlay
                controls
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : playbackStartSec != null ? (
              <PlaybackPlayer
                ref={playbackPlayerRef}
                cameraId={cameraId}
                fromIso={new Date(`${day}T00:00:00`).toISOString()}
                toIso={new Date(`${day}T23:59:59.999`).toISOString()}
                dayUtcDate={day}
                onTimeUpdate={(secOfDay) => setPlaybackCurrentSec(secOfDay)}
                className="absolute inset-0 w-full h-full"
              />
            ) : (
              <div className="absolute inset-0 pointer-events-none">
                <LivePlayer
                  cameraId={cameraId}
                  mode="auto"
                  muted
                  showOverlay={false}
                  fit="contain"
                  className="w-full h-full"
                />
              </div>
            )}

            {/* Zone overlays (modo área) */}
            {cameraId && zones.map(z => (
              <div
                key={z.id}
                style={{
                  position: 'absolute',
                  left: `${z.x * 100}%`,
                  top: `${z.y * 100}%`,
                  width: `${z.w * 100}%`,
                  height: `${z.h * 100}%`,
                  borderColor: z.color,
                  backgroundColor: z.color + '33',
                }}
                className="border-2 group"
              >
                <button
                  onClick={() => setZones(prev => prev.filter(x => x.id !== z.id))}
                  className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* Preview rect sendo desenhado */}
            {previewRect && (
              <div
                style={{
                  position: 'absolute',
                  left: `${previewRect.x * 100}%`,
                  top: `${previewRect.y * 100}%`,
                  width: `${previewRect.w * 100}%`,
                  height: `${previewRect.h * 100}%`,
                }}
                className="border-2 border-cyan-400 bg-cyan-400/20 pointer-events-none"
              />
            )}

            {/* Pointing hits (Robotics-ER) */}
            {pointHits.map((h, i) => (
              h.bbox ? (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: `${h.bbox.x * 100}%`,
                    top: `${h.bbox.y * 100}%`,
                    width: `${h.bbox.w * 100}%`,
                    height: `${h.bbox.h * 100}%`,
                  }}
                  className="border-2 border-fuchsia-400 bg-fuchsia-400/15 pointer-events-none"
                >
                  <span className="absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-fuchsia-500 text-white whitespace-nowrap">
                    {h.label}{h.confidence != null ? ` · ${Math.round(h.confidence * 100)}%` : ''}
                  </span>
                </div>
              ) : (
                <div
                  key={i}
                  style={{ position: 'absolute', left: `${h.point.x * 100}%`, top: `${h.point.y * 100}%` }}
                  className="-translate-x-1/2 -translate-y-1/2 pointer-events-none"
                >
                  <span className="block w-4 h-4 rounded-full bg-fuchsia-500 border-2 border-white shadow-lg" />
                </div>
              )
            ))}

            {/* Voltar ao live — clip de evento */}
            {selectedEventId && !selectedEventId.startsWith('frame-') && (
              <button
                onClick={() => setSelectedEventId(null)}
                className="absolute top-2 right-2 px-2 py-1 rounded bg-black/70 text-white text-xs flex items-center gap-1 hover:bg-black"
              >
                <X className="w-3 h-3" /> Voltar ao live
              </button>
            )}

            {/* Voltar ao live — playback timeline */}
            {playbackStartSec != null && !selectedEventId && (
              <button
                onClick={backToLive}
                className="absolute top-2 right-2 z-30 px-2 py-1 rounded bg-rose-500 hover:bg-rose-600 text-white text-xs flex items-center gap-1 font-medium"
              >
                <X className="w-3 h-3" /> Voltar ao LIVE
              </button>
            )}

            {/* Status badges sobre o player */}
            {cameraId && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
                {playbackStartSec != null ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-black flex items-center gap-1">
                    ⏯ PLAYBACK {String(Math.floor(playbackStartSec / 3600)).padStart(2,'0')}h
                  </span>
                ) : isToday && !selectedEventId && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500 text-white flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" /> LIVE
                  </span>
                )}
                {mode === 'area' && playbackStartSec == null && !selectedEventId && (
                  <span className="px-2 py-0.5 rounded text-[10px] bg-black/60 text-cyan-300">
                    📐 desenhe zonas
                  </span>
                )}
              </div>
            )}

            {/* Análise Gemini — overlay flutuante (não rouba espaço) */}
            {(liveDesc || livePlate) && (
              <div className="absolute bottom-2 left-2 right-2 max-w-2xl rounded-lg border border-violet-400/60 bg-violet-950/85 backdrop-blur px-3 py-2 text-xs space-y-1 text-violet-50">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-violet-200 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Gemini · cena atual
                  </span>
                  <button
                    onClick={() => { setLiveDesc(null); setLivePlate(null) }}
                    className="text-violet-300 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {livePlate && (
                  <div className="rounded bg-black/30 p-1.5 font-mono flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-500 text-black font-bold text-sm">{livePlate.text}</span>
                    <span className="text-[11px] text-violet-200">
                      {livePlate.vehicle} · {livePlate.color} · {Math.round(livePlate.conf * 100)}% conf
                    </span>
                  </div>
                )}
                {liveDesc && <p className="leading-relaxed text-[12px]">{liveDesc}</p>}
              </div>
            )}
          </div>

          {/* Timeline + Actions — bloco com folga acima pra tooltip+bookmarks */}
          <div className="flex-shrink-0 min-h-[200px] rounded-xl border-2 border-slate-300 dark:border-white/10 bg-white dark:bg-white/[0.03] px-3 pt-6 pb-3 space-y-2 shadow-sm relative">
            {/* Timeline 24h com hover + análise IA + scrub playback */}
            <TimelineHeatmap
              hours={heatmap}
              bookmarks={bookmarkMarkers}
              currentSec={playbackCurrentSec}
              cameraId={cameraId}
              day={day}
              onSeek={seekToHour}
              onAnalyzeAI={cameraId ? analyzeTimelineNow : undefined}
              analyzing={analyzingTimeline}
            />

            {/* Resultado da análise IA — colapsa quando fechado */}
            {timelineAnalysis && (
              <div className="rounded-lg border border-violet-500/40 bg-violet-500/[0.06] p-2 text-[11px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-violet-700 dark:text-violet-300 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Análise do dia · Gemini Pro
                  </span>
                  <button
                    onClick={() => setTimelineAnalysis(null)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  {timelineAnalysis}
                </p>
              </div>
            )}

            {/* Action row compacto */}
            {/* Action row — 3 grupos visuais separados:
                  • Operador (cyan)   : Bookmark, Exportar — ações do operador
                  • IA on-demand (violeta): Analisar / Placa / Localizar — Gemini lê o frame atual
                  • (busca histórica fica no painel direito) */}
            <div className="flex items-center gap-2 text-xs flex-wrap">

              {/* Grupo Operador (cyan) */}
              <div className="flex items-center gap-1">
                <button
                  onClick={saveBookmarkNow}
                  disabled={savingBookmark || !cameraId}
                  className="px-2 py-1 rounded bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center gap-1 text-[11px]"
                  title="Marca este instante (atalho: B)"
                >
                  {savingBookmark ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bookmark className="w-3 h-3" />}
                  Bookmark
                  <kbd className="text-[9px] opacity-60 bg-white/20 px-1 rounded">B</kbd>
                </button>
              </div>

              {/* Divisor */}
              <div className="h-5 w-px bg-slate-300 dark:bg-white/10" aria-hidden />

              {/* Grupo IA on-demand (violeta) — "analisar a cena AGORA" */}
              <span className="text-[9px] uppercase tracking-wider text-violet-700 dark:text-violet-300 font-bold whitespace-nowrap flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> IA na cena atual:
              </span>

              <button
                onClick={() => describeNow('scene')}
                disabled={describing || !cameraId}
                className="px-2 py-1 rounded bg-violet-500 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center gap-1 text-[11px]"
                title="Gemini analisa e descreve o frame ao vivo"
              >
                {describing ? <Loader2 className="w-3 h-3 animate-spin" /> : '🎬'}
                Analisar cena
              </button>
              <button
                onClick={() => describeNow('plate')}
                disabled={describing || !cameraId}
                className="px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center gap-1 text-[11px]"
                title="Gemini Pro lê a placa do veículo visível"
              >
                {describing ? <Loader2 className="w-3 h-3 animate-spin" /> : '🚘'}
                Ler placa
              </button>

              {/* Pointing inline — IA visual com input livre */}
              <div className="flex items-center gap-1 flex-1 min-w-[200px]">
                <input
                  type="text"
                  value={pointQuery}
                  onChange={e => setPointQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && cameraId && pointNow()}
                  disabled={!cameraId}
                  placeholder={cameraId ? '🎯 Localizar objeto: "carro branco", "homem de moletom"...' : 'Selecione uma câmera'}
                  className="flex-1 px-2 py-1 rounded bg-fuchsia-50 dark:bg-fuchsia-500/10 border border-fuchsia-500/30 text-[11px] focus:outline-none focus:border-fuchsia-500 disabled:opacity-40 placeholder:text-fuchsia-500/60"
                  title="Gemini Pro encontra o objeto descrito no frame e marca com bbox"
                />
                <button
                  onClick={pointNow}
                  disabled={pointing || !cameraId || pointQuery.trim().length < 2}
                  className="px-2 py-1 rounded bg-fuchsia-500 hover:bg-fuchsia-600 disabled:opacity-40 text-white text-[11px] flex items-center gap-1"
                  title="Acha o objeto descrito e desenha bbox sobre o vídeo"
                >
                  {pointing ? <Loader2 className="w-3 h-3 animate-spin" /> : '🎯'}
                  Apontar
                </button>
                {pointHits.length > 0 && (
                  <button
                    onClick={() => setPointHits([])}
                    className="text-[10px] text-rose-500 hover:underline"
                    title="Remover overlays no vídeo"
                  >
                    ✕ ({pointHits.length})
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ====== RIGHT COL: tabs + filter + list + paginação ====== */}
        <aside className="w-[380px] flex-shrink-0 flex flex-col gap-2 min-h-0">

          {/* Tabs Resultados / Bookmarks */}
          <div className="flex-shrink-0 flex rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] overflow-hidden">
            <button
              onClick={() => setRightTab('results')}
              className={`flex-1 px-3 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                rightTab === 'results'
                  ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-b-2 border-cyan-500'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Resultados {mode === 'area' && totalResults > 0 ? `(${totalResults.toLocaleString('pt-BR')})` : descResults.length > 0 ? `(${descResults.length})` : `· ${segments.length} eventos`}
            </button>
            <button
              onClick={() => setRightTab('bookmarks')}
              className={`flex-1 px-3 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                rightTab === 'bookmarks'
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-b-2 border-amber-500'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              Bookmarks ({bookmarks.length})
            </button>
          </div>

          {/* Filter card — só na tab Resultados */}
          {rightTab === 'results' && (
            <div className="flex-shrink-0 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] p-2 space-y-1.5">
              {mode === 'area' && (
                <>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
                    📐 Objetos
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {OBJECT_TYPES.map(t => (
                      <button
                        key={t}
                        onClick={() => toggleObjectType(t)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition border ${
                          objectTypes.has(t)
                            ? 'border-cyan-500 bg-cyan-500 text-white'
                            : 'border-slate-200 dark:border-white/10 text-slate-500 hover:border-cyan-400'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {mode === 'description' && (
                <>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
                    🔍 Buscar no histórico por texto
                  </label>
                  <input
                    type="text"
                    value={descQuery}
                    onChange={e => setDescQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && runSearch(0)}
                    placeholder='ex: "homem de moletom vermelho"'
                    className="w-full px-2 py-1 rounded bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <p className="text-[9px] text-slate-400 leading-tight">
                    Busca em descrições já indexadas pelo Gemini (events passados). Para descrever a cena ATUAL, use os botões IA no rodapé do player.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {SUGGESTIONS_DESC.map(s => (
                      <button
                        key={s}
                        onClick={() => setDescQuery(s)}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-500"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <button
                onClick={() => runSearch(0)}
                disabled={searching || !cameraId}
                className="w-full px-2 py-1.5 rounded bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-medium flex items-center justify-center gap-1"
              >
                {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                {searching ? 'Buscando...' : (
                  mode === 'area'
                    ? `Buscar (${zones.length} zona${zones.length === 1 ? '' : 's'})`
                    : 'Buscar descrição'
                )}
              </button>
            </div>
          )}

          {/* Lista — flex-1, internal scroll only */}
          <div className="flex-1 min-h-0 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {rightTab === 'results' ? (
                <>
                  {mode === 'area' && zoneResults.length > 0 && zoneResults.map(r => (
                    <ZoneResultRow
                      key={r.timestamp}
                      row={r}
                      active={selectedEventId === 'frame-' + r.timestamp}
                      onSelect={() => {
                        // Entra em playback ancorado no segundo-do-dia do frame
                        // e marca a linha como ativa (highlight).
                        // Antes só marcava o ID e o player ficava em LIVE —
                        // resultado: usuário via "evento sem gravação".
                        // Ordem importa: seekToHour() limpa selectedEventId,
                        // então setamos depois.
                        const secOfDay = localSecOfDay(new Date(r.timestamp))
                        seekToHour(Math.max(0, secOfDay - 3)) // -3s pra ver o objeto entrar
                        setSelectedEventId('frame-' + r.timestamp)
                      }}
                    />
                  ))}

                  {mode === 'description' && descResults.length > 0 && descResults.map(r => (
                    <DescResultRow
                      key={r.id}
                      row={r}
                      active={selectedEventId === r.id}
                      onSelect={() => setSelectedEventId(r.id)}
                    />
                  ))}

                  {/* Default: review segments do dia */}
                  {((mode === 'area' && zoneResults.length === 0) ||
                    (mode === 'description' && descResults.length === 0)) && segments.length > 0 && (
                    <>
                      <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold pt-1 pb-0.5">
                        Eventos do dia ({segments.length})
                      </p>
                      {segments.slice(0, 30).map(s => (
                        <SegmentRow
                          key={s.id}
                          segment={s}
                          onSelectEvent={(eventId) => setSelectedEventId(eventId)}
                        />
                      ))}
                    </>
                  )}

                  {!cameraId && (
                    <div className="text-center py-8 text-slate-400">
                      <CameraIcon className="w-8 h-8 mx-auto mb-1 opacity-50" />
                      <p className="text-xs">Selecione uma câmera</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {bookmarks.length === 0 && cameraId && (
                    <div className="text-center py-6 text-slate-400">
                      <Bookmark className="w-8 h-8 mx-auto mb-1 opacity-50" />
                      <p className="text-xs">Sem bookmarks neste dia.</p>
                      <p className="text-[10px] mt-0.5">Click no botão Bookmark ou tecle <kbd className="px-1 bg-slate-200 dark:bg-white/10 rounded">B</kbd> pra marcar o instante atual.</p>
                    </div>
                  )}
                  {bookmarks.map(b => (
                    <div key={b.id} className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2 text-xs hover:bg-amber-500/[0.1] group">
                      <div className="flex items-start gap-2">
                        <div className="w-1 self-stretch rounded" style={{ backgroundColor: b.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-300">
                              {new Date(b.startAt).toLocaleTimeString('pt-BR')}
                            </span>
                            <button
                              onClick={() => removeBookmark(b.id)}
                              className="text-rose-500 opacity-0 group-hover:opacity-100 transition"
                              title="Remover bookmark"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-700 dark:text-slate-300 truncate">{b.title}</p>
                          {b.notes && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{b.notes}</p>}
                          {b.autoType !== 'MANUAL' && (
                            <span className="inline-block mt-0.5 text-[9px] px-1 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-400">
                              {b.autoType}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Paginação só na tab Resultados quando há mais de 1 página */}
            {rightTab === 'results' && mode === 'area' && totalResults > PAGE_SIZE && (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={totalResults}
                onPage={gotoPage}
                disabled={searching}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

function ModeTab({
  active, onClick, icon, label, sub, disabled,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
  sub: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1.5 ${
        active
          ? 'bg-white dark:bg-space-800 text-cyan-600 dark:text-cyan-400 shadow-sm'
          : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span>{icon}</span> {label}
      <span className={`text-[9px] px-1 py-0.5 rounded ${
        active ? 'bg-cyan-500/20' : 'bg-slate-200 dark:bg-white/10'
      }`}>{sub}</span>
    </button>
  )
}

function Pagination({ page, pageSize, total, onPage, disabled }: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  disabled?: boolean
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = page > 0
  const canNext = page < totalPages - 1

  return (
    <div className="border-t border-slate-200 dark:border-white/10 px-3 py-2 flex items-center justify-between text-xs">
      <button
        onClick={() => onPage(page - 1)}
        disabled={!canPrev || disabled}
        className="px-2 py-1 rounded bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
      >
        ◀ Anterior
      </button>
      <span className="text-slate-500 font-mono">
        página <strong className="text-slate-700 dark:text-slate-300">{page + 1}</strong> de {totalPages.toLocaleString('pt-BR')}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={!canNext || disabled}
        className="px-2 py-1 rounded bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
      >
        Próxima ▶
      </button>
    </div>
  )
}

function SegmentRow({ segment, onSelectEvent }: {
  segment: ReviewSegmentRow
  onSelectEvent: (id: string) => void
}) {
  const isAlert = segment.severity === 'ALERT'
  const duration = segment.endTime
    ? Math.round((+new Date(segment.endTime) - +new Date(segment.startTime)) / 1000)
    : null
  return (
    <div className={`rounded-md border p-2 text-xs ${
      isAlert
        ? 'border-rose-500/40 bg-rose-500/5'
        : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02]'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
          isAlert
            ? 'bg-rose-500 text-white'
            : 'bg-slate-300 dark:bg-white/10 text-slate-700 dark:text-slate-300'
        }`}>
          {segment.severity}
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          {new Date(segment.startTime).toLocaleTimeString('pt-BR')}
          {duration != null && ` · ${duration}s`}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 mb-1">
        {segment.labels.map(l => (
          <span key={l} className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            {l}
          </span>
        ))}
      </div>
      {segment.events.length > 0 && (
        <div className="space-y-0.5 pt-1 border-t border-slate-200/50 dark:border-white/5">
          {segment.events.slice(0, 3).map(e => (
            <button
              key={e.id}
              onClick={() => onSelectEvent(e.id)}
              className="w-full flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 group"
            >
              <span className="font-mono">
                {new Date(e.startTime).toLocaleTimeString('pt-BR')} · {e.objectType}
              </span>
              <span className="flex items-center gap-1">
                <span className="text-emerald-500">{Math.round(e.topScore * 100)}%</span>
                <Play className="w-3 h-3 opacity-50 group-hover:opacity-100" />
              </span>
            </button>
          ))}
          {segment.events.length > 3 && (
            <p className="text-[9px] text-slate-400 italic">+{segment.events.length - 3} mais</p>
          )}
        </div>
      )}
    </div>
  )
}

function ZoneResultRow({ row, active, onSelect }: {
  row: DetectionFrameRow
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-md border p-2 text-xs transition ${
        active
          ? 'border-cyan-500 bg-cyan-500/10'
          : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:bg-cyan-500/5'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold">
          {new Date(row.timestamp).toLocaleTimeString('pt-BR')}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
          {row.confidence ? Math.round(row.confidence * 100) + '%' : '?'}
        </span>
      </div>
      <p className="text-[10px] text-slate-500 mt-0.5">
        {row.objectType} · bbox ({Math.round(row.bboxX * 100)}%, {Math.round(row.bboxY * 100)}%)
      </p>
    </button>
  )
}

function DescResultRow({ row, active, onSelect }: {
  row: DescriptionSearchResult
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-md border p-2 text-xs transition ${
        active
          ? 'border-cyan-500 bg-cyan-500/10'
          : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:bg-cyan-500/5'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[11px] font-bold">
          {new Date(row.startTime).toLocaleTimeString('pt-BR')}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
          {Math.round(row.relevance * 100)}% match
        </span>
      </div>
      <p className="text-[11px] text-slate-700 dark:text-slate-300 line-clamp-2 mb-1">
        {row.description}
      </p>
      <p className="text-[9px] text-slate-500">
        {row.cameraName} · {row.objectType} · {Math.round(row.topScore * 100)}% conf
      </p>
    </button>
  )
}

