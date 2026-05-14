/**
 * MotionSearchPage — Pesquisa de movimento por zona em gravações.
 *
 * Estratégia (Alt 3 do plano): usa DetectionFrame (bounding boxes pré-indexadas
 * pelo edge) + interseção de zona desenhada no canvas → query SQL em ms.
 *
 * UX:
 *  1. Usuário escolhe câmera + período
 *  2. Carrega último snapshot da câmera como background
 *  3. Desenha zona(s) retangular(es) clicando+arrastando
 *  4. Filtros opcionais: tipos de objeto (person/car/animal/etc)
 *  5. Click "Buscar" → chama POST /detections/zone-search
 *  6. Resultados: lista de timestamps com bbox preview, click → abre player no momento
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search, Loader2, Camera, AlertCircle, Trash2, Square, X, Play, Tag,
} from 'lucide-react'
import {
  useCameras, searchMotionInZones, BASE_URL, formatApiError,
  listReviewSegments, eventClipM3u8Url,
  type DetectionZone, type DetectionFrameRow,
  type ReviewSegmentRow,
} from '../api/client'
import { LivePlayer } from '../components/player/LivePlayer'

const OBJECT_TYPES = ['person', 'car', 'truck', 'motorcycle', 'bicycle', 'animal', 'dog', 'cat'] as const

interface Zone extends DetectionZone {
  id: string
  color: string
}

export function MotionSearchPage() {
  const { data: camerasData } = useCameras({ limit: '100' })
  const cameras: Array<{ id: string; name: string }> = camerasData?.cameras ?? []

  const [params] = useSearchParams()
  const [cameraId, setCameraId] = useState<string>(params.get('cameraId') ?? '')
  const [from, setFrom] = useState<string>(() => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return d.toISOString().slice(0, 16)
  })
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 16))
  const [objectTypes, setObjectTypes] = useState<Set<string>>(new Set(['person']))
  const [zones, setZones] = useState<Zone[]>([])
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<DetectionFrameRow[]>([])
  const [error, setError] = useState<string | null>(null)

  // ── Review Segments (auto-agrupados via worker tracking + ReviewMaintainer) ──
  const [segments, setSegments] = useState<ReviewSegmentRow[]>([])
  const [loadingSegments, setLoadingSegments] = useState(false)
  useEffect(() => {
    if (!cameraId) { setSegments([]); return }
    setLoadingSegments(true)
    listReviewSegments({
      cameraId,
      from: new Date(from),
      to:   new Date(to),
      limit: 50,
    })
      .then(r => setSegments(r.segments))
      .catch(() => setSegments([]))
      .finally(() => setLoadingSegments(false))
  }, [cameraId, from, to])

  // Drawing state
  const canvasRef = useRef<HTMLDivElement>(null)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)

  const snapshotUrl = cameraId ? `${BASE_URL}/cameras/${cameraId}/snapshot` : ''

  function toggleObjectType(t: string) {
    setObjectTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  // ── Drawing zones on canvas ──

  function handleMouseDown(e: React.MouseEvent) {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top)  / rect.height
    setDrawStart({ x, y })
    setDrawCurrent({ x, y })
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!drawStart || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height))
    setDrawCurrent({ x, y })
  }

  function handleMouseUp() {
    if (!drawStart || !drawCurrent) return
    const x = Math.min(drawStart.x, drawCurrent.x)
    const y = Math.min(drawStart.y, drawCurrent.y)
    const w = Math.abs(drawCurrent.x - drawStart.x)
    const h = Math.abs(drawCurrent.y - drawStart.y)
    if (w > 0.02 && h > 0.02) {  // mínimo razoável (2% da imagem)
      setZones(prev => [...prev, {
        id: `zone-${Date.now()}`,
        x, y, w, h,
        color: COLORS[prev.length % COLORS.length],
      }])
    }
    setDrawStart(null)
    setDrawCurrent(null)
  }

  function removeZone(id: string) {
    setZones(prev => prev.filter(z => z.id !== id))
  }

  function clearZones() {
    setZones([])
  }

  // ── Search ──

  async function handleSearch() {
    if (!cameraId)       { setError('Selecione uma câmera'); return }
    if (zones.length === 0) { setError('Desenhe ao menos uma zona'); return }

    setSearching(true)
    setError(null)
    try {
      const resp = await searchMotionInZones({
        cameraId,
        from: new Date(from),
        to:   new Date(to),
        zones: zones.map(z => ({ x: z.x, y: z.y, w: z.w, h: z.h })),
        objectTypes: Array.from(objectTypes),
      })
      setResults(resp.detections)
      if (resp.detections.length === 0) {
        setError('Nenhum movimento encontrado nas zonas e período especificados')
      }
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSearching(false)
    }
  }

  // Live drawing rectangle preview
  const previewRect = drawStart && drawCurrent ? {
    x: Math.min(drawStart.x, drawCurrent.x),
    y: Math.min(drawStart.y, drawCurrent.y),
    w: Math.abs(drawCurrent.x - drawStart.x),
    h: Math.abs(drawCurrent.y - drawStart.y),
  } : null

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-space-950 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Search className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            Pesquisa de Movimento por Zona
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Desenhe áreas no frame da câmera para buscar momentos com objetos detectados naquelas zonas específicas.
          </p>
        </div>

        {/* Filtros */}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Câmera</span>
            <select
              value={cameraId}
              onChange={e => { setCameraId(e.target.value); setZones([]) }}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="">— Selecione —</option>
              {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">De</span>
            <input
              type="datetime-local"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Até</span>
            <input
              type="datetime-local"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
            />
          </label>
        </div>

        {/* Object types filter */}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3 flex flex-wrap items-center gap-2">
          <Tag className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Objetos:</span>
          {OBJECT_TYPES.map(t => (
            <button
              key={t}
              onClick={() => toggleObjectType(t)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition border ${
                objectTypes.has(t)
                  ? 'border-cyan-500 bg-cyan-500 text-white'
                  : 'border-slate-200 dark:border-white/10 text-slate-500 hover:border-cyan-400'
              }`}
            >
              {t}
            </button>
          ))}
          <span className="text-[10px] text-slate-400 ml-auto">
            {objectTypes.size === 0 ? 'Sem filtro (todos)' : `${objectTypes.size} tipo${objectTypes.size === 1 ? '' : 's'}`}
          </span>
        </div>

        {/* Canvas com snapshot + zonas */}
        {cameraId && (
          <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Square className="w-3.5 h-3.5" /> Zonas ({zones.length})
              </p>
              <div className="flex gap-2">
                {zones.length > 0 && (
                  <button
                    onClick={clearZones}
                    className="text-[11px] text-rose-500 hover:underline flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Limpar
                  </button>
                )}
                <span className="text-[10px] text-slate-400 italic">
                  Clique e arraste sobre a imagem
                </span>
              </div>
            </div>

            <div
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="relative w-full bg-black rounded-lg overflow-hidden cursor-crosshair select-none"
              style={{ aspectRatio: '16/9' }}
            >
              {/* Live WebRTC como referência visual — usuário desenha zonas
                  sobre o vídeo ao vivo, mesma escala dos frames analisados
                  pelo YOLO. pointer-events:none deixa os cliques passarem
                  para o wrapper que gerencia o desenho. */}
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

              {/* Zonas existentes */}
              {zones.map(z => (
                <div
                  key={z.id}
                  style={{
                    position: 'absolute',
                    left:    `${z.x * 100}%`,
                    top:     `${z.y * 100}%`,
                    width:   `${z.w * 100}%`,
                    height:  `${z.h * 100}%`,
                    borderColor: z.color,
                    backgroundColor: z.color + '33',
                  }}
                  className="border-2 group"
                >
                  <button
                    onClick={() => removeZone(z.id)}
                    className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {/* Preview do retângulo sendo desenhado */}
              {previewRect && (
                <div
                  style={{
                    position: 'absolute',
                    left:    `${previewRect.x * 100}%`,
                    top:     `${previewRect.y * 100}%`,
                    width:   `${previewRect.w * 100}%`,
                    height:  `${previewRect.h * 100}%`,
                  }}
                  className="border-2 border-cyan-400 bg-cyan-400/20 pointer-events-none"
                />
              )}
            </div>
          </div>
        )}

        {/* Botão buscar */}
        <button
          onClick={handleSearch}
          disabled={searching || !cameraId || zones.length === 0}
          className="w-full px-4 py-3 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
          {searching ? 'Buscando...' : `Buscar Movimento (${zones.length} zona${zones.length === 1 ? '' : 's'})`}
        </button>

        {error && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-300 text-sm p-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Resultados */}
        {results.length > 0 && (
          <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
              Resultados ({results.length} detecções)
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {results.slice(0, 100).map(r => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 dark:border-white/10 hover:border-cyan-400 transition cursor-pointer"
                >
                  <div className="w-1 h-8 rounded-full" style={{ backgroundColor: '#06B6D4' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-slate-700 dark:text-slate-300">
                      {new Date(r.timestamp).toLocaleString('pt-BR')}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {r.objectType} · bbox ({(r.bboxX * 100).toFixed(0)}%, {(r.bboxY * 100).toFixed(0)}%)
                      {r.confidence != null && ` · ${(r.confidence * 100).toFixed(0)}% conf`}
                    </p>
                  </div>
                  <a
                    href={`/recordings?cameraId=${cameraId}&at=${encodeURIComponent(r.timestamp)}`}
                    className="px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 text-[11px] flex items-center gap-1 hover:bg-cyan-500/20"
                  >
                    <Play className="w-3 h-3" /> Ver
                  </a>
                </div>
              ))}
              {results.length > 100 && (
                <p className="text-[11px] text-slate-400 text-center pt-2">
                  ...mostrando primeiros 100 de {results.length}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Review Segments (auto-agrupados, severity por label) ─────── */}
        {cameraId && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.03] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Eventos IA agrupados <span className="text-[10px] font-normal text-slate-400">(novo · Frigate-style)</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Tracks confirmados pelo worker, agrupados em segmentos por severity. Click pra abrir o clip exato.
                </p>
              </div>
              {loadingSegments && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
            </div>

            {!loadingSegments && segments.length === 0 && (
              <p className="text-[11px] text-slate-500 italic text-center py-3">
                Nenhum segmento ainda. Eventos aparecem aqui conforme o worker detecta objetos
                e o EventMaintainer agrupa tracks (~1 minuto após detecção).
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {segments.map(s => {
                const isAlert = s.severity === 'ALERT'
                const duration = s.endTime
                  ? Math.round((+new Date(s.endTime) - +new Date(s.startTime)) / 1000)
                  : null
                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border p-2 text-xs space-y-1 ${
                      isAlert
                        ? 'border-rose-500/40 bg-rose-500/5'
                        : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isAlert
                          ? 'bg-rose-500 text-white'
                          : 'bg-slate-300 dark:bg-white/10 text-slate-700 dark:text-slate-300'
                      }`}>
                        {s.severity}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {new Date(s.startTime).toLocaleString('pt-BR')}
                        {duration != null && ` · ${duration}s`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {s.labels.map(l => (
                        <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                          {l}
                        </span>
                      ))}
                    </div>
                    {s.events.length > 0 && (
                      <div className="pt-1 border-t border-slate-200 dark:border-white/10 space-y-0.5">
                        {s.events.slice(0, 3).map(e => (
                          <a
                            key={e.id}
                            href={eventClipM3u8Url(e.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400"
                          >
                            <span className="font-mono">
                              {new Date(e.startTime).toLocaleTimeString('pt-BR')} · {e.objectType}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="text-emerald-500">
                                {Math.round(e.topScore * 100)}%
                              </span>
                              <Play className="w-3 h-3" />
                            </span>
                          </a>
                        ))}
                        {s.events.length > 3 && (
                          <p className="text-[10px] text-slate-400 italic">+{s.events.length - 3} mais</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const COLORS = ['#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#10B981', '#EC4899']
