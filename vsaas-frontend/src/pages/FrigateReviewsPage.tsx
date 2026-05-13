/**
 * FrigateReviewsPage — painel de alertas Frigate vindos do Edge Box.
 *
 * Backend já enviava reviews via POST /iacv-box/review-segments e POST
 * /iacv-box/:nodeId/review-events, mas não havia UI consumindo o GET
 * /iacv-box/reviews. Resultado: feature inteira cega para o operador.
 *
 * Severities (FrigateReviewSeverity):
 *   - ALERT       — alta relevância, exige atenção imediata
 *   - DETECTION   — informativa, entra no review silencioso
 *   - SIGNIFICANT — movimento sem objeto classificado
 *
 * Marcar como revisado:
 *   - Atualiza FrigateReview.hasBeenReviewed=true (Cloud-side)
 *   - Enfileira EdgeCommand MARK_REVIEWED → Box propaga ao Frigate
 *
 * RBAC: SUPER_ADMIN vê tudo; INTEGRADOR_ADMIN só do próprio integradorId
 * (backend força via tenant scope no JWT).
 */
import { useMemo, useState } from 'react'
import {
  Loader2, AlertTriangle, Bell, Eye, EyeOff, CheckCircle2, Clock,
  Camera as CameraIcon, Cpu, RefreshCw, Filter, Sparkles,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PremiumHero } from '../components/hierarchy'
import {
  useFrigateReviews, markFrigateReviewsViewed, formatApiError,
  type FrigateReviewRow, type FrigateReviewSeverity,
} from '../api/client'
import { cn } from '../lib/utils'

const SEVERITY_META: Record<FrigateReviewSeverity, {
  label: string; color: string; bg: string; border: string; emoji: string
}> = {
  ALERT: {
    label: 'Alerta',
    emoji: '🚨',
    color: 'text-rose-700 dark:text-rose-300',
    bg:    'bg-rose-500/10',
    border:'border-rose-500/40',
  },
  DETECTION: {
    label: 'Detecção',
    emoji: '👁️',
    color: 'text-cyan-700 dark:text-cyan-300',
    bg:    'bg-cyan-500/10',
    border:'border-cyan-500/40',
  },
  SIGNIFICANT: {
    label: 'Movimento',
    emoji: '🔔',
    color: 'text-amber-700 dark:text-amber-300',
    bg:    'bg-amber-500/10',
    border:'border-amber-500/40',
  },
}

const THREAT_LEVEL_LABEL = ['baixo', 'médio', 'alto', 'crítico']

