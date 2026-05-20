/**
 * ForceChangePasswordPage — /change-password
 *
 * Lote 2 / Lote 5: forçado quando mustChangePassword=true após login.
 * O usuário DEVE criar uma nova senha antes de acessar qualquer outra rota.
 *
 * Fluxo:
 *   1. PrivateRoute detecta icv_must_change_pw=1 → redireciona aqui
 *   2. Usuário digita senha atual + nova + confirmação
 *   3. POST /auth/change-password → backend zera mustChangePassword
 *   4. Remove icv_must_change_pw do localStorage → redireciona para /
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Eye, EyeOff, Loader2, AlertTriangle,
  CheckCircle2, Lock,
} from 'lucide-react'
import { api, formatApiError } from '../api/client'

export function ForceChangePasswordPage() {
  const navigate  = useNavigate()

  const [current, setCurrent]   = useState('')
  const [next,    setNext]      = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPw,  setShowPw]    = useState(false)
  const [saving,  setSaving]    = useState(false)
  const [error,   setError]     = useState('')
  const [done,    setDone]      = useState(false)

  const role  = localStorage.getItem('icv_role') ?? ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (next !== confirm) { setError('As senhas não coincidem'); return }
    if (next.length < 8)  { setError('Nova senha deve ter no mínimo 8 caracteres'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/auth/change-password', { current, next })
      localStorage.removeItem('icv_must_change_pw')
      setDone(true)
      setTimeout(() => navigate('/', { replace: true }), 1800)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const strengthColor = next.length === 0 ? '#e2e8f0'
    : next.length < 8 ? '#ef4444'
    : next.length < 12 ? '#f59e0b'
    : '#10b981'

  const strengthLabel = next.length === 0 ? ''
    : next.length < 8 ? 'Fraca'
    : next.length < 12 ? 'Média'
    : 'Forte'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-slate-100 via-slate-50 to-cyan-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-8">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #0090D8 0%, #00C0D0 52%, #00D0A8 100%)' }}>
          <ShieldCheck className="w-5 h-5 text-white"/>
        </div>
        <span className="text-slate-900 dark:text-white font-bold text-lg">VSaaS</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {done ? (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="rounded-2xl p-8 text-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 shadow-xl"
          >
            <CheckCircle2 className="w-12 h-12 text-emerald-500 dark:text-emerald-400 mx-auto mb-4"/>
            <h2 className="text-slate-900 dark:text-white font-bold text-lg mb-1">Senha alterada!</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Redirecionando…</p>
          </motion.div>
        ) : (
          <div className="rounded-2xl overflow-hidden bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 shadow-xl">
            <div className="p-6 border-b border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400"/>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-amber-600 dark:text-amber-400 font-semibold">
                    Ação necessária
                  </p>
                  <h2 className="text-slate-900 dark:text-white font-bold text-base">Redefina sua senha</h2>
                </div>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-xs">
                Por segurança, você deve criar uma senha pessoal antes de continuar.
                {role && (
                  <span className="ml-1 text-slate-400 dark:text-slate-500">
                    ({role.replace('_', ' ').toLowerCase()})
                  </span>
                )}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Senha atual */}
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
                  Senha atual (temporária)
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 pr-10 rounded-xl text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-white/5 border border-slate-300 dark:border-white/10 outline-none focus:ring-2 focus:ring-amber-500/50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                    {showPw ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                  </button>
                </div>
              </div>

              {/* Nova senha */}
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
                  Nova senha (mín. 8 caracteres)
                </label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-white/5 border border-slate-300 dark:border-white/10 outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
                {next.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (next.length / 16) * 100)}%`,
                          background: strengthColor,
                        }}/>
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: strengthColor }}>
                      {strengthLabel}
                    </span>
                  </div>
                )}
              </div>

              {/* Confirmar */}
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
                  Confirmar nova senha
                </label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-white/5 border outline-none focus:ring-2 focus:ring-cyan-500/50 ${
                    confirm && confirm !== next
                      ? 'border-rose-400 dark:border-rose-500/70'
                      : 'border-slate-300 dark:border-white/10'
                  }`}
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="px-3 py-2.5 rounded-xl flex items-start gap-2 text-xs bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-300"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5"/> {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={saving || !current || !next || !confirm}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, #0090D8 0%, #00C0D0 52%, #00D0A8 100%)' }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>}
                Redefinir senha e entrar
              </button>
            </form>
          </div>
        )}
      </motion.div>
    </div>
  )
}
