/**
 * Sprint U.1.2 — DemographicsPage (substitui placeholder)
 *
 * Renderiza distribuição de emoções dominantes e faixas etárias dos rostos
 * detectados (vem de AnalyticsEvent no backend).
 *
 * Endpoint GET /bi/demographics?days=N retorna:
 *   { emotions: [{emotion, count, pct}], ageRanges: [{range, count}], periodDays }
 *
 * Quando há módulo DEMOGRAPHICS habilitado, dados são reais; sem ele, o
 * gráfico fica com poucos pontos — copy explica.
 */
import { useMemo, useState } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { Users, Smile, AlertTriangle, Loader2, BarChart3 } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useDemographics, formatApiError } from '../api/client'
import { cn } from '../lib/utils'

const RANGES = [
  { days: 7,  label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
]

// Cores fixas por emoção (consistência visual entre páginas).
const EMOTION_COLORS: Record<string, string> = {
  happy:     '#22c55e',
  neutral:   '#94a3b8',
  surprise:  '#00C0D0',
  sad:       '#6366f1',
  angry:     '#ef4444',
  fear:      '#f59e0b',
  disgust:   '#a855f7',
  unknown:   '#475569',
}

const EMOTION_LABELS: Record<string, string> = {
  happy:    'Feliz',
  neutral:  'Neutro',
  surprise: 'Surpresa',
  sad:      'Triste',
  angry:    'Raiva',
  fear:     'Medo',
  disgust:  'Nojo',
}

// Ordena faixas etárias na ordem cronológica natural ao invés de alfabética.
const AGE_ORDER = ['0-12', '13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'unknown']

interface DemographicsResp {
  periodDays: number
  emotions: { emotion: string; count: number; pct: number }[]
  ageRanges: { range: string; count: number }[]
}

export function DemographicsPage() {
  const [days, setDays] = useState(30)
  const { data, error, isLoading } = useDemographics(days) as {
    data?: DemographicsResp; error?: any; isLoading: boolean
  }

  const emotions = data?.emotions ?? []
  const ageRanges = data?.ageRanges ?? []

  const totalFaces = useMemo(
    () => emotions.reduce((s, e) => s + e.count, 0),
    [emotions],
  )

  const dominantEmotion = useMemo(() => {
    if (emotions.length === 0) return null
    return [...emotions].sort((a, b) => b.count - a.count)[0]
  }, [emotions])

  const ageData = useMemo(() => {
    return [...ageRanges].sort((a, b) => {
      const ia = AGE_ORDER.indexOf(a.range)
      const ib = AGE_ORDER.indexOf(b.range)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
  }, [ageRanges])

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Demografia</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Análise demográfica agregada (<strong className="text-slate-900 dark:text-white">faixa etária</strong> e
                <strong className="text-slate-900 dark:text-white"> emoção dominante</strong>) dos rostos
                detectados pelo módulo de análise. Dados são <strong className="text-slate-900 dark:text-white">anônimos
                e agregados</strong> — nenhuma face individual é identificada nesta visão.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg p-1">
            {RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-semibold transition',
                  days === r.days
                    ? 'bg-violet-500/20 text-violet-700 dark:text-violet-200 border border-violet-500/30'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiTile
          icon={Users}
          label="Faces analisadas"
          value={totalFaces.toLocaleString('pt-BR')}
          loading={isLoading}
          accent="violet"
        />
        <KpiTile
          icon={Smile}
          label="Emoção dominante"
          value={dominantEmotion ? `${EMOTION_LABELS[dominantEmotion.emotion] ?? dominantEmotion.emotion} (${dominantEmotion.pct}%)` : '—'}
          loading={isLoading}
          accent="cyan"
        />
        <KpiTile
          icon={BarChart3}
          label="Faixas detectadas"
          value={String(ageRanges.length)}
          loading={isLoading}
          accent="emerald"
        />
      </div>

      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao carregar demografia</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {!error && totalFaces === 0 && !isLoading && (
        <GlassCard className="p-6 text-center text-sm text-slate-400">
          Sem dados demográficos no período. Verifique se o módulo
          <code className="px-1 mx-1 text-violet-600 dark:text-violet-300 bg-slate-100 dark:bg-white/5 rounded">DEMOGRAPHICS</code>
          está habilitado e se há câmeras enviando análise facial.
        </GlassCard>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pie de emoções */}
        <GlassCard className="p-4 md:p-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
            <Smile className="w-4 h-4 text-violet-500 dark:text-violet-400" />
            Distribuição de emoções
          </h2>
          {isLoading ? (
            <SkeletonChart />
          ) : emotions.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={emotions}
                  dataKey="count"
                  nameKey="emotion"
                  cx="50%" cy="50%"
                  innerRadius={50} outerRadius={95}
                  paddingAngle={2}
                  label={(entry: any) => `${entry.pct}%`}
                  labelLine={false}
                >
                  {emotions.map(e => (
                    <Cell key={e.emotion} fill={EMOTION_COLORS[e.emotion] ?? EMOTION_COLORS.unknown} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#0b1322', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: any, _name: string, props: any) => [
                    `${value} faces`,
                    EMOTION_LABELS[props.payload.emotion] ?? props.payload.emotion,
                  ]}
                />
                <Legend
                  formatter={(value: any) => <span style={{ color: '#94a3b8', fontSize: 10 }}>{EMOTION_LABELS[value] ?? value}</span>}
                  wrapperStyle={{ fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </GlassCard>

        {/* Barras de faixa etária */}
        <GlassCard className="p-4 md:p-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            Faixa etária
          </h2>
          {isLoading ? (
            <SkeletonChart />
          ) : ageData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={ageData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="range" stroke="#475569" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis stroke="#475569" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{ background: '#0b1322', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: any) => [`${value} faces`, 'Detecções']}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#00C0D0" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </GlassCard>
      </div>

      {/* Tabela de ranking */}
      {emotions.length > 0 && (
        <GlassCard className="p-4 md:p-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Ranking de emoções</h2>
          <div className="space-y-1.5">
            {[...emotions].sort((a, b) => b.count - a.count).map(e => (
              <div key={e.emotion} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: EMOTION_COLORS[e.emotion] ?? EMOTION_COLORS.unknown }} />
                <span className="text-xs text-slate-700 dark:text-slate-300 w-24">{EMOTION_LABELS[e.emotion] ?? e.emotion}</span>
                <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${e.pct}%`, background: EMOTION_COLORS[e.emotion] ?? EMOTION_COLORS.unknown }}
                  />
                </div>
                <span className="text-xs text-slate-500 font-mono w-16 text-right">{e.count.toLocaleString('pt-BR')}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono w-12 text-right">{e.pct}%</span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}

function KpiTile({
  icon: Icon, label, value, loading, accent,
}: { icon: any; label: string; value: string; loading?: boolean; accent: 'cyan' | 'violet' | 'emerald' }) {
  const colors = {
    cyan:    'text-cyan-600 dark:text-cyan-300',
    violet:  'text-violet-600 dark:text-violet-300',
    emerald: 'text-emerald-600 dark:text-emerald-300',
  }[accent]
  return (
    <GlassCard className="p-4">
      <div className={cn('flex items-center gap-2 text-[10px] uppercase tracking-wider', colors)}>
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-xl font-bold text-slate-900 dark:text-white truncate">
        {loading ? <Loader2 className="w-5 h-5 animate-spin inline" /> : value}
      </p>
    </GlassCard>
  )
}

function SkeletonChart() {
  return (
    <div className="h-[280px] flex items-center justify-center text-slate-600">
      <Loader2 className="w-6 h-6 animate-spin" />
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="h-[280px] flex items-center justify-center text-slate-600 text-xs">
      Sem dados no período.
    </div>
  )
}
