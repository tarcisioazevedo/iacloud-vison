/**
 * DemoTenantModal — Sprint Demo.1
 *
 * Permite INTEGRADOR_ADMIN criar um tenant demo para um prospect sem passar
 * pelo CRM/SUPER_ADMIN. Gera ClienteFinal + User admin com senha temporária.
 *
 * Fluxo:
 *   1. Integrador preenche formulário com dados do prospect
 *   2. Backend cria ClienteFinal (isDemo=true) + User admin
 *   3. Backend tenta enviar e-mail de boas-vindas (best-effort)
 *   4. Modal exibe credenciais + botão "Copiar link" para o integrador enviar
 */
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X, FlaskConical, Building2, Mail, User, Phone,
  MapPin, Clock, Camera, Copy, Check, ExternalLink,
  AlertTriangle, CheckCircle2, Loader2,
} from 'lucide-react'
import { createDemoTenant, formatApiError, type Vertical, type DemoCreatedResult } from '../../api/client'
import { cn } from '../../lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: () => void
}

const VERTICALS: { value: Vertical; label: string }[] = [
  { value: 'RETAIL',        label: 'Varejo' },
  { value: 'SHOPPING',      label: 'Shopping' },
  { value: 'EDUCATION',     label: 'Educação' },
  { value: 'INDUSTRY',      label: 'Indústria' },
  { value: 'LOGISTICS',     label: 'Logística' },
  { value: 'PARKING',       label: 'Estacionamento' },
  { value: 'CONDOMINIUM',   label: 'Condomínio' },
  { value: 'PUBLIC_SAFETY', label: 'Segurança Pública' },
  { value: 'OTHER',         label: 'Outro' },
]

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50'
const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1'

