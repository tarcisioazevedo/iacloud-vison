import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  HardDrive, Timer, Cpu, Loader2, X, ChevronRight,
  ShoppingBag, AlertCircle,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'

interface Subscription {
  id: string
  productName: string
  productSlug: string
  status: 'ACTIVE' | 'GRACE' | 'CANCELED' | 'SUSPENDED'
  cameraCount: number
  monthlyPrice: number
  startedAt: string
}

const STATUS_STYLES: Record<Subscription['status'], string> = {
  ACTIVE:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  GRACE:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  CANCELED:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const STATUS_LABELS: Record<Subscription['status'], string> = {
  ACTIVE:    'Ativo',
  GRACE:     'Período de Graça',
  CANCELED:  'Cancelado',
  SUSPENDED: 'Suspenso',
}

export function MarketplacePage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loadingSubs, setLoadingSubs] = useState(true)
  const [subsError, setSubsError] = useState<string | null>(null)

  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const [waitlistName, setWaitlistName] = useState('')
  const [waitlistEmail, setWaitlistEmail] = useState('')
  const [waitlistLoading, setWaitlistLoading] = useState(false)
  const [waitlistSuccess, setWaitlistSuccess] = useState(false)
  const [waitlistError, setWaitlistError] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ subscriptions: Subscription[] }>('/marketplace/subscriptions')
      .then(r => setSubscriptions(r.data.subscriptions ?? []))
      .catch(() => setSubsError('Não foi possível carregar suas assinaturas.'))
      .finally(() => setLoadingSubs(false))
  }, [])

  async function handleWaitlistSubmit(e: React.FormEvent) {
    e.preventDefault()
    setWaitlistLoading(true)
    setWaitlistError(null)
    try {
      await api.post('/marketplace/waitlist', {
        productSlug: 'ia-detection',
        email: waitlistEmail,
        name: waitlistName,
      })
      setWaitlistSuccess(true)
    } catch {
      setWaitlistError('Não foi possível registrar. Tente novamente.')
    } finally {
      setWaitlistLoading(false)
    }
  }

  function closeWaitlist() {
    setWaitlistOpen(false)
    setWaitlistSuccess(false)
    setWaitlistError(null)
    setWaitlistName('')
    setWaitlistEmail('')
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <ShoppingBag className="w-7 h-7 text-cyan-500" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Marketplace
          </h1>
        </div>
        <p className="text-slate-500 dark:text-slate-400 ml-10">
          Contrate, gerencie e expanda seus serviços de segurança
        </p>
      </div>

      {/* Categorias */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        {/* VMS em Nuvem */}
        <Link to="/marketplace/storage">
          <motion.div
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className={cn(
              'rounded-2xl border bg-white dark:bg-slate-900 p-6 cursor-pointer',
              'border-cyan-500/30 shadow-sm hover:shadow-md transition-shadow',
            )}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 rounded-xl bg-cyan-50 dark:bg-cyan-900/20">
                <HardDrive className="w-6 h-6 text-cyan-500" />
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 mt-1" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              VMS em Nuvem
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Gravação contínua na nuvem, acesse de qualquer lugar
            </p>
          </motion.div>
        </Link>

        {/* Timelapse */}
        <Link to="/marketplace/timelapse">
          <motion.div
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className={cn(
              'rounded-2xl border bg-white dark:bg-slate-900 p-6 cursor-pointer',
              'border-amber-500/30 shadow-sm hover:shadow-md transition-shadow',
            )}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20">
                <Timer className="w-6 h-6 text-amber-500" />
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 mt-1" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              Timelapse
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Comprima dias em segundos. Perfeito para obras e análises
            </p>
          </motion.div>
        </Link>

        {/* Inteligência Artificial */}
        <motion.div
          whileHover={{ scale: 1.02 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          onClick={() => setWaitlistOpen(true)}
          className={cn(
            'rounded-2xl border bg-white dark:bg-slate-900 p-6 cursor-pointer',
            'border-violet-500/30 shadow-sm hover:shadow-md transition-shadow',
          )}
        >
          <div className="flex items-start justify-between mb-4">
            <div className="p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20">
              <Cpu className="w-6 h-6 text-violet-500" />
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border border-violet-200 dark:border-violet-700">
              Em breve
            </span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
            Inteligência Artificial
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Detecção, LPR, contagem de pessoas e mais
          </p>
        </motion.div>
      </div>

      {/* Minhas Assinaturas */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Minhas Assinaturas
          </h2>
          <Link
            to="/marketplace/minhas-assinaturas"
            className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline font-medium"
          >
            Ver todas
          </Link>
        </div>

        {loadingSubs ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : subsError ? (
          <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {subsError}
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400 text-sm">
            Você ainda não tem assinaturas. Explore os produtos acima.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {subscriptions.slice(0, 6).map(sub => (
              <div
                key={sub.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-slate-900 dark:text-white text-sm">
                    {sub.productName}
                  </h3>
                  <span className={cn(
                    'text-[10px] font-bold px-2 py-0.5 rounded-full',
                    STATUS_STYLES[sub.status],
                  )}>
                    {STATUS_LABELS[sub.status]}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <p>{sub.cameraCount} câmera{sub.cameraCount !== 1 ? 's' : ''}</p>
                  <p className="font-semibold text-slate-700 dark:text-slate-300">
                    R$ {sub.monthlyPrice.toFixed(2).replace('.', ',')}/mês
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Lista de Espera IA */}
      <AnimatePresence>
        {waitlistOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) closeWaitlist() }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white text-lg">
                    Lista de espera — IA
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    Seja avisado quando lançarmos
                  </p>
                </div>
                <button
                  onClick={closeWaitlist}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {waitlistSuccess ? (
                <div className="text-center py-6">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl">✓</span>
                  </div>
                  <p className="font-semibold text-slate-900 dark:text-white mb-1">
                    Registrado com sucesso!
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Você será notificado assim que a IA estiver disponível.
                  </p>
                  <button
                    onClick={closeWaitlist}
                    className="mt-4 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition"
                  >
                    Fechar
                  </button>
                </div>
              ) : (
                <form onSubmit={handleWaitlistSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Nome
                    </label>
                    <input
                      type="text"
                      required
                      value={waitlistName}
                      onChange={e => setWaitlistName(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                      placeholder="Seu nome"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      E-mail
                    </label>
                    <input
                      type="email"
                      required
                      value={waitlistEmail}
                      onChange={e => setWaitlistEmail(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                      placeholder="seu@email.com"
                    />
                  </div>
                  {waitlistError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{waitlistError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={waitlistLoading}
                    className="w-full py-2.5 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition flex items-center justify-center gap-2"
                  >
                    {waitlistLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Entrar na lista de espera
                  </button>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
