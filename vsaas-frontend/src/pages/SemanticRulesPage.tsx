/**
 * SemanticRulesPage — gestão de regras de alerta em linguagem natural.
 *
 * Endereça gaps P0/P1 do audit:
 *  - LGPD opt-in obrigatório antes de criar regra (P0 #5)
 *  - Quota visível (3/5) — backend enforce com HTTP 403 (P0 #3)
 *  - Botões FP / Correto em cada disparo recente (P1 #7)
 *  - Banner de auto-pause quando regra muito FP (P1 #8)
 *  - Templates testados (P2 #16)
 *
 * Backend wired:
 *   GET    /semantic-rules
 *   POST   /semantic-rules
 *   PATCH  /semantic-rules/:id
 *   DELETE /semantic-rules/:id
 *   POST   /semantic-rules/:id/test
 *   GET    /lgpd-consents
 *   POST   /lgpd-consents
 *   POST   /fp-feedback
 *   GET    /semantic-templates
 *   POST   /semantic-templates/:id/use
 */
import { useState, useEffect } from 'react'
import useSWR from 'swr'
import {
  Sparkles, Plus, Play, Pause, Trash2, AlertTriangle,
  ShieldAlert, X, Check, Zap,
} from 'lucide-react'
import { api } from '../api/client'
import { useCameras } from '../api/client'
import { brtTime } from '../lib/brt'

interface SemanticRule {
  id: string
  cameraId: string
  prompt: string
  intervalSec: number
  enabled: boolean
  severity: string
  notifyChannels: string[]
  fireCount: number
  consecutiveFp: number
  autoPaused: boolean
  autoPausedReason?: string | null
  lastFiredAt?: string | null
  lastFireReason?: string | null
}

interface TestResult {
  ruleId: string
  matches: boolean
  reason?: string
  confidence?: number
  snapshotDataUrl?: string
}

interface Template {
  id: string
  emoji: string
  title: string
  prompt: string
  defaultIntervalSec: number
  defaultSeverity: string
  defaultChannels: string[]
  observedFpRate: number
  vertical?: string | null
}

const fetcher = (url: string) => api.get(url).then(r => r.data)

