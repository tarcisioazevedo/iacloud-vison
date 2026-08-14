/**
 * SemanticSearchPage — busca por linguagem natural sobre eventos indexados.
 *
 * Pipeline:
 *   - Backend gera embedding (Gemini 768D) sobre descrição PT-BR do evento
 *   - Query texto → mesmo embedding → cosine similarity → top-K
 *   - Cards mostram thumb GCS (signed URL ~1h), score, caption, câmera, tempo
 *
 * Features premium:
 *   - URL state (?q=...&topK=...) — share/link permanente
 *   - Histórico das últimas 8 buscas (localStorage)
 *   - Filtros: câmera, janela temporal (24h/7d/30d/all), score, top-K
 *   - Click no card → navega pra /recordings com timestamp + cameraId
 *   - Botão "limpar" no input
 *   - Empty state friendly + skeleton no loading
 *
 * A aba "Imagem" está temporariamente escondida — pipeline multimodal
 * (Vertex 1408D) não está alinhado com o índice atual (Gemini 768D).
 * Quando o ingest passar a gravar 1408D também, reabilitar.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Sparkles, Database, X,
  Camera, Clock, RefreshCw, Zap, Brain,
  Wand2, Eye, History, Filter, ChevronDown,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { KpiCard } from '../components/cards/KpiCard'
import {
  semanticQuery, useSemanticStats, useCameras,
  type SemanticMatch, type SemanticQueryBody,
} from '../api/client'
import { cn } from '../lib/utils'
import { useUiToast } from '../components/Toast'

// ──────────────────────────────────────────────────────────────
// Constantes

const SUGGESTIONS = [
  'pessoa usando capacete amarelo',
  'carro vermelho estacionado',
  'porta aberta à noite',
  'pessoa correndo na calçada',
  'caminhão branco de carga',
  'grupo de pessoas aglomeradas',
  'pessoa de uniforme azul',
  'cachorro solto na rua',
]

const HISTORY_KEY = 'icv_semantic_history_v1'
const HISTORY_MAX = 8

type Window = '24h' | '7d' | '30d' | 'all'
const WINDOW_LABEL: Record<Window, string> = {
  '24h': 'Últimas 24h',
  '7d':  'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  'all': 'Tudo',
}

// ──────────────────────────────────────────────────────────────
// Helpers

function formatRelative(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 0) return 'agora'
  if (d < 60_000) return 'agora'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}min`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  const days = Math.floor(d / 86_400_000)
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mes`
  return `${Math.floor(days / 365)}a`
}

function windowToSince(w: Window): string | undefined {
  if (w === 'all') return undefined
  const ms = w === '24h' ? 86_400_000 : w === '7d' ? 7 * 86_400_000 : 30 * 86_400_000
  return new Date(Date.now() - ms).toISOString()
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : []
  } catch { return [] }
}

function saveHistory(q: string) {
  try {
    const cur = loadHistory().filter(x => x !== q)
    cur.unshift(q)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(cur.slice(0, HISTORY_MAX)))
  } catch { /* ignore */ }
}

// ──────────────────────────────────────────────────────────────

