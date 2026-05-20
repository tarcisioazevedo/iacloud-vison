/**
 * RegisterLeadPage — `/register-lead` (público, sem auth)
 *
 * Lote 0 do onboarding: substitui o auto-trial. Coleta dados de qualificação
 * e cria um Lead no CRM interno (status=NEW). Admin global do Fabricante
 * trabalha o lead manualmente até converter em Integrador ou ClienteFinal.
 *
 * Wizard em 3 etapas:
 *   1. Tipo (Integrador × Cliente final)
 *   2. Empresa (CNPJ → BrasilAPI auto-preenche razão social/cidade/UF)
 *   3. Contexto (volume de câmeras, central de alarme, projeto, mensagem)
 *
 * Cliente final na verdade ENTRA no integrador "VSaaS Direct"
 * (handled pelo Admin global no Lote 1) — aqui só capturamos o lead.
 */
import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Building2, User, Mail, Phone, FileText, ArrowRight, ArrowLeft,
  Check, Loader2, AlertTriangle, Briefcase, Camera, ShieldCheck, Sparkles,
  ChevronRight, Search,
} from 'lucide-react'
import { api, formatApiError } from '../api/client'

type LeadKind = 'INTEGRADOR' | 'CLIENTE_FINAL'

interface LeadForm {
  kind: LeadKind | null
  // contato
  contactName:  string
  contactEmail: string
  contactPhone: string
  contactRole:  string
  // empresa
  companyName:      string
  companyTradeName: string
  cnpj:             string
  city:             string
  state:            string
  // contexto
  alarmCentral: '' | 'YES' | 'NO' | 'BUILDING'
  cameraVolume: '' | 'LT_50' | '50_500' | '500_2000' | 'GT_2000'
  projectStage: string
  message:      string
  acceptTerms:  boolean
}

const EMPTY_FORM: LeadForm = {
  kind: null,
  contactName: '', contactEmail: '', contactPhone: '', contactRole: '',
  companyName: '', companyTradeName: '', cnpj: '', city: '', state: '',
  alarmCentral: '', cameraVolume: '', projectStage: '', message: '',
  acceptTerms: false,
}

const VOLUME_LABEL: Record<string, { label: string; hint: string }> = {
  LT_50:    { label: 'Até 50 câmeras',           hint: 'Pequeno comércio / um site' },
  '50_500': { label: 'De 50 a 500 câmeras',      hint: 'Multi-site, indústria média'  },
  '500_2000':{ label: 'De 500 a 2.000 câmeras',  hint: 'Grande operação, varejo nacional' },
  GT_2000:  { label: 'Mais de 2.000 câmeras',    hint: 'Smart city / portfólio enterprise' },
}

const inputCls = "w-full rounded-lg px-3 py-2.5 text-sm outline-none border-1.5 transition-colors bg-white dark:bg-space-900/50 border-slate-200 dark:border-white/10 text-slate-900 dark:text-white focus:border-cyan-500 dark:focus:border-cyan-400 placeholder:text-slate-400 dark:placeholder:text-slate-500"