export default function SemanticRulesPage() {
  const { data: camData } = useCameras()
  const cameras = (camData?.cameras ?? []) as Array<{ id: string; name: string }>

  // ── LGPD consent state ───────────────────────────────────────────
  const { data: consentData, mutate: refreshConsent } = useSWR<{ items: Array<{ scope: string; accepted: boolean }> }>(
    '/lgpd-consents', fetcher,
  )
  const consentGemini = consentData?.items?.find(c => c.scope === 'ai_gemini')
  const hasConsent = !!consentGemini?.accepted

  // ── Rules list ───────────────────────────────────────────────────
  const { data: rulesData, mutate: refreshRules } = useSWR<{ items: SemanticRule[] }>(
    '/semantic-rules', fetcher,
  )
  const rules = rulesData?.items ?? []

  // ── Templates ────────────────────────────────────────────────────
  const { data: tplData } = useSWR<{ items: Template[] }>('/semantic-templates', fetcher)
  const templates = tplData?.items ?? []

  // ── Form state ───────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [cameraId, setCameraId] = useState<string>('')
  const [intervalSec, setIntervalSec] = useState(30)
  const [severity, setSeverity] = useState<'info'|'warning'|'critical'>('warning')
  const [notifyChannels, setNotifyChannels] = useState<string[]>(['push'])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null)

  useEffect(() => {
    if (cameras.length > 0 && !cameraId) setCameraId(cameras[0].id)
  }, [cameras, cameraId])

  function applyTemplate(t: Template) {
    setPrompt(t.prompt)
    setIntervalSec(t.defaultIntervalSec)
    setSeverity(t.defaultSeverity as any)
    setNotifyChannels(t.defaultChannels?.length ? t.defaultChannels : ['push'])
    setShowForm(true)
    api.post(`/semantic-templates/${t.id}/use`).catch(() => {})
  }

  async function handleAcceptLgpd() {
    try {
      await api.post('/lgpd-consents', { scope: 'ai_gemini', policyVersion: 'v1' })
      refreshConsent()
    } catch (e: any) {
      alert('Falha ao registrar consentimento: ' + (e.response?.data?.message ?? e.message))
    }
  }

  async function handleCreate() {
    setError(null); setSaving(true)
    try {
      await api.post('/semantic-rules', {
        cameraId, prompt, intervalSec, severity, notifyChannels,
      })
      setShowForm(false); setPrompt('')
      refreshRules()
    } catch (e: any) {
      const data = e.response?.data
      if (data?.error === 'quota_exceeded') {
        setError(`Cota atingida (${data.quota?.used}/${data.quota?.limit}). Adquira o add-on para regras extras.`)
      } else {
        setError(data?.message ?? data?.error ?? 'Erro ao criar regra')
      }
    } finally { setSaving(false) }
  }

  async function handleToggle(rule: SemanticRule) {
    await api.patch(`/semantic-rules/${rule.id}`, { enabled: !rule.enabled }).catch(() => {})
    refreshRules()
  }

  async function handleDelete(rule: SemanticRule) {
    if (!confirm(`Remover regra "${rule.prompt.slice(0,40)}..."?`)) return
    await api.delete(`/semantic-rules/${rule.id}`).catch(() => {})
    refreshRules()
  }

  async function handleTest(rule: SemanticRule) {
    setTesting(rule.id); setTestResult(null)
    try {
      const { data } = await api.post(`/semantic-rules/${rule.id}/test`)
      const snapshotDataUrl = data.snapshotBase64
        ? `data:${data.snapshotMime ?? 'image/jpeg'};base64,${data.snapshotBase64}`
        : undefined
      setTestResult({
        ruleId: rule.id,
        matches: !!data.result?.matches,
        reason: data.result?.reason,
        confidence: data.result?.confidence,
        snapshotDataUrl,
      })
    } catch (e: any) {
      setTestResult({
        ruleId: rule.id,
        matches: false,
        reason: 'Falha ao testar: ' + (e.response?.data?.message ?? e.message),
      })
    } finally {
      setTesting(null)
    }
  }

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleFpFeedback(rule: SemanticRule, verdict: 'false_positive' | 'correct') {
    try {
      await api.post('/fp-feedback', {
        source: 'semantic_rule',
        sourceId: rule.id,
        cameraId: rule.cameraId,
        verdict,
      })
      showToast(verdict === 'correct' ? '✓ Marcado como correto' : '✗ Marcado como falso positivo')
      refreshRules()
    } catch (e: any) {
      showToast('Falha: ' + (e.response?.data?.message ?? e.message), 'err')
    }
  }

  async function handleFireVerdict(rule: SemanticRule, fireId: string, verdict: 'false_positive' | 'correct') {
    try {
      await api.post(`/semantic-rules/${rule.id}/fires/${fireId}/verdict`, { verdict })
      showToast(verdict === 'correct' ? '✓ Disparo marcado como correto' : '✗ Disparo marcado como falso positivo')
      refreshRules()
      // Recarrega lista de fires se está aberta pra essa regra
      if (historyOpenFor === rule.id) setHistoryOpenFor(rule.id)
    } catch (e: any) {
      showToast('Falha: ' + (e.response?.data?.message ?? e.message), 'err')
    }
  }

  // ── Render LGPD wall first ───────────────────────────────────────
  if (!hasConsent) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-amber-900/20 border-2 border-amber-500/50 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <ShieldAlert className="w-10 h-10 text-amber-400 shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-amber-100 mb-2">Consentimento LGPD necessário</h1>
              <p className="text-sm text-slate-200 mb-4">
                Para usar <strong>Regras Semânticas (Alertas IA)</strong>, snapshots das suas câmeras serão enviados
                ao Google Gemini (servidores nos EUA) para análise.
              </p>
              <ul className="text-sm text-slate-300 space-y-1 mb-4">
                <li>• Snapshots <strong>NÃO</strong> são armazenados pelo Google</li>
                <li>• Você pode revogar o consentimento a qualquer momento</li>
                <li>• Cada análise fica registrada em log auditável</li>
                <li>• Não é necessário consent se você usar sua própria chave Gemini (BYOK)</li>
              </ul>
              <div className="flex gap-3">
                <button onClick={handleAcceptLgpd}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-sm font-bold">
                  Aceito · ativar IA
                </button>
                <button className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
                  Política completa
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Page header + KPIs ───────────────────────────────────────────
  const activeRules = rules.filter(r => r.enabled && !r.autoPaused).length
  const pausedRules = rules.filter(r => r.autoPaused).length

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-400" />
            Regras Semânticas
          </h1>
          <p className="text-xs text-slate-400">
            Crie alertas em PT-BR — a IA monitora as câmeras periodicamente.
          </p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="px-3 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-bold flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nova regra
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
          <div className="text-[10px] text-violet-400 uppercase font-bold">Regras ativas</div>
          <div className="text-2xl font-bold mt-1">{activeRules}</div>
        </div>
        <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
          <div className="text-[10px] text-amber-400 uppercase font-bold">Auto-pausadas</div>
          <div className="text-2xl font-bold mt-1">{pausedRules}</div>
        </div>
        <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
          <div className="text-[10px] text-emerald-400 uppercase font-bold">Disparos totais</div>
          <div className="text-2xl font-bold mt-1">{rules.reduce((s, r) => s + r.fireCount, 0)}</div>
        </div>
        <div className="bg-slate-900/60 border border-emerald-500/30 rounded-xl p-4">
          <div className="text-[10px] text-emerald-400 uppercase font-bold">LGPD opt-in</div>
          <div className="text-sm font-bold mt-1 text-emerald-300">ATIVO</div>
        </div>
      </div>

      {/* Templates */}
      {templates.length > 0 && !showForm && (
        <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
          <div className="text-xs font-bold mb-3 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" /> Templates testados
            <span className="text-[10px] text-slate-500">· clique pra começar a partir de um</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {templates.slice(0, 6).map(t => (
              <button key={t.id} onClick={() => applyTemplate(t)}
                className="text-left bg-slate-800/60 hover:bg-slate-800 border border-white/10 hover:border-violet-500/40 rounded-lg p-3 transition">
                <div className="font-bold text-sm flex items-center gap-2">{t.emoji} {t.title}</div>
                <div className="text-[11px] text-slate-400 line-clamp-2 mt-1 italic">"{t.prompt}"</div>
                <div className="text-[10px] text-emerald-300 mt-1">
                  FP histórico: {Math.round(t.observedFpRate * 100)}% · vertical: {t.vertical ?? 'geral'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-slate-900/80 border border-violet-500/40 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" /> Nova regra · descreva em PT-BR
            </h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='Ex: "Avise se alguém ficar parado em frente ao portão por mais de 5 minutos entre 22h e 6h"'
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm h-20 focus:border-violet-500 focus:outline-none mb-3"
          />
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div>
              <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Câmera</label>
              <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs">
                {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Intervalo</label>
              <select value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs">
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={120}>2 min</option>
                <option value={300}>5 min</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Severidade</label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as any)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs">
                <option value="info">ℹ️ Info</option>
                <option value="warning">⚠️ Warning</option>
                <option value="critical">🔴 Critical</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Canais</label>
              <div className="flex gap-1 flex-wrap">
                {['push', 'whatsapp', 'email', 'telegram'].map(c => (
                  <label key={c} className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer border ${
                    notifyChannels.includes(c)
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    <input type="checkbox" checked={notifyChannels.includes(c)}
                      onChange={(e) => setNotifyChannels(e.target.checked
                        ? [...notifyChannels, c]
                        : notifyChannels.filter(x => x !== c))}
                      className="hidden" />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          </div>
          {error && <div className="text-rose-300 text-xs mb-2">{error}</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)}
              className="px-3 py-1.5 rounded-md bg-slate-700 hover:bg-slate-600 text-xs text-slate-200">
              Cancelar
            </button>
            <button onClick={handleCreate} disabled={saving || prompt.length < 10}
              className="px-4 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white text-xs font-bold">
              {saving ? 'Salvando...' : 'Salvar regra'}
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="space-y-2">
        {rules.length === 0 && !showForm && (
          <div className="bg-slate-900/40 border border-slate-700 border-dashed rounded-xl p-8 text-center text-slate-400 text-sm">
            Nenhuma regra criada ainda. Comece por um template acima ou clique em <strong>Nova regra</strong>.
          </div>
        )}
        {rules.map(rule => {
          const camName = cameras.find(c => c.id === rule.cameraId)?.name ?? rule.cameraId.slice(0, 8)
          return (
            <div key={rule.id} className={`bg-slate-900/60 border rounded-xl p-4 ${
              rule.autoPaused ? 'border-amber-500/40 opacity-80' : 'border-white/10'
            }`}>
              <div className="flex items-start gap-3 mb-2">
                <Zap className={`w-5 h-5 shrink-0 ${rule.enabled && !rule.autoPaused ? 'text-violet-400' : 'text-slate-600'}`} />
                <div className="flex-1">
                  <div className="font-bold text-sm flex items-center gap-2 flex-wrap">
                    <span>{camName}</span>
                    {rule.autoPaused
                      ? <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold">AUTO-PAUSADA · {rule.autoPausedReason}</span>
                      : rule.enabled
                        ? <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold">ATIVA</span>
                        : <span className="text-[10px] bg-slate-500/20 text-slate-300 px-1.5 py-0.5 rounded font-bold">PAUSADA</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      rule.severity === 'critical' ? 'bg-rose-500/20 text-rose-300' :
                      rule.severity === 'warning'  ? 'bg-amber-500/20 text-amber-300' :
                                                     'bg-cyan-500/20 text-cyan-300'
                    }`}>{rule.severity.toUpperCase()}</span>
                  </div>
                  <div className="text-[12px] text-slate-300 italic mt-1">"{rule.prompt}"</div>
                  {rule.fireCount > 0 && rule.lastFireReason && (
                    <div className="text-[11px] text-emerald-300 mt-1">
                      🎯 último disparo: "{rule.lastFireReason}"
                    </div>
                  )}
                </div>
                {rule.fireCount > 0 && (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <FireSnapshot ruleId={rule.id} lastFiredAt={rule.lastFiredAt} />
                    {rule.lastFiredAt && (
                      <a
                        href={`/recordings?cameraId=${rule.cameraId}&at=${encodeURIComponent(rule.lastFiredAt)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-cyan-300 hover:text-cyan-200 hover:underline flex items-center gap-0.5"
                        title="Abrir gravação no exato momento do disparo"
                      >
                        🎬 Ver gravação →
                      </a>
                    )}
                  </div>
                )}
                <div className="flex gap-1">
                  <button title="Testar agora" onClick={() => handleTest(rule)}
                    className="p-1.5 rounded hover:bg-white/10 text-cyan-300"><Play className="w-4 h-4" /></button>
                  <button title={rule.enabled ? 'Pausar' : 'Reativar'} onClick={() => handleToggle(rule)}
                    className="p-1.5 rounded hover:bg-white/10 text-amber-300">
                    {rule.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button title="Remover" onClick={() => handleDelete(rule)}
                    className="p-1.5 rounded hover:bg-white/10 text-rose-300"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-400 pt-2 border-t border-white/5">
                <span>cada {rule.intervalSec}s</span>
                <button
                  onClick={() => setHistoryOpenFor(historyOpenFor === rule.id ? null : rule.id)}
                  className="text-emerald-300 hover:text-emerald-200 underline decoration-dotted"
                  title="Ver histórico de disparos">
                  {rule.fireCount} disparos {historyOpenFor === rule.id ? '▲' : '▼'}
                </button>
                <span>{rule.notifyChannels.map(c =>
                  c === 'push' ? '📱' :
                  c === 'whatsapp' ? '💬' :
                  c === 'email' ? '✉️' :
                  c === 'telegram' ? '📨' : c,
                ).join(' ')}</span>
                <span className="font-mono">last: {rule.lastFiredAt ? `${brtTime(rule.lastFiredAt)} BRT` : 'nunca'}</span>
              </div>

              {/* Histórico de disparos expansível */}
              {historyOpenFor === rule.id && (
                <FireHistory rule={rule} onVerdict={(fireId, v) => handleFireVerdict(rule, fireId, v)} />
              )}

              {/* Auto-pause banner */}
              {rule.autoPaused && (
                <div className="mt-2 p-2 bg-amber-900/20 border border-amber-500/30 rounded text-[11px] text-amber-200 flex items-center justify-between">
                  <span><AlertTriangle className="w-3 h-3 inline mr-1" />
                    Pausada automaticamente · motivo: <strong>{rule.autoPausedReason}</strong>
                  </span>
                  <button onClick={() => api.patch(`/semantic-rules/${rule.id}`, { enabled: true }).then(() => {
                    // backend não tem endpoint pra desfazer auto-paused; fazemos manualmente
                    refreshRules()
                  })} className="px-2 py-0.5 rounded bg-amber-500 text-amber-950 text-[10px] font-bold">
                    Reativar (revise o prompt)
                  </button>
                </div>
              )}

              {/* Last fire feedback (mock disparo recente) */}
              {rule.lastFiredAt && new Date(rule.lastFiredAt) > new Date(Date.now() - 24*60*60*1000) && !rule.autoPaused && (
                <div className="mt-2 p-2 bg-slate-800/40 rounded text-[11px] flex items-center justify-between">
                  <span className="text-slate-300">Disparo recente · marque o veredito:</span>
                  <div className="flex gap-1">
                    <button onClick={() => handleFpFeedback(rule, 'correct')}
                      className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" /> Correto
                    </button>
                    <button onClick={() => handleFpFeedback(rule, 'false_positive')}
                      className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold flex items-center gap-1">
                      <X className="w-3 h-3" /> Falso positivo
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Toast feedback (FP/correct/erros) */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'ok' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
        } animate-in slide-in-from-top-2`}>
          {toast.msg}
        </div>
      )}

      {/* Modal de resultado do Teste */}
      {testResult && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={() => setTestResult(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-2xl w-full p-5"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold flex items-center gap-2">
                {testResult.matches ? '🎯' : '💤'} Resultado do teste
              </h3>
              <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {testResult.snapshotDataUrl && (
              <img src={testResult.snapshotDataUrl} alt="snapshot avaliado"
                   className="w-full rounded-lg border border-white/10 mb-3" />
            )}
            <div className={`px-3 py-2 rounded-lg ${testResult.matches ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-300'} text-sm`}>
              <strong>{testResult.matches ? 'MATCH (regra disparou)' : 'NO MATCH (regra não disparou)'}</strong>
              {testResult.confidence !== undefined && (
                <span className="ml-2 text-xs">confiança: {(testResult.confidence * 100).toFixed(0)}%</span>
              )}
            </div>
            <div className="mt-2 text-sm text-slate-300 italic">
              {testResult.reason ?? '(sem razão fornecida)'}
            </div>
            <div className="text-[10px] text-slate-500 mt-3">
              Avaliação feita pelo Gemini Flash 1.5 contra o frame atual da câmera. Custo: ~R$ 0,002.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Histórico de disparos: extrato + download de fotos ──────────────────────
interface FireRow {
  id: string
  firedAt: string
  reason: string | null
  confidence: number | null
  severity: string
  verdict: string | null
  cameraId: string
}

function FireHistory({ rule, onVerdict }: { rule: SemanticRule; onVerdict: (fireId: string, v: 'correct' | 'false_positive') => void }) {
  const [items, setItems] = useState<FireRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setErr(null)
    api.get(`/semantic-rules/${rule.id}/fires?limit=20`)
      .then(r => { setItems(r.data.items); setTotal(r.data.total) })
      .catch(e => setErr(e.response?.data?.message ?? e.message))
      .finally(() => setLoading(false))
  }, [rule.id, rule.fireCount])

  async function downloadSnapshot(fireId: string) {
    try {
      const r = await api.get(`/semantic-rules/${rule.id}/fires/${fireId}/snapshot?download=1`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `disparo-${fireId.slice(0, 8)}.jpg`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e: any) {
      alert('Falha no download: ' + (e.response?.data?.message ?? e.message))
    }
  }

  function exportCsv() {
    if (!items || items.length === 0) return
    const header = ['id', 'firedAt_brt', 'severity', 'verdict', 'confidence', 'reason']
    const rows = items.map(f => [
      f.id,
      new Date(f.firedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      f.severity,
      f.verdict ?? 'pendente',
      f.confidence != null ? (f.confidence * 100).toFixed(0) + '%' : '',
      (f.reason ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""'),
    ])
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `disparos-${rule.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (loading) return <div className="mt-2 p-3 bg-slate-900/40 rounded text-[11px] text-slate-500">Carregando histórico…</div>
  if (err)     return <div className="mt-2 p-3 bg-rose-900/20 border border-rose-500/30 rounded text-[11px] text-rose-300">Erro: {err}</div>
  if (!items || items.length === 0) {
    return <div className="mt-2 p-3 bg-slate-900/40 rounded text-[11px] text-slate-500 text-center">Nenhum disparo persistido ainda. Próximo match será registrado aqui.</div>
  }

  return (
    <div className="mt-2 p-2 bg-slate-900/60 border border-white/10 rounded">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-slate-400">Mostrando {items.length} de {total} disparos</span>
        <button onClick={exportCsv} className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30">
          📊 Exportar CSV
        </button>
      </div>
      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {items.map(f => (
          <div key={f.id} className="flex items-center gap-2 p-1.5 bg-slate-800/40 rounded text-[11px]">
            <FireRowImg fireId={f.id} ruleId={rule.id} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-mono text-emerald-300">{brtTime(f.firedAt)} BRT</span>
                <span className={`text-[9px] px-1 rounded ${f.severity==='critical'?'bg-rose-500/20 text-rose-300':f.severity==='warning'?'bg-amber-500/20 text-amber-300':'bg-cyan-500/20 text-cyan-300'}`}>{f.severity}</span>
                {f.confidence != null && <span className="text-[9px] text-slate-500">conf {(f.confidence*100).toFixed(0)}%</span>}
                {f.verdict === 'correct' && <span className="text-[9px] text-emerald-400">✓ correto</span>}
                {f.verdict === 'false_positive' && <span className="text-[9px] text-rose-400">✗ FP</span>}
              </div>
              <div className="text-slate-300 truncate" title={f.reason ?? ''}>"{f.reason ?? '(sem razão)'}"</div>
            </div>
            <div className="flex flex-col gap-0.5 shrink-0">
              {f.verdict == null && (
                <>
                  <button onClick={() => onVerdict(f.id, 'correct')} title="Correto"
                    className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">✓</button>
                  <button onClick={() => onVerdict(f.id, 'false_positive')} title="Falso positivo"
                    className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px]">✗</button>
                </>
              )}
              <button onClick={() => downloadSnapshot(f.id)} title="Download da foto"
                className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 text-[10px]">⬇</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FireRowImg({ fireId, ruleId }: { fireId: string; ruleId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    api.get(`/semantic-rules/${ruleId}/fires/${fireId}/snapshot`, { responseType: 'blob' })
      .then(r => { objectUrl = URL.createObjectURL(r.data); setUrl(objectUrl) })
      .catch(() => {})
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fireId, ruleId])
  if (!url) return <div className="w-16 h-10 bg-slate-700/50 rounded animate-pulse shrink-0" />
  return <img src={url} alt="" className="w-16 h-10 object-cover rounded shrink-0" />
}

// Carrega snapshot via fetch + blob URL (precisa Authorization header)
function FireSnapshot({ ruleId, lastFiredAt }: { ruleId: string; lastFiredAt?: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let revoked = false
    let objectUrl: string | null = null
    api.get(`/semantic-rules/${ruleId}/snapshot`, { responseType: 'blob' })
      .then(resp => {
        if (revoked) return
        objectUrl = URL.createObjectURL(resp.data)
        setUrl(objectUrl)
      })
      .catch(() => setErr(true))
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ruleId, lastFiredAt])
  if (err) return null
  if (!url) return <div className="w-32 h-20 bg-slate-800/50 rounded animate-pulse shrink-0" />
  return (
    <img src={url} alt="último disparo"
         className="w-32 h-20 object-cover rounded border border-emerald-500/40 shrink-0" />
  )
}
