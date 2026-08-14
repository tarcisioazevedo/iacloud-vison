import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Lock, Mail, AlertCircle, Tag, Brain, Car, BarChart3, HardDrive, Fingerprint, Shield, ChevronRight } from 'lucide-react'
import { api } from '../api/client'

/* ── Features listadas no painel esquerdo ── */
const FEATURES = [
  { icon: Brain,       label: 'Busca Semântica com IA Generativa',    desc: 'Pesquise em vídeos por linguagem natural' },
  { icon: Fingerprint, label: 'Reconhecimento Facial em Tempo Real',  desc: 'Identificação e alertas automáticos' },
  { icon: Car,         label: 'LPR — Leitura Automática de Placas',   desc: 'Reconhecimento por IA de alta acurácia' },
  { icon: BarChart3,   label: 'Analytics e Heatmaps de Fluxo',        desc: 'Dashboards BI para operadores e gestores' },
  { icon: HardDrive,   label: 'Armazenamento S3 Multi-tenant',        desc: 'Gravações seguras isoladas por cliente' },
]


export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  // Sprint C · MFA challenge state
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null)
  const [mfaCode, setMfaCode]           = useState('')
  const [mfaUseBackup, setMfaUseBackup] = useState(false)

  async function finishLogin(data: { token: string; role: string; mustChangePassword?: boolean; passwordExpired?: boolean }) {
    localStorage.setItem('icv_token', data.token)
    localStorage.setItem('icv_role', data.role)
    if (data.mustChangePassword || data.passwordExpired) {
      localStorage.setItem('icv_must_change_pw', '1')
    } else {
      localStorage.removeItem('icv_must_change_pw')
    }
    const { setSentryUser } = await import('../lib/sentry')
    setSentryUser()
    navigate('/', { replace: true })
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault()
    if (!mfaChallenge) return
    setLoading(true); setError('')
    try {
      const { data } = await api.post('/auth/login-mfa-verify', {
        challengeToken: mfaChallenge,
        code:           mfaCode.trim(),
      })
      await finishLogin(data)
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Código inválido')
      setMfaCode('')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/auth/login', { email, password })

      // Sprint C · backend pediu 2º fator
      if (data.mfaRequired && data.challengeToken) {
        setMfaChallenge(data.challengeToken)
        setMfaCode('')
        setLoading(false)
        return
      }

      await finishLogin(data)
    } catch (err: any) {
      // Sprint B — 423 Locked: conta bloqueada por excesso de tentativas.
      // Backend retorna { error: 'ACCOUNT_LOCKED', message, unlockAt }
      if (err?.response?.status === 423) {
        const unlockAtIso = err.response?.data?.unlockAt as string | undefined
        if (unlockAtIso) {
          try {
            const unlockAt = new Date(unlockAtIso)
            const diffMs = unlockAt.getTime() - Date.now()
            const minutes = Math.max(1, Math.ceil(diffMs / 60_000))
            const hhmm = unlockAt.toLocaleTimeString('pt-BR', {
              hour: '2-digit', minute: '2-digit',
            })
            setError(`Conta bloqueada por excesso de tentativas. Tente novamente em ${minutes} min (a partir das ${hhmm}).`)
          } catch {
            setError(err.response?.data?.message ?? 'Conta bloqueada — tente novamente mais tarde')
          }
        } else {
          setError(err.response?.data?.message ?? 'Conta bloqueada — tente novamente mais tarde')
        }
      } else if (!err.response) {
        setError('Não foi possível conectar ao servidor. Verifique se o backend está rodando.')
      } else {
        setError(err.response?.data?.message ?? 'Credenciais inválidas')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── SPLIT LAYOUT ── */}
      <div className="flex flex-1">

        {/* ════ LEFT PANEL — Gradient Azul→Cyan ════ */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="hidden lg:flex flex-col w-[55%] relative overflow-hidden"
          style={{
            // Paleta VSaaS — navy → deep-navy → deep-teal → cyan-prime (135°)
            background: 'linear-gradient(160deg, #001018 0%, #003058 42%, #007080 72%, #00C0D0 100%)',
          }}
        >
          {/* Subtle grid overlay */}
          <div className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
          {/* Brand depth overlay */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(120deg, rgba(0,16,24,0.30) 0%, transparent 46%, rgba(0,208,168,0.10) 100%)' }}/>

          <div className="relative flex flex-col h-full px-12 py-10">
            {/* Logo topo — wordmark VSaaS (sem tagline) */}
            <div className="flex items-center mb-auto" style={{ fontFamily: 'Manrope, Inter, sans-serif' }}>
              <img
                src="/brand/vsaas-wordmark-transparent.png"
                alt="VSaaS"
                className="h-14 w-auto block"
                draggable={false}
              />
            </div>

            {/* Hero central — tagline como h1, sem logomark/wordmark duplicado.
             * O wordmark do topo já identifica a marca; repetir logomark grande
             * + h1 "VSaaS" gerava 3 referências visuais ao mesmo nome. Agora:
             * topo = identidade · hero = proposta de valor · features = prova. */}
            <div className="my-auto">
              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="text-3xl lg:text-4xl font-extrabold text-white mb-3 leading-[1.15]"
                style={{ fontFamily: 'Manrope, Inter, sans-serif', letterSpacing: '-0.02em' }}
              >
                Videomonitoramento<br/>
                <span style={{
                  background: 'linear-gradient(90deg, #00C0D0 0%, #00D0A8 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}>inteligente como serviço</span>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="text-white/65 text-sm mb-10 max-w-md leading-relaxed"
              >
                A plataforma B2B2B que une edge box, IA on-device e cloud
                multi-tenant — para integradores que vendem segurança, não só câmera.
              </motion.p>

              {/* Feature pills */}
              <div className="flex flex-col gap-3">
                {FEATURES.map((f, i) => {
                  const Icon = f.icon
                  return (
                    <motion.div
                      key={f.label}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + i * 0.08, duration: 0.4 }}
                      className="flex items-center gap-3 group"
                    >
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
                        style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.18)' }}>
                        <Icon className="w-4 h-4 text-cyan-300"/>
                      </div>
                      <div>
                        <p className="text-white text-sm font-semibold leading-none">{f.label}</p>
                        <p className="text-white/45 text-xs mt-0.5">{f.desc}</p>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </div>

            {/* Social proof rodapé */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1, duration: 0.6 }}
              className="mt-auto flex items-center gap-2 pt-6 border-t border-slate-200 dark:border-white/10"
            >
              <Shield className="w-4 h-4 text-cyan-300 shrink-0"/>
              <p className="text-white/50 text-xs">
                Confiado por integradores de segurança eletrônica em todo o Brasil · Conformidade <span className="text-cyan-300/80">LGPD</span>
              </p>
            </motion.div>
          </div>
        </motion.div>

        {/* ════ RIGHT PANEL — Branco/Off-white ════ */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="login-auth-panel flex flex-col w-full lg:w-[45%] bg-white relative"
        >
          {/* Top-right nav links */}
          <div className="absolute top-5 right-4 sm:right-5 flex items-center gap-2">
            <Link
              to="/demo/new"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
              style={{ background: 'rgba(0,208,168,0.10)', color: '#007D69', border: '1px solid rgba(0,208,168,0.28)' }}
            >
              Demo · 60s
            </Link>
            <Link
              to="/pricing"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition hover:bg-slate-100"
              style={{ background: 'rgba(0,48,88,0.04)', color: '#3A4A58', border: '1px solid rgba(0,48,88,0.14)' }}
            >
              <Tag className="w-3.5 h-3.5"/>
              Ver planos
            </Link>
          </div>

          {/* Mobile logo - versao para fundo claro, sem moldura */}
          <div className="lg:hidden px-6 pt-7 sm:px-8 sm:pt-9">
            <div className="inline-flex max-w-[46vw] sm:max-w-none items-center gap-2.5 min-w-0">
              <img
                src="/brand/vsaas-symbol-transparent.png"
                alt=""
                aria-hidden="true"
                className="h-12 sm:h-14 w-auto shrink-0 object-contain"
                draggable={false}
              />
              <div className="min-w-0 leading-none" aria-label="VSaaS - Videomonitoramento inteligente como servico">
                <div className="text-[28px] sm:text-[34px] font-extrabold tracking-normal whitespace-nowrap" style={{ fontFamily: 'Manrope, Inter, sans-serif' }}>
                  <span style={{ color: '#0090D8' }}>V</span><span className="text-slate-900">SaaS</span>
                </div>
                <div className="mt-0.5 hidden min-[430px]:block text-[6px] sm:text-[7px] font-medium tracking-normal text-slate-500 whitespace-nowrap">
                  Videomonitoramento inteligente como servico
                </div>
              </div>
            </div>
          </div>

          {/* Form area — centralizado verticalmente */}
          <div className="flex flex-col flex-1 items-center justify-center px-8 sm:px-14 py-16">
            <div className="w-full max-w-sm">

              {/* Título */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mb-8"
              >
                <h2 className="text-2xl font-bold text-slate-900">Entre na sua conta</h2>
                <p className="text-slate-500 text-sm mt-1">Acesse a plataforma com suas credenciais</p>
              </motion.div>

              {mfaChallenge ? (
                <form onSubmit={handleMfaSubmit} className="space-y-4">
                  <div className="rounded-xl p-3 bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs flex items-start gap-2">
                    <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Autenticação em duas etapas</p>
                      <p className="text-cyan-700 mt-0.5">
                        {mfaUseBackup
                          ? 'Digite um dos seus 10 códigos de backup (10 caracteres).'
                          : 'Abra seu app autenticador e digite o código de 6 dígitos.'}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                      {mfaUseBackup ? 'Código de backup' : 'Código TOTP'}
                    </label>
                    <input
                      type="text"
                      inputMode={mfaUseBackup ? 'text' : 'numeric'}
                      autoComplete="one-time-code"
                      maxLength={mfaUseBackup ? 12 : 6}
                      value={mfaCode}
                      onChange={e => setMfaCode(
                        mfaUseBackup
                          ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                          : e.target.value.replace(/\D/g, ''),
                      )}
                      placeholder={mfaUseBackup ? 'XXXXXXXXXX' : '000000'}
                      className="w-full rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest text-slate-900 bg-slate-50 border-[1.5px] border-slate-200 focus:border-cyan-500 transition-all outline-none"
                      autoFocus
                      required
                    />
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs"
                      style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48' }}
                    >
                      <AlertCircle className="w-4 h-4 shrink-0"/>
                      {error}
                    </motion.div>
                  )}

                  <motion.button
                    type="submit"
                    disabled={loading || mfaCode.length < (mfaUseBackup ? 6 : 6)}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full flex items-center justify-center gap-2 font-semibold py-3 px-4 rounded-xl text-white text-sm transition-all mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{
                      background: 'linear-gradient(135deg, #0090D8 0%, #00C0D0 52%, #00D0A8 100%)',
                      boxShadow: '0 10px 30px -12px rgba(0,192,208,0.55)',
                    }}
                  >
                    {loading ? (
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                    ) : (
                      <>Verificar <ChevronRight className="w-4 h-4"/></>
                    )}
                  </motion.button>

                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => { setMfaUseBackup(v => !v); setMfaCode(''); setError('') }}
                      className="text-cyan-600 hover:text-cyan-700 hover:underline"
                    >
                      {mfaUseBackup ? '← Usar código do app' : 'Perdi acesso ao app · usar código de backup'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMfaChallenge(null); setMfaCode(''); setError('') }}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 bg-slate-50 border-[1.5px] border-slate-200 focus:border-cyan-500 transition-all outline-none"
                      placeholder="seu@email.com"
                      required
                    />
                  </div>
                </div>

                {/* Senha */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
                    <input
                      id="login-password"
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full rounded-xl pl-10 pr-10 py-3 text-sm text-slate-900 bg-slate-50 border-[1.5px] border-slate-200 focus:border-cyan-500 transition-all outline-none"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPwd ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                    </button>
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs"
                    style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48' }}
                  >
                    <AlertCircle className="w-4 h-4 shrink-0"/>
                    {error}
                  </motion.div>
                )}

                {/* Submit */}
                <motion.button
                  id="login-submit"
                  type="submit"
                  disabled={loading}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full flex items-center justify-center gap-2 font-semibold py-3 px-4 rounded-xl text-white text-sm transition-all mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    background: 'linear-gradient(135deg, #0090D8 0%, #00C0D0 52%, #00D0A8 100%)',
                    boxShadow: '0 10px 30px -12px rgba(0,192,208,0.55)',
                  }}
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                  ) : (
                    <>Entrar <ChevronRight className="w-4 h-4"/></>
                  )}
                </motion.button>
              </form>
              )}

              {/* Links */}
              <div className="flex items-center justify-between mt-4">
                <button className="text-xs text-slate-400 hover:text-cyan-600 transition-colors">
                  Esqueceu a senha?
                </button>
                <Link
                  to="/pricing"
                  className="text-xs font-semibold text-slate-500 hover:text-cyan-700 transition-colors flex items-center gap-1"
                >
                  Ver planos <ChevronRight className="w-3 h-3"/>
                </Link>
              </div>

              {/* CTA — Solicitar acesso (funil de leads, sem auto-trial) */}
              <div className="mt-8 pt-6 border-t border-slate-100">
                <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                  Ainda não é cliente? Conte pra gente sobre seu projeto — nossa equipe agenda
                  uma demonstração e libera seu acesso após análise.
                </p>
                <Link
                  to="/register-lead"
                  className="w-full inline-flex items-center justify-center gap-2 font-semibold py-2.5 px-4 rounded-xl text-sm transition-all bg-emerald-50 text-emerald-600 border-[1.5px] border-emerald-200 hover:bg-emerald-100"
                >
                  Solicitar acesso GRÁTIS
                  <ChevronRight className="w-4 h-4"/>
                </Link>
                <p className="text-[10px] text-slate-400 text-center mt-2">
                  Sou integrador de segurança ou cliente final — leva &lt; 2 minutos
                </p>
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <footer className="px-8 py-5 border-t border-slate-100">
            <p className="text-center text-[11px] text-slate-400">
              © {new Date().getFullYear()} VSaaS — Videomonitoramento inteligente como serviço · Todos os direitos reservados
              {' · '}
              <Link to="/terms" className="hover:text-cyan-600 transition-colors">Termos de Uso</Link>
              {' · '}
              <Link to="/privacy" className="hover:text-cyan-600 transition-colors">Política de Privacidade</Link>
              {' · '}
              <span className="text-cyan-600/70">LGPD</span>
            </p>
          </footer>
        </motion.div>
      </div>
    </div>
  )
}