export function RegisterLeadPage() {
  const navigate = useNavigate()
  const [step, setStep]       = useState<1 | 2 | 3 | 4>(1)
  const [form, setForm]       = useState<LeadForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [error, setError]     = useState('')

  function update<K extends keyof LeadForm>(key: K, value: LeadForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function next() {
    setError('')
    // validações por etapa
    if (step === 1 && !form.kind) {
      setError('Selecione o tipo de cadastro')
      return
    }
    if (step === 2) {
      if (!form.companyName.trim()) {
        setError(form.kind === 'INTEGRADOR'
          ? 'Razão social é obrigatória para integradores'
          : 'Informe o nome da empresa')
        return
      }
      if (form.kind === 'INTEGRADOR' && form.cnpj.replace(/\D+/g, '').length !== 14) {
        setError('CNPJ obrigatório (14 dígitos) para cadastro de integradores')
        return
      }
    }
    if (step === 3) {
      if (form.contactName.trim().length < 2) { setError('Informe seu nome'); return }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) { setError('E-mail inválido'); return }
    }
    setStep((s) => Math.min(4, (s + 1)) as 1 | 2 | 3 | 4)
  }

  function prev() {
    setError('')
    setStep((s) => Math.max(1, (s - 1)) as 1 | 2 | 3 | 4)
  }

  async function lookupCnpj() {
    const digits = form.cnpj.replace(/\D+/g, '')
    if (digits.length !== 14) {
      setError('CNPJ precisa ter 14 dígitos')
      return
    }
    setError('')
    setCnpjLoading(true)
    try {
      const { data } = await api.post(`/leads/cnpj/${digits}`)
      setForm((f) => ({
        ...f,
        cnpj:             digits,
        companyName:      f.companyName      || data.razaoSocial   || '',
        companyTradeName: f.companyTradeName || data.nomeFantasia  || '',
        city:             f.city             || data.cidade        || '',
        state:            f.state            || data.uf            || '',
        contactPhone:     f.contactPhone     || (data.telefone ?? ''),
      }))
    } catch (err) {
      setError('Não conseguimos consultar este CNPJ — preencha manualmente.')
    } finally {
      setCnpjLoading(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.acceptTerms) {
      setError('É necessário aceitar os termos para enviar')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/leads', {
        kind: form.kind,
        contactName:  form.contactName.trim(),
        contactEmail: form.contactEmail.trim().toLowerCase(),
        contactPhone: form.contactPhone || null,
        contactRole:  form.contactRole  || null,
        companyName:      form.companyName.trim() || null,
        companyTradeName: form.companyTradeName.trim() || null,
        cnpj:             form.cnpj.replace(/\D+/g, '') || null,
        city:             form.city  || null,
        state:            form.state.toUpperCase() || null,
        alarmCentral:     form.alarmCentral || null,
        cameraVolume:     form.cameraVolume || null,
        projectStage:     form.projectStage || null,
        message:          form.message      || null,
        source:           'register_lead_form',
        acceptTerms:      true,
      })
      setStep(4)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-cyan-50 dark:from-space-950 dark:to-space-900"
      style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-200 dark:border-white/10 bg-white/70 dark:bg-space-900/70 backdrop-blur">
        <Link to="/login" className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
          <ArrowLeft className="w-4 h-4"/>
          <span className="text-sm font-semibold">Voltar pra login</span>
        </Link>
        <p className="text-xs text-slate-500">
          IA <span className="text-cyan-600 dark:text-cyan-400 font-bold">Cloud Vision</span> — Solicitação de acesso
        </p>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl">
          {/* Stepper */}
          {step < 4 && (
            <div className="flex items-center gap-2 mb-8">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex-1">
                  <div className={`h-1.5 rounded-full transition-colors ${step >= s ? 'bg-cyan-500' : 'bg-slate-200 dark:bg-white/10'}`} />
                  <p className={`text-[10px] mt-1.5 font-semibold uppercase tracking-wide ${step >= s ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-400 dark:text-slate-500'}`}>
                    Etapa {s}
                  </p>
                </div>
              ))}
            </div>
          )}

          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="bg-white dark:bg-space-900/70 dark:backdrop-blur rounded-2xl shadow-lg border border-slate-200 dark:border-white/10 p-8"
          >
            <AnimatePresence mode="wait">
              {/* ─────────────── Etapa 1: tipo ─────────────── */}
              {step === 1 && (
                <motion.div key="s1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Vamos começar</h1>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">Como você se identifica? Ajuda nossa equipe a preparar a demonstração certa.</p>

                  <div className="grid gap-3">
                    {([
                      {
                        kind: 'INTEGRADOR' as LeadKind,
                        title: 'Sou integrador / revenda de segurança eletrônica',
                        desc:  'Tenho carteira de clientes finais e quero oferecer a plataforma como serviço da minha empresa.',
                        icon:  Briefcase,
                      },
                      {
                        kind: 'CLIENTE_FINAL' as LeadKind,
                        title: 'Sou cliente final (preciso para minha operação)',
                        desc:  'Quero monitorar minhas câmeras direto. Vamos te conectar a um integrador ou atender pela IACV Direct.',
                        icon:  Building2,
                      },
                    ]).map((opt) => {
                      const Icon = opt.icon
                      const selected = form.kind === opt.kind
                      return (
                        <button
                          key={opt.kind}
                          type="button"
                          onClick={() => update('kind', opt.kind)}
                          className={`text-left p-4 rounded-xl border-2 transition-all flex gap-3 ${
                            selected 
                              ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10' 
                              : 'border-slate-200 dark:border-white/10 bg-white dark:bg-space-900/50 hover:border-slate-300 dark:hover:border-white/20'
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                            selected ? 'bg-cyan-500 text-white' : 'bg-slate-100 dark:bg-space-800 text-cyan-600 dark:text-cyan-400'
                          }`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-slate-900 dark:text-white text-sm">{opt.title}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{opt.desc}</p>
                          </div>
                          {selected && <Check className="w-5 h-5 text-cyan-600 dark:text-cyan-400 shrink-0"/>}
                        </button>
                      )
                    })}
                  </div>
                </motion.div>
              )}

              {/* ─────────────── Etapa 2: empresa ─────────────── */}
              {step === 2 && (
                <motion.div key="s2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Sobre a empresa</h1>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
                    {form.kind === 'INTEGRADOR'
                      ? 'Vamos verificar seu CNPJ para acelerar a aprovação.'
                      : 'Me conta um pouco da sua operação. Se tiver CNPJ, melhor — preenchemos os dados pra você.'}
                  </p>

                  {/* CNPJ + lookup */}
                  <Field label={`CNPJ${form.kind === 'INTEGRADOR' ? ' *' : ' (opcional)'}`}>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={form.cnpj}
                        onChange={(e) => update('cnpj', e.target.value)}
                        placeholder="00.000.000/0000-00"
                        className={`${inputCls} flex-1`}
                        style={{ borderWidth: '1.5px' }}
                      />
                      <button
                        type="button"
                        onClick={lookupCnpj}
                        disabled={cnpjLoading || form.cnpj.replace(/\D+/g, '').length !== 14}
                        className="px-3 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        style={{ background: '#0891b2', color: 'white' }}
                      >
                        {cnpjLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Search className="w-4 h-4"/>}
                        Buscar
                      </button>
                    </div>
                  </Field>

                  <Field label="Razão social *">
                    <input
                      type="text"
                      value={form.companyName}
                      onChange={(e) => update('companyName', e.target.value)}
                      placeholder="Nome jurídico da empresa"
                      className={inputCls}
                      style={{ borderWidth: '1.5px' }}
                    />
                  </Field>

                  <Field label="Nome fantasia">
                    <input
                      type="text"
                      value={form.companyTradeName}
                      onChange={(e) => update('companyTradeName', e.target.value)}
                      placeholder="Como sua empresa é conhecida"
                      className={inputCls}
                      style={{ borderWidth: '1.5px' }}
                    />
                  </Field>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <Field label="Cidade">
                        <input
                          type="text"
                          value={form.city}
                          onChange={(e) => update('city', e.target.value)}
                          placeholder="São Paulo"
                          className={inputCls}
                          style={{ borderWidth: '1.5px' }}
                        />
                      </Field>
                    </div>
                    <Field label="UF">
                      <input
                        type="text"
                        value={form.state}
                        maxLength={2}
                        onChange={(e) => update('state', e.target.value.toUpperCase())}
                        placeholder="SP"
                        className={`${inputCls} uppercase`}
                        style={{ borderWidth: '1.5px' }}
                      />
                    </Field>
                  </div>
                </motion.div>
              )}

              {/* ─────────────── Etapa 3: contexto + contato ─────────────── */}
              {step === 3 && (
                <motion.form key="s3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={submit}>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Você e o projeto</h1>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">Última etapa — quem fala com a gente e como é a operação.</p>

                  <Field label="Seu nome *" icon={User}>
                    <input
                      type="text"
                      value={form.contactName}
                      onChange={(e) => update('contactName', e.target.value)}
                      placeholder="Como devemos te chamar"
                      className={`${inputCls} pl-10 pr-3`}
                      style={{ borderWidth: '1.5px' }}
                      required
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="E-mail *" icon={Mail}>
                      <input
                        type="email"
                        value={form.contactEmail}
                        onChange={(e) => update('contactEmail', e.target.value)}
                        placeholder="seu@email.com"
                        className={`${inputCls} pl-10 pr-3`}
                        style={{ borderWidth: '1.5px' }}
                        required
                      />
                    </Field>
                    <Field label="Telefone (WhatsApp)" icon={Phone}>
                      <input
                        type="tel"
                        value={form.contactPhone}
                        onChange={(e) => update('contactPhone', e.target.value)}
                        placeholder="(11) 90000-0000"
                        className={`${inputCls} pl-10 pr-3`}
                        style={{ borderWidth: '1.5px' }}
                      />
                    </Field>
                  </div>

                  <Field label="Cargo">
                    <input
                      type="text"
                      value={form.contactRole}
                      onChange={(e) => update('contactRole', e.target.value)}
                      placeholder="Ex.: Sócio, Gerente de TI, Engenheiro de segurança"
                      className={inputCls}
                      style={{ borderWidth: '1.5px' }}
                    />
                  </Field>

                  <Field label="Volume aproximado de câmeras *" icon={Camera}>
                    <select
                      value={form.cameraVolume}
                      onChange={(e) => update('cameraVolume', e.target.value as LeadForm['cameraVolume'])}
                      className={`${inputCls} pl-10 pr-3 appearance-none`}
                      style={{ borderWidth: '1.5px' }}
                      required
                    >
                      <option value="" className="bg-white dark:bg-space-900">— escolha uma faixa —</option>
                      {Object.entries(VOLUME_LABEL).map(([k, v]) => (
                        <option key={k} value={k} className="bg-white dark:bg-space-900">{v.label} ({v.hint})</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Tem central de alarme integrada?" icon={ShieldCheck}>
                    <select
                      value={form.alarmCentral}
                      onChange={(e) => update('alarmCentral', e.target.value as LeadForm['alarmCentral'])}
                      className={`${inputCls} pl-10 pr-3 appearance-none`}
                      style={{ borderWidth: '1.5px' }}
                    >
                      <option value="" className="bg-white dark:bg-space-900">— opcional —</option>
                      <option value="YES" className="bg-white dark:bg-space-900">Sim, já temos central operacional</option>
                      <option value="BUILDING" className="bg-white dark:bg-space-900">Estamos montando agora</option>
                      <option value="NO" className="bg-white dark:bg-space-900">Não temos / não pretendo</option>
                    </select>
                  </Field>

                  <Field label="Mensagem (opcional)" icon={FileText}>
                    <textarea
                      value={form.message}
                      onChange={(e) => update('message', e.target.value)}
                      rows={3}
                      placeholder="Conte mais sobre o projeto, prazos, expectativas…"
                      className={`${inputCls} pl-10 pr-3 resize-none`}
                      style={{ borderWidth: '1.5px' }}
                    />
                  </Field>

                  <label className="flex gap-2.5 mt-4 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.acceptTerms}
                      onChange={(e) => update('acceptTerms', e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-cyan-600"
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Concordo em receber contato comercial por e-mail/telefone e com a{' '}
                      <Link to="/privacy" className="text-cyan-600 dark:text-cyan-400 hover:underline">Política de Privacidade</Link>
                      {' '}e{' '}
                      <Link to="/terms" className="text-cyan-600 dark:text-cyan-400 hover:underline">Termos de Uso</Link>
                      {' '}da VSaaS (LGPD).
                    </span>
                  </label>
                </motion.form>
              )}

              {/* ─────────────── Etapa 4: sucesso ─────────────── */}
              {step === 4 && (
                <motion.div key="s4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
                  <div className="w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center bg-emerald-100 dark:bg-emerald-500/20">
                    <Check className="w-8 h-8 text-emerald-600 dark:text-emerald-400"/>
                  </div>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Recebemos sua solicitação!</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
                    Nossa equipe comercial vai entrar em contato em até 1 dia útil pelo e-mail{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{form.contactEmail}</span>{' '}
                    para alinhar a demonstração e liberar seu acesso.
                  </p>
                  <div className="flex gap-2 justify-center flex-wrap">
                    <Link to="/pricing"
                      className="px-4 py-2.5 rounded-lg text-sm font-semibold transition-all bg-slate-100 dark:bg-space-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-space-700">
                      Enquanto isso, ver planos
                    </Link>
                    <button onClick={() => navigate('/login')}
                      className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5"
                      style={{ background: 'linear-gradient(135deg, #0090D8 0%, #00C0D0 52%, #00D0A8 100%)' }}>
                      Voltar para login <ChevronRight className="w-4 h-4"/>
                    </button>
                  </div>
                  <div className="mt-8 pt-6 border-t border-slate-100 dark:border-white/10 flex items-center justify-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                    <Sparkles className="w-3.5 h-3.5"/>
                    Lead protocolado no nosso CRM — você não precisa enviar de novo
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Erro */}
            {error && step < 4 && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2 mt-4 rounded-lg px-3 py-2.5 text-xs"
                style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48' }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5"/>
                {error}
              </motion.div>
            )}

            {/* Navegação */}
            {step < 4 && (
              <div className="flex justify-between items-center mt-8 pt-6 border-t border-slate-100 dark:border-white/10">
                <button
                  type="button"
                  onClick={prev}
                  disabled={step === 1}
                  className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <ArrowLeft className="w-4 h-4"/> Voltar
                </button>
                {step < 3 ? (
                  <button
                    type="button"
                    onClick={next}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5 transition-all"
                    style={{
                      background: 'linear-gradient(135deg, #0090D8 0%, #00C0D0 52%, #00D0A8 100%)',
                      boxShadow: '0 4px 16px -6px rgba(6,182,212,0.5)',
                    }}
                  >
                    Continuar <ArrowRight className="w-4 h-4"/>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={submit as any}
                    disabled={loading}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5 transition-all disabled:opacity-60"
                    style={{
                      background: 'linear-gradient(135deg, #059669, #10b981)',
                      boxShadow: '0 4px 16px -6px rgba(16,185,129,0.5)',
                    }}
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
                    Enviar solicitação
                  </button>
                )}
              </div>
            )}
          </motion.div>

          <p className="text-center text-[11px] text-slate-400 dark:text-slate-500 mt-6">
            Já tem conta?{' '}
            <Link to="/login" className="text-cyan-600 dark:text-cyan-400 font-semibold hover:underline">Faça login</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Field helper ────────────────────────────────────────────────────────────
function Field({
  label, children, icon: Icon,
}: {
  label: string
  children: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none"/>
        )}
        {children}
      </div>
    </div>
  )
}
