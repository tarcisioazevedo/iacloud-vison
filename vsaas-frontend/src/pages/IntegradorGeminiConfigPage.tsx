/**
 * IntegradorGeminiConfigPage — configuração Gemini BYOK + ROI + Templates.
 *
 * Persona: INTEGRADOR_ADMIN
 * Rota: /me/integrador/gemini
 *
 * 3 seções:
 *   1. BYOK config: modo (pool/self/off) + API key + teste
 *   2. ROI Calculator: nº câmeras x preço cobrado x custo estimado Gemini
 *   3. Templates: gestão dos templates do integrador (globais read-only)
 */
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import {
  Sparkles, KeyRound, Cpu, CheckCircle2, AlertTriangle, Loader2,
  DollarSign, Calculator, Plus, Trash2, Eye, EyeOff,
} from 'lucide-react'
import { api } from '../api/client'
import { confirm } from '../components/ConfirmDialog'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface GeminiConfig {
  mode: 'pool' | 'self' | 'off'
  hasKey: boolean
  keyMasked: string | null
  callCapDaily: number
}

interface Usage {
  periodFrom: string
  totalCalls: number
  successCalls: number
  totalTokensIn: number
  totalTokensOut: number
  estCostUsd: number
  estCostBrl: number
  perFeature: Record<string, { calls: number; tokensIn: number; tokensOut: number }>
}

interface Template {
  id: string
  integradorId: string | null
  emoji: string
  title: string
  prompt: string
  defaultIntervalSec: number
  defaultSeverity: string
  defaultChannels: string[]
  observedFpRate: number
  observedFireRate: number
  usageCount: number
  vertical: string | null
  enabled: boolean
}

const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
const canEdit = role === 'INTEGRADOR_ADMIN' || role === 'SUPER_ADMIN'

export default function IntegradorGeminiConfigPage() {
  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30">
          <Sparkles className="w-7 h-7 text-cyan-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Configuração Gemini IA</h1>
          <p className="text-sm text-slate-400">BYOK, ROI e biblioteca de templates do seu integrador</p>
        </div>
      </header>

      <BYOKSection />
      <ROICalculator />
      <TemplatesSection />
    </div>
  )
}

// ── BYOK Section ─────────────────────────────────────────────────────────────

