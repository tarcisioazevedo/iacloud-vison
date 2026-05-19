/**
 * MeWhitelabelPage — Hub WL do INTEGRADOR.
 *
 * Sub-tabs aparecem dinamicamente conforme capabilities liberadas pelo SUPER_ADMIN:
 *   Branding (caps.branding) · Domínio (caps.domain) · Pricing (caps.pricing) · Email (caps.email — Fase 2)
 */
import { useState } from 'react'
import useSWR from 'swr'
import { Palette, Globe, DollarSign, Mail, Lock, Crown, MessageCircle, Save, RefreshCw, Trash2, AlertCircle, ExternalLink, Check, Eye, EyeOff, Send, ShieldCheck, ShieldOff } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'
import { useMyWhitelabel, useTenantPricing, api, type WhitelabelCapabilities, type WhitelabelTier, type TenantPricingPlan } from '../api/client'
import { IntegradorThemePage } from './IntegradorThemePage'
import { CustomDomainsPage } from './CustomDomainsPage'

type SubTab = 'branding' | 'domain' | 'pricing' | 'email'

const TIER_COLORS: Record<WhitelabelTier, string> = {
  NONE: 'bg-slate-200 dark:bg-space-800 text-slate-500',
  BASIC: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30',
  PRO: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30',
  ENTERPRISE: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
}

export function MeWhitelabelPage() {
  const { data, isLoading, error } = useMyWhitelabel()
  const [tab, setTab] = useState<SubTab>('branding')

  if (isLoading) return <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando…</GlassCard>
  if (error || !data) {
    return (
      <GlassCard className="p-6 text-center">
        <AlertCircle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
        <p className="text-sm text-rose-600 dark:text-rose-400">Falha ao carregar status white-label.</p>
      </GlassCard>
    )
  }

  const caps = data.capabilitiesResolved
  const anyEnabled = Object.values(caps).some(Boolean)

  const availableTabs: { id: SubTab; label: string; icon: any; cap: keyof WhitelabelCapabilities }[] = [
    { id: 'branding', label: 'Branding', icon: Palette, cap: 'branding' },
    { id: 'domain', label: 'Domínio', icon: Globe, cap: 'domain' },
    { id: 'pricing', label: 'Pricing', icon: DollarSign, cap: 'pricing' },
    { id: 'email', label: 'E-mail', icon: Mail, cap: 'email' },
  ]
  const enabledTabs = availableTabs.filter(t => caps[t.cap])
  if (enabledTabs.length > 0 && !enabledTabs.find(t => t.id === tab)) {
    setTimeout(() => setTab(enabledTabs[0].id), 0)
  }

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <Palette className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">White-label</h1>
                <span className={cn('px-2 py-0.5 rounded-full font-mono text-[10px]', TIER_COLORS[data.tier])}>{data.tier}</span>
                {data.tier === 'ENTERPRISE' && <Crown className="w-3.5 h-3.5 text-amber-500" />}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                Personalize a experiência dos seus clientes. Cada aba representa uma capability liberada pelo administrador.
              </p>
            </div>
          </div>
          {data.cfSubdomain && (
            <a href={`https://${data.cfSubdomain}.vsaas.com.br/pricing`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold whitespace-nowrap">
              <ExternalLink className="w-3.5 h-3.5" /> Ver pública
            </a>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-1">
          {(Object.keys(caps) as (keyof WhitelabelCapabilities)[]).map(k => (
            <span key={k} className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-mono',
              caps[k]
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-100 dark:bg-space-800 text-slate-400 border border-slate-200 dark:border-white/10',
            )}>{caps[k] ? '✓' : '✗'} {k}</span>
          ))}
        </div>
      </GlassCard>

      {!anyEnabled && (
        <GlassCard className="p-8 text-center">
          <Lock className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">Seu plano atual não inclui white-label</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-4">
            Faça upgrade para o tier <strong>PRO</strong> ou <strong>ENTERPRISE</strong> para personalizar logo, cores, domínio próprio e seus próprios planos comerciais.
          </p>
          <a href="mailto:comercial@vsaas.com.br?subject=Upgrade%20White-label" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
            <MessageCircle className="w-4 h-4" /> Falar com consultor
          </a>
        </GlassCard>
      )}

      {anyEnabled && (
        <>
          <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 w-fit">
            {availableTabs.map(t => {
              const Icon = t.icon
              const enabled = caps[t.cap]
              const active = tab === t.id
              return (
                <button key={t.id} disabled={!enabled} onClick={() => enabled && setTab(t.id)} className={cn(
                  'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition',
                  !enabled
                    ? 'text-slate-600 dark:text-slate-300 dark:text-slate-700 cursor-not-allowed'
                    : active
                      ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
                )}>
                  <Icon className="w-3.5 h-3.5" />{t.label}
                  {!enabled && <Lock className="w-2.5 h-2.5" />}
                </button>
              )
            })}
          </div>

          <div>
            {tab === 'branding' && caps.branding && <IntegradorThemePage />}
            {tab === 'domain' && caps.domain && <CustomDomainsPage />}
            {tab === 'pricing' && caps.pricing && <TenantPricingTab />}
            {tab === 'email' && caps.email && <EmailSmtpTab />}
          </div>
        </>
      )}
    </div>
  )
}