export function FrigateReviewsPage() {
  const [severity, setSeverity] = useState<FrigateReviewSeverity | ''>('')
  const [showReviewed, setShowReviewed] = useState(false)
  const [windowHours, setWindowHours] = useState(48)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const since = useMemo(
    () => new Date(Date.now() - windowHours * 3600 * 1000).toISOString(),
    [windowHours],
  )

  const { data, error: apiError, isLoading, mutate } = useFrigateReviews({
    severity: severity || undefined,
    hasBeenReviewed: showReviewed ? undefined : false,
    since,
    limit: 200,
  })

  const reviews = data?.reviews ?? []

  const stats = useMemo(() => {
    const r = reviews
    return {
      total:       r.length,
      alert:       r.filter(x => x.severity === 'ALERT' && !x.hasBeenReviewed).length,
      detection:   r.filter(x => x.severity === 'DETECTION' && !x.hasBeenReviewed).length,
      significant: r.filter(x => x.severity === 'SIGNIFICANT' && !x.hasBeenReviewed).length,
      reviewed:    r.filter(x => x.hasBeenReviewed).length,
    }
  }, [reviews])

  // Agrupa por edgeNodeId (precisamos disso pra mark-reviewed que é por nodeId)
  const grouped = useMemo(() => {
    const by: Record<string, FrigateReviewRow[]> = {}
    for (const r of reviews) {
      if (!by[r.edgeNodeId]) by[r.edgeNodeId] = []
      by[r.edgeNodeId].push(r)
    }
    return by
  }, [reviews])

  function toggleSelected(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  function selectAllUnreviewed() {
    setSelected(new Set(reviews.filter(r => !r.hasBeenReviewed).map(r => r.id)))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  async function handleMarkReviewed() {
    if (selected.size === 0) return
    setMarking(true)
    setError(null)
    try {
      // Agrupa selecionados por edgeNodeId — endpoint é por nodeId
      const byNode: Record<string, string[]> = {}
      for (const r of reviews) {
        if (!selected.has(r.id)) continue
        if (!byNode[r.edgeNodeId]) byNode[r.edgeNodeId] = []
        byNode[r.edgeNodeId].push(r.frigateReviewId)
      }
      // Dispara em paralelo
      await Promise.all(
        Object.entries(byNode).map(([nodeId, ids]) =>
          markFrigateReviewsViewed(nodeId, ids),
        ),
      )
      clearSelection()
      await mutate()
    } catch (e: unknown) {
      setError(formatApiError(e))
    } finally {
      setMarking(false)
    }
  }

  return (
    <div className="space-y-4">
      <PremiumHero
        emoji="🚨"
        title="Alertas Frigate"
        subtitle={`${stats.total} eventos nas últimas ${windowHours}h · ${stats.alert} alertas pendentes`}
        accent={stats.alert > 0 ? 'rose' : 'violet'}
        tags={[
          { label: `${stats.alert} alertas`, color: 'rose' },
          { label: `${stats.detection} detecções`, color: 'cyan' },
          { label: `${stats.significant} movimentos`, color: 'amber' },
        ]}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => mutate()}
              className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-violet-500/50 text-sm text-white inline-flex items-center gap-1.5 transition"
              title="Atualizar"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} /> Atualizar
            </button>
            {selected.size > 0 && (
              <button
                onClick={handleMarkReviewed}
                disabled={marking}
                className="px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 hover:opacity-90 text-white text-sm font-bold shadow-lg shadow-emerald-500/20 inline-flex items-center gap-1.5 transition disabled:opacity-60"
              >
                {marking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Marcar {selected.size} como visto
              </button>
            )}
          </div>
        }
      />

      {/* Filtros */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-slate-500 mr-1">Severidade:</span>
          {(['ALERT', 'DETECTION', 'SIGNIFICANT'] as const).map(s => {
            const active = severity === s
            const meta = SEVERITY_META[s]
            return (
              <button
                key={s}
                onClick={() => setSeverity(active ? '' : s)}
                className={cn(
                  'px-2.5 py-0.5 rounded-full border transition',
                  active ? meta.color + ' ' + meta.bg + ' ' + meta.border : 'border-slate-300 dark:border-white/10 text-slate-500 hover:border-slate-400',
                )}
              >
                {meta.emoji} {meta.label}
              </button>
            )
          })}
          {severity && (
            <button onClick={() => setSeverity('')} className="text-[10px] text-slate-500 underline ml-1">
              limpar
            </button>
          )}

          <span className="text-slate-500 mx-2">·</span>
          <span className="text-slate-500 mr-1">Janela:</span>
          {[12, 24, 48, 168].map(h => (
            <button
              key={h}
              onClick={() => setWindowHours(h)}
              className={cn(
                'px-2 py-0.5 rounded-full border text-[10px] transition',
                windowHours === h
                  ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30'
                  : 'border-slate-300 dark:border-white/10 text-slate-500 hover:border-slate-400',
              )}
            >
              {h === 168 ? '7d' : `${h}h`}
            </button>
          ))}

          <span className="text-slate-500 mx-2">·</span>
          <button
            onClick={() => setShowReviewed(v => !v)}
            className={cn(
              'px-2.5 py-0.5 rounded-full border transition inline-flex items-center gap-1',
              showReviewed
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                : 'border-slate-300 dark:border-white/10 text-slate-500 hover:border-slate-400',
            )}
          >
            {showReviewed ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {showReviewed ? 'Mostrando vistos' : 'Esconder vistos'}
          </button>

          {reviews.filter(r => !r.hasBeenReviewed).length > 0 && (
            <>
              <span className="text-slate-500 mx-2">·</span>
              <button
                onClick={selectAllUnreviewed}
                className="text-[10px] text-violet-600 dark:text-violet-300 underline"
              >
                selecionar todos pendentes
              </button>
            </>
          )}
          {selected.size > 0 && (
            <button
              onClick={clearSelection}
              className="text-[10px] text-slate-500 underline ml-2"
            >
              limpar seleção ({selected.size})
            </button>
          )}
        </div>
      </GlassCard>

      {/* Erro */}
      {(error || apiError) && (
        <GlassCard className="p-4 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start gap-3 text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold">Erro ao carregar reviews</p>
              <p className="text-xs mt-1">{error ?? formatApiError(apiError)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Empty */}
      {!isLoading && reviews.length === 0 && !apiError && (
        <GlassCard className="p-12 text-center">
          <Bell className="w-10 h-10 text-slate-400 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">
            {showReviewed
              ? 'Nenhum review (visto ou pendente) nesta janela.'
              : 'Nenhum alerta pendente. Tudo revisado! 🎉'}
          </p>
        </GlassCard>
      )}

      {/* Loading */}
      {isLoading && reviews.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Loader2 className="w-6 h-6 text-violet-500 mx-auto animate-spin" />
          <p className="text-slate-500 text-sm mt-3">Carregando alertas…</p>
        </GlassCard>
      )}

      {/* Lista agrupada por Edge Box */}
      {Object.entries(grouped).map(([nodeId, nodeReviews]) => {
        const nodeName = nodeReviews[0]?.edgeNode.name ?? nodeId.slice(0, 8)
        return (
          <GlassCard key={nodeId} className="p-0 overflow-hidden">
            {/* Header do node */}
            <div className="px-4 py-2.5 bg-slate-100/60 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/5 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-sm font-bold text-slate-900 dark:text-white">{nodeName}</span>
              <span className="text-[10px] text-slate-500 font-mono">{nodeId.slice(0, 8)}…</span>
              <span className="text-[10px] text-slate-500 ml-auto">{nodeReviews.length} eventos</span>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-white/5">
              {nodeReviews.map(r => (
                <ReviewRow
                  key={r.id}
                  review={r}
                  selected={selected.has(r.id)}
                  onToggle={() => toggleSelected(r.id)}
                />
              ))}
            </div>
          </GlassCard>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function ReviewRow({
  review, selected, onToggle,
}: {
  review: FrigateReviewRow
  selected: boolean
  onToggle: () => void
}) {
  const meta = SEVERITY_META[review.severity]
  const started = new Date(review.startedAt)
  const ended = review.endedAt ? new Date(review.endedAt) : null
  const durationSec = ended ? Math.max(1, Math.round((ended.getTime() - started.getTime()) / 1000)) : null

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full px-4 py-3 flex items-start gap-3 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.02]',
        selected && 'bg-violet-500/5 dark:bg-violet-500/10',
        review.hasBeenReviewed && 'opacity-60',
      )}
    >
      {/* Checkbox */}
      <div
        className={cn(
          'mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition',
          selected
            ? 'bg-violet-500 border-violet-500'
            : 'border-slate-400 dark:border-slate-500',
          review.hasBeenReviewed && !selected && 'border-emerald-500/40 bg-emerald-500/10',
        )}
      >
        {selected && <CheckCircle2 className="w-3 h-3 text-white" />}
        {!selected && review.hasBeenReviewed && <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
      </div>

      {/* Severity badge */}
      <div className={cn(
        'w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 text-base',
        meta.bg, meta.border,
      )}>
        {meta.emoji}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-bold', meta.bg, meta.color, meta.border)}>
            {meta.label}
          </span>
          {review.objects.length > 0 && (
            <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
              {review.objects.join(' · ')}
            </span>
          )}
          {review.zones.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10">
              {review.zones.join(' · ')}
            </span>
          )}
          {review.genaiPotentialThreatLevel != null && review.genaiPotentialThreatLevel >= 2 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 inline-flex items-center gap-1 font-bold">
              <Sparkles className="w-2.5 h-2.5" />
              ameaça {THREAT_LEVEL_LABEL[review.genaiPotentialThreatLevel] ?? '?'}
            </span>
          )}
          {review.hasBeenReviewed && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
              ✓ visto
            </span>
          )}
        </div>

        {review.genaiTitle && (
          <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 font-medium">
            <Sparkles className="w-3 h-3 inline mr-1 text-violet-500" />
            {review.genaiTitle}
          </p>
        )}
        {review.genaiShortSummary && (
          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
            {review.genaiShortSummary}
          </p>
        )}

        <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
          <CameraIcon className="w-3 h-3" />
          <span>{review.camera.name}</span>
          {review.cameraFrigateName && review.cameraFrigateName !== review.camera.name && (
            <span className="font-mono opacity-60">({review.cameraFrigateName})</span>
          )}
          <span>·</span>
          <Clock className="w-3 h-3" />
          <span className="font-mono">
            {started.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}
          </span>
          {durationSec != null && (
            <>
              <span>·</span>
              <span>{durationSec >= 60 ? `${Math.round(durationSec / 60)}min` : `${durationSec}s`}</span>
            </>
          )}
          {review.cloudReviewedAt && (
            <>
              <span>·</span>
              <span className="text-emerald-600 dark:text-emerald-400">
                visto em {new Date(review.cloudReviewedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </>
          )}
        </div>
      </div>

      {/* GenAI confidence */}
      {review.genaiConfidence != null && (
        <div className="text-right text-[10px] text-slate-500 shrink-0">
          <div className="font-mono">{(parseFloat(review.genaiConfidence) * 100).toFixed(0)}%</div>
          <div className="text-slate-400 dark:text-slate-600">conf</div>
        </div>
      )}
    </button>
  )
}
