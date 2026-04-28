/**
 * DemoNewPage — `/demo/new` (público, sem auth)
 *
 * Onboarding de lead estilo Monuv `/demo/new`:
 *  Step 1 — Conexão (sample feed | RTSP | WHEP | MJPEG)
 *  Step 2 — IA ao Vivo (preview com bounding boxes sintéticos sobre vídeo)
 *  Step 3 — Lead form (nome, email, empresa, telefone) → POST /demo/lead
 *
 * Sprint 2.5 — Camera Demo / lead capture.
 *
 * Endpoint backend planejado: POST /demo/lead { name, email, company, phone, source }
 * Falha silenciosa: se o backend rejeitar (404/CORS), guarda o lead em
 * localStorage `icv_pending_leads` e exibe sucesso ao usuário (warm fallback).
 */
import { useState, useMemo, FormEvent, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera as CameraIcon, Sparkles, ArrowRight, ArrowLeft, Check,
  Tag, ShieldCheck, Fingerprint, Car, Activity, Building2, Mail,
  Phone, User, Globe, Loader2, AlertTriangle, Play,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'

type DemoSource = 'sample' | 'rtsp' | 'whep' | 'mjpeg'

interface LeadForm {
  name: string
  email: string
  company: string
  phone: string
}

// Sample público — substitua por URL própria em produção
const SAMPLE_VIDEO_URL =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'

const ANALYTICS = [
  { id: 'faces',    icon: Fingerprint, label: 'Faces',     color: 'cyan',    desc: 'Reconhecimento facial' },
  { id: 'plates',   icon: Car,         label: 'Placas',    color: 'amber',   desc: 'OCR de placas LPR'      },
  { id: 'ppe',      icon: ShieldCheck, label: 'EPI',       color: 'emerald', desc: 'Auditoria de EPIs'      },
  { id: 'motion',   icon: Activity,    label: 'Movimento', color: 'violet',  desc: 'Detecção zonal'         },
] as const

const COLOR_CLASSES: Record<string, { ring: string; bg: string; text: string; border: string }> = {
  cyan:    { ring: 'ring-cyan-400/60',    bg: 'bg-cyan-500/15',    text: 'text-cyan-300',    border: 'border-cyan-500/40'    },
  amber:   { ring: 'ring-amber-400/60',   bg: 'bg-amber-500/15',   text: 'text-amber-300',   border: 'border-amber-500/40'   },
  emerald: { ring: 'ring-emerald-400/60', bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/40' },
  violet:  { ring: 'ring-violet-400/60',  bg: 'bg-violet-500/15',  text: 'text-violet-300',  border: 'border-violet-500/40'  },
}

// ── Synthetic detection overlay (boxes que se movem aleatoriamente) ───────
interface SynthBox {
  id: string
  kind: keyof typeof ANALYTIC_KIND_TO_COLOR
  x: number  // %
  y: number  // %
  w: number  // %
  h: number  // %
  label: string
  conf: number
}
const ANALYTIC_KIND_TO_COLOR = {
  faces:  'cyan',
  plates: 'amber',
  ppe:    'emerald',
  motion: 'violet',
} as const

function synthBoxes(enabled: Set<string>, tick: number): SynthBox[] {
  const boxes: SynthBox[] = []
  // Faces (1-2 boxes)
  if (enabled.has('faces')) {
    for (let i = 0; i < 2; i++) {
      const phase = (tick * 0.04 + i * 1.7) % (Math.PI * 2)
      boxes.push({
        id: `face-${i}`,
        kind: 'faces',
        x: 35 + i * 18 + Math.sin(phase) * 4,
        y: 28 + Math.cos(phase * 1.3) * 5,
        w: 8,
        h: 12,
        label: i === 0 ? 'João S. (94%)' : 'Visitor (61%)',
        conf: 0.94 - i * 0.33,
      })
    }
  }
  // Plates (1 box)
  if (enabled.has('plates')) {
    const phase = tick * 0.05
    boxes.push({
      id: 'plate-1',
      kind: 'plates',
      x: 42 + Math.sin(phase) * 6,
      y: 68,
      w: 14,
      h: 5,
      label: 'ABC-1D23 (98%)',
      conf: 0.98,
    })
  }
  // EPI (1 box, exclama no centro)
  if (enabled.has('ppe')) {
    boxes.push({
      id: 'ppe-1',
      kind: 'ppe',
      x: 18,
      y: 40,
      w: 14,
      h: 30,
      label: 'Sem capacete',
      conf: 0.81,
    })
  }
  // Motion (zona grande)
  if (enabled.has('motion')) {
    boxes.push({
      id: 'motion-1',
      kind: 'motion',
      x: 60,
      y: 18,
      w: 30,
      h: 60,
      label: 'Zona ativa',
      conf: 1,
    })
  }
  return boxes
}

export function DemoNewPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [source, setSource] = useState<DemoSource>('sample')
  const [streamUrl, setStreamUrl] = useState('')
  const [enabledIa, setEnabledIa] = useState<Set<string>>(new Set(['faces', 'plates']))
  const [tick, setTick] = useState(0)
  const [lead, setLead] = useState<LeadForm>({ name: '', email: '', company: '', phone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // tick para animar bounding boxes
  useEffect(() => {
    if (step !== 2) return
    const id = window.setInterval(() => setTick(t => t + 1), 60)
    return () => window.clearInterval(id)
  }, [step])

  const boxes = useMemo(() => synthBoxes(enabledIa, tick), [enabledIa, tick])

  function toggleIa(id: string) {
    setEnabledIa(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmitLead(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const payload = {
      ...lead,
      source: 'demo_new',
      streamSource: source,
      iaEnabled: Array.from(enabledIa),
      capturedAt: new Date().toISOString(),
    }
    try {
      await api.post('/demo/lead', payload)
      setSubmitted(true)
    } catch (err: any) {
      // Backend pode ainda não existir — guarda em localStorage como fallback
      try {
        const pending = JSON.parse(localStorage.getItem('icv_pending_leads') ?? '[]')
        pending.push(payload)
        localStorage.setItem('icv_pending_leads', JSON.stringify(pending))
        setSubmitted(true)
      } catch {
        setError(err?.response?.data?.message ?? 'Não conseguimos registrar agora. Tente novamente em alguns instantes.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-brand-navy text-slate-100 relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-brand-sky/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[400px] bg-brand-skyLight/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top bar — público */}
      <header className="relative z-10 px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-gradient flex items-center justify-center shrink-0 shadow-sky-glow">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none">
              <path d="M7 15h10a4 4 0 0 0 0-8 5 5 0 0 0-9.7-1A3.5 3.5 0 0 0 7 15Z"
                    stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(255,255,255,0.14)" />
              <circle cx="12" cy="11" r="2.3" fill="currentColor" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">IA Cloud Vision</p>
            <p className="text-[10px] text-brand-skyLight">Demo · 60 segundos</p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/pricing"
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-brand-skyLight text-xs font-semibold hover:bg-white/10 hover:text-white flex items-center gap-1.5 transition">
            <Tag className="w-3.5 h-3.5" /> Preços
          </Link>
          <Link to="/login"
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-brand-skyLight text-xs font-semibold hover:bg-white/10 hover:text-white transition">
            Entrar
          </Link>
        </div>
      </header>

      {/* Stepper */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 mt-2 mb-6">
        <div className="flex items-center justify-center gap-2 sm:gap-4">
          {[
            { n: 1, label: 'Conexão' },
            { n: 2, label: 'IA ao Vivo' },
            { n: 3, label: 'Comece grátis' },
          ].map((s, i) => (
            <div key={s.n} className="flex items-center gap-2 sm:gap-4">
              <div className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                step === s.n
                  ? 'bg-brand-sky/20 border-brand-sky/50 text-white'
                  : step > s.n
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-slate-500',
              )}>
                <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px]">
                  {step > s.n ? <Check className="w-3 h-3" /> : s.n}
                </span>
                {s.label}
              </div>
              {i < 2 && <div className="w-6 sm:w-12 h-px bg-white/10" />}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 pb-12">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="grid lg:grid-cols-2 gap-8"
            >
              {/* Pitch */}
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-sky/10 border border-brand-sky/30 text-brand-skyLight text-[11px] font-semibold">
                  <Sparkles className="w-3.5 h-3.5" /> Demo interativo · sem cadastro
                </div>
                <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
                  Veja IA Cloud Vision <span className="text-brand-skyLight">analisando</span> sua câmera em segundos.
                </h1>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Conecte um stream RTSP, MJPEG ou WHEP — ou use nossa cena de exemplo.
                  Nenhum cadastro necessário. O preview roda 100% no seu navegador, sem armazenar nada.
                </p>
                <ul className="space-y-2 text-sm text-slate-300">
                  {[
                    'Faces, placas, EPI e movimento — tudo num só dashboard',
                    'Federação cross-tenant: integradores compartilham eventos',
                    'WHEP < 700ms (vs ≥ 4s da concorrência)',
                  ].map(t => (
                    <li key={t} className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-brand-skyLight shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Form de conexão */}
              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-skyLight mb-3">
                  Origem da câmera
                </p>
                <div className="grid grid-cols-4 gap-1.5 mb-4">
                  {(['sample', 'rtsp', 'whep', 'mjpeg'] as DemoSource[]).map(s => (
                    <button
                      key={s}
                      onClick={() => setSource(s)}
                      className={cn(
                        'px-2 py-2 rounded-lg text-[11px] font-semibold border transition uppercase',
                        source === s
                          ? 'bg-brand-sky/25 border-brand-sky/50 text-white'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {source === 'sample' && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-200 mb-4">
                    Cena de exemplo (CDN pública). Use isto se ainda não tem câmera RTSP em mãos.
                  </div>
                )}
                {source !== 'sample' && (
                  <>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
                      URL do stream {source.toUpperCase()}
                    </label>
                    <input
                      type="text"
                      value={streamUrl}
                      onChange={e => setStreamUrl(e.target.value)}
                      placeholder={
                        source === 'rtsp'
                          ? 'rtsp://user:pass@10.0.0.5:554/stream1'
                          : source === 'whep'
                            ? 'https://seu-mediamtx/whep/cam01'
                            : 'http://camera/mjpeg/feed'
                      }
                      className="w-full px-3 py-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-white placeholder-slate-600 focus:border-brand-sky/60 focus:outline-none focus:ring-2 focus:ring-brand-sky/20 mb-3"
                    />
                    <p className="text-[11px] text-slate-500 mb-3">
                      Para o demo, RTSP/MJPEG/WHEP só serão validados após criar conta.
                      Continue para ver IA rodando na cena de exemplo.
                    </p>
                  </>
                )}

                <button
                  onClick={() => setStep(2)}
                  className="w-full px-4 py-3 rounded-lg bg-brand-gradient text-white font-semibold text-sm flex items-center justify-center gap-2 hover:shadow-sky-glow transition"
                >
                  <Play className="w-4 h-4" />
                  Iniciar preview
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="grid lg:grid-cols-[1fr_280px] gap-6"
            >
              {/* Preview com overlay */}
              <div className="space-y-3">
                <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                  <video
                    src={SAMPLE_VIDEO_URL}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                  />

                  {/* Bounding boxes sintéticos */}
                  <AnimatePresence>
                    {boxes.map(b => {
                      const c = COLOR_CLASSES[ANALYTIC_KIND_TO_COLOR[b.kind]]
                      return (
                        <motion.div
                          key={b.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className={cn('absolute pointer-events-none border-2 rounded', c.border)}
                          style={{
                            left: `${b.x}%`,
                            top: `${b.y}%`,
                            width: `${b.w}%`,
                            height: `${b.h}%`,
                          }}
                        >
                          <div className={cn(
                            'absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap',
                            c.bg, c.text, 'border', c.border,
                          )}>
                            {b.label}
                          </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>

                  {/* HUD top-left */}
                  <div className="absolute top-3 left-3 flex items-center gap-2">
                    <span className="px-2 py-1 rounded bg-rose-500/90 text-white text-[10px] font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> AO VIVO
                    </span>
                    <span className="px-2 py-1 rounded bg-black/60 backdrop-blur text-white text-[10px] font-mono">
                      DEMO · #DEMO01
                    </span>
                  </div>
                  {/* HUD top-right */}
                  <div className="absolute top-3 right-3">
                    <span className="px-2 py-1 rounded bg-black/60 backdrop-blur text-brand-skyLight text-[10px] font-mono">
                      {boxes.length} detecções · 24fps · 480p
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => setStep(1)}
                    className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 text-xs font-semibold hover:text-white transition flex items-center gap-1.5"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Voltar
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-brand-gradient text-white font-semibold text-sm flex items-center justify-center gap-2 hover:shadow-sky-glow transition"
                  >
                    Gostei — quero criar conta
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Toggles de IA */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-skyLight">
                  Analytics ativos
                </p>
                {ANALYTICS.map(a => {
                  const on = enabledIa.has(a.id)
                  const c = COLOR_CLASSES[a.color]
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggleIa(a.id)}
                      className={cn(
                        'w-full text-left p-3 rounded-xl border transition flex items-center gap-3',
                        on
                          ? cn(c.bg, c.border, 'shadow-md')
                          : 'bg-white/5 border-white/10 hover:bg-white/8',
                      )}
                    >
                      <a.icon className={cn('w-5 h-5 shrink-0', on ? c.text : 'text-slate-500')} />
                      <div className="flex-1">
                        <p className={cn('text-sm font-semibold', on ? 'text-white' : 'text-slate-300')}>
                          {a.label}
                        </p>
                        <p className="text-[11px] text-slate-500">{a.desc}</p>
                      </div>
                      <div className={cn(
                        'w-9 h-5 rounded-full border transition relative',
                        on ? cn(c.bg, c.border) : 'bg-white/5 border-white/15',
                      )}>
                        <span className={cn(
                          'absolute top-0.5 w-4 h-4 rounded-full transition-all',
                          on ? cn('right-0.5', c.text.replace('text-', 'bg-')) : 'left-0.5 bg-slate-500',
                        )} />
                      </div>
                    </button>
                  )
                })}
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-[11px] text-amber-200 leading-relaxed">
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                  Boxes do demo são <b>simulados</b> sobre vídeo de exemplo, para você visualizar a UX.
                  Ao criar conta, os modelos rodam de verdade no seu stream.
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && !submitted && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="max-w-xl mx-auto"
            >
              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 backdrop-blur">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-gradient shadow-sky-glow mb-3">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-1">Vamos criar sua conta?</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">14 dias grátis · sem cartão · até 4 câmeras</p>
                </div>

                <form onSubmit={handleSubmitLead} className="space-y-3">
                  <Field icon={User}    label="Nome completo" value={lead.name}    onChange={v => setLead({ ...lead, name: v })}    required />
                  <Field icon={Mail}    label="Email"          value={lead.email}   onChange={v => setLead({ ...lead, email: v })}   type="email" required />
                  <Field icon={Building2} label="Empresa"      value={lead.company} onChange={v => setLead({ ...lead, company: v })} />
                  <Field icon={Phone}   label="Telefone (WhatsApp)" value={lead.phone} onChange={v => setLead({ ...lead, phone: v })} type="tel" />

                  {error && (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-xs text-rose-300 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || !lead.name || !lead.email}
                    className="w-full px-4 py-3 rounded-lg bg-brand-gradient text-white font-semibold text-sm flex items-center justify-center gap-2 hover:shadow-sky-glow transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {submitting ? 'Enviando…' : 'Criar conta grátis'}
                  </button>
                  <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                    Ao continuar, você concorda com nossos termos de uso e política de privacidade.
                    Tratamos dados conforme LGPD.
                  </p>
                </form>
                <div className="text-center mt-3">
                  <button
                    onClick={() => setStep(2)}
                    className="text-xs text-slate-500 hover:text-slate-300 transition inline-flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" /> Voltar para o preview
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && submitted && (
            <motion.div
              key="step3done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="max-w-xl mx-auto text-center bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-8"
            >
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 mb-4">
                <Check className="w-8 h-8 text-emerald-600 dark:text-emerald-300" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Recebido, {lead.name.split(' ')[0]}!</h2>
              <p className="text-sm text-slate-400 mb-6">
                Em até 1h útil você recebe no <span className="text-emerald-600 dark:text-emerald-300">{lead.email}</span> as credenciais
                e um onboarding de 15 minutos com nosso time.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Link to="/pricing"
                  className="px-4 py-2.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-200 text-sm font-semibold hover:bg-white/10 hover:text-white transition flex items-center justify-center gap-1.5">
                  <Tag className="w-4 h-4" /> Ver planos
                </Link>
                <button onClick={() => navigate('/login')}
                  className="px-4 py-2.5 rounded-lg bg-brand-gradient text-white text-sm font-semibold hover:shadow-sky-glow transition flex items-center justify-center gap-1.5">
                  Já tenho conta — entrar <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-4 text-center">
        <p className="text-[10px] text-slate-600">
          IA Cloud Vision · VSaaS Analytics · Demo em <Globe className="inline w-3 h-3 mb-0.5" /> &nbsp;qualquer câmera, qualquer rede
        </p>
      </footer>
    </div>
  )
}

// ── Field component ───────────────────────────────────────────────────────
function Field({
  icon: Icon, label, value, onChange, type = 'text', required = false,
}: {
  icon: typeof User
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-400 mb-1 block">
        {label} {required && <span className="text-rose-400">*</span>}
      </span>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
          className="w-full pl-9 pr-3 py-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-white placeholder-slate-600 focus:border-brand-sky/60 focus:outline-none focus:ring-2 focus:ring-brand-sky/20"
        />
      </div>
    </label>
  )
}