function TenantPricingTab() {
  const { data, mutate, isLoading } = useTenantPricing()
  const [editing, setEditing] = useState<string | null>(null)
  if (isLoading) return <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando preços…</GlassCard>
  if (!data) return null
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Os planos abaixo são os do <strong>master</strong>. Personalize com seu preço — o piso é o atacado que você paga ao fabricante.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {data.plans.map(p => <PlanCard key={p.slug} plan={p} onEdit={() => setEditing(p.slug)} onChange={mutate} />)}
      </div>
      {editing && <PlanOverrideModal plan={data.plans.find(p => p.slug === editing)!} onClose={() => setEditing(null)} onSave={() => { setEditing(null); mutate() }} />}
    </div>
  )
}

function PlanCard({ plan, onEdit, onChange }: { plan: TenantPricingPlan; onEdit: () => void; onChange: () => void }) {
  const isOverride = plan._isOverride
  const wholesale = plan._wholesalePriceMonthly !== null && plan._wholesalePriceMonthly !== undefined ? Number(plan._wholesalePriceMonthly) : null
  async function reset() {
    if (!confirm(`Voltar "${plan.name}" ao plano master?`)) return
    try { await api.delete(`/me/integrador/pricing/plans/${plan.slug}/override`); onChange() }
    catch (e: any) { alert(e?.response?.data?.error ?? e.message) }
  }
  return (
    <GlassCard className={cn('p-4 relative', isOverride && 'border-violet-500/30 bg-violet-500/[0.02]')}>
      {isOverride && <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-700 dark:text-violet-300 text-[9px] font-bold uppercase">Personalizado</span>}
      <p className="text-sm font-bold text-slate-900 dark:text-white">{plan.name}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{plan.tagline}</p>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-[10px] text-slate-500">R$</span>
        <span className="text-2xl font-bold text-slate-900 dark:text-white">
          {plan.priceMonthly === null ? 'Sob consulta' : Number(plan.priceMonthly).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
        {plan.priceMonthly !== null && <span className="text-[10px] text-slate-500">/mês</span>}
      </div>
      {wholesale !== null && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-mono">
          piso: R$ {wholesale.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </p>
      )}
      <div className="mt-3 space-y-2">
        <button onClick={onEdit} className={cn(
          'w-full px-3 py-1.5 rounded-lg text-xs font-semibold transition',
          isOverride
            ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30 hover:bg-violet-500/30'
            : 'bg-cyan-600 hover:bg-cyan-700 text-white',
        )}>
          {isOverride ? 'Editar' : 'Personalizar'}
        </button>
        {isOverride && (
          <button onClick={reset} className="w-full px-3 py-1.5 rounded-lg text-[10px] text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-white/10">
            <Trash2 className="w-3 h-3 inline mr-1" />Voltar ao master
          </button>
        )}
      </div>
    </GlassCard>
  )
}

function PlanOverrideModal({ plan, onClose, onSave }: { plan: TenantPricingPlan; onClose: () => void; onSave: () => void }) {
  const isExisting = plan._isOverride
  const [priceMonthly, setPriceMonthly] = useState(plan.priceMonthly !== null ? String(plan.priceMonthly) : '')
  const [tagline, setTagline] = useState(plan.tagline)
  const [ctaLabel, setCtaLabel] = useState(plan.ctaLabel)
  const [highlights, setHighlights] = useState((plan.highlights ?? []).join('\n'))
  const [recommended, setRecommended] = useState(plan.recommended ?? false)
  const [saving, setSaving] = useState(false); const [err, setErr] = useState<string | null>(null)

  const wholesale = plan._wholesalePriceMonthly !== null && plan._wholesalePriceMonthly !== undefined ? Number(plan._wholesalePriceMonthly) : null
  const priceNum = priceMonthly === '' ? null : Number(priceMonthly)
  const belowFloor = wholesale !== null && priceNum !== null && priceNum < wholesale

  async function save() {
    if (belowFloor) { setErr(`Preço não pode ser inferior ao atacado (R$ ${wholesale!.toFixed(2)}).`); return }
    setSaving(true); setErr(null)
    const payload = {
      priceMonthly: priceMonthly === '' ? null : Number(priceMonthly),
      tagline, ctaLabel,
      highlights: highlights.split('\n').map(s => s.trim()).filter(Boolean),
      recommended,
    }
    try {
      if (isExisting) await api.patch(`/me/integrador/pricing/plans/${plan.slug}`, payload)
      else await api.post(`/me/integrador/pricing/plans/${plan.slug}/override`, payload)
      onSave()
    } catch (e: any) { setErr(e?.response?.data?.message ?? e?.response?.data?.error ?? e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-xl mt-12 bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{isExisting ? `Editar: ${plan.name}` : `Personalizar: ${plan.name}`}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-xl leading-none">×</button>
        </div>
        {wholesale !== null && (
          <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              <strong>Piso (atacado):</strong> R$ {wholesale.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês — é o que você paga ao fabricante.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Tagline</label>
            <input value={tagline} onChange={e => setTagline(e.target.value)} className="w-full input-base" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Preço mensal (R$){belowFloor && <span className="ml-1 text-rose-500 normal-case font-normal">abaixo do piso!</span>}
            </label>
            <input type="number" step="0.01" value={priceMonthly} onChange={e => setPriceMonthly(e.target.value)}
              className={cn('w-full input-base', belowFloor && 'border-rose-500 focus:border-rose-500')} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">CTA Label</label>
            <input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} className="w-full input-base" />
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Highlights (1 por linha)</label>
            <textarea rows={5} value={highlights} onChange={e => setHighlights(e.target.value)} className="w-full input-base font-mono text-xs" />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={recommended} onChange={e => setRecommended(e.target.checked)} />Marcar como destaque
            </label>
          </div>
        </div>
        {err && <div className="mt-3 p-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs">Cancelar</button>
          <button onClick={save} disabled={saving || belowFloor} className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1">
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isExisting ? 'Salvar' : 'Personalizar'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface SmtpConfigData {
  configured:     boolean
  host?:          string
  port?:          number
  secure?:        boolean
  user?:          string
  pass?:          string
  fromName?:      string
  fromAddress?:   string
  verified?:      boolean
  lastTestedAt?:  string | null
  lastTestResult?: string | null
}

function EmailSmtpTab() {
  const { data, isLoading, mutate } = useSWR<SmtpConfigData>('/me/integrador/smtp',
    (url: string) => api.get(url).then(r => r.data),
    { revalidateOnFocus: false },
  )

  const [host,        setHost]        = useState('')
  const [port,        setPort]        = useState('587')
  const [secure,      setSecure]      = useState(false)
  const [user,        setUser]        = useState('')
  const [pass,        setPass]        = useState('')
  const [showPass,    setShowPass]    = useState(false)
  const [fromName,    setFromName]    = useState('')
  const [fromAddress, setFromAddress] = useState('')
  const [saving,      setSaving]      = useState(false)
  const [saveErr,     setSaveErr]     = useState<string | null>(null)
  const [saveOk,      setSaveOk]      = useState(false)
  const [testTo,      setTestTo]      = useState('')
  const [testing,     setTesting]     = useState(false)
  const [testResult,  setTestResult]  = useState<{ ok: boolean; error?: string } | null>(null)
  const [removing,    setRemoving]    = useState(false)
  const [initialized, setInitialized] = useState(false)

  // Preenche formulário ao carregar config existente
  if (data && data.configured && !initialized) {
    setHost(data.host ?? '')
    setPort(String(data.port ?? 587))
    setSecure(data.secure ?? false)
    setUser(data.user ?? '')
    setPass(data.pass ?? '••••••')
    setFromName(data.fromName ?? '')
    setFromAddress(data.fromAddress ?? '')
    setInitialized(true)
  }

  async function save() {
    setSaving(true); setSaveErr(null); setSaveOk(false)
    try {
      await api.put('/me/integrador/smtp', {
        host, port: Number(port), secure, user,
        pass: pass === '••••••' ? undefined : pass,
        fromName, fromAddress,
      })
      setSaveOk(true)
      mutate()
      setTimeout(() => setSaveOk(false), 3000)
    } catch (e: any) {
      setSaveErr(e?.response?.data?.message ?? e?.response?.data?.error ?? e.message)
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    if (!testTo) return
    setTesting(true); setTestResult(null)
    try {
      const r = await api.post('/me/integrador/smtp/test', { to: testTo })
      setTestResult(r.data)
      mutate()
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.response?.data?.error ?? e.message })
    } finally {
      setTesting(false)
    }
  }

  async function remove() {
    if (!confirm('Remover SMTP próprio? Os emails voltarão a sair pelo SMTP padrão da plataforma.')) return
    setRemoving(true)
    try {
      await api.delete('/me/integrador/smtp')
      setHost(''); setPort('587'); setSecure(false); setUser(''); setPass('')
      setFromName(''); setFromAddress(''); setInitialized(false)
      mutate({ configured: false }, false)
    } catch (e: any) {
      alert(e?.response?.data?.error ?? e.message)
    } finally {
      setRemoving(false)
    }
  }

  if (isLoading) {
    return <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando…</GlassCard>
  }

  const isVerified = data?.verified === true

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header + status */}
      <GlassCard className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">E-mail SMTP próprio</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Emails transacionais saem com o nome e endereço da sua empresa.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {data?.configured && (
              isVerified
                ? <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold border border-emerald-500/30">
                    <ShieldCheck className="w-3 h-3" /> Verificado
                  </span>
                : <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-semibold border border-amber-500/30">
                    <ShieldOff className="w-3 h-3" /> Não testado
                  </span>
            )}
            {data?.configured && (
              <button onClick={remove} disabled={removing}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-40 transition">
                {removing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Remover
              </button>
            )}
          </div>
        </div>

        {data?.lastTestResult && (
          <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-400">
            Último erro: {data.lastTestResult}
          </div>
        )}
      </GlassCard>

      {/* Formulário de configuração */}
      <GlassCard className="p-5 space-y-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Servidor SMTP</p>

        <div className="grid grid-cols-[1fr_120px_auto] gap-3 items-end">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Host</label>
            <input value={host} onChange={e => setHost(e.target.value)}
              placeholder="smtp.seudominio.com"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Porta</label>
            <input type="number" value={port} onChange={e => setPort(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500" />
          </div>
          <div className="pb-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div onClick={() => setSecure(v => !v)}
                className={`w-9 h-5 rounded-full transition-colors ${secure ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-600'} relative`}>
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${secure ? 'translate-x-4' : ''}`} />
              </div>
              <span className="text-xs text-slate-600 dark:text-slate-300">TLS/SSL</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Usuário</label>
            <input value={user} onChange={e => setUser(e.target.value)}
              placeholder="no-reply@seudominio.com"
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Senha</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={pass}
                onChange={e => setPass(e.target.value)}
                onFocus={() => { if (pass === '••••••') setPass('') }}
                placeholder="Senha SMTP"
                autoComplete="new-password"
                className="w-full px-3 py-2 pr-9 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500"
              />
              <button type="button" onClick={() => setShowPass(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <hr className="border-slate-200 dark:border-white/10" />
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Remetente</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Nome</label>
            <input value={fromName} onChange={e => setFromName(e.target.value)}
              placeholder="Meu ISP Telecom"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Endereço</label>
            <input value={fromAddress} onChange={e => setFromAddress(e.target.value)}
              type="email"
              placeholder="monitoramento@meuisp.com.br"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500" />
          </div>
        </div>

        {saveErr && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-400">
            {saveErr}
          </div>
        )}

        <div className="flex justify-end">
          <button onClick={save} disabled={saving || !host || !user || !fromName || !fromAddress}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold transition">
            {saving
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : saveOk
                ? <Check className="w-4 h-4" />
                : <Save className="w-4 h-4" />}
            {saveOk ? 'Salvo!' : 'Salvar configuração'}
          </button>
        </div>
      </GlassCard>

      {/* Testar envio */}
      {data?.configured && (
        <GlassCard className="p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Enviar email de teste</p>
          <div className="flex gap-2">
            <input value={testTo} onChange={e => setTestTo(e.target.value)}
              type="email"
              placeholder="seu@email.com"
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500" />
            <button onClick={sendTest} disabled={testing || !testTo}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white text-sm font-semibold transition whitespace-nowrap">
              {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Testar
            </button>
          </div>
          {testResult && (
            <div className={`mt-3 p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
              testResult.ok
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400'
            }`}>
              {testResult.ok
                ? <><ShieldCheck className="w-3.5 h-3.5 shrink-0" /> Email enviado com sucesso! Verifique a caixa de entrada.</>
                : <><AlertCircle className="w-3.5 h-3.5 shrink-0" /> {testResult.error}</>}
            </div>
          )}
          {data?.lastTestedAt && !testResult && (
            <p className="mt-2 text-[10px] text-slate-400">
              Último teste: {new Date(data.lastTestedAt).toLocaleString('pt-BR')}
            </p>
          )}
        </GlassCard>
      )}
    </div>
  )
}
