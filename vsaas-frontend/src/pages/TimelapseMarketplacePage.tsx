import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Timer, Loader2, X, Check, AlertCircle,
  Building2, Tractor, ShoppingBag, Calendar,
  Download, Share2, ChevronRight,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────
interface TimelapseJob {
  id: string
  cameraName: string
  createdAt: string
  durationSeconds: number
  thumbnailUrl?: string
  downloadUrl?: string
}

interface Camera {
  id: string
  name: string
  status: string
}

interface TimelapsePlan {
  slug: string
  name: string
  frequency: string
  outputDuration: string
  archiveDays: number
  price: string
  icon: React.FC<{ className?: string }>
  description: string
}

// ─── Constants ───────────────────────────────────────────────────────────────
const USE_CASES = [
  { icon: Building2, label: 'Obras',  color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', desc: 'Acompanhe o progresso do canteiro dia a dia' },
  { icon: Tractor,   label: 'Fazenda', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20', desc: 'Monitore safras, crescimento e movimentação' },
  { icon: ShoppingBag, label: 'Loja', color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-900/20', desc: 'Analise fluxo de clientes e disposição do espaço' },
  { icon: Calendar,  label: 'Evento', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-900/20', desc: 'Registre montagem e desmontagem em segundos' },
]

const TIMELAPSE_PLANS: TimelapsePlan[] = [
  {
    slug: 'timelapse-daily',
    name: 'Diário',
    frequency: '1× por dia',
    outputDuration: '~30 segundos',
    archiveDays: 30,
    price: 'R$ 19,90/câm/mês',
    icon: Timer,
    description: 'Gerado toda madrugada com as imagens do dia anterior',
  },
  {
    slug: 'timelapse-weekly',
    name: 'Semanal',
    frequency: '1× por semana',
    outputDuration: '~2 minutos',
    archiveDays: 90,
    price: 'R$ 39,90/câm/mês',
    icon: Timer,
    description: 'Compilação semanal — ideal para relatórios de progresso',
  },
  {
    slug: 'timelapse-monthly',
    name: 'Mensal',
    frequency: '1× por mês',
    outputDuration: '~5 minutos',
    archiveDays: 365,
    price: 'R$ 69,90/câm/mês',
    icon: Timer,
    description: 'Compressão total do mês — arquivo de longa duração',
  },
]

// ─── Wizard simples ───────────────────────────────────────────────────────────
function ContractWizard({
  plan,
  cameras,
  onClose,
  onSuccess,
}: {
  plan: TimelapsePlan
  cameras: Camera[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedCamIds, setSelectedCamIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const toggleCam = (id: string) =>
    setSelectedCamIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id],
    )

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      await api.post('/marketplace/subscriptions', {
        productSlug: plan.slug,
        cameraIds: selectedCamIds,
        acceptedTermsVersion: 'v1',
      })
      setDone(true)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Erro ao contratar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !done) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="font-semibold text-slate-900 dark:text-white">
            Timelapse {plan.name}
          </h3>
          {!done && (
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {done ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
                <Check className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="font-semibold text-slate-900 dark:text-white mb-1">
                Timelapse contratado!
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Seus primeiros timelapses serão gerados automaticamente. Aguarde até amanhã!
              </p>
            </div>
          ) : step === 1 ? (
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Selecione as câmeras para o plano <strong>{plan.name}</strong>.
              </p>
              <div className="space-y-2">
                {cameras.map(cam => (
                  <label
                    key={cam.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition',
                      selectedCamIds.includes(cam.id)
                        ? 'border-amber-500/50 bg-amber-50 dark:bg-amber-900/10'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50',
                    )}
                  >
                    <input type="checkbox" className="sr-only" checked={selectedCamIds.includes(cam.id)} onChange={() => toggleCam(cam.id)} />
                    <div className={cn(
                      'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition',
                      selectedCamIds.includes(cam.id) ? 'border-amber-500 bg-amber-500' : 'border-slate-300 dark:border-slate-600',
                    )}>
                      {selectedCamIds.includes(cam.id) && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{cam.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Confirme a contratação do plano <strong>{plan.name}</strong> para{' '}
                <strong>{selectedCamIds.length}</strong> câmera{selectedCamIds.length !== 1 ? 's' : ''}.
              </p>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Frequência</span>
                  <span className="text-slate-900 dark:text-white font-medium">{plan.frequency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Duração do vídeo</span>
                  <span className="text-slate-900 dark:text-white font-medium">{plan.outputDuration}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Arquivo</span>
                  <span className="text-slate-900 dark:text-white font-medium">{plan.archiveDays} dias</span>
                </div>
                <div className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-2 mt-2">
                  <span className="text-slate-700 dark:text-slate-300 font-medium">Total</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{plan.price}</span>
                </div>
              </div>
              {error && (
                <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {!done && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
            {step === 2 ? (
              <button onClick={() => setStep(1)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                Voltar
              </button>
            ) : <div />}
            {step === 1 ? (
              <button
                disabled={selectedCamIds.length === 0}
                onClick={() => setStep(2)}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition"
              >
                Continuar
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                disabled={loading}
                onClick={handleConfirm}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar
              </button>
            )}
          </div>
        )}
        {done && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
            <button onClick={onSuccess} className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition">
              Concluído
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function TimelapseMarketplacePage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [jobs, setJobs] = useState<TimelapseJob[]>([])
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [activePlan, setActivePlan] = useState<TimelapsePlan | null>(null)
  const [hasSubscription, setHasSubscription] = useState(false)

  useEffect(() => {
    api.get<{ cameras: Camera[] }>('/cameras?limit=200')
      .then(r => setCameras(r.data.cameras ?? []))
      .catch(() => {})

    api.get<{ subscriptions: { productSlug: string }[] }>('/marketplace/subscriptions')
      .then(r => {
        const subs = r.data.subscriptions ?? []
        setHasSubscription(subs.some(s => s.productSlug?.startsWith('timelapse')))
      })
      .catch(() => {})

    api.get<{ jobs: TimelapseJob[] }>('/timelapse/jobs?status=DONE&limit=20')
      .then(r => setJobs(r.data.jobs ?? []))
      .catch(() => {})
      .finally(() => setLoadingJobs(false))
  }, [])

  function formatDuration(s: number) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      {/* Hero */}
      <div
        className="rounded-2xl p-8 mb-8 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)' }}
      >
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 70% 50%, white 0%, transparent 60%)' }}
        />
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <Timer className="w-8 h-8 text-white" />
            <h1 className="text-3xl font-bold text-white">Timelapse</h1>
          </div>
          <p className="text-white/80 text-base mb-6 max-w-xl">
            Comprima dias em segundos. Acompanhe a evolução dos seus projetos com vídeos automáticos gerados pela nuvem.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {USE_CASES.map(uc => (
              <div
                key={uc.label}
                className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 p-3 flex items-start gap-2"
              >
                <div className="p-2 rounded-lg bg-white/20">
                  <uc.icon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{uc.label}</p>
                  <p className="text-white/70 text-xs leading-tight">{uc.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Planos */}
      <div className="mb-10">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
          Escolha seu plano
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TIMELAPSE_PLANS.map(plan => (
            <motion.div
              key={plan.slug}
              whileHover={{ scale: 1.015 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="rounded-2xl border border-amber-500/30 bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col"
            >
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 w-fit mb-4">
                <plan.icon className="w-5 h-5 text-amber-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                {plan.name}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 flex-1">
                {plan.description}
              </p>
              <div className="space-y-1.5 mb-4 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex justify-between">
                  <span>Frequência</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{plan.frequency}</span>
                </div>
                <div className="flex justify-between">
                  <span>Duração do vídeo</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{plan.outputDuration}</span>
                </div>
                <div className="flex justify-between">
                  <span>Arquivo por</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{plan.archiveDays} dias</span>
                </div>
              </div>
              <p className="text-center text-sm font-semibold text-slate-900 dark:text-white mb-3">
                {plan.price}
              </p>
              <button
                onClick={() => setActivePlan(plan)}
                className="w-full py-2.5 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
              >
                Contratar
              </button>
            </motion.div>
          ))}

          {/* On-demand */}
          <motion.div
            whileHover={{ scale: 1.015 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-50/30 dark:bg-amber-900/5 p-5 flex flex-col items-center justify-center text-center min-h-[220px]"
          >
            <Timer className="w-8 h-8 text-amber-400 mb-3" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
              On-demand
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
              Gere um timelapse pontual a qualquer momento, sem assinatura
            </p>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
              Em breve
            </span>
          </motion.div>
        </div>
      </div>

      {/* Galeria */}
      {(hasSubscription || jobs.length > 0) && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
            Meus Timelapses
          </h2>
          {loadingJobs ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-amber-500/30 bg-amber-50/20 dark:bg-amber-900/5 p-10 text-center">
              <Timer className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Seus primeiros timelapses serão gerados automaticamente. Aguarde até amanhã!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {jobs.map(job => (
                <div
                  key={job.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
                >
                  <div className="aspect-video bg-slate-100 dark:bg-slate-800 relative">
                    {job.thumbnailUrl ? (
                      <img src={job.thumbnailUrl} alt={job.cameraName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Timer className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate mb-0.5">
                      {job.cameraName}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                      {new Date(job.createdAt).toLocaleDateString('pt-BR')} · {formatDuration(job.durationSeconds)}
                    </p>
                    <div className="flex gap-2">
                      {job.downloadUrl && (
                        <a
                          href={job.downloadUrl}
                          download
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                        >
                          <Download className="w-3 h-3" />
                          Baixar
                        </a>
                      )}
                      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                        <Share2 className="w-3 h-3" />
                        Compartilhar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wizard */}
      <AnimatePresence>
        {activePlan && (
          <ContractWizard
            plan={activePlan}
            cameras={cameras}
            onClose={() => setActivePlan(null)}
            onSuccess={() => setActivePlan(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