export function SemanticSearchPage() {
  const toast = useUiToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [query,    setQuery]    = useState(() => searchParams.get('q') ?? '')
  const [topK,     setTopK]     = useState(() => Number(searchParams.get('k')) || 12)
  const [minScore, setMinScore] = useState(() => Number(searchParams.get('s')) || 0.35)
  const [windowF,  setWindowF]  = useState<Window>(() => (searchParams.get('w') as Window) || '7d')
  const [cameraF,  setCameraF]  = useState<string>(() => searchParams.get('cam') ?? '')
  const [showFilters, setShowFilters] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const [loading,  setLoading]  = useState(false)
  const [results,  setResults]  = useState<SemanticMatch[] | null>(null)
  const [queryTime, setQueryTime] = useState<number | null>(null)
  const [history, setHistory] = useState<string[]>(() => loadHistory())

  const { data: stats } = useSemanticStats()
  const { data: cameraData } = useCameras()
  const cameras = useMemo(
    () => (cameraData?.cameras ?? cameraData?.items ?? cameraData ?? []) as Array<{ id: string; name: string }>,
    [cameraData],
  )

  const handleSearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim()
    if (!q) return
    setLoading(true)
    setResults(null)
    setShowHistory(false)

    // Persiste estado na URL (link compartilhável)
    const sp = new URLSearchParams()
    sp.set('q', q)
    if (topK !== 12)        sp.set('k', String(topK))
    if (minScore !== 0.35)  sp.set('s', String(minScore))
    if (windowF !== '7d')   sp.set('w', windowF)
    if (cameraF)            sp.set('cam', cameraF)
    setSearchParams(sp, { replace: true })

    const since = windowToSince(windowF)
    const body: SemanticQueryBody = { query: q, topK, minScore }
    if (cameraF) body.cameraId = cameraF
    if (since)   body.since    = since

    const start = Date.now()
    try {
      const res = await semanticQuery(body)
      setQueryTime(Date.now() - start)
      setResults(res.matches ?? [])
      // Atualiza histórico só com queries que retornaram alguma coisa
      saveHistory(q)
      setHistory(loadHistory())
    } catch (err: any) {
      const code = err.response?.data?.error
      const msg  = err.response?.data?.message ?? err.message
      if (code === 'rate_limited') toast.error('Muitas buscas — aguarde 1 minuto')
      else if (code === 'subscription_required') toast.error('Esse recurso requer assinatura ativa')
      else toast.error('Erro na busca: ' + msg)
    } finally {
      setLoading(false)
    }
  }, [query, topK, minScore, windowF, cameraF, setSearchParams, toast])

  // Auto-busca se já vier ?q= na URL (deep-link / refresh)
  useEffect(() => {
    const q = searchParams.get('q')
    if (q && !results && !loading) handleSearch(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleResultClick(m: SemanticMatch) {
    // Abre a gravação com timestamp ~5s antes do evento, mesmo cameraId
    const t = new Date(new Date(m.capturedAt).getTime() - 5_000).toISOString()
    navigate(`/recordings?camera=${m.cameraId}&t=${encodeURIComponent(t)}`)
  }

  function clearQuery() {
    setQuery('')
    setResults(null)
    setQueryTime(null)
    setSearchParams({}, { replace: true })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Brain className="w-6 h-6 text-violet-600 dark:text-violet-400" />
            Busca Semântica
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gradient-to-r from-violet-500/20 to-cyan-500/20 border border-violet-500/30 text-violet-700 dark:text-violet-300 ml-2">
              Gemini · {stats?.vectorDim ?? 768}D
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Procure em vídeos por descrição em linguagem natural — "homem de capacete amarelo", "carro vermelho parado"
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="Itens indexados" value={stats?.totalEmbeddings ?? 0} icon={<Database />} accent="violet" delay={0.0} />
        <KpiCard title="Câmeras cobertas" value={stats?.camerasIndexed ?? 0} icon={<Camera />} accent="cyan"   delay={0.1} />
        <KpiCard title="Novos (24h)"      value={stats?.last24h ?? 0}        subtitle="últimas 24h" icon={<Zap />}    accent="emerald" delay={0.2} />
        <KpiCard title="Dimensões"        value={stats?.vectorDim ?? 768}    subtitle="L2-normalizado" icon={<Sparkles />} accent="amber" delay={0.3} />
      </div>

      {/* Search box */}
      <GlassCard className="p-5" glow="violet">
        <div className="space-y-3">
          <div className="relative">
            <Wand2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-violet-400 pointer-events-none" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSearch()
                if (e.key === 'Escape') clearQuery()
              }}
              onFocus={() => setShowHistory(history.length > 0)}
              placeholder="Descreva o que você procura em linguagem natural..."
              className="w-full pl-12 pr-44 py-4 rounded-xl bg-slate-50 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 text-base text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-violet-500/50 focus:outline-none"
            />

            {/* Botão limpar */}
            {query && (
              <button
                onClick={clearQuery}
                aria-label="Limpar busca"
                className="absolute right-32 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-sm font-semibold shadow-violet-glow disabled:opacity-50 hover:opacity-90 transition"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>

            {/* Dropdown de histórico */}
            <AnimatePresence>
              {showHistory && history.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100 dark:border-white/5">
                    <History className="w-3 h-3" /> Buscas recentes
                  </div>
                  {history.map(h => (
                    <button
                      key={h}
                      onClick={() => { setQuery(h); handleSearch(h) }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 truncate"
                    >
                      {h}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Suggestions */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Sugestões:</span>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => { setQuery(s); handleSearch(s) }}
                className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 text-[10px] text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-300 hover:border-violet-500/30 transition"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Botão filtros avançados */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5">
          <button
            onClick={() => setShowFilters(v => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            <Filter className="w-3.5 h-3.5" />
            Filtros avançados
            <ChevronDown className={cn('w-3.5 h-3.5 transition', showFilters && 'rotate-180')} />
          </button>

          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                  {/* Câmera */}
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Câmera</label>
                    <select
                      value={cameraF}
                      onChange={e => setCameraF(e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:border-violet-500/50 focus:outline-none"
                    >
                      <option value="">Todas</option>
                      {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  {/* Janela temporal */}
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Período</label>
                    <select
                      value={windowF}
                      onChange={e => setWindowF(e.target.value as Window)}
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:border-violet-500/50 focus:outline-none"
                    >
                      {(Object.keys(WINDOW_LABEL) as Window[]).map(w => (
                        <option key={w} value={w}>{WINDOW_LABEL[w]}</option>
                      ))}
                    </select>
                  </div>
                  {/* Top-K */}
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                      Top K <span className="text-violet-600 dark:text-violet-400 font-mono">{topK}</span>
                    </label>
                    <input
                      type="range" min={4} max={50} value={topK}
                      onChange={e => setTopK(Number(e.target.value))}
                      className="w-full mt-2 accent-violet-500"
                    />
                  </div>
                  {/* Score mínimo */}
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                      Score mínimo <span className="text-violet-600 dark:text-violet-400 font-mono">{minScore.toFixed(2)}</span>
                    </label>
                    <input
                      type="range" min={0.2} max={0.9} step={0.01} value={minScore}
                      onChange={e => setMinScore(Number(e.target.value))}
                      className="w-full mt-2 accent-violet-500"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </GlassCard>

      {/* Query meta */}
      {queryTime !== null && results && (
        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
          <span className="flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            {results.length} {results.length === 1 ? 'resultado' : 'resultados'} em {queryTime}ms
          </span>
          {query && (
            <span>Query: <span className="text-slate-700 dark:text-slate-300 font-medium">"{query}"</span></span>
          )}
          {cameraF && (
            <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-700 dark:text-cyan-300">
              {cameras.find(c => c.id === cameraF)?.name ?? 'câmera'}
            </span>
          )}
          {windowF !== 'all' && (
            <span className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300">
              {WINDOW_LABEL[windowF]}
            </span>
          )}
        </div>
      )}

      {/* Resultados — loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-slate-100 dark:bg-space-800/40 border border-slate-200 dark:border-white/5 overflow-hidden animate-pulse">
              <div className="aspect-video bg-slate-200 dark:bg-space-800/60" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-slate-200 dark:bg-space-800/60 rounded w-3/4" />
                <div className="h-2 bg-slate-200 dark:bg-space-800/60 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resultados — vazio */}
      {!loading && results && results.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Search className="w-12 h-12 mx-auto text-slate-500 mb-3" />
          <p className="text-sm text-slate-700 dark:text-slate-300 font-semibold">Nenhum resultado acima do score mínimo</p>
          <p className="text-xs text-slate-500 mt-1">Tente reduzir o score mínimo, ampliar o período ou usar termos mais amplos</p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            <button onClick={() => setMinScore(Math.max(0.2, minScore - 0.1))}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 hover:border-violet-500/40">
              Score → {Math.max(0.2, minScore - 0.1).toFixed(2)}
            </button>
            <button onClick={() => { setWindowF('all'); handleSearch() }}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 hover:border-violet-500/40">
              Período: tudo
            </button>
          </div>
        </GlassCard>
      )}

      {/* Resultados — grid */}
      {!loading && results && results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <AnimatePresence>
            {results.map((r, idx) => (
              <ResultCard key={r.id} result={r} delay={idx * 0.03} onClick={() => handleResultClick(r)} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Empty state inicial */}
      {!loading && !results && (
        <GlassCard className="p-12 text-center">
          <Brain className="w-16 h-16 mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-700 dark:text-slate-300 font-semibold">Pronto para buscar</p>
          <p className="text-xs text-slate-500 mt-1">Digite uma descrição ou escolha uma sugestão acima</p>
        </GlassCard>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Result card

function ResultCard({
  result, delay, onClick,
}: { result: SemanticMatch; delay: number; onClick: () => void }) {
  const score = result.score ?? 0
  const pct = Math.round(score * 100)
  const thumb = result.thumbnailUrl

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: Math.min(delay, 0.4) }}
      className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 rounded-2xl"
      aria-label={`Abrir gravação — ${result.caption ?? 'evento'}`}
    >
      <GlassCard className="overflow-hidden group cursor-pointer transition hover:scale-[1.01]" hover>
        <div className="relative aspect-video bg-slate-200 dark:bg-space-800">
          {thumb ? (
            <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 gap-1">
              <Camera className="w-7 h-7" />
              <span className="text-[9px] uppercase tracking-wider">sem thumb</span>
            </div>
          )}

          {/* Score badge */}
          <div className={cn(
            'absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold font-mono backdrop-blur-sm shadow',
            pct >= 75 ? 'bg-emerald-500/85 text-white' :
            pct >= 55 ? 'bg-violet-500/85 text-white' :
                        'bg-amber-500/85 text-white',
          )}>
            {pct}%
          </div>

          {/* Play overlay (hover) */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/45">
            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <Eye className="w-5 h-5 text-space-900" />
            </div>
          </div>
        </div>

        <div className="p-3">
          <p
            className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-2"
            title={result.caption ?? undefined}
          >
            {result.caption ?? 'Evento detectado'}
          </p>

          {result.tags && result.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-1.5">
              {result.tags.slice(0, 3).map(t => (
                <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
            {result.camera?.name && (
              <span className="flex items-center gap-1 truncate min-w-0">
                <Camera className="w-3 h-3 shrink-0" />
                <span className="truncate">{result.camera.name}</span>
              </span>
            )}
            {result.capturedAt && (
              <span className="flex items-center gap-1 shrink-0">
                <Clock className="w-3 h-3" />
                {formatRelative(result.capturedAt)}
              </span>
            )}
          </div>
        </div>
      </GlassCard>
    </motion.button>
  )
}

export default SemanticSearchPage
