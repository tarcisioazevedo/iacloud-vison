import { Users, Clock, Smile, ShieldCheck, Eye, Zap } from 'lucide-react'
import { KpiCard } from '../components/cards/KpiCard'
import { FlowChart } from '../components/charts/FlowChart'
import { DemographicsChart } from '../components/charts/DemographicsChart'
import { HeatmapGrid } from '../components/charts/HeatmapGrid'
import { EvidenceGallery } from '../components/events/EvidenceGallery'
import { PpeCompliance } from '../components/ppe/PpeCompliance'
import { useKpis } from '../api/client'
import { GlassCard } from '../components/cards/GlassCard'
import { motion } from 'framer-motion'

// ── Quota bar ─────────────────────────────────────────────────────────────

function QuotaBar({ label, used, limit, color }: { label: string; used: number; limit: number; color: string }) {
  const pct = limit ? Math.round((used / limit) * 100) : 0
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-600 dark:text-slate-400">{label}</span>
        <span className="text-slate-500 dark:text-slate-500 font-mono">{used.toLocaleString('pt-BR')} / {limit.toLocaleString('pt-BR')}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-slate-200 dark:bg-white/5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full transition-all"
          style={{ background: pct > 90 ? '#f43f5e' : pct > 70 ? '#f59e0b' : color }}
        />
      </div>
      <p className="text-right text-[9px] mt-0.5" style={{ color: pct > 90 ? '#f43f5e' : '#64748b' }}>
        {pct}% utilizado
      </p>
    </div>
  )
}

// ── Camera status mini ────────────────────────────────────────────────────

function CameraStatusRow({ name, status, fps, pipeline }: any) {
  const isOnline = status === 'ACTIVE'
  return (
    <div className="flex items-center gap-2.5 py-2 border-b last:border-0 border-slate-100 dark:border-white/5">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? 'bg-emerald-400 animate-pulse-slow' : 'bg-slate-300 dark:bg-slate-700'}`} />
      <span className="text-xs flex-1 truncate text-slate-700 dark:text-slate-300">{name}</span>
      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
        pipeline === 'VERTEX_STREAMING'
          ? 'text-violet-700 bg-violet-100 border-violet-200 dark:text-violet-300 dark:bg-violet-500/10 dark:border-violet-500/20'
          : 'text-cyan-700 bg-cyan-100 border-cyan-200 dark:text-cyan-300 dark:bg-cyan-500/10 dark:border-cyan-500/20'
      }`}>
        {pipeline === 'VERTEX_STREAMING' ? 'Vertex' : 'Edge'}
      </span>
      {fps && <span className="text-[9px] font-mono text-slate-500 dark:text-slate-600">{fps}fps</span>}
    </div>
  )
}

export function DashboardPage() {
  const { data: kpis } = useKpis()

  const personCount   = kpis?.personCount    ?? 1842
  const avgDwell      = kpis?.avgDwellSeconds ?? 2520
  const totalEvents   = kpis?.totalEvents     ?? 247

  // Câmeras mock — em produção: useCameras()
  const cameras = [
    { name: 'Entrada Principal',      status: 'ACTIVE', fps: 5,  pipeline: 'EDGE_HYBRID'      },
    { name: 'Praça Alimentação',      status: 'ACTIVE', fps: 25, pipeline: 'VERTEX_STREAMING' },
    { name: 'Corredor Loja A',        status: 'ACTIVE', fps: 5,  pipeline: 'EDGE_HYBRID'      },
    { name: 'Caixas Supermercado',    status: 'ACTIVE', fps: 5,  pipeline: 'EDGE_HYBRID'      },
    { name: 'Estacionamento P1',      status: 'ACTIVE', fps: 5,  pipeline: 'EDGE_HYBRID'      },
  ]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-space-950">
      {/* Ambient glow background — só no DARK (poluem o card branco do LIGHT) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden hidden dark:block">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-cyan-500/5 blur-3xl" />
        <div className="absolute top-1/3 right-0 w-80 h-80 rounded-full bg-violet-500/5 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 rounded-full bg-emerald-500/4 blur-3xl" />
      </div>

      <div className="relative p-6 space-y-5">

        {/* ── Row 1: KPI Cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard
            title="Pessoas Hoje"
            value={personCount}
            subtitle="fluxo total"
            icon={<Users className="w-full h-full" />}
            accent="cyan"
            trend={8}
            delay={0.05}
          />
          <KpiCard
            title="Dwell Time Médio"
            value={avgDwell}
            subtitle="permanência média"
            icon={<Clock className="w-full h-full" />}
            accent="violet"
            format="time"
            trend={-3}
            delay={0.1}
          />
          <KpiCard
            title="Sentimento Geral"
            value={68}
            unit="%"
            subtitle="😊 alegria dominante"
            icon={<Smile className="w-full h-full" />}
            accent="amber"
            format="pct"
            trend={5}
            delay={0.15}
          />
          <KpiCard
            title="Compliance EPI"
            value={94}
            unit="%"
            subtitle="auditoria contínua"
            icon={<ShieldCheck className="w-full h-full" />}
            accent="emerald"
            format="pct"
            trend={2}
            delay={0.2}
          />
          <KpiCard
            title="Eventos Detectados"
            value={totalEvents}
            subtitle="últimas 24h"
            icon={<Eye className="w-full h-full" />}
            accent="rose"
            trend={12}
            delay={0.25}
          />
          <KpiCard
            title="Edge Nodes Online"
            value={3}
            subtitle="de 3 ativos"
            icon={<Zap className="w-full h-full" />}
            accent="violet"
            delay={0.3}
          />
        </div>

        {/* ── Row 2: Flow chart + Heatmap ──────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className="xl:col-span-3">
            <FlowChart days={7} delay={0.35} />
          </div>
          <div className="xl:col-span-2">
            <HeatmapGrid label="Praça de Alimentação" delay={0.4} />
          </div>
        </div>

        {/* ── Row 3: Demographics + Evidence + PPE ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <DemographicsChart delay={0.45} />
          <EvidenceGallery delay={0.5} />
          <PpeCompliance delay={0.55} />
        </div>

        {/* ── Row 4: Camera status + Quota ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Cameras */}
          <GlassCard delay={0.6} className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Status das Câmeras</h3>
              <span className="ml-auto text-xs text-slate-500 dark:text-slate-500">{cameras.filter(c => c.status === 'ACTIVE').length}/{cameras.length} online</span>
            </div>
            <div>
              {cameras.map((c, i) => <CameraStatusRow key={i} {...c} />)}
            </div>
          </GlassCard>

          {/* Quota */}
          <GlassCard delay={0.65} className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Consumo de API GCP</h3>
              <span className="ml-auto text-xs text-slate-500 dark:text-slate-500">Este mês</span>
            </div>
            <div className="space-y-4">
              <QuotaBar
                label="Cloud Vision API (Static Vision)"
                used={38_420}
                limit={50_000}
                color="#00C0D0"
              />
              <QuotaBar
                label="Vertex AI Vision (Streaming)"
                used={3_660}
                limit={6_000}
                color="#8b5cf6"
              />
              <QuotaBar
                label="GCS Evidências (GB)"
                used={12}
                limit={50}
                color="#10b981"
              />
            </div>
            <div className="mt-4 pt-3 flex justify-between text-xs border-t border-slate-200 dark:border-white/5">
              <span className="text-slate-500 dark:text-slate-500">Próxima fatura:</span>
              <span className="font-medium text-slate-900 dark:text-slate-300">R$ 4.280,00</span>
            </div>
          </GlassCard>
        </div>

      </div>
    </div>
  )
}
