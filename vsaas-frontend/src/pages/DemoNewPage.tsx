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

// Vídeo de tráfego (Intel IoT DevKit) para representar os cenários perfeitamente
const SAMPLE_VIDEO_URL = '/demo_iot.mp4'


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
  
  // O ciclo do vídeo é contínuo, usamos tick para mover os objetos de forma natural na perspectiva da rua
  
  // 1. Faces (Pedestres caminhando)
  if (enabled.has('faces')) {
    // Pedestre da esquerda para a direita (longe)
    const p1 = (tick * 0.15) % 120 - 10
    if (p1 > -5 && p1 < 105) {
      boxes.push({
        id: 'face-1',
        kind: 'faces',
        x: p1,
        y: 35 + Math.sin(p1 * 0.1) * 1, // Leve sobe/desce do caminhar
        w: 3 + (p1 > 50 ? 0.5 : 0),
        h: 10 + (p1 > 50 ? 1 : 0),
        label: 'Visitor (74%)',
        conf: 0.74 + (Math.sin(tick) * 0.05),
      })
    }

    // Pedestre da direita para a esquerda (mais perto)
    const p2 = 110 - ((tick * 0.22) % 130)
    if (p2 > -5 && p2 < 105) {
      boxes.push({
        id: 'face-2',
        kind: 'faces',
        x: p2,
        y: 45 + Math.cos(p2 * 0.15) * 1.5,
        w: 5,
        h: 15,
        label: 'João S. (94%)',
        conf: 0.94 - (Math.cos(tick) * 0.03),
      })
    }
  }

  // 2. Placas (Carros na rua)
  if (enabled.has('plates')) {
    // Carro indo da direita para a esquerda (pista de cima)
    const c1 = 120 - ((tick * 0.5) % 140)
    if (c1 > -10 && c1 < 110) {
      boxes.push({
        id: 'plate-1',
        kind: 'plates',
        x: c1,
        y: 55,
        w: 12 + (c1 < 50 ? 2 : 0), // Simula perspectiva
        h: 8 + (c1 < 50 ? 1 : 0),
        label: 'ABC-1D23 (98%)',
        conf: 0.98,
      })
    }

    // Carro indo da esquerda para a direita (pista de baixo)
    const c2 = (tick * 0.4 + 40) % 150 - 20
    if (c2 > -10 && c2 < 110) {
      boxes.push({
        id: 'plate-2',
        kind: 'plates',
        x: c2,
        y: 72,
        w: 16,
        h: 12,
        label: 'XYZ-9988 (88%)',
        conf: 0.88 + (Math.sin(tick) * 0.02),
      })
    }
  }

  // 3. EPI (Auditoria em um trabalhador na lateral da via)
  if (enabled.has('ppe')) {
    // Parado na esquerda, simulando um agente de trânsito ou operário
    const ppePhase = Math.sin(tick * 0.05)
    boxes.push({
      id: 'ppe-1',
      kind: 'ppe',
      x: 12 + ppePhase * 0.2, // Respiração/movimento mínimo
      y: 48 + Math.cos(tick * 0.03) * 0.3,
      w: 6,
      h: 18,
      label: 'SEM COLETE',
      conf: 0.91,
    })
  }

  // 4. Movimento (Zona de detecção configurada sobre o asfalto)
  if (enabled.has('motion')) {
    boxes.push({
      id: 'motion-1',
      kind: 'motion',
      x: 10,
      y: 52,
      w: 80,
      h: 38,
      label: 'ZONA ATIVA',
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
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-slate-900 dark:text-white" fill="none">
              <path d="M7 15h10a4 4 0 0 0 0-8 5 5 0 0 0-9.7-1A3.5 3.5 0 0 0 7 15Z"
                    stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(255,255,255,0.14)" />
              <circle cx="12" cy="11" r="2.3" fill="currentColor" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">VSaaS</p>
            <p className="text-[10px] text-brand-skyLight">Demo · 60 segundos</p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/pricing"
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-brand-skyLight text-xs font-semibold hover:bg-slate-100 dark:bg-white/10 hover:text-slate-900 dark:text-white flex items-center gap-1.5 transition">
            <Tag className="w-3.5 h-3.5" /> Preços
          </Link>
          <Link to="/login"
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-brand-skyLight text-xs font-semibold hover:bg-slate-100 dark:bg-white/10 hover:text-slate-900 dark:text-white transition">
            Entrar
          </Link>
        </div>
      </header>

      {/* Stepper */}
      <div className="relative z-10 max-w-6xl mx-auto px-6 mt-2 mb-6">
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
                  ? 'bg-brand-sky/20 border-brand-sky/50 text-slate-900 dark:text-white shadow-[0_0_15px_rgba(56,189,248,0.3)]'
                  : step > s.n
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                    : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500',
              )}>
                <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-[10px]">
                  {step > s.n ? <Check className="w-3 h-3" /> : s.n}
                </span>
                {s.label}
              </div>
              {i < 2 && <div className="w-6 sm:w-12 h-px bg-slate-100 dark:bg-white/10" />}
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
                <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white leading-tight">
                  Veja VSaaS <span className="text-brand-skyLight">analisando</span> sua câmera em segundos.
                </h1>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Conecte um stream RTSP, MJPEG ou WHEP — ou use nossa cena de exemplo.
                  Nenhum cadastro necessário. O preview roda 100% no seu navegador, sem armazenar nada.
                </p>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
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
              <div className="bg-white/[0.04] border border-slate-200 dark:border-white/10 rounded-2xl p-6 backdrop-blur">
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
                          ? 'bg-brand-sky/25 border-brand-sky/50 text-slate-900 dark:text-white'
                          : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-900 dark:text-white hover:bg-slate-100 dark:bg-white/10',
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
                      className="w-full px-3 py-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-600 focus:border-brand-sky/60 focus:outline-none focus:ring-2 focus:ring-brand-sky/20 mb-3"
                    />
                    <p className="text-[11px] text-slate-500 mb-3">
                      Para o demo, RTSP/MJPEG/WHEP só serão validados após criar conta.
                      Continue para ver IA rodando na cena de exemplo.
                    </p>
                  </>
                )}

                <button
                  onClick={() => setStep(2)}
                  className="w-full px-4 py-3 rounded-lg bg-brand-gradient text-slate-900 dark:text-white font-semibold text-sm flex items-center justify-center gap-2 hover:shadow-sky-glow transition"
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
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="grid lg:grid-cols-[1fr_320px] gap-6 max-w-7xl mx-auto"
            >
              {/* Preview com overlay Avançado */}
              <div className="space-y-4">
                <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-brand-sky/20 shadow-[0_0_40px_rgba(56,189,248,0.1)] group">
                  {/* Scanlines Effect */}
                  <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] z-20 opacity-30 mix-blend-overlay"></div>
                  
                  {/* Vignette */}
                  <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_100px_rgba(0,0,0,0.9)] z-20"></div>

                  <video
                    src={SAMPLE_VIDEO_URL}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover filter contrast-125 saturate-50 brightness-90"
                  />

                  {/* Bounding boxes sintéticos Hollywood Style */}
                  <AnimatePresence>
                    {boxes.map(b => {
                      const c = COLOR_CLASSES[ANALYTIC_KIND_TO_COLOR[b.kind]]
                      return (
                        <motion.div
                          key={b.id}
                          initial={{ opacity: 0, scale: 1.2 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.3 }}
                          className={cn('absolute pointer-events-none z-30')}
                          style={{
                            left: `${b.x}%`,
                            top: `${b.y}%`,
                            width: `${b.w}%`,
                            height: `${b.h}%`,
                          }}
                        >
                          {/* Corner brackets */}
                          <div className={cn("absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2", c.border)} />
                          <div className={cn("absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2", c.border)} />
                          <div className={cn("absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2", c.border)} />
                          <div className={cn("absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2", c.border)} />
                          
                          {/* Target Box */}
                          <div className={cn('absolute inset-0 border border-white/20', c.bg)} />

                          {/* Data Label */}
                          <div className="absolute -right-2 top-0 translate-x-full flex flex-col gap-0.5">
                            <div className={cn(
                              'px-2 py-0.5 text-[10px] font-mono font-bold whitespace-nowrap bg-black/80 backdrop-blur-md border-l-2 uppercase tracking-wider',
                              c.text, c.border
                            )}>
                              {b.label}
                            </div>
                            <div className="px-2 py-0.5 text-[9px] font-mono text-slate-900 dark:text-white/70 bg-black/50 backdrop-blur-sm w-fit">
                              TRK: {Math.random().toString(16).slice(2, 8).toUpperCase()}
                            </div>
                          </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>

                  {/* HUD Elements */}
                  <div className="absolute top-4 left-4 z-40 flex items-center gap-3">
                    <div className="flex items-center gap-2 px-2 py-1 bg-black/50 border border-slate-200 dark:border-white/10 rounded backdrop-blur-md">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
                      <span className="text-slate-900 dark:text-white text-[10px] font-bold tracking-widest">REC</span>
                    </div>
                    <div className="px-2 py-1 bg-black/50 border border-slate-200 dark:border-white/10 rounded backdrop-blur-md text-brand-skyLight text-[10px] font-mono">
                      {new Date().toISOString().replace('T', ' ').slice(0, 19)}Z
                    </div>
                  </div>

                  <div className="absolute top-4 right-4 z-40">
                    <div className="px-3 py-1.5 bg-black/60 border border-brand-sky/30 rounded backdrop-blur-md text-brand-skyLight text-[10px] font-mono flex flex-col items-end">
                      <span>SYS. STATUS: <span className="text-emerald-400">NOMINAL</span></span>
                      <span>FPS: {Math.floor(24 + Math.random() * 2)} | LAT: 42ms</span>
                    </div>
                  </div>

                  {/* Crosshair central sutil */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 opacity-20">
                    <div className="w-[1px] h-full bg-brand-sky/50" />
                    <div className="h-[1px] w-full bg-brand-sky/50 absolute" />
                    <div className="w-32 h-32 border border-brand-sky/50 rounded-full absolute" />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 text-sm font-semibold hover:text-slate-900 dark:text-white transition flex items-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" /> Voltar
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    className="flex-1 px-5 py-3 rounded-lg bg-brand-gradient text-slate-900 dark:text-white font-bold text-sm flex items-center justify-center gap-2 hover:shadow-[0_0_20px_rgba(56,189,248,0.4)] transition-all hover:-translate-y-0.5"
                  >
                    Fantástico! Quero testar na minha câmera
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Toggles de IA & Telemetry Log */}
              <div className="space-y-4 flex flex-col">
                <div className="bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-xl">
                  <p className="text-xs font-bold uppercase tracking-widest text-brand-skyLight mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Módulos de Inteligência
                  </p>
                  <div className="space-y-2">
                    {ANALYTICS.map(a => {
                      const on = enabledIa.has(a.id)
                      const c = COLOR_CLASSES[a.color]
                      return (
                        <button
                          key={a.id}
                          onClick={() => toggleIa(a.id)}
                          className={cn(
                            'w-full text-left p-3 rounded-lg border transition-all duration-300 flex items-center gap-3 relative overflow-hidden',
                            on
                              ? cn('bg-black/60', c.border, 'shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]')
                              : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/5 hover:bg-slate-100 dark:bg-white/10',
                          )}
                        >
                          {on && (
                            <motion.div 
                              layoutId="activeGlow"
                              className={cn("absolute left-0 top-0 bottom-0 w-1", c.bg.replace('15', '100'))} 
                            />
                          )}
                          <a.icon className={cn('w-5 h-5 shrink-0 z-10', on ? c.text : 'text-slate-500')} />
                          <div className="flex-1 z-10">
                            <p className={cn('text-sm font-bold tracking-wide', on ? 'text-slate-900 dark:text-white' : 'text-slate-400')}>
                              {a.label}
                            </p>
                          </div>
                          <div className={cn(
                            'w-10 h-5 rounded-full border transition-all relative z-10',
                            on ? cn(c.bg, c.border) : 'bg-slate-100 dark:bg-white/10 border-white/20',
                          )}>
                            <span className={cn(
                              'absolute top-0.5 w-4 h-4 rounded-full transition-all shadow-sm',
                              on ? cn('right-0.5', c.text.replace('text-', 'bg-')) : 'left-0.5 bg-slate-400',
                            )} />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Simulated Telemetry Log */}
                <div className="flex-1 bg-black/80 border border-slate-200 dark:border-white/10 rounded-xl p-4 flex flex-col overflow-hidden min-h-[200px]">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Live Telemetry</p>
                  <div className="flex-1 overflow-hidden relative flex flex-col justify-end space-y-1 font-mono text-[9px] sm:text-[10px]">
                    <div className="absolute inset-0 bg-gradient-to-b from-black/80 to-transparent z-10 pointer-events-none" />
                    {boxes.map((b, i) => {
                      const c = COLOR_CLASSES[ANALYTIC_KIND_TO_COLOR[b.kind]]
                      return (
                         <motion.div
                           key={`${b.id}-${tick}`}
                           initial={{ opacity: 0, x: -10 }}
                           animate={{ opacity: 1, x: 0 }}
                           className="flex items-center gap-2 z-0"
                         >
                           <span className="text-slate-500">[{new Date().toISOString().slice(11, 19)}.{tick.toString().padStart(3,'0')}]</span>
                           <span className={cn(c.text, "font-bold uppercase")}>[{b.kind}]</span>
                           <span className="text-slate-600 dark:text-slate-300 flex-1 truncate">Detected {b.label} at x:{b.x.toFixed(1)} y:{b.y.toFixed(1)}</span>
                         </motion.div>
                      )
                    }).slice(0, 5)}
                     <motion.div
                           key={`sys-${tick}`}
                           initial={{ opacity: 0 }}
                           animate={{ opacity: 1 }}
                           className="flex items-center gap-2 z-0 text-brand-sky/50"
                         >
                           <span>[{new Date().toISOString().slice(11, 19)}.{tick.toString().padStart(3,'0')}]</span>
                           <span>[SYS]</span>
                           <span>Inference latency: {Math.floor(30 + Math.random() * 15)}ms</span>
                         </motion.div>
                  </div>
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
              <div className="bg-white/[0.04] border border-slate-200 dark:border-white/10 rounded-2xl p-6 backdrop-blur">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-gradient shadow-sky-glow mb-3">
                    <Sparkles className="w-6 h-6 text-slate-900 dark:text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Vamos criar sua conta?</h2>
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
                    className="w-full px-4 py-3 rounded-lg bg-brand-gradient text-slate-900 dark:text-white font-semibold text-sm flex items-center justify-center gap-2 hover:shadow-sky-glow transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="text-xs text-slate-500 hover:text-slate-600 dark:text-slate-300 transition inline-flex items-center gap-1"
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
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Recebido, {lead.name.split(' ')[0]}!</h2>
              <p className="text-sm text-slate-400 mb-6">
                Em até 1h útil você recebe no <span className="text-emerald-600 dark:text-emerald-300">{lead.email}</span> as credenciais
                e um onboarding de 15 minutos com nosso time.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Link to="/pricing"
                  className="px-4 py-2.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-200 text-sm font-semibold hover:bg-slate-100 dark:bg-white/10 hover:text-slate-900 dark:text-white transition flex items-center justify-center gap-1.5">
                  <Tag className="w-4 h-4" /> Ver planos
                </Link>
                <button onClick={() => navigate('/login')}
                  className="px-4 py-2.5 rounded-lg bg-brand-gradient text-slate-900 dark:text-white text-sm font-semibold hover:shadow-sky-glow transition flex items-center justify-center gap-1.5">
                  Já tenho conta — entrar <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-200 dark:border-white/5 py-4 text-center">
        <p className="text-[10px] text-slate-600">
          VSaaS · VSaaS Analytics · Demo em <Globe className="inline w-3 h-3 mb-0.5" /> &nbsp;qualquer câmera, qualquer rede
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
          className="w-full pl-9 pr-3 py-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-600 focus:border-brand-sky/60 focus:outline-none focus:ring-2 focus:ring-brand-sky/20"
        />
      </div>
    </label>
  )
}
