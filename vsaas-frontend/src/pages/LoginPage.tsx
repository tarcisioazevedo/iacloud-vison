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

/* ── Brand SVG inline (nuvem com olho) ── */
function BrandIcon({ size = 64 }: { size?: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="lp-cloud" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95"/>
          <stop offset="60%" stopColor="#bae6fd" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.85"/>
        </linearGradient>
        <radialGradient id="lp-iris" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0c1e3a"/>
          <stop offset="65%" stopColor="#0e2a50"/>
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.9"/>
        </radialGradient>
        <radialGradient id="lp-pupil" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff"/>
          <stop offset="28%" stopColor="#06b6d4"/>
          <stop offset="100%" stopColor="#0c1e3a"/>
        </radialGradient>
        <filter id="lp-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="7" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {/* Cloud */}
      <ellipse cx="185" cy="263" rx="74" ry="67" fill="url(#lp-cloud)"/>
      <ellipse cx="256" cy="238" rx="102" ry="90" fill="url(#lp-cloud)"/>
      <ellipse cx="334" cy="258" rx="80" ry="72" fill="url(#lp-cloud)"/>
      <rect x="150" y="273" width="228" height="68" rx="8" fill="url(#lp-cloud)"/>
      {/* Inner */}
      <ellipse cx="256" cy="255" rx="138" ry="96" fill="#0d2a4a" opacity="0.35"/>
      {/* Sclera */}
      <ellipse cx="256" cy="258" rx="88" ry="51" fill="white" opacity="0.97"/>
      {/* Iris */}
      <circle cx="256" cy="258" r="41" fill="url(#lp-iris)"/>
      <circle cx="256" cy="258" r="41" fill="none" stroke="#06b6d4" strokeWidth="2" opacity="0.7"/>
      <circle cx="256" cy="258" r="30" fill="none" stroke="#06b6d4" strokeWidth="1.5" opacity="0.5"/>
      <circle cx="256" cy="258" r="20" fill="none" stroke="#06b6d4" strokeWidth="1" opacity="0.4"/>
      {/* Spokes */}
      <g stroke="#06b6d4" strokeWidth="1.2" opacity="0.45">
        <line x1="256" y1="217" x2="256" y2="230"/>
        <line x1="256" y1="286" x2="256" y2="299"/>
        <line x1="215" y1="258" x2="228" y2="258"/>
        <line x1="284" y1="258" x2="297" y2="258"/>
        <line x1="228" y1="230" x2="236" y2="238"/>
        <line x1="276" y1="278" x2="284" y2="286"/>
        <line x1="284" y1="230" x2="276" y2="238"/>
        <line x1="236" y1="278" x2="228" y2="286"/>
      </g>
      {/* Pupil */}
      <circle cx="256" cy="258" r="18" fill="url(#lp-pupil)" filter="url(#lp-glow)"/>
      <circle cx="256" cy="258" r="10" fill="#0c1e3a"/>
      <circle cx="256" cy="258" r="4" fill="#06b6d4" opacity="0.9"/>
      <circle cx="263" cy="251" r="3" fill="white" opacity="0.8"/>
      {/* Eye glow */}
      <ellipse cx="256" cy="258" rx="88" ry="51" fill="none" stroke="#06b6d4" strokeWidth="2" opacity="0.5" filter="url(#lp-glow)"/>
      {/* Nodes */}
      <g fill="#06b6d4" opacity="0.6" filter="url(#lp-glow)">
        <circle cx="168" cy="258" r="4"/>
        <circle cx="344" cy="258" r="4"/>
        <circle cx="210" cy="213" r="3"/>
        <circle cx="302" cy="213" r="3"/>
      </g>
      <g stroke="#06b6d4" strokeWidth="1" opacity="0.3">
        <line x1="168" y1="258" x2="132" y2="338"/>
        <line x1="344" y1="258" x2="380" y2="338"/>
        <line x1="210" y1="213" x2="176" y2="168"/>
        <line x1="302" y1="213" x2="336" y2="168"/>
      </g>
    </svg>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('icv_token', data.token)
      localStorage.setItem('icv_role', data.role)
      const { setSentryUser } = await import('../lib/sentry')
      setSentryUser()
      navigate('/', { replace: true })
    } catch (err: any) {
      if (!err.response) {
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
            background: 'linear-gradient(160deg, #0B1629 0%, #0c2340 30%, #0369a1 70%, #06b6d4 100%)',
          }}
        >
          {/* Subtle grid overlay */}
          <div className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
          {/* Glow orbs */}
          <div className="absolute top-[-80px] left-[-80px] w-[360px] h-[360px] rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, #06b6d4, transparent)' }}/>
          <div className="absolute bottom-[-60px] right-[-60px] w-[280px] h-[280px] rounded-full opacity-15"
            style={{ background: 'radial-gradient(circle, #0ea5e9, transparent)' }}/>

          <div className="relative flex flex-col h-full px-12 py-10">
            {/* Logo topo */}
            <div className="flex items-center gap-3 mb-auto">
              <BrandIcon size={40}/>
              <div>
                <p className="text-white font-bold text-lg leading-none tracking-wide">
                  IA <span className="text-cyan-300">Cloud Vision</span>
                </p>
                <p className="text-cyan-300/60 text-[11px] mt-0.5 uppercase tracking-widest">VSaaS Platform</p>
              </div>
            </div>

            {/* Hero central */}
            <div className="my-auto">
              {/* Logo grande */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="mb-8 flex"
              >
                <div className="drop-shadow-[0_0_40px_rgba(6,182,212,0.5)]">
                  <BrandIcon size={120}/>
                </div>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.5 }}
                className="text-4xl font-extrabold text-white mb-2 leading-tight"
              >
                IA <span className="text-cyan-300">Cloud Vision</span>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.5 }}
                className="text-white/60 text-sm mb-10"
              >
                VSaaS · IA Generativa · Segurança Eletrônica
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
              className="mt-auto flex items-center gap-2 pt-6 border-t border-white/10"
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
          className="flex flex-col w-full lg:w-[45%] bg-white dark:bg-space-950 relative"
        >
          {/* Top-right nav links */}
          <div className="absolute top-5 right-5 flex items-center gap-2">
            <Link
              to="/demo/new"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
              style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }}
            >
              Demo · 60s
            </Link>
            <Link
              to="/pricing"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition hover:bg-slate-100"
              style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0' }}
            >
              <Tag className="w-3.5 h-3.5"/>
              Ver planos
            </Link>
          </div>

          {/* Mobile logo (só em telas pequenas) */}
          <div className="lg:hidden flex items-center gap-3 px-8 pt-8">
            <BrandIcon size={36}/>
            <p className="font-bold text-slate-800 dark:text-white text-lg">IA <span className="text-cyan-500 dark:text-cyan-400">Cloud Vision</span></p>
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
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Entre na sua conta</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Acesse a plataforma com suas credenciais</p>
              </motion.div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5 uppercase tracking-wide">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-white/5 border-[1.5px] border-slate-200 dark:border-white/10 focus:border-cyan-500 dark:focus:border-cyan-400 transition-all outline-none"
                      placeholder="seu@email.com"
                      required
                    />
                  </div>
                </div>

                {/* Senha */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5 uppercase tracking-wide">Senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
                    <input
                      id="login-password"
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full rounded-xl pl-10 pr-10 py-3 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-white/5 border-[1.5px] border-slate-200 dark:border-white/10 focus:border-cyan-500 dark:focus:border-cyan-400 transition-all outline-none"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
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
                    background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)',
                    boxShadow: '0 4px 24px -6px rgba(6,182,212,0.5)',
                  }}
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                  ) : (
                    <>Entrar <ChevronRight className="w-4 h-4"/></>
                  )}
                </motion.button>
              </form>

              {/* Links */}
              <div className="flex items-center justify-between mt-4">
                <button className="text-xs text-slate-400 dark:text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                  Esqueceu a senha?
                </button>
                <Link
                  to="/pricing"
                  className="text-xs font-semibold text-slate-500 dark:text-slate-300 hover:text-cyan-700 dark:hover:text-cyan-400 transition-colors flex items-center gap-1"
                >
                  Ver planos <ChevronRight className="w-3 h-3"/>
                </Link>
              </div>

              {/* CTA — Solicitar acesso (funil de leads, sem auto-trial) */}
              <div className="mt-8 pt-6 border-t border-slate-100 dark:border-white/10">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                  Ainda não é cliente? Conte pra gente sobre seu projeto — nossa equipe agenda
                  uma demonstração e libera seu acesso após análise.
                </p>
                <Link
                  to="/register-lead"
                  className="w-full inline-flex items-center justify-center gap-2 font-semibold py-2.5 px-4 rounded-xl text-sm transition-all bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-[1.5px] border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
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
              © {new Date().getFullYear()} IA Cloud Vision LTDA — Todos os direitos reservados
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
