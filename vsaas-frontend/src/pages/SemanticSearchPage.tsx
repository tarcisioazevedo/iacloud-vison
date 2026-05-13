import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Sparkles, Image as ImageIcon, Database, Upload, X,
  Camera, Clock, RefreshCw, Zap, Brain, FileText, Target,
  Wand2, Eye, ChevronRight,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { KpiCard } from '../components/cards/KpiCard'
import { semanticQuery, semanticImage, useSemanticStats } from '../api/client'
import { cn } from '../lib/utils'

// ──────────────────────────────────────────────────────────────
// Helpers

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

function formatRelative(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000) return 'agora'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}min`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / 86_400_000)}d`
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const res = r.result as string
      resolve(res.split(',')[1] ?? res)
    }
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

// ──────────────────────────────────────────────────────────────

export function SemanticSearchPage() {
  const [mode, setMode] = useState<'text' | 'image'>('text')
  const [query, setQuery] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [topK, setTopK] = useState(12)
  const [minScore, setMinScore] = useState(0.35)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<any[] | null>(null)
  const [queryTime, setQueryTime] = useState<number | null>(null)

  const { data: stats } = useSemanticStats()

  async function handleSearch() {
    if (mode === 'text' && !query.trim()) return
    if (mode === 'image' && !imageFile) return
    setLoading(true)
    setResults(null)
    const start = Date.now()
    try {
      let res: any
      if (mode === 'text') {
        res = await semanticQuery({ query: query.trim(), topK, minScore })
      } else {
        const b64 = await fileToBase64(imageFile!)
        res = await semanticImage({ imageBase64: b64, topK, minScore })
      }
      setQueryTime(Date.now() - start)
      setResults(res.results ?? res.matches ?? res.items ?? [])
    } catch (err: any) {
      alert('Erro: ' + (err.response?.data?.error ?? err.message))
    } finally {
      setLoading(false)
    }
  }

  function handleImageFile(f: File) {
    setImageFile(f)
    setImagePreview(URL.createObjectURL(f))
    setResults(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Brain className="w-6 h-6 text-violet-600 dark:text-violet-400" />
            Busca Semântica
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gradient-to-r from-violet-500/20 to-cyan-500/20 border border-violet-500/30 text-violet-700 dark:text-violet-300 ml-2">
              Vertex multimodal 1408D
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Busque por texto ("homem de capacete amarelo") ou imagem similar
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          title="Itens indexados"
          value={stats?.totalEmbeddings ?? 0}
          icon={<Database />}
          accent="violet"
          delay={0.0}
        />
        <KpiCard
          title="Câmeras cobertas"
          value={stats?.camerasIndexed ?? 0}
          icon={<Camera />}
          accent="cyan"
          delay={0.1}
        />
        <KpiCard
          title="Índice atualizado"
          value={stats?.last24h ?? 0}
          subtitle="últimas 24h"
          icon={<Zap />}
          accent="emerald"
          delay={0.2}
        />
        <KpiCard
          title="Dimensões"
          value={stats?.vectorDim ?? 1408}
          subtitle="L2-normalizado"
          icon={<Sparkles />}
          accent="amber"
          delay={0.3}
        />
      </div>

      {/* Search box */}
      <GlassCard className="p-5" glow="violet">
        {/* Mode toggle */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setMode('text')}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition',
              mode === 'text'
                ? 'bg-violet-500/20 border-violet-500/40 text-violet-700 dark:text-violet-300'
                : 'bg-slate-100 dark:bg-space-800/40 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
            )}
          >
            <FileText className="w-3.5 h-3.5" />
            Texto
          </button>
          <button
            onClick={() => setMode('image')}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition',
              mode === 'image'
                ? 'bg-violet-500/20 border-violet-500/40 text-violet-700 dark:text-violet-300'
                : 'bg-slate-100 dark:bg-space-800/40 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
            )}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Imagem
          </button>
        </div>

        {mode === 'text' ? (
          <div className="space-y-3">
            <div className="relative">
              <Wand2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-violet-400" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Descreva o que você procura em linguagem natural..."
                className="w-full pl-12 pr-32 py-4 rounded-xl bg-slate-50 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 text-base text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-violet-500/50 focus:outline-none"
              />
              <button
                onClick={handleSearch}
                disabled={loading || !query.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-sm font-semibold shadow-violet-glow disabled:opacity-50 hover:opacity-90 transition"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar
              </button>
            </div>

            {/* Suggestions */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Sugestões:</span>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => { setQuery(s); }}
                  className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 text-[10px] text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-300 hover:border-violet-500/30 transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-5">
            {imagePreview ? (
              <div className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
                <img src={imagePreview} className="w-full h-full object-cover" />
                <button
                  onClick={() => { setImageFile(null); setImagePreview(null); setResults(null) }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-rose-500/80 text-white hover:bg-rose-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center aspect-square rounded-xl border border-dashed border-slate-300 dark:border-white/15 text-slate-500 hover:text-slate-700 dark:hover:text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-white/30 cursor-pointer transition">
                <Upload className="w-8 h-8 mb-2" />
                <span className="text-xs font-medium">Selecione uma imagem</span>
                <span className="text-[9px] mt-1 opacity-60">JPG / PNG · similaridade visual</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }}
                  className="hidden"
                />
              </label>
            )}
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/15">
                <p className="text-xs font-medium text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Como funciona
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  A imagem é vetorizada pelo Vertex AI multimodal embedding (1408D). Comparamos com
                  todo o catálogo indexado via cosine similarity para encontrar cenas visualmente
                  similares.
                </p>
              </div>
              <button
                onClick={handleSearch}
                disabled={loading || !imageFile}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-sm font-semibold shadow-violet-glow disabled:opacity-50 hover:opacity-90 transition"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                Buscar similares
              </button>
            </div>
          </div>
        )}

        {/* Advanced controls */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5 grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              Top K <span className="text-violet-600 dark:text-violet-400 font-mono">{topK}</span>
            </label>
            <input
              type="range" min={4} max={50} value={topK}
              onChange={e => setTopK(Number(e.target.value))}
              className="w-full mt-1 accent-violet-500"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              Score mínimo <span className="text-violet-600 dark:text-violet-400 font-mono">{minScore.toFixed(2)}</span>
            </label>
            <input
              type="range" min={0.2} max={0.9} step={0.01} value={minScore}
              onChange={e => setMinScore(Number(e.target.value))}
              className="w-full mt-1 accent-violet-500"
            />
          </div>
        </div>
      </GlassCard>

      {/* Query meta */}
      {queryTime !== null && results && (
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            {results.length} resultados em {queryTime}ms
          </span>
          {mode === 'text' && query && (
            <span>Query: <span className="text-slate-700 dark:text-slate-300 font-medium">"{query}"</span></span>
          )}
        </div>
      )}

      {/* Results */}
      {loading && (
        <GlassCard className="p-12 text-center">
          <div className="inline-flex items-center gap-2 text-violet-600 dark:text-violet-300">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-sm">Vetorizando e buscando matches...</span>
          </div>
        </GlassCard>
      )}

      {!loading && results && results.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Search className="w-12 h-12 mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum resultado acima do score mínimo</p>
          <p className="text-xs text-slate-500 mt-1">Tente reduzir o score mínimo ou usar termos mais amplos</p>
        </GlassCard>
      )}

      {!loading && results && results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <AnimatePresence>
            {results.map((r: any, idx: number) => (
              <ResultCard key={r.id ?? idx} result={r} delay={idx * 0.03} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {!loading && !results && (
        <GlassCard className="p-12 text-center">
          <Brain className="w-16 h-16 mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">Pronto para buscar</p>
          <p className="text-xs text-slate-500 mt-1">Digite uma descrição ou envie uma imagem para começar</p>
        </GlassCard>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Result card

function ResultCard({ result, delay }: { result: any; delay: number }) {
  const score = result.score ?? result.similarity ?? 0
  const pct = Math.round(score * 100)
  const thumbUrl = result.thumbnailUrl ?? result.imageUrl

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: Math.min(delay, 0.4) }}
    >
      <GlassCard className="overflow-hidden group" hover>
        <div className="relative aspect-video bg-space-800">
          {thumbUrl ? (
            <img src={thumbUrl} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-600">
              <ImageIcon className="w-8 h-8" />
            </div>
          )}

          {/* Score badge */}
          <div className={cn(
            'absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold font-mono backdrop-blur-sm',
            pct >= 75 ? 'bg-emerald-500/80 text-white' :
            pct >= 55 ? 'bg-violet-500/80 text-white' :
            'bg-amber-500/80 text-white',
          )}>
            {pct}%
          </div>

          {/* Play overlay */}
          {result.videoUrl && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/50">
              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                <Eye className="w-5 h-5 text-space-900" />
              </div>
            </div>
          )}
        </div>

        <div className="p-3">
          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
            {result.caption ?? result.title ?? result.label ?? 'Evento detectado'}
          </p>

          {result.objects && result.objects.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-1">
              {result.objects.slice(0, 3).map((o: string) => (
                <span key={o} className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300">
                  {o}
                </span>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
            {result.camera?.name && (
              <span className="flex items-center gap-1 truncate">
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
    </motion.div>
  )
}
