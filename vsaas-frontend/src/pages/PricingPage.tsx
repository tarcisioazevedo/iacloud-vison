import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Zap, Check, Sparkles, ShieldCheck, Star, Cpu, Users, Car,
  Fingerprint, Activity, Clock, Camera, BarChart3, HardDrive,
  ChevronRight, LogIn, MessageCircle, Infinity as InfinityIcon,
  Layers, Globe, Search, Eye, Cloud, Lock,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'


// ──────────────────────────────────────────────────────────────
// Fonte de preços: vsaas-docs/COMPETITIVE_ROADMAP_MONUV.md §4
// Sincronizar valores aqui ao atualizar a tabela no markdown.
// ──────────────────────────────────────────────────────────────

interface Plan {
  id: string
  name: string
  tagline: string
  priceMonthly: number | null   // null = Sob consulta
  connections: number | '∞'
  retention: string
  totalAIs: string
  ctaLabel: string
  ctaKind: 'self-service' | 'consultant'
  highlights: string[]
  recommended?: boolean
  accent: 'cyan' | 'violet' | 'emerald' | 'amber'
}

// ── Precificação: base = Monuv × 0.78 (−22%) + retenção 2×, IAs bonus e unfair advantages
const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Ideal para começar com 1 site',
    priceMonthly: 1169,          // Monuv Light R$ 1.499 × 0.78
    connections: 22,
    retention: '7 dias',
    totalAIs: '22 IAs',
    ctaLabel: 'Contratar agora',
    ctaKind: 'self-service',
    accent: 'cyan',
    highlights: [
      '22 conexões de câmera',
      'Retenção 7 dias (2× Monuv)',
      'Detecção de Movimento + Presença + LPR',
      'Mosaico 6×6 + Live WHEP <1s',
      'Central de Eventos completa',
      'Suporte 8×5',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'Mais escolhido por integradores',
    priceMonthly: 1676,          // Monuv Smart R$ 2.149 × 0.78
    connections: 28,
    retention: '7 dias',
    totalAIs: '32 IAs',
    ctaLabel: 'Contratar agora',
    ctaKind: 'self-service',
    recommended: true,
    accent: 'amber',
    highlights: [
      '28 conexões de câmera',
      '32 IAs incluídas (10 a mais)',
      'Dashboard de IA com KPIs',
      'Regras condicionais compostas',
      'Webhooks + API pública',
      'Suporte 12×6',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    tagline: 'Múltiplos sites e IAs premium',
    priceMonthly: 2807,          // Monuv Premium R$ 3.599 × 0.78
    connections: 52,
    retention: '7 dias',
    totalAIs: '52 IAs + PPE + Demographics',
    ctaLabel: 'Contratar agora',
    ctaKind: 'self-service',
    accent: 'violet',
    highlights: [
      '52 conexões de câmera',
      'PPE (EPI) + Demographics exclusivos',
      'Busca semântica Vertex AI',
      'White-label por integrador',
      'Federação entre clientes',
      'Suporte 24×7',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Hierarquia sem limites + Edge',
    priceMonthly: null,
    connections: '∞',
    retention: '30+ dias',
    totalAIs: 'Tudo + Edge + Federação',
    ctaLabel: 'Falar com consultor',
    ctaKind: 'consultant',
    accent: 'emerald',
    highlights: [
      'Câmeras ilimitadas',
      'Edge nodes com gravação local',
      'Hierarquia 5 níveis',
      'SLA 99,95% contratado',
      'LGPD premium (face masking, DSAR)',
      'Onboarding dedicado',
    ],
  },
]

interface StandaloneAI {
  id: string
  name: string
  icon: any
  priceIACV: number | null
  priceMonuv: number | null
  exclusive?: boolean
  color: string
}

// Preços IACV = Monuv × 0.78 (−22%). Exclusivos permanecem sem comparativo.
const STANDALONE_AIS: StandaloneAI[] = [
  { id: 'movement',    name: 'Detecção de Movimento',        icon: Activity,    priceIACV: 12.32,   priceMonuv: 15.79,  color: 'text-violet-400' },
  { id: 'presence',    name: 'Detecção de Presença',         icon: Users,       priceIACV: 43.76,   priceMonuv: 56.10,  color: 'text-cyan-400' },
  { id: 'suspect',     name: 'Detecção de Suspeito',         icon: Eye,         priceIACV: 61.62,   priceMonuv: 79.00,  color: 'text-rose-400' },
  { id: 'lpr',         name: 'LPR (placas veiculares)',      icon: Car,         priceIACV: 79.48,   priceMonuv: 101.90, color: 'text-emerald-400' },
  { id: 'anomaly',     name: 'Detecção de Anomalia',         icon: ShieldCheck, priceIACV: 88.37,   priceMonuv: 113.30, color: 'text-amber-400' },
  { id: 'absence',     name: 'Detecção de Ausência',         icon: Clock,       priceIACV: 88.37,   priceMonuv: 113.30, color: 'text-cyan-400' },
  { id: 'timelapse',   name: 'Timelapse',                    icon: Camera,      priceIACV: 177.61,  priceMonuv: 227.70, color: 'text-violet-400' },
  { id: 'counting',    name: 'Contagem + Mapa de Calor',     icon: BarChart3,   priceIACV: 266.92,  priceMonuv: 342.20, color: 'text-emerald-400' },
  { id: 'ppe',         name: 'Auditoria de EPI (PPE)',       icon: ShieldCheck, priceIACV: 69.00,   priceMonuv: null, exclusive: true, color: 'text-amber-400' },
  { id: 'demographics',name: 'Demographics (gênero/idade)',  icon: Fingerprint, priceIACV: 79.00,   priceMonuv: null, exclusive: true, color: 'text-violet-400' },
  { id: 'semantic',    name: 'Busca semântica (Vertex AI)',  icon: Search,      priceIACV: 29.00,   priceMonuv: null, exclusive: true, color: 'text-cyan-400' },
]

// VMS storage: Resolução × Dias
const VMS_RESOLUTIONS = ['VGA', 'HD', 'Full HD', '4K'] as const
const VMS_DAYS = [0, 1, 3, 7, 15, 30, 60, 90, 180] as const
type Reso = typeof VMS_RESOLUTIONS[number]
type Days = typeof VMS_DAYS[number]

// preços VMS em R$/câmera/mês = Monuv × 0.78 (−22%)
const VMS_PRICES: Record<Reso, Partial<Record<Days, number>>> = {
  'VGA':      { 0: 3.82, 1: 13.34, 3: 15.99, 7: 17.78, 15: 26.75, 30: 35.65, 60: 53.51, 90: 80.26, 180: 139.62 },
  'HD':       { 0: 3.82, 1: 15.13, 3: 17.78, 7: 26.75, 15: 35.65, 30: 53.51, 60: 89.23,  90: 133.85 },
  'Full HD':  { 0: 3.82, 1: 15.99, 3: 26.75, 7: 35.65, 15: 62.40, 30: 89.23, 60: 160.60, 90: 258.80 },
  '4K':       { 0: 3.82, 1: 35.65, 3: 44.54, 7: 68.64, 15: 115.99, 30: 142.74, 60: 258.80, 90: 365.90 },
}

// ──────────────────────────────────────────────────────────────

function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

// ──────────────────────────────────────────────────────────────

export function PricingPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'plans' | 'ai' | 'vms'>('plans')
  const [annual, setAnnual] = useState(true)
  const [selectedAIs, setSelectedAIs] = useState<Set<string>>(new Set())
  const [camerasForAI, setCamerasForAI] = useState(5)
  const [reso, setReso] = useState<Reso>('Full HD')
  const [days, setDays] = useState<Days>(7)
  const [camerasForVMS, setCamerasForVMS] = useState(10)


  const aiTotalMonthly = useMemo(() => {
    let sum = 0
    for (const id of selectedAIs) {
      const ai = STANDALONE_AIS.find(x => x.id === id)
      if (ai?.priceIACV) sum += ai.priceIACV
    }
    return sum * camerasForAI
  }, [selectedAIs, camerasForAI])

  const vmsUnitPrice = VMS_PRICES[reso]?.[days] ?? 0
  const vmsTotalMonthly = vmsUnitPrice * camerasForVMS

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-space-950 text-slate-900 dark:text-white">
      {/* Hero */}
      <header className="relative overflow-hidden border-b border-slate-200 dark:border-white/5 bg-[linear-gradient(145deg,#001018_0%,#003058_52%,#007080_100%)]">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-sky/10 via-violet-500/5 to-transparent pointer-events-none" />
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(ellipse_at_top,_rgba(0,192,208,0.22),_transparent_60%)] pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
          <div
            className="flex items-center gap-2.5 cursor-pointer"
            onClick={() => navigate('/')}
          >
            <img src="/brand/vsaas-logomark.png" alt="VSaaS" className="h-10 w-10 object-contain rounded-lg" draggable={false} />
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-white tracking-wide">
                <span className="text-white">VSaaS</span>
              </p>
              <p className="text-[10px] text-cyan-500/50 -mt-0.5 uppercase tracking-widest">Videomonitoramento inteligente</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/login')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:text-white hover:bg-slate-50 dark:bg-white/5 transition"
            >
              <LogIn className="w-3.5 h-3.5" />
              Entrar
            </button>
            <a
              href="mailto:comercial@iacloudvision.com.br"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-sky/20 border border-brand-sky/30 text-brand-sky text-xs font-semibold hover:bg-brand-sky/30 transition"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Falar com consultor
            </a>
          </div>
        </div>

        <div className="relative max-w-7xl mx-auto px-6 pt-8 pb-14 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-sky/10 border border-brand-sky/25 text-[11px] font-semibold text-brand-sky mb-4"
          >
            <Sparkles className="w-3 h-3" />
            Preços transparentes — self-service — cancele quando quiser
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 dark:text-white"
          >
            Preços que <span className="text-brand-sky">competem</span> e features que{' '}
            <span className="bg-gradient-to-r from-brand-sky via-brand-skyLight to-vsaas-aqua bg-clip-text text-transparent">
              superam
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-4 text-base text-slate-400 max-w-2xl mx-auto"
          >
            VSaaS multi-tenant com Vertex AI. Retenção 7 dias inclusa, IAs 22% abaixo do mercado,
            WHEP <span className="text-emerald-400 font-mono">&lt;1s</span> de latência e Edge nodes
            resilientes. Contrate pelo painel, sem consultor.
          </motion.p>

          {/* Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-8 inline-flex items-center gap-1 p-1 rounded-xl bg-space-800/60 border border-slate-200 dark:border-white/10 backdrop-blur-sm"
          >
            {[
              { id: 'plans' as const, label: 'Planos PRO',         icon: Layers },
              { id: 'ai' as const,    label: 'IAs avulsas',         icon: Sparkles },
              { id: 'vms' as const,   label: 'Armazenamento (VMS)', icon: HardDrive },
            ].map(t => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition',
                    active
                      ? 'bg-brand-sky/20 text-brand-sky border border-brand-sky/40 shadow-inner'
                      : 'text-slate-400 hover:text-slate-200',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              )
            })}
          </motion.div>

          {/* Billing toggle (apenas na aba Planos) */}
          {tab === 'plans' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 inline-flex items-center gap-3 text-xs"
            >
              <span className={cn(!annual ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-500')}>Mensal</span>
              <button
                onClick={() => setAnnual(a => !a)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition',
                  annual ? 'bg-emerald-500/30 border border-emerald-500/40' : 'bg-space-800 border border-slate-200 dark:border-white/10',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all',
                    annual ? 'left-5 bg-emerald-400' : 'left-0.5',
                  )}
                />
              </button>
              <span className={cn(annual ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-500')}>
                Anual
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold">
                  −20%
                </span>
              </span>
            </motion.div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        {tab === 'plans' && <PlansTab annual={annual} />}
        {tab === 'ai' && (
          <AITab
            selected={selectedAIs}
            onToggle={(id) => {
              setSelectedAIs(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id); else next.add(id)
                return next
              })
            }}
            cameras={camerasForAI}
            onCamerasChange={setCamerasForAI}
            totalMonthly={aiTotalMonthly}
          />
        )}
        {tab === 'vms' && (
          <VMSTab
            reso={reso} setReso={setReso}
            days={days} setDays={setDays}
            cameras={camerasForVMS} setCameras={setCamerasForVMS}
            unitPrice={vmsUnitPrice}
            totalMonthly={vmsTotalMonthly}
          />
        )}
      </main>

      {/* Comparison footer */}
      <section className="border-t border-slate-200 dark:border-white/5 bg-white dark:bg-space-900/40">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className="text-center mb-8">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-brand-sky mb-2">
              por que trocar
            </p>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              VSaaS vs. concorrentes
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Latência ao vivo',     ours: '<1s (WHEP)',      theirs: '6-20s (HLS)',  icon: Zap,         accent: 'text-emerald-700 dark:text-emerald-400' },
              { label: 'Retenção inclusa',     ours: '7 dias',          theirs: '3 dias',       icon: Clock,       accent: 'text-cyan-700 dark:text-cyan-400' },
              { label: 'Edge on-prem',         ours: 'Sim',             theirs: 'Não',          icon: Cpu,         accent: 'text-violet-700 dark:text-violet-400' },
              { label: 'Busca semântica',      ours: 'Vertex AI',       theirs: 'Não',          icon: Search,      accent: 'text-amber-700 dark:text-amber-400' },
              { label: 'Webhooks + API',       ours: 'OpenAPI',         theirs: 'Não',          icon: Globe,       accent: 'text-rose-700 dark:text-rose-400' },
            ].map((c, i) => {
              const Icon = c.icon
              return (
                <GlassCard key={c.label} className="p-4" delay={i * 0.05}>
                  <Icon className={cn('w-4 h-4 mb-2', c.accent)} />
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{c.label}</p>
                  <p className={cn('mt-1 text-sm font-bold', c.accent)}>{c.ours}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500 line-through">{c.theirs}</p>
                </GlassCard>
              )
            })}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <footer className="border-t border-slate-200 dark:border-white/5 bg-white dark:bg-space-900">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">Ainda com dúvidas?</p>
            <p className="text-xs text-slate-500">Marque uma demo de 15min — sem compromisso.</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="mailto:comercial@iacloudvision.com.br"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-space-800 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-50 dark:bg-white/5 transition"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              comercial@iacloudvision.com.br
            </a>
            <button
              onClick={() => navigate('/login')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-sky text-slate-900 dark:text-white text-xs font-semibold hover:bg-brand-skyDeep transition"
            >
              <Zap className="w-3.5 h-3.5" />
              Entrar no painel
            </button>
          </div>
        </div>
        {/* Legal links */}
        <div className="border-t border-slate-200 dark:border-white/5 py-4">
          <p className="text-center text-[11px] text-slate-500 dark:text-slate-600">
            © {new Date().getFullYear()} VSaaS LTDA — Todos os direitos reservados
            {' · '}
            <Link to="/terms" className="hover:text-cyan-600 dark:hover:text-cyan-500 transition-colors">Termos de Uso</Link>
            {' · '}
            <Link to="/privacy" className="hover:text-cyan-600 dark:hover:text-cyan-500 transition-colors">Política de Privacidade</Link>
            {' · '}
            <span className="text-cyan-600/60">Conformidade LGPD</span>
          </p>
        </div>
      </footer>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Plans tab
// ──────────────────────────────────────────────────────────────

function PlansTab({ annual }: { annual: boolean }) {
  const navigate = useNavigate()

  function handleCheckout(plan: Plan) {
    if (plan.ctaKind === 'consultant') {
      window.location.href = 'mailto:comercial@iacloudvision.com.br?subject=Interesse%20plano%20Enterprise'
      return
    }
    // self-service: leva para login com plano pré-selecionado
    navigate(`/login?plan=${plan.id}&billing=${annual ? 'annual' : 'monthly'}`)
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {PLANS.map((plan, idx) => {
        const monthlyEffective =
          plan.priceMonthly === null
            ? null
            : annual
              ? plan.priceMonthly * 0.8
              : plan.priceMonthly
        return (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08 }}
            className={cn('relative', plan.recommended && 'md:-translate-y-2')}
          >
            {plan.recommended && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500 text-space-950 text-[10px] font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(251,191,36,0.4)]">
                <Star className="w-3 h-3 fill-space-950" />
                Recomendado
              </div>
            )}
            <GlassCard
              className={cn(
                'p-5 h-full flex flex-col',
                plan.recommended && 'border-amber-500/30 bg-amber-500/[0.02]',
              )}
              glow={plan.recommended ? 'amber' : undefined}
            >
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{plan.name}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{plan.tagline}</p>
              </div>

              <div className="mt-4 min-h-[70px]">
                {monthlyEffective === null ? (
                  <div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">Sob consulta</p>
                    <p className="text-[11px] text-slate-500">contrato anual mínimo</p>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[11px] text-slate-500">R$</span>
                      <span className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                        {formatPrice(monthlyEffective)}
                      </span>
                      <span className="text-[11px] text-slate-500">/mês</span>
                    </div>
                    {annual && (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                        economia de R$ {formatPrice(plan.priceMonthly! * 0.2 * 12)}/ano
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-3 text-[10px] text-slate-700 dark:text-slate-400 border-y border-slate-200 dark:border-white/5 py-2">
                <span className="flex items-center gap-1">
                  <Camera className="w-3 h-3 text-brand-sky" />
                  {plan.connections === '∞'
                    ? <InfinityIcon className="w-3 h-3 inline" />
                    : plan.connections}
                  {typeof plan.connections === 'number' && ' câms'}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  {plan.retention}
                </span>
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                  {plan.totalAIs.split(' ')[0]}
                </span>
              </div>

              <ul className="mt-4 space-y-2 flex-1">
                {plan.highlights.map(h => (
                  <li key={h} className="flex items-start gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleCheckout(plan)}
                className={cn(
                  'mt-5 w-full flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg text-xs font-semibold transition',
                  plan.recommended
                    ? 'bg-amber-500 hover:bg-amber-400 text-space-950'
                    : plan.ctaKind === 'consultant'
                      ? 'bg-slate-100 dark:bg-space-800 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-50 dark:bg-white/5'
                      : 'bg-brand-sky hover:bg-brand-skyDeep text-slate-900 dark:text-white',
                )}
              >
                {plan.ctaKind === 'consultant' ? <MessageCircle className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                {plan.ctaLabel}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </GlassCard>
          </motion.div>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Standalone AIs tab
// ──────────────────────────────────────────────────────────────

interface AITabProps {
  selected: Set<string>
  onToggle: (id: string) => void
  cameras: number
  onCamerasChange: (n: number) => void
  totalMonthly: number
}

function AITab({ selected, onToggle, cameras, onCamerasChange, totalMonthly }: AITabProps) {
  const totalSavings = useMemo(() => {
    let savings = 0
    for (const id of selected) {
      const ai = STANDALONE_AIS.find(x => x.id === id)
      if (ai?.priceMonuv && ai.priceIACV) savings += (ai.priceMonuv - ai.priceIACV)
    }
    return savings * cameras
  }, [selected, cameras])

  return (
    <div>
      <div className="mb-6 text-center">
        <p className="text-xs text-slate-700 dark:text-slate-400">
          Preços em R$/câmera/mês. <span className="text-emerald-600 dark:text-emerald-400 font-semibold">22% abaixo do concorrente.</span>{' '}
          <span className="text-violet-600 dark:text-violet-400 font-semibold">3 IAs exclusivas.</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {STANDALONE_AIS.map((ai, idx) => {
          const Icon = ai.icon
          const isSelected = selected.has(ai.id)
          const discount = ai.priceMonuv && ai.priceIACV ? Math.round((1 - ai.priceIACV / ai.priceMonuv) * 100) : null
          return (
            <motion.button
              key={ai.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              onClick={() => onToggle(ai.id)}
              className={cn(
                'text-left p-4 rounded-xl border transition backdrop-blur-sm',
                isSelected
                  ? 'bg-brand-sky/10 border-brand-sky/40 shadow-[0_0_15px_rgba(74,144,226,0.15)]'
                  : 'bg-white dark:bg-space-800/40 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25',
              )}
            >
              <div className="flex items-start justify-between">
                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', 'bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10')}>
                  <Icon className={cn('w-4 h-4', ai.color)} />
                </div>
                <div className="flex flex-col items-end gap-1">
                  {ai.exclusive && (
                    <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 dark:bg-violet-500/15 dark:border-violet-500/30 dark:text-violet-300 text-[9px] font-bold uppercase tracking-wider">
                      Exclusivo
                    </span>
                  )}
                  {discount && (
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-300 text-[9px] font-bold font-mono">
                      −{discount}%
                    </span>
                  )}
                </div>
              </div>

              <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">{ai.name}</p>

              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[10px] text-slate-500">R$</span>
                <span className="text-xl font-bold text-cyan-700 dark:text-brand-sky">
                  {formatBRL(ai.priceIACV ?? 0)}
                </span>
                <span className="text-[10px] text-slate-500">/câm/mês</span>
              </div>
              {ai.priceMonuv && (
                <p className="mt-0.5 text-[10px] text-slate-500">
                  <span className="line-through">R$ {formatBRL(ai.priceMonuv)}</span> concorrente
                </p>
              )}

              {isSelected && (
                <div className="mt-2 flex items-center gap-1 text-[10px] text-cyan-700 dark:text-brand-sky font-semibold">
                  <Check className="w-3 h-3" />
                  Adicionado ao carrinho
                </div>
              )}
            </motion.button>
          )
        })}
      </div>

      {/* Calc sidebar */}
      <GlassCard className="mt-6 p-5 sticky bottom-4" glow="cyan">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4 justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Simulador</p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
              <span className="text-slate-900 dark:text-white font-bold">{selected.size}</span> IA{selected.size === 1 ? '' : 's'} ×{' '}
              <input
                type="number"
                min={1} max={1000}
                value={cameras}
                onChange={e => onCamerasChange(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 px-2 py-0.5 rounded bg-slate-100 dark:bg-space-800 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm font-mono text-center focus:border-brand-sky/50 focus:outline-none"
              />
              câmeras
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[10px] text-slate-500">Total mensal</p>
              <p className="text-2xl font-bold text-cyan-700 dark:text-brand-sky">
                R$ {formatBRL(totalMonthly)}
              </p>
              {totalSavings > 0 && (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                  economia de R$ {formatBRL(totalSavings)}/mês vs concorrente
                </p>
              )}
            </div>
            <button
              disabled={selected.size === 0}
              onClick={() => {
                const params = new URLSearchParams()
                params.set('ais', Array.from(selected).join(','))
                params.set('cams', String(cameras))
                window.location.href = `/login?${params.toString()}`
              }}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-brand-sky text-slate-900 dark:text-white text-xs font-semibold hover:bg-brand-skyDeep transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap className="w-3.5 h-3.5" />
              Contratar
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// VMS storage tab
// ──────────────────────────────────────────────────────────────

interface VMSTabProps {
  reso: Reso
  setReso: (r: Reso) => void
  days: Days
  setDays: (d: Days) => void
  cameras: number
  setCameras: (n: number) => void
  unitPrice: number
  totalMonthly: number
}

function VMSTab({ reso, setReso, days, setDays, cameras, setCameras, unitPrice, totalMonthly }: VMSTabProps) {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-xs text-slate-700 dark:text-slate-400">
          Gravação em nuvem AWS S3 + CDN Cloudflare. Encriptação AES-256. LGPD compliant.
        </p>
      </div>

      {/* Simulator */}
      <GlassCard className="p-5" glow="cyan">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          Simulador de armazenamento
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Resolution */}
          <div>
            <label className="text-[10px] font-semibold text-slate-700 dark:text-slate-400 uppercase tracking-wider mb-2 block">
              Resolução
            </label>
            <div className="flex flex-wrap gap-1">
              {VMS_RESOLUTIONS.map(r => (
                <button
                  key={r}
                  onClick={() => setReso(r)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition',
                    reso === r
                      ? 'bg-brand-sky/20 border-brand-sky/40 text-cyan-700 dark:text-brand-sky'
                      : 'bg-slate-100 dark:bg-space-800/40 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Days */}
          <div>
            <label className="text-[10px] font-semibold text-slate-700 dark:text-slate-400 uppercase tracking-wider mb-2 block">
              Retenção (dias)
            </label>
            <div className="flex flex-wrap gap-1">
              {VMS_DAYS.map(d => {
                const available = VMS_PRICES[reso]?.[d] !== undefined
                return (
                  <button
                    key={d}
                    onClick={() => available && setDays(d)}
                    disabled={!available}
                    className={cn(
                      'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition font-mono',
                      days === d
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-400'
                        : available
                          ? 'bg-slate-100 dark:bg-space-800/40 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          : 'bg-slate-50 dark:bg-space-800/20 border-slate-100 dark:border-white/5 text-slate-600 dark:text-slate-300 dark:text-slate-700 cursor-not-allowed',
                    )}
                  >
                    {d === 0 ? 'live' : `${d}d`}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Cameras */}
          <div>
            <label className="text-[10px] font-semibold text-slate-700 dark:text-slate-400 uppercase tracking-wider mb-2 block">
              Câmeras
            </label>
            <input
              type="number"
              min={1} max={10000}
              value={cameras}
              onChange={e => setCameras(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-space-800 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm font-mono focus:border-brand-sky/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-slate-200 dark:border-white/5 flex flex-col md:flex-row items-start md:items-center gap-3 justify-between">
          <div>
            <p className="text-[10px] text-slate-500">
              {reso} · {days === 0 ? 'somente live' : `retenção ${days} dias`} · {cameras} câmera{cameras === 1 ? '' : 's'}
            </p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
              <span className="text-slate-900 dark:text-white font-bold">R$ {formatBRL(unitPrice)}</span>/câm/mês
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500">Total mensal</p>
            <p className="text-3xl font-bold text-cyan-700 dark:text-brand-sky">R$ {formatBRL(totalMonthly)}</p>
          </div>
          <button
            onClick={() => navigate(`/login?vms=${reso}_${days}d_${cameras}cam`)}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-brand-sky text-slate-900 dark:text-white text-xs font-semibold hover:bg-brand-skyDeep transition"
          >
            <Zap className="w-3.5 h-3.5" />
            Contratar
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </GlassCard>

      {/* Full matrix */}
      <GlassCard className="p-5 overflow-x-auto">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Tabela completa — R$/câmera/mês
        </p>
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left p-2 font-semibold">Resolução ↓ / Dias →</th>
              {VMS_DAYS.map(d => (
                <th key={d} className="text-right p-2 font-mono">{d === 0 ? 'live' : `${d}d`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {VMS_RESOLUTIONS.map(r => (
              <tr key={r} className="border-t border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                <td className="p-2 font-semibold text-slate-900 dark:text-white">{r}</td>
                {VMS_DAYS.map(d => {
                  const price = VMS_PRICES[r]?.[d]
                  const active = r === reso && d === days
                  return (
                    <td key={d} className={cn(
                      'text-right p-2 font-mono',
                      price === undefined
                        ? 'text-slate-600 dark:text-slate-300 dark:text-slate-700'
                        : active
                          ? 'bg-brand-sky/15 text-cyan-700 dark:text-brand-sky font-bold rounded'
                          : 'text-slate-700 dark:text-slate-300',
                    )}>
                      {price === undefined ? '—' : formatBRL(price)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[10px] text-slate-500">
          Descontos adicionais por volume (&gt; 200 câmeras) ou anual (20% off) negociados via consultor.
        </p>
      </GlassCard>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { icon: Lock,       title: 'Encriptação AES-256',   desc: 'Dados em repouso e em trânsito via TLS 1.3' },
          { icon: Cloud,      title: 'AWS S3 + Cloudflare',    desc: 'Região São Paulo (sa-east-1). Replicação cross-region sob demanda.' },
          { icon: ShieldCheck,title: 'LGPD + DSAR',           desc: 'Exclusão por direito ao esquecimento + audit log.' },
        ].map(f => {
          const Icon = f.icon
          return (
            <GlassCard key={f.title} className="p-4">
              <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mb-2" />
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{f.title}</p>
              <p className="mt-1 text-[11px] text-slate-500">{f.desc}</p>
            </GlassCard>
          )
        })}
      </div>
    </div>
  )
}