function BYOKSection() {
  const { data: cfg, mutate } = useSWR<GeminiConfig>('/me/integrador/gemini', fetcher)
  const { data: usage } = useSWR<Usage>('/me/integrador/gemini/usage', fetcher, {
    refreshInterval: 60_000,
  })

  const [mode, setMode] = useState<'pool' | 'self' | 'off' | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; error?: string; reply?: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const effectiveMode = mode ?? cfg?.mode ?? 'pool'

  async function save() {
    setSaving(true); setErr(null)
    try {
      await api.put('/me/integrador/gemini', {
        mode: effectiveMode,
        apiKey: apiKey.length > 0 ? apiKey : undefined,
      })
      setApiKey('')
      setMode(null)
      mutate()
    } catch (e: any) {
      setErr(e.response?.data?.error ?? e.message)
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true); setTestResult(null)
    try {
      const { data } = await api.post('/me/integrador/gemini/test', {
        apiKey: apiKey.length > 0 ? apiKey : undefined,
      })
      setTestResult(data)
    } catch (e: any) {
      setTestResult({ ok: false, latencyMs: 0, error: e.response?.data?.error ?? e.message })
    } finally {
      setTesting(false)
    }
  }

  async function resetToPool() {
    const ok = await confirm({
      title: 'Voltar para o pool do fabricante?',
      description: 'A chave atual será apagada.',
      destructive: true,
      confirmLabel: 'Apagar chave',
    })
    if (!ok) return
    await api.delete('/me/integrador/gemini')
    setMode(null); setApiKey(''); setTestResult(null)
    mutate()
  }

  return (
    <section className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-semibold">BYOK — Bring Your Own Key</h2>
        </div>
        {usage && (
          <div className="text-sm text-slate-400">
            {usage.totalCalls.toLocaleString('pt-BR')} calls este mês · est.
            <span className="font-mono text-emerald-300 ml-1">R$ {usage.estCostBrl.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <ModeCard
          active={effectiveMode === 'pool'}
          onClick={() => canEdit && setMode('pool')}
          title="Pool do Fabricante"
          subtitle="Fabricante paga — sem cap próprio (default)"
          accent="cyan"
        />
        <ModeCard
          active={effectiveMode === 'self'}
          onClick={() => canEdit && setMode('self')}
          title="Sua própria chave"
          subtitle="Você paga direto Google — margem 100%"
          accent="violet"
        />
        <ModeCard
          active={effectiveMode === 'off'}
          onClick={() => canEdit && setMode('off')}
          title="Desligado"
          subtitle="Recusa qualquer chamada Gemini"
          accent="rose"
        />
      </div>

      {effectiveMode === 'self' && (
        <div className="space-y-3 p-4 rounded-xl bg-violet-500/5 border border-violet-500/20">
          <label className="block text-sm font-medium">Gemini API Key</label>
          {cfg?.hasKey && !apiKey && (
            <div className="text-xs text-slate-400 font-mono mb-2">
              Chave salva: {cfg.keyMasked}
            </div>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={cfg?.hasKey ? 'Deixe vazio para manter a chave atual…' : 'AIzaSy…'}
                className="w-full px-3 py-2 pr-10 bg-slate-950/70 border border-slate-700 rounded-lg font-mono text-sm focus:border-violet-500 focus:outline-none"
                disabled={!canEdit}
              />
              <button
                type="button"
                onClick={() => setShowKey(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                title={showKey ? 'Esconder' : 'Mostrar'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={test}
              disabled={testing || (!apiKey && !cfg?.hasKey)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Testar'}
            </button>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
              testResult.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200'
                            : 'bg-rose-500/10 border border-rose-500/30 text-rose-200'
            }`}>
              {testResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertTriangle className="w-4 h-4 mt-0.5" />}
              <div className="flex-1">
                {testResult.ok ? (
                  <>Chave válida — latência <span className="font-mono">{testResult.latencyMs}ms</span> · reply: "{testResult.reply}"</>
                ) : (
                  <>Falhou: {testResult.error}</>
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400">
            Sua chave fica criptografada no banco (AES-256-GCM). Use uma chave dedicada
            ao IA Cloud Vision com cap diário no console Google.
          </p>
        </div>
      )}

      {err && (
        <div className="mt-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-sm text-rose-200">
          {err}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        {canEdit && (mode !== null || apiKey.length > 0) && (
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg text-sm font-semibold"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar configuração'}
          </button>
        )}
        {cfg?.mode !== 'pool' && canEdit && (
          <button
            onClick={resetToPool}
            className="px-4 py-2 text-rose-300 hover:bg-rose-500/10 rounded-lg text-sm"
          >
            Voltar para pool
          </button>
        )}
        <div className="ml-auto text-xs text-slate-500">
          Cap diário pelo fabricante:&nbsp;
          <span className="font-mono text-slate-300">{cfg?.callCapDaily?.toLocaleString('pt-BR') ?? '—'}</span> calls/dia
        </div>
      </div>
    </section>
  )
}

function ModeCard({ active, onClick, title, subtitle, accent }: {
  active: boolean; onClick: () => void; title: string; subtitle: string; accent: 'cyan' | 'violet' | 'rose'
}) {
  const colors = {
    cyan:   'border-cyan-500 bg-cyan-500/10 text-cyan-300',
    violet: 'border-violet-500 bg-violet-500/10 text-violet-300',
    rose:   'border-rose-500 bg-rose-500/10 text-rose-300',
  }
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border-2 transition ${
        active ? colors[accent] : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
      }`}
    >
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-xs text-slate-400">{subtitle}</div>
    </button>
  )
}

// ── ROI Calculator ───────────────────────────────────────────────────────────

function ROICalculator() {
  const [cameras, setCameras] = useState(20)
  const [rulesPerCam, setRulesPerCam] = useState(2)
  const [intervalSec, setIntervalSec] = useState(30)
  const [priceBrl, setPriceBrl] = useState(80) // R$/câmera/mês

  const numbers = useMemo(() => {
    const totalRules = cameras * rulesPerCam
    const callsPerDay = totalRules * (86400 / intervalSec)
    const callsPerMonth = callsPerDay * 30

    // Gemini Flash 1.5 pricing (USD/1M tokens):
    //   input: $0.075, output: $0.30. Snapshot ~ 612 input + 88 output tokens.
    const tokensInPerCall = 612
    const tokensOutPerCall = 88
    const costPerCallUsd = (tokensInPerCall / 1e6) * 0.075 + (tokensOutPerCall / 1e6) * 0.30
    const monthlyCostUsd = callsPerMonth * costPerCallUsd
    const monthlyCostBrl = monthlyCostUsd * 5.0

    const monthlyRevenueBrl = cameras * priceBrl
    const marginBrl = monthlyRevenueBrl - monthlyCostBrl
    const marginPct = monthlyRevenueBrl > 0 ? (marginBrl / monthlyRevenueBrl) * 100 : 0

    return {
      totalRules, callsPerDay, callsPerMonth,
      monthlyCostUsd, monthlyCostBrl, monthlyRevenueBrl, marginBrl, marginPct,
    }
  }, [cameras, rulesPerCam, intervalSec, priceBrl])

  return (
    <section className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur p-5">
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-semibold">Calculadora de ROI Gemini</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <FieldNumber label="Câmeras"        value={cameras}     onChange={setCameras}    min={1} max={1000} />
        <FieldNumber label="Regras/câmera"  value={rulesPerCam} onChange={setRulesPerCam} min={1} max={10} />
        <FieldNumber label="Intervalo (s)"  value={intervalSec} onChange={setIntervalSec} min={15} max={300} />
        <FieldNumber label="Preço/cam (R$)" value={priceBrl}    onChange={setPriceBrl}    min={0} max={1000} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Calls/mês"        value={numbers.callsPerMonth.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} />
        <Stat label="Custo Gemini/mês" value={`R$ ${numbers.monthlyCostBrl.toFixed(2)}`} tone="rose" />
        <Stat label="Receita/mês"      value={`R$ ${numbers.monthlyRevenueBrl.toFixed(2)}`} tone="cyan" />
        <Stat
          label={`Margem (${numbers.marginPct.toFixed(0)}%)`}
          value={`R$ ${numbers.marginBrl.toFixed(2)}`}
          tone={numbers.marginPct >= 50 ? 'emerald' : numbers.marginPct >= 0 ? 'amber' : 'rose'}
        />
      </div>

      <p className="text-xs text-slate-500 mt-3">
        Custo estimado com Gemini Flash 1.5 ($0.075/1M in + $0.30/1M out) · ~700 tokens/call · USD→BRL 5.0.
      </p>
    </section>
  )
}

function FieldNumber({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (n: number) => void; min: number; max: number
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 mb-1 block">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(Number(e.target.value) || 0)}
        className="w-full px-3 py-2 bg-slate-950/70 border border-slate-700 rounded-lg text-sm font-mono focus:border-cyan-500 focus:outline-none"
      />
    </label>
  )
}

function Stat({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'cyan' | 'emerald' | 'amber' | 'rose' }) {
  const toneClass = {
    slate:   'text-slate-200',
    cyan:    'text-cyan-300',
    emerald: 'text-emerald-300',
    amber:   'text-amber-300',
    rose:    'text-rose-300',
  }[tone]
  return (
    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-lg font-mono font-semibold ${toneClass}`}>{value}</div>
    </div>
  )
}

// ── Templates Section ────────────────────────────────────────────────────────

function TemplatesSection() {
  const { data, mutate } = useSWR<{ items: Template[] }>('/semantic-templates', fetcher)
  const [showForm, setShowForm] = useState(false)
  const items = data?.items ?? []

  const myIntegradorId = useMemo(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('icv_integradorId')
  }, [])

  const mine    = items.filter(i => i.integradorId === myIntegradorId)
  const globais = items.filter(i => i.integradorId === null)

  async function remove(id: string) {
    const ok = await confirm({
      title: 'Apagar este template?',
      destructive: true,
      confirmLabel: 'Apagar',
    })
    if (!ok) return
    await api.delete(`/semantic-templates/${id}`)
    mutate()
  }

  return (
    <section className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-semibold">Templates de Regras</h2>
          <span className="text-xs text-slate-500">({mine.length} seus · {globais.length} globais)</span>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm(s => !s)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Novo template
          </button>
        )}
      </div>

      {showForm && <NewTemplateForm onSaved={() => { setShowForm(false); mutate() }} onCancel={() => setShowForm(false)} />}

      {mine.length > 0 && (
        <>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2 mt-4">Seus templates</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mine.map(t => (
              <TemplateCard key={t.id} t={t} canDelete onDelete={() => remove(t.id)} />
            ))}
          </div>
        </>
      )}

      {globais.length > 0 && (
        <>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2 mt-4">Globais (do fabricante)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {globais.map(t => <TemplateCard key={t.id} t={t} />)}
          </div>
        </>
      )}
    </section>
  )
}

function TemplateCard({ t, canDelete, onDelete }: { t: Template; canDelete?: boolean; onDelete?: () => void }) {
  return (
    <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 flex gap-3">
      <div className="text-2xl">{t.emoji}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-semibold truncate">{t.title}</h4>
          {canDelete && (
            <button onClick={onDelete} className="text-rose-400 hover:text-rose-300" title="Apagar">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400 line-clamp-2 mt-1">{t.prompt}</p>
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
          <span>⏱️ {t.defaultIntervalSec}s</span>
          <span>📊 {(t.observedFpRate * 100).toFixed(0)}% FP</span>
          <span>🔥 {t.usageCount} usos</span>
          {t.vertical && <span className="px-1.5 py-0.5 bg-slate-700 rounded">{t.vertical}</span>}
        </div>
      </div>
    </div>
  )
}

function NewTemplateForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [emoji, setEmoji] = useState('🎯')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [intervalSec, setIntervalSec] = useState(30)
  const [severity, setSeverity] = useState('warning')
  const [vertical, setVertical] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setSaving(true); setErr(null)
    try {
      await api.post('/semantic-templates', {
        emoji, title, prompt,
        defaultIntervalSec: intervalSec,
        defaultSeverity: severity,
        defaultChannels: [],
        vertical: vertical || undefined,
      })
      onSaved()
    } catch (e: any) {
      setErr(e.response?.data?.error ?? e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20 mb-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={4}
          placeholder="🎯" className="px-3 py-2 bg-slate-950/70 border border-slate-700 rounded-lg text-2xl text-center"
        />
        <input
          value={title} onChange={e => setTitle(e.target.value)} placeholder="Título do template"
          className="md:col-span-3 px-3 py-2 bg-slate-950/70 border border-slate-700 rounded-lg text-sm"
        />
      </div>
      <textarea
        value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder="Prompt: 'Detecte pessoas com capacete amarelo em zona industrial...'"
        rows={3}
        className="w-full px-3 py-2 bg-slate-950/70 border border-slate-700 rounded-lg text-sm"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">Intervalo (s)</span>
          <input
            type="number" value={intervalSec} onChange={e => setIntervalSec(Number(e.target.value))}
            className="w-full px-3 py-2 bg-slate-950/70 border border-slate-700 rounded-lg text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">Severidade</span>
          <select
            value={severity} onChange={e => setSeverity(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950/70 border border-slate-700 rounded-lg text-sm"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">Vertical (opcional)</span>
          <input
            value={vertical} onChange={e => setVertical(e.target.value)} placeholder="varejo / condomínio / indústria"
            className="w-full px-3 py-2 bg-slate-950/70 border border-slate-700 rounded-lg text-sm"
          />
        </label>
      </div>
      {err && <div className="text-sm text-rose-300">{err}</div>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving || !title || !prompt}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-1"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          <DollarSign className="w-4 h-4" /> Salvar template
        </button>
        <button onClick={onCancel} className="px-3 py-2 text-slate-400 hover:bg-slate-800 rounded-lg text-sm">
          Cancelar
        </button>
      </div>
    </div>
  )
}
