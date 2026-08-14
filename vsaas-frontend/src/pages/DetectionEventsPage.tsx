/**
 * DetectionEventsPage — painel de eventos detectados (YOLO track + Gemini describe).
 *
 * Fonte: docs/43-PLAN-IA-GEMINI-EXPANSAO.md (feature 1 — auto-tagging).
 *
 * Mostra DetectionEvents (pipeline novo) com:
 *  - Chips de tags semânticas (pessoa, veículo, EPI violação, etc) — multi-label
 *  - Descrição PT-BR gerada pelo Gemini Flash
 *  - Filtro multi-select por tag (?tags=pessoa,veiculo via API)
 *  - Auto-refresh a cada 30s
 *
 * Vista: LISTA DENSA (tabela). Cada linha = 1 event:
 *   tempo · câmera · objeto · score · duração · descrição · tags · ações
 *
 * Diferencia-se da FrigateReviewsPage:
 *  - FrigateReviews = vem do Edge Box (Frigate-style severity ALERT/DETECTION)
 *  - DetectionEvents = vem do worker YOLO (track-based + Gemini description + auto-tags)
 *  - Eventualmente: as duas convergem. Hoje rodam em pipelines paralelos.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Loader2, Filter, RefreshCw, Camera as CameraIcon, Clock,
  PlayCircle, MessageSquare, Pause, Play,
} from 'lucide-react'
import {
  listDetectionEvents, useCameras, formatApiError,
  AUTO_TAGS, AUTO_TAG_LABELS,
  type DetectionEventRow, type AutoTag,
} from '../api/client'
import { PremiumHero } from '../components/hierarchy'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'

/** Cores por tag — refletem severidade/contexto. */
const TAG_STYLE: Record<AutoTag, { bg: string; fg: string; emoji: string }> = {
  pessoa:                { bg: 'bg-blue-500/15',   fg: 'text-blue-700 dark:text-blue-300',     emoji: '🧑' },
  veiculo:               { bg: 'bg-cyan-500/15',   fg: 'text-cyan-700 dark:text-cyan-300',     emoji: '🚗' },
  objeto_abandonado:     { bg: 'bg-amber-500/15',  fg: 'text-amber-700 dark:text-amber-300',   emoji: '📦' },
  epi_violacao:          { bg: 'bg-rose-500/15',   fg: 'text-rose-700 dark:text-rose-300',     emoji: '⚠️' },
  aglomeracao:           { bg: 'bg-orange-500/15', fg: 'text-orange-700 dark:text-orange-300', emoji: '👥' },
  comportamento_anomalo: { bg: 'bg-red-500/15',    fg: 'text-red-700 dark:text-red-300',       emoji: '🚨' },
  noturno:               { bg: 'bg-slate-500/15',  fg: 'text-slate-700 dark:text-slate-300',   emoji: '🌙' },
  chuva_neblina:         { bg: 'bg-violet-500/15', fg: 'text-violet-700 dark:text-violet-300', emoji: '🌧️' },
}

/** Emoji por objectType do COCO — fallback genérico. */
function objectEmoji(objectType: string): string {
  const t = objectType.toLowerCase()
  if (t === 'person')                       return '🧑'
  if (t === 'car' || t === 'truck' || t === 'bus') return '🚗'
  if (t === 'motorcycle' || t === 'bicycle')return '🏍️'
  if (t === 'dog' || t === 'cat')           return '🐕'
  if (t === 'cell phone')                   return '📱'
  if (t === 'laptop')                       return '💻'
  if (t === 'backpack' || t === 'handbag' || t === 'suitcase') return '🎒'
  return '🎯'
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—'
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec - m * 60)
  return `${m}m${s.toString().padStart(2, '0')}s`
}

