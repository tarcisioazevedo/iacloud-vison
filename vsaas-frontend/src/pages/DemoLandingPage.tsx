/**
 * DemoLandingPage — rota pública /demo/:token
 *
 * Lote 1: o destinatário do convite acessa este link para criar seu tenant.
 *
 *  1. GET /demo/:token   → carrega info do convite (nome, empresa, targetKind)
 *  2. Exibe formulário: nome + senha + confirmação
 *  3. POST /demo/:token/accept → redireciona para /login com mensagem de sucesso
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Eye, EyeOff, Loader2, AlertTriangle,
  CheckCircle2, Building2, User,
} from 'lucide-react'
import { api, formatApiError } from '../api/client'

interface InviteInfo {
  invite: {
    id:            string
    targetKind:    'INTEGRADOR' | 'CLIENTE_FINAL'
    suggestedPlan: string | null
    expiresAt:     string
  }
  lead: {
    contactName:  string
    contactEmail: string
    companyName:  string | null
    kind:         string
  }
}

export function DemoLandingPage() {
  const { token } = useParams<{ token: string }>()
  const navigate  = useNavigate()

  const [loading,  setLoading]  = useState(true)
  const [info,     setInfo]     = useState<InviteInfo | null>(null)
  const [fetchErr, setFetchErr] = useState('')

  const [name,     setName]     = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [formErr,  setFormErr]  = useState('')
  const [done,     setDone]     = useState(false)

  useEffect(() => {
    if (!token) return
    api.get(`/demo/${token}`)
      .then((r) => {
        setInfo(r.data)
        setName(r.data.lead.contactName ?? '')
      })
      .catch((err) => setFetchErr(formatApiError(err)))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setFormErr('As senhas não coincidem'); return }
    if (password.length < 8)  { setFormErr('Senha muito curta — mínimo 8 caracteres'); return }
    setSaving(true)
    setFormErr('')
    try {
      await api.post(`/demo/${token}/accept`, { password, name: name.trim() || undefined })
      setDone(true)
      setTimeout(() => navigate('/login', { state: { justActivated: true } }), 3500)
    } catch (err) {
      setFormErr(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-slate-100 via-slate-50 to-cyan-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-8">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)' }}>
          <ShieldCheck className="w-5 h-5 text-white"/>
        </div>
        <span className="text-slate-900 dark:text-white font-bold text-lg">IA Cloud Vision</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {loading ? (
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin"/>
            <p className="text-sm">Verificando convite…</p>
          </div>

        ) : fetchErr ? (
          <div className="rounded-2xl p-6 text-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 shadow-xl">
            <AlertTriangle className="w-10 h-10 text-rose-500 dark:text-rose-400 mx-auto mb-3"/>
            <h2 className="text-slate-900 dark:text-white font-bold text-lg mb-2">Convite inválido</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-5">{fetchErr}</p>
            <button
              onClick={() => navigate('/login')}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)' }}
            >
              Ir para login
            </button>
          </div>

        ) : done ? (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="rounded-2xl p-8 text-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 shadow-xl"
          >
            <CheckCircle2 className="w-14 h-14 text-emerald-500 dark:text-emerald-400 mx-auto mb-4"/>
            <h2 className="text-slate-900 dark:text-white font-bold text-xl mb-2">Conta criada!</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-1">
              Bem-vindo(a), <strong className="text-slate-900 dark:text-white">{name || info?.lead.contactName}</strong>!
            </p>
            <p className="text-slate-400 dark:text-slate-500 text-xs">Redirecionando para o login…</p>
          </motion.div>

        ) : info ? (
          <div className="rounded-2xl overflow-hidden bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 shadow-xl">
            {/* Header do convite */}
            <div className="p-6 border-b border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-500/20 flex items-center justify-center">
                  {info.invite.targetKind === 'INTEGRADOR'
                    ? <Building2 className="w-5 h-5 text-cyan-600 dark:text-cyan-400"/>
                    : <User className="w-5 h-5 text-cyan-600 dark:text-cyan-400"/>}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-cyan-600 dark:text-cyan-400 font-semibold">
                    Convite de acesso
                  </p>
                  <p className="text-slate-900 dark:text-white font-bold text-base leading-tight">
                    {info.lead.companyName || info.lead.contactName}
                  </p>
                </div>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-xs">
                Olá, <strong className="text-slate-900 dark:text-white">{info.lead.contactName}</strong>! Defina sua senha
                para ativar seu acesso como{' '}
                <strong className="text-cyan-600 dark:text-cyan-400">
                  {info.invite.targetKind === 'INTEGRADOR' ? 'Integrador' : 'Cliente'}
                </strong>.
              </p>
              <p className="text-slate-400 dark:text-slate-500 text-[10px] mt-2">
                Link válido até {new Date(info.invite.expiresAt).toLocaleDateString('pt-BR')}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
                  Seu nome
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={info.lead.contactName}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-white/5 border border-slate-300 dark:border-white/10 outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
                  Senha (mínimo 8 caracteres)
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 pr-10 rounded-xl text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-white/5 border border-slate-300 dark:border-white/10 outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                    {showPw ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
                  Confirmar senha
                </label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-white/5 border border-slate-300 dark:border-white/10 outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              <AnimatePresence>
                {formErr && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="px-3 py-2.5 rounded-xl flex items-start gap-2 text-xs bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-300"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5"/> {formErr}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={saving || !password || !confirm}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)' }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>}
                Ativar meu acesso
              </button>
            </form>
          </div>
        ) : null}
      </motion.div>

      <p className="mt-8 text-slate-500 dark:text-slate-600 text-xs">
        © {new Date().getFullYear()} IA Cloud Vision — Segurança inteligente
      </p>
    </div>
  )
}
