import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'
import { GlassCard } from '../cards/GlassCard'
import { useDemographics } from '../../api/client'
import { Users } from 'lucide-react'
import { EMOTION_CONFIG } from '../../lib/utils'
import { motion } from 'framer-motion'

// ── Donut customizado para gênero ─────────────────────────────────────────

function GenderDonut({ male, female, unknown = 0 }: { male: number; female: number; unknown?: number }) {
  // Distribuição real do AnalyticsEvent.gender ("MALE" | "FEMALE" | "UNKNOWN").
  // UNKNOWN entra no donut quando há volume relevante (>5%); abaixo disso é
  // ignorado para não poluir a visualização.
  const total = male + female + unknown || 1
  const mPct = Math.round((male / total) * 100)
  const fPct = Math.round((female / total) * 100)
  const uPct = Math.max(0, 100 - mPct - fPct)
  const data = [
    { name: 'Masculino', value: mPct, color: '#00C0D0' },
    { name: 'Feminino',  value: fPct, color: '#8b5cf6' },
    ...(uPct > 5 ? [{ name: 'N/A', value: uPct, color: '#475569' }] : []),
  ]

  return (
    <div className="relative flex flex-col items-center">
      <div className="relative">
        <PieChart width={120} height={120}>
          <Pie
            data={data}
            cx="50%" cy="50%"
            innerRadius={40} outerRadius={55}
            startAngle={90} endAngle={-270}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} opacity={0.9} />
            ))}
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-slate-900 dark:text-white">{fPct}%</span>
          <span className="text-xs text-slate-500">♀</span>
        </div>
      </div>
      <div className="flex gap-3 mt-2">
        {data.map(d => (
          <div key={d.name} className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
            <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
            {d.name}: <span className="font-medium text-slate-900 dark:text-white">{d.value}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Emotion bar ────────────────────────────────────────────────────────────

function EmotionBar({ emotion, count, total }: { emotion: string; count: number; total: number }) {
  const cfg   = EMOTION_CONFIG[emotion] ?? { label: emotion, color: '#94a3b8', emoji: '❓' }
  const pct   = total ? Math.round((count / total) * 100) : 0

  return (
    <div className="flex items-center gap-3">
      <span className="text-lg w-7">{cfg.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between text-xs mb-1">
          <span className="font-medium text-slate-700 dark:text-slate-300">{cfg.label}</span>
          <span className="text-slate-500">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden bg-slate-200 dark:bg-white/5">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
            className="h-full rounded-full"
            style={{ background: cfg.color }}
          />
        </div>
      </div>
      <span className="text-xs w-10 text-right font-mono text-slate-500 dark:text-slate-500">{count}</span>
    </div>
  )
}

const AGE_COLORS = ['#00C0D0', '#22d3ee', '#8b5cf6', '#a78bfa', '#10b981', '#34d399']

export function DemographicsChart({ delay = 0 }: { delay?: number }) {
  const { data, isLoading } = useDemographics(30)

  const emotions: any[]  = data?.emotions  ?? []
  const ageRanges: any[] = data?.ageRanges ?? []
  const genders: any[]   = data?.genders   ?? []
  const totalEmotions    = emotions.reduce((s: number, e: any) => s + e.count, 0)

  // Distribuição real de gênero do AnalyticsEvent.gender (backend `/bi/demographics`).
  const maleCount    = genders.find((g: any) => g.gender === 'MALE')?.count    ?? 0
  const femaleCount  = genders.find((g: any) => g.gender === 'FEMALE')?.count  ?? 0
  const unknownCount = genders.find((g: any) => g.gender === 'UNKNOWN')?.count ?? 0

  return (
    <GlassCard delay={delay} className="p-5">
      <div className="flex items-center gap-2 mb-5">
        <Users className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Demografia Anonimizada</h3>
        <span className="ml-auto text-xs text-slate-500">30 dias</span>
      </div>

      {isLoading ? (
        <div className="h-48 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {/* Emoções */}
          <div className="space-y-3">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Sentimento</p>
            {emotions.slice(0, 4).map((e: any) => (
              <EmotionBar key={e.emotion} emotion={e.emotion} count={e.count} total={totalEmotions} />
            ))}
          </div>

          {/* Gênero + Faixa etária */}
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">Gênero</p>
              <GenderDonut male={maleCount} female={femaleCount} unknown={unknownCount} />
            </div>

            {ageRanges.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Faixa Etária</p>
                <ResponsiveContainer width="100%" height={80}>
                  <BarChart data={ageRanges} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
                    <XAxis dataKey="range" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ background: '#0a1628', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#94a3b8' }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {ageRanges.map((_: any, i: number) => (
                        <Cell key={i} fill={AGE_COLORS[i % AGE_COLORS.length]} opacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
    </GlassCard>
  )
}