function scoreClass(score: number | null | undefined): string {
  if (score == null) return 'text-slate-400'
  if (score >= 0.85) return 'text-emerald-600 dark:text-emerald-400 font-semibold'
  if (score >= 0.65) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

export function DetectionEventsPage() {
  const [selectedTags, setSelectedTags] = useState<Set<AutoTag>>(new Set())
  const [windowHours, setWindowHours] = useState(24)
  const [cameraFilter, setCameraFilter] = useState<string>('') // '' = todas
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [events, setEvents] = useState<DetectionEventRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: camData } = useCameras()
  const camMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of camData?.cameras ?? []) map.set(c.id, c.name ?? 'Sem nome')
    return map
  }, [camData])

  // Fetch + auto-refresh
  useEffect(() => {
    let cancelled = false
    let interval: number | null = null

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const since = new Date(Date.now() - windowHours * 3600 * 1000)
        const tags = Array.from(selectedTags)
        const result = await listDetectionEvents({
          from:     since,
          tags:     tags.length > 0 ? tags : undefined,
          cameraId: cameraFilter || undefined,
          limit:    200,
        })
        if (!cancelled) {
          setEvents(result.events)
          setLastFetchAt(new Date())
        }
      } catch (e) {
        if (!cancelled) setError(formatApiError(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    if (autoRefresh) interval = window.setInterval(load, 30_000)
    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [selectedTags, windowHours, cameraFilter, autoRefresh])

  function toggleTag(tag: AutoTag) {
    setSelectedTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag); else next.add(tag)
      return next
    })
  }

  const stats = useMemo(() => {
    const byTag = new Map<string, number>()
    let withTags = 0
    let withoutTags = 0
    let totalWithDescription = 0
    for (const e of events) {
      const t = e.autoTags ?? []
      if (t.length === 0) withoutTags++
      else withTags++
      if (e.description) totalWithDescription++
      for (const tag of t) byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
    }
    return { total: events.length, withTags, withoutTags, withDescription: totalWithDescription, byTag }
  }, [events])

  return (
    <div className="space-y-4 p-4">
      <PremiumHero
        emoji="🏷️"
        accent="cyan"
        title="Eventos de Detecção"
        subtitle="Eventos rastreados pelo YOLO + classificação automática por IA (Gemini)"
      />

      {/* KPIs + controles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <GlassCard className="p-3">
          <div className="text-[10px] uppercase text-slate-500">Total</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[10px] uppercase text-slate-500">Com descrição IA</div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.withDescription}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[10px] uppercase text-slate-500">Com tags</div>
          <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{stats.withTags}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[10px] uppercase text-slate-500">Sem tags</div>
          <div className={cn('text-2xl font-bold', stats.withoutTags > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400')}>
            {stats.withoutTags}
          </div>
        </GlassCard>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={windowHours}
          onChange={e => setWindowHours(Number(e.target.value))}
          className="text-xs px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          title="Janela temporal"
        >
          <option value={1}>Última 1h</option>
          <option value={6}>Últimas 6h</option>
          <option value={24}>Últimas 24h</option>
          <option value={72}>Últimas 72h</option>
          <option value={168}>Últimos 7 dias</option>
        </select>

        <select
          value={cameraFilter}
          onChange={e => setCameraFilter(e.target.value)}
          className="text-xs px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 max-w-[200px]"
          title="Filtrar por câmera"
        >
          <option value="">Todas as câmeras</option>
          {(camData?.cameras ?? []).map((c: { id: string; name?: string | null }) => (
            <option key={c.id} value={c.id}>{c.name ?? c.id.slice(0, 8)}</option>
          ))}
        </select>

        <button
          onClick={() => setAutoRefresh(v => !v)}
          className={cn(
            'text-xs px-2 py-1.5 rounded border flex items-center gap-1.5 transition-colors',
            autoRefresh
              ? 'border-cyan-500 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
              : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
          )}
          title={autoRefresh ? 'Auto-refresh ligado (30s)' : 'Auto-refresh desligado'}
        >
          {autoRefresh ? <Pause size={12} /> : <Play size={12} />}
          Auto 30s
        </button>

        <button
          onClick={() => {
            setSelectedTags(new Set())
            setCameraFilter('')
            setLastFetchAt(null)
          }}
          className="text-xs px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1"
        >
          <RefreshCw size={12} /> Limpar filtros
        </button>

        {loading && <Loader2 className="animate-spin text-cyan-500" size={14} />}
        {lastFetchAt && (
          <span className="text-[10px] text-slate-400 ml-auto">
            Atualizado às {lastFetchAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* Filtro multi-select de tags */}
      <GlassCard className="p-3">
        <div className="text-xs uppercase font-semibold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1">
          <Filter size={12} /> Filtrar por tag
        </div>
        <div className="flex flex-wrap gap-1.5">
          {AUTO_TAGS.map(tag => {
            const style = TAG_STYLE[tag]
            const count = stats.byTag.get(tag) ?? 0
            const selected = selectedTags.has(tag)
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1.5',
                  selected
                    ? `${style.bg} ${style.fg} border-current font-semibold`
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:border-slate-400',
                )}
              >
                <span>{style.emoji}</span>
                <span>{AUTO_TAG_LABELS[tag]}</span>
                <span className="opacity-60">·{count}</span>
              </button>
            )
          })}
        </div>
      </GlassCard>

      {/* Lista densa */}
      {error && (
        <div className="p-3 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300 text-sm">
          {error}
        </div>
      )}

      {events.length === 0 && !loading ? (
        <GlassCard className="p-8 text-center text-slate-500">
          {selectedTags.size > 0 || cameraFilter
            ? 'Nenhum evento com os filtros atuais no período.'
            : 'Nenhum evento no período. Aguardando atividade nas câmeras…'}
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100/60 dark:bg-slate-800/60 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold w-24">Horário</th>
                  <th className="px-3 py-2 text-left font-semibold">Câmera</th>
                  <th className="px-3 py-2 text-left font-semibold">Objeto</th>
                  <th className="px-3 py-2 text-right font-semibold w-16">Score</th>
                  <th className="px-3 py-2 text-right font-semibold w-20">Duração</th>
                  <th className="px-3 py-2 text-left font-semibold">Descrição IA · Tags</th>
                  <th className="px-3 py-2 text-center font-semibold w-12">Clip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                {events.map(evt => {
                  const camName = camMap.get(evt.cameraId) ?? `${evt.cameraId.slice(0, 8)}…`
                  const isExpanded = expandedId === evt.id
                  return (
                    <Fragment key={evt.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : evt.id)}
                        className={cn(
                          'cursor-pointer hover:bg-cyan-500/5 transition-colors',
                          isExpanded && 'bg-cyan-500/10',
                        )}
                      >
                        <td className="px-3 py-2 text-xs font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          <Clock size={10} className="inline mr-1 text-slate-400" />
                          {new Date(evt.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <CameraIcon size={11} className="shrink-0 text-slate-400" />
                            <span className="truncate max-w-[180px]" title={camName}>{camName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <span>{objectEmoji(evt.objectType)}</span>
                            <span className="font-mono text-slate-700 dark:text-slate-200">{evt.objectType}</span>
                            {evt.subLabel && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/15 text-purple-700 dark:text-purple-300 font-mono">
                                {evt.subLabel}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={cn('px-3 py-2 text-xs text-right font-mono', scoreClass(evt.topScore))}>
                          {evt.topScore != null ? `${(evt.topScore * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-right font-mono text-slate-600 dark:text-slate-300">
                          {formatDuration(evt.durationSec)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="flex flex-col gap-1">
                            {evt.description ? (
                              <div className="flex items-start gap-1.5 text-slate-700 dark:text-slate-200 leading-snug">
                                <MessageSquare size={11} className="shrink-0 mt-0.5 text-emerald-500" />
                                <span className={cn(isExpanded ? '' : 'line-clamp-2')}>{evt.description}</span>
                              </div>
                            ) : (
                              <span className="text-[10px] italic text-slate-400">aguardando descrição IA</span>
                            )}
                            {(evt.autoTags ?? []).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {(evt.autoTags ?? []).map(t => {
                                  const tag = t as AutoTag
                                  const style = TAG_STYLE[tag]
                                  if (!style) {
                                    return (
                                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600">
                                        {t}
                                      </span>
                                    )
                                  }
                                  return (
                                    <span
                                      key={t}
                                      className={cn('text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1', style.bg, style.fg)}
                                    >
                                      <span>{style.emoji}</span>
                                      <span>{AUTO_TAG_LABELS[tag]}</span>
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {evt.hasClip ? (
                            <PlayCircle size={18} className="inline text-cyan-500" />
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-cyan-500/5">
                          <td colSpan={7} className="px-3 py-3">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                              <div>
                                <div className="text-[10px] uppercase text-slate-500 mb-1">Metadados YOLO</div>
                                <dl className="space-y-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                                  <div>frames: {evt.frameCount}</div>
                                  <div>median score: {(evt.medianScore * 100).toFixed(1)}%</div>
                                  <div>bbox: ({evt.bestBboxX.toFixed(3)}, {evt.bestBboxY.toFixed(3)}) {evt.bestBboxW.toFixed(3)}×{evt.bestBboxH.toFixed(3)}</div>
                                  {evt.enteredZones.length > 0 && <div>zonas: {evt.enteredZones.join(', ')}</div>}
                                </dl>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase text-slate-500 mb-1">Janela</div>
                                <dl className="space-y-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                                  <div>início: {new Date(evt.startTime).toLocaleString('pt-BR')}</div>
                                  <div>fim: {evt.endTime ? new Date(evt.endTime).toLocaleString('pt-BR') : '—'}</div>
                                </dl>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase text-slate-500 mb-1">IDs</div>
                                <dl className="space-y-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all">
                                  <div>event: {evt.id}</div>
                                  <div>camera: {evt.cameraId}</div>
                                  {evt.reviewSegmentId && <div>segment: {evt.reviewSegmentId}</div>}
                                </dl>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  )
}