export function DemoTenantModal({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<'form' | 'result'>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<DemoCreatedResult | null>(null)
  const [copied, setCopied] = useState<'pw' | 'email' | null>(null)

  // Form state
  const [form, setForm] = useState({
    name:        '',
    contactName: '',
    email:       '',
    phone:       '',
    city:        '',
    state:       '',
    vertical:    'OTHER' as Vertical,
    ttlDays:     14,
    cameraLimit: 5,
    notes:       '',
  })

  function reset() {
    setStep('form')
    setLoading(false)
    setError('')
    setResult(null)
    setCopied(null)
    setForm({
      name: '', contactName: '', email: '', phone: '',
      city: '', state: '', vertical: 'OTHER', ttlDays: 14, cameraLimit: 5, notes: '',
    })
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await createDemoTenant({
        name:         form.name,
        contactName:  form.contactName,
        email:        form.email,
        phone:        form.phone || undefined,
        city:         form.city || undefined,
        state:        form.state || undefined,
        vertical:     form.vertical,
        ttlDays:      form.ttlDays,
        cameraLimit:  form.cameraLimit,
        notes:        form.notes || undefined,
      })
      setResult(res)
      setStep('result')
      onCreated?.()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  function copyToClipboard(text: string, which: 'pw' | 'email') {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(which)
    setTimeout(() => setCopied(null), 2000)
  }

  const loginUrl = `${window.location.origin}/login`

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

          <motion.div
            className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 bg-gradient-to-r from-amber-500/10 to-orange-500/10">
              <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <FlaskConical className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-white">Criar Demo para Prospect</h2>
                <p className="text-xs text-slate-400 mt-0.5">Acesso temporário sem necessidade de aprovação</p>
              </div>
              <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {step === 'form' ? (
              <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Dados do prospect */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={labelCls}>
                      <Building2 className="w-3 h-3 inline mr-1" />
                      Empresa / Prospect *
                    </label>
                    <input
                      required
                      className={inputCls}
                      placeholder="Construtora ABC"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <User className="w-3 h-3 inline mr-1" />
                      Nome do Contato *
                    </label>
                    <input
                      required
                      className={inputCls}
                      placeholder="João Silva"
                      value={form.contactName}
                      onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Phone className="w-3 h-3 inline mr-1" />
                      Telefone
                    </label>
                    <input
                      type="tel"
                      className={inputCls}
                      placeholder="(11) 99999-9999"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>
                      <Mail className="w-3 h-3 inline mr-1" />
                      E-mail do Prospect *
                    </label>
                    <input
                      required
                      type="email"
                      className={inputCls}
                      placeholder="joao@empresa.com.br"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    />
                    <p className="text-xs text-slate-500 mt-1">Este será o login do prospect. Deve ser único na plataforma.</p>
                  </div>
                  <div>
                    <label className={labelCls}>
                      <MapPin className="w-3 h-3 inline mr-1" />
                      Cidade
                    </label>
                    <input
                      className={inputCls}
                      placeholder="São Paulo"
                      value={form.city}
                      onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Estado</label>
                    <input
                      className={inputCls}
                      placeholder="SP"
                      maxLength={2}
                      value={form.state}
                      onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase() }))}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Vertical / Segmento</label>
                    <select
                      className={inputCls}
                      value={form.vertical}
                      onChange={e => setForm(f => ({ ...f, vertical: e.target.value as Vertical }))}
                    >
                      {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Parâmetros do demo */}
                <div className="border border-white/10 rounded-xl p-4 bg-white/3 space-y-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Parâmetros do Demo</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>
                        <Clock className="w-3 h-3 inline mr-1" />
                        Duração (dias)
                      </label>
                      <input
                        type="number"
                        min={1} max={90}
                        className={inputCls}
                        value={form.ttlDays}
                        onChange={e => setForm(f => ({ ...f, ttlDays: Number(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>
                        <Camera className="w-3 h-3 inline mr-1" />
                        Câmeras máx.
                      </label>
                      <input
                        type="number"
                        min={1} max={50}
                        className={inputCls}
                        value={form.cameraLimit}
                        onChange={e => setForm(f => ({ ...f, cameraLimit: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Notas internas (não visível ao prospect)</label>
                    <textarea
                      className={cn(inputCls, 'resize-none h-16 text-xs')}
                      placeholder="Oportunidade via LinkedIn, interesse em 20 câmeras…"
                      value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-300">{error}</p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 text-sm transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-black text-sm font-bold transition-colors"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                    {loading ? 'Criando…' : 'Criar Demo'}
                  </button>
                </div>
              </form>
            ) : (
              /* Resultado */
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <p className="text-sm font-semibold text-white">Demo criado com sucesso!</p>
                </div>

                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                  <p className="text-xs text-emerald-300 font-medium">
                    Compartilhe as credenciais abaixo com {result?.demo.user.name}:
                  </p>

                  {/* E-mail */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-400">E-mail de acesso</p>
                      <p className="text-sm font-mono text-white truncate">{result?.demo.user.email}</p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(result?.demo.user.email ?? '', 'email')}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                      title="Copiar e-mail"
                    >
                      {copied === 'email' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Senha */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-400">Senha temporária</p>
                      <p className="text-sm font-mono text-amber-300">{result?.demo.user.tempPassword}</p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(result?.demo.user.tempPassword ?? '', 'pw')}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                      title="Copiar senha"
                    >
                      {copied === 'pw' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Validade */}
                  <div className="text-xs text-slate-400">
                    Válido até{' '}
                    <span className="text-slate-200">
                      {result?.demo.demoExpiresAt
                        ? new Date(result.demo.demoExpiresAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
                        : '—'}
                    </span>
                    {' '}· máx. <span className="text-slate-200">{result?.demo.demoCameraLimit} câmera{(result?.demo.demoCameraLimit ?? 1) !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <p className="text-xs text-amber-300">
                    ⚠️ A senha aparece <strong>apenas agora</strong>. Se o e-mail não foi enviado, copie e compartilhe via WhatsApp/e-mail manualmente.
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <a
                    href={loginUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 text-xs transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir login
                  </a>
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-bold transition-colors"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
