/**
 * AdminBillingPage — Painel ÚNICO de billing Asaas.
 *
 * Substitui AdminBillingPage (status) + AdminBillingAsaasConfigPage (rotação).
 * Tudo num só lugar: status + KPIs + atividade + ações + config + audit.
 *
 * SUPER_ADMIN | ADMIN_GLOBAL apenas.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Copy, CreditCard, ExternalLink, Key, Loader2,
  RefreshCw, Shield, Trash2, XCircle, Zap,
} from 'lucide-react'
import { api } from '../api/client'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface Overview {
  config: {
    enabled:          boolean
    configured:       boolean
    source:           'db' | 'env'
    environment:      'PROD' | 'SANDBOX'
    apiKeyPreview:    string | null
    webhookSecretSet: boolean
    accountName:      string | null
    accountEmail:     string | null
    lastValidatedAt:  string | null
    lastValidatedOk:  boolean
    lastError:        string | null
  }
  counts: {
    customers:           number
    activeSubscriptions: number
    recentWebhooks24h:   number
    failedWebhooks:      number
    pendingWebhooks:     number
  }
  webhookHealth: {
    monitored:               boolean
    webhookId:               string | null
    webhookEnabled:          boolean
    interrupted:             boolean
    penalizedRequestsCount:  number
  }
  recentEvents: Array<{
    id:           string
    eventId:      string
    eventName:    string
    status:       string
    receivedAt:   string
    processedAt:  string | null
    errorMessage: string | null
  }>
  customers:     Array<any>
  subscriptions: Array<any>
  notes:         string | null
}

interface AuditEntry {
  id:         string
  action:     string
  actorEmail: string | null
  actorName:  string | null
  metadata:   any
  createdAt:  string
}

export function AdminBillingPage() {
  const { data: ov, error, isLoading, mutate } = useSWR<Overview>(
    '/admin/billing/overview', fetcher, { refreshInterval: 30_000 },
  )
  const { data: integradores, mutate: mutateIntegs } = useSWR<{
    totals: { mrrForecast: number; overdueCount: number; pendingCount: number }
    integradores: Array<any>
  }>('/admin/billing/integradores-overview', fetcher, { refreshInterval: 60_000 })

  // Sections state
  const [showRotateKey, setShowRotateKey]       = useState(false)
  const [showRotateSecret, setShowRotateSecret] = useState(false)
  const [showSimulate, setShowSimulate]         = useState(false)
  const [showAudit, setShowAudit]               = useState(false)
  const [generating, setGenerating]             = useState(false)
  const [generateResult, setGenerateResult]     = useState<any | null>(null)

  // Test connection
  const [testing, setTesting]   = useState(false)
  const [testRes, setTestRes]   = useState<{ ok: boolean; accountName?: string; errors?: any[] } | null>(null)

  // Rotate key
  const [newKey, setNewKey]                   = useState('')
  const [keyEnv, setKeyEnv]                   = useState<'PROD' | 'SANDBOX'>('PROD')
  const [rotatingKey, setRotatingKey]         = useState(false)
  const [keyRes, setKeyRes]                   = useState<any | null>(null)

  // Rotate secret
  const [rotatingSecret, setRotatingSecret]   = useState(false)
  const [secretRes, setSecretRes]             = useState<{ newSecret: string } | null>(null)

  // Simulate
  const [simEvent, setSimEvent]               = useState('PAYMENT_RECEIVED')
  const [simulating, setSimulating]           = useState(false)
  const [simRes, setSimRes]                   = useState<any | null>(null)

  // Unpause
  const [unpausing, setUnpausing]             = useState(false)

  // Reprocess
  const [reprocessingAll, setReprocessingAll] = useState(false)

  async function handleTest() {
    setTesting(true); setTestRes(null)
    try { const r = await api.post('/admin/billing/asaas/test-connection'); setTestRes(r.data); mutate() }
    finally { setTesting(false) }
  }

  async function handleRotateKey() {
    if (!newKey || newKey.length < 16) { setKeyRes({ ok: false, errors: [{ description: 'API key inválida (mín. 16 chars)' }] }); return }
    setRotatingKey(true); setKeyRes(null)
    try {
      const r = await api.post('/admin/billing/asaas/rotate-api-key', { apiKey: newKey, environment: keyEnv })
      setKeyRes(r.data)
      if (r.data.ok) { setNewKey(''); mutate() }
    } catch (e: any) {
      setKeyRes({ ok: false, errors: e?.response?.data?.errors ?? [{ description: e?.message ?? 'Erro' }] })
    } finally { setRotatingKey(false) }
  }

  async function handleRotateSecret() {
    setRotatingSecret(true); setSecretRes(null)
    try {
      const r = await api.post('/admin/billing/asaas/rotate-webhook-secret')
      setSecretRes({ newSecret: r.data.newSecret })
      mutate()
    } finally { setRotatingSecret(false) }
  }

  async function handleSimulate() {
    setSimulating(true); setSimRes(null)
    try {
      const r = await api.post('/admin/billing/asaas/simulate-webhook', { eventName: simEvent })
      setSimRes(r.data)
      mutate()
    } catch (e: any) {
      setSimRes({ ok: false, error: e?.response?.data ?? e?.message })
    } finally { setSimulating(false) }
  }

  async function handleUnpause() {
    if (!confirm('Reativar a fila do webhook? Após reativar, eventos novos voltam a chegar.')) return
    setUnpausing(true)
    try {
      await api.post('/admin/billing/asaas/unpause-queue')
      mutate()
    } catch (e: any) { alert('Falha: ' + (e?.response?.data?.message ?? e?.message)) }
    finally { setUnpausing(false) }
  }

  async function handleReprocessAll() {
    if (!confirm('Reprocessar todos os webhooks FAILED dos últimos 7 dias?')) return
    setReprocessingAll(true)
    try {
      const r = await api.post('/admin/billing/webhook-events/reprocess-all-failed')
      alert(`${r.data.count} webhook(s) marcados pra reprocessar.`)
      mutate()
    } finally { setReprocessingAll(false) }
  }

  async function handleReprocessOne(id: string) {
    try { await api.post(`/admin/billing/webhook-events/${id}/reprocess`); mutate() }
    catch (e: any) { alert('Falha: ' + (e?.response?.data?.message ?? e?.message)) }
  }

  async function handleCancelSub(id: string, name: string) {
    if (!confirm(`Cancelar assinatura de "${name}"? Esta ação não pode ser desfeita.`)) return
    try { await api.delete(`/admin/billing/subscriptions/${id}`); mutate() }
    catch (e: any) { alert('Falha: ' + (e?.response?.data?.errors?.[0]?.description ?? e?.message)) }
  }

  function copyToClipboard(s: string) { navigator.clipboard.writeText(s).catch(() => {}) }

  // Status overall
  const statusKind = !ov?.config.enabled
    ? 'inactive'
    : ov.webhookHealth.interrupted
      ? 'critical'
      : ov.config.lastError || !ov.config.lastValidatedOk
        ? 'warning'
        : 'ok'

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <GlassCard className={cn('p-5 border-l-4',
        statusKind === 'ok'       && 'border-l-emerald-500 bg-emerald-500/5',
        statusKind === 'warning'  && 'border-l-amber-500 bg-amber-500/5',
        statusKind === 'critical' && 'border-l-rose-500 bg-rose-500/5',
        statusKind === 'inactive' && 'border-l-slate-500 bg-slate-500/5',
      )}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-medium text-slate-900 dark:text-white">Asaas billing</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {ov?.config.enabled
                  ? <>Boletos + Cartão + PIX. Webhook em <code className="text-cyan-600">/webhooks/asaas</code>.</>
                  : 'Provisionado, inativo. Configure a API key abaixo pra ativar.'}
              </p>
              {ov?.config.accountName && (
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5">
                  <strong>{ov.config.accountName}</strong>
                  {ov.config.accountEmail && <span className="text-slate-400"> · {ov.config.accountEmail}</span>}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {ov && (
              <>
                <Badge label={ov.config.enabled ? 'Ativo' : 'Inativo'} kind={ov.config.enabled ? 'ok' : 'neutral'} />
                <Badge label={ov.config.environment} kind={ov.config.environment === 'PROD' ? 'ok' : 'warning'} />
                <Badge label={ov.config.source === 'db' ? 'DB (rotável)' : 'Env (legado)'} kind={ov.config.source === 'db' ? 'ok' : 'warning'} />
              </>
            )}
            <Link to="/admin/billing/explorer"
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-violet-500 to-cyan-500 text-white hover:from-violet-600 hover:to-cyan-600 shadow-md shadow-violet-500/20 inline-flex items-center gap-1.5">
              🔍 Explorador
            </Link>
          </div>
        </div>

        {ov && (
          <div className="mt-3 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
            <span>
              Última validação:{' '}
              {ov.config.lastValidatedAt
                ? <strong className={ov.config.lastValidatedOk ? 'text-emerald-600' : 'text-rose-500'}>
                    {new Date(ov.config.lastValidatedAt).toLocaleString('pt-BR')}
                  </strong>
                : <em>nunca</em>}
            </span>
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-2 py-1 rounded text-[11px] font-medium bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {testing
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Testando…</>
                : <><RefreshCw className="w-3 h-3" /> Testar agora</>}
            </button>
            {ov.config.lastError && (
              <span className="text-rose-500">⚠ {ov.config.lastError}</span>
            )}
          </div>
        )}

        {testRes && (
          <div className={cn('mt-3 p-2 rounded text-xs',
            testRes.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
          )}>
            {testRes.ok
              ? <><CheckCircle2 className="w-3 h-3 inline" /> Conectou: <strong>{testRes.accountName ?? 'OK'}</strong></>
              : <><XCircle className="w-3 h-3 inline" /> {testRes.errors?.[0]?.description}</>}
          </div>
        )}

        {ov?.notes && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded p-2">
            {ov.notes}
          </p>
        )}
      </GlassCard>

      {isLoading && (
        <GlassCard className="p-6 text-center text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Carregando…
        </GlassCard>
      )}

      {error && (
        <GlassCard className="p-6 text-center">
          <AlertTriangle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
          <p className="text-sm text-rose-600">Erro ao carregar overview</p>
        </GlassCard>
      )}

      {ov && (
        <>
          {/* PENALTY ALERT — só se ativo */}
          {(ov.webhookHealth.interrupted || ov.webhookHealth.penalizedRequestsCount > 0) && (
            <GlassCard className="p-4 border-l-4 border-l-rose-500 bg-rose-500/5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
                      {ov.webhookHealth.interrupted
                        ? 'Fila do webhook PAUSADA pelo Asaas'
                        : `Webhook acumulando falhas (${ov.webhookHealth.penalizedRequestsCount})`}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {ov.webhookHealth.interrupted
                        ? 'Eventos novos NÃO chegam até reativar. Revise os FAILED abaixo antes.'
                        : `Em ${15 - ov.webhookHealth.penalizedRequestsCount} falhas consecutivas a fila será pausada.`}
                    </p>
                  </div>
                </div>
                {ov.webhookHealth.interrupted && (
                  <button
                    onClick={handleUnpause}
                    disabled={unpausing}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {unpausing
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Reativando…</>
                      : <><Zap className="w-3 h-3" /> Reativar fila</>}
                  </button>
                )}
              </div>
            </GlassCard>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label="Webhooks 24h"  value={ov.counts.recentWebhooks24h} icon={<Activity className="w-4 h-4" />} />
            <Kpi label="FAILED"        value={ov.counts.failedWebhooks}    icon={<XCircle className="w-4 h-4" />} kind={ov.counts.failedWebhooks > 0 ? 'warning' : 'neutral'} />
            <Kpi label="PENDING"       value={ov.counts.pendingWebhooks}   icon={<Clock className="w-4 h-4" />}   kind={ov.counts.pendingWebhooks > 5 ? 'warning' : 'neutral'} />
            <Kpi label="Customers"     value={ov.counts.customers}         icon={<CreditCard className="w-4 h-4" />} />
            <Kpi label="Assinaturas"   value={ov.counts.activeSubscriptions} icon={<RefreshCw className="w-4 h-4" />} />
          </div>

          {/* INTEGRADORES — MRR + inadimplência */}
          {integradores && (
            <GlassCard className="p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Cobrança por integrador
                </p>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-slate-500">
                    MRR previsto: <strong className="text-emerald-600">R$ {integradores.totals.mrrForecast.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                  </span>
                  {integradores.totals.overdueCount > 0 && (
                    <span className="text-xs text-rose-600">
                      {integradores.totals.overdueCount} em atraso
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      if (!confirm('Gerar fatura agora pra TODOS os integradores? (dry-run primeiro)')) return
                      setGenerating(true); setGenerateResult(null)
                      try {
                        const r = await api.post('/admin/billing/invoices/run-now', { dryRun: true })
                        setGenerateResult(r.data)
                      } finally { setGenerating(false) }
                    }}
                    disabled={generating}
                    className="px-2 py-1 rounded text-[11px] font-medium bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
                  >
                    {generating ? '…' : 'Simular fatura'}
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('GERAR fatura REAL agora pra todos os integradores? Vai criar payments no Asaas.')) return
                      setGenerating(true); setGenerateResult(null)
                      try {
                        const r = await api.post('/admin/billing/invoices/run-now', { dryRun: false })
                        setGenerateResult(r.data)
                        mutate(); mutateIntegs()
                      } finally { setGenerating(false) }
                    }}
                    disabled={generating}
                    className="px-2 py-1 rounded text-[11px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {generating ? '…' : 'Gerar fatura agora'}
                  </button>
                </div>
              </div>

              {generateResult && (
                <div className="mb-3 p-2 rounded bg-slate-100 dark:bg-slate-800/50 text-xs">
                  <strong>{generateResult.dryRun ? 'SIMULAÇÃO' : 'GERADAS'}</strong>: {generateResult.processed} processados ·
                  {' '}{generateResult.generated} novas ·
                  {' '}{generateResult.skipped} já existentes ·
                  {generateResult.asaasErrors > 0 && <span className="text-rose-500"> {generateResult.asaasErrors} erros Asaas</span>}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left p-1">Integrador</th>
                      <th className="text-right p-1">MRR previsto</th>
                      <th className="text-right p-1">Pendentes</th>
                      <th className="text-left p-1">Fatura corrente</th>
                      <th className="text-right p-1">Último pago</th>
                      <th className="text-center p-1">Asaas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {integradores.integradores.map((r: any) => (
                      <tr key={r.integradorId} className="border-t border-slate-200 dark:border-white/5">
                        <td className="p-1">{r.integradorName}</td>
                        <td className="p-1 text-right font-mono">R$ {(r.previewMrrBrl ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="p-1 text-right">{r.pendingCount > 0
                          ? <span className="text-rose-600 font-medium">{r.pendingCount}</span>
                          : '0'}</td>
                        <td className="p-1 text-[10px]">
                          {r.currentInvoice
                            ? <>R$ {r.currentInvoice.totalAmountBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} <StatusPill status={r.currentInvoice.status} /></>
                            : '—'}
                        </td>
                        <td className="p-1 text-right text-[10px]">
                          {r.lastPaidAt
                            ? <>R$ {r.lastPaidAmount?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em {new Date(r.lastPaidAt).toLocaleDateString('pt-BR')}</>
                            : '—'}
                        </td>
                        <td className="p-1 text-center">
                          {r.hasAsaasCustomer
                            ? <span className="text-emerald-600 text-[10px]">✓</span>
                            : <span className="text-slate-400 text-[10px]">não cadastrado</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}

          {/* ATIVIDADE — webhooks recentes */}
          <GlassCard className="p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Últimos webhooks</p>
              {ov.counts.failedWebhooks > 0 && (
                <button
                  onClick={handleReprocessAll}
                  disabled={reprocessingAll}
                  className="px-2 py-1 rounded text-[11px] font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {reprocessingAll ? 'Reprocessando…' : `Reprocessar ${ov.counts.failedWebhooks} FAILED`}
                </button>
              )}
            </div>
            {ov.recentEvents.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">Nenhum webhook ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[540px]">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left p-1">Evento</th>
                      <th className="text-left p-1">Status</th>
                      <th className="text-left p-1">Recebido</th>
                      <th className="text-left p-1">Erro</th>
                      <th className="text-right p-1">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ov.recentEvents.map(e => (
                      <tr key={e.id} className="border-t border-slate-200 dark:border-white/5">
                        <td className="p-1 font-mono text-[10px]">{e.eventName}</td>
                        <td className="p-1"><StatusPill status={e.status} /></td>
                        <td className="p-1 text-[10px] text-slate-500">
                          {new Date(e.receivedAt).toLocaleString('pt-BR')}
                        </td>
                        <td className="p-1 text-[10px] text-rose-500 max-w-[200px] truncate" title={e.errorMessage ?? ''}>
                          {e.errorMessage ?? ''}
                        </td>
                        <td className="p-1 text-right">
                          {(e.status === 'FAILED' || e.status === 'PENDING') && (
                            <button
                              onClick={() => handleReprocessOne(e.id)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <RefreshCw className="w-2.5 h-2.5 inline" /> Reprocessar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>

          {/* Customers */}
          {ov.customers.length > 0 && (
            <GlassCard className="p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Customers ({ov.customers.length})</p>
              <div className="space-y-1.5">
                {ov.customers.map(c => (
                  <div key={c.id} className="flex items-center justify-between text-xs p-2 rounded border border-slate-200 dark:border-white/10">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{c.integrador?.tradeName ?? c.integrador?.name ?? '—'}</p>
                      <p className="text-[10px] text-slate-500">{c.email ?? '—'} · CPF/CNPJ: {c.cpfCnpj ?? '—'}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">{c.asaasCustomerId}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {/* Subscriptions */}
          {ov.subscriptions.length > 0 && (
            <GlassCard className="p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Assinaturas ativas ({ov.subscriptions.length})</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left p-1">Integrador</th>
                      <th className="text-left p-1">Plano</th>
                      <th className="text-right p-1">Valor</th>
                      <th className="text-right p-1">Próximo</th>
                      <th className="text-center p-1">Status</th>
                      <th className="text-right p-1">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ov.subscriptions.map(s => (
                      <tr key={s.id} className="border-t border-slate-200 dark:border-white/5">
                        <td className="p-1">{s.integrador?.tradeName ?? s.integrador?.name ?? '—'}</td>
                        <td className="p-1 font-mono text-[10px]">{s.planSlug}</td>
                        <td className="p-1 text-right font-mono">R$ {Number(s.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="p-1 text-right text-[10px]">{new Date(s.nextDueDate).toLocaleDateString('pt-BR')}</td>
                        <td className="p-1 text-center"><StatusPill status={s.status} /></td>
                        <td className="p-1 text-right">
                          <button
                            onClick={() => handleCancelSub(s.id, s.integrador?.tradeName ?? s.integrador?.name ?? s.planSlug)}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                          >
                            <Trash2 className="w-2.5 h-2.5 inline" /> Cancelar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}

          {/* CONFIGURAÇÃO AVANÇADA — collapsed por default */}
          <GlassCard className="p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Configuração</p>

            <Collapse open={showRotateKey} onToggle={() => setShowRotateKey(!showRotateKey)}
              icon={<Key className="w-4 h-4" />} title="Rotacionar API key"
              subtitle={ov.config.apiKeyPreview ? `Atual: ${ov.config.apiKeyPreview}` : 'Não configurada'}>
              <div className="space-y-3 mt-2">
                <div>
                  <label className="text-xs text-slate-500">Ambiente</label>
                  <select value={keyEnv} onChange={e => setKeyEnv(e.target.value as any)}
                    className="block w-full mt-1 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
                    <option value="PROD">Produção (api.asaas.com)</option>
                    <option value="SANDBOX">Sandbox (api-sandbox.asaas.com)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Nova API key</label>
                  <input type="password" value={newKey} onChange={e => setNewKey(e.target.value)}
                    placeholder="$aact_prod_xxx… ou $aact_hmlg_xxx…"
                    className="block w-full mt-1 px-2 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" />
                </div>
                <button onClick={handleRotateKey} disabled={rotatingKey || !newKey}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                  {rotatingKey ? 'Validando…' : 'Aplicar'}
                </button>
                {keyRes && (
                  <div className={cn('p-2 rounded text-xs',
                    keyRes.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300')}>
                    {keyRes.ok
                      ? <><CheckCircle2 className="w-3 h-3 inline" /> Aplicada · conta: <strong>{keyRes.accountName ?? '—'}</strong></>
                      : <><XCircle className="w-3 h-3 inline" /> {keyRes.errors?.map((e: any) => e.description).join(' · ')}</>}
                  </div>
                )}
              </div>
            </Collapse>

            <Collapse open={showRotateSecret} onToggle={() => setShowRotateSecret(!showRotateSecret)}
              icon={<Shield className="w-4 h-4" />} title="Rotacionar webhook secret"
              subtitle={ov.config.webhookSecretSet ? 'Configurado' : 'Não configurado'}>
              <div className="space-y-3 mt-2">
                {!secretRes ? (
                  <>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      ⚠ Após gerar, atualize imediatamente no painel Asaas. Webhooks nesse intervalo recebem 401.
                    </p>
                    <button onClick={handleRotateSecret} disabled={rotatingSecret}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                      {rotatingSecret ? 'Gerando…' : 'Gerar novo'}
                    </button>
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="w-3 h-3 inline" /> Copie e cole no painel Asaas:
                    </p>
                    <div className="flex gap-2">
                      <code className="flex-1 p-2 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-mono break-all">{secretRes.newSecret}</code>
                      <button onClick={() => copyToClipboard(secretRes.newSecret)}
                        className="px-2 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800" title="Copiar">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    <button onClick={() => setSecretRes(null)}
                      className="text-xs underline text-slate-500">Fechar</button>
                  </div>
                )}
              </div>
            </Collapse>

            <Collapse open={showSimulate} onToggle={() => setShowSimulate(!showSimulate)}
              icon={<Zap className="w-4 h-4" />} title="Testar webhook simulado"
              subtitle="Dispara um evento mock pra validar handler">
              <div className="space-y-3 mt-2">
                <select value={simEvent} onChange={e => setSimEvent(e.target.value)}
                  className="block w-full px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
                  <option>PAYMENT_RECEIVED</option>
                  <option>PAYMENT_CONFIRMED</option>
                  <option>PAYMENT_OVERDUE</option>
                  <option>PAYMENT_REFUNDED</option>
                  <option>SUBSCRIPTION_DELETED</option>
                  <option>ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED</option>
                  <option>BALANCE_VALUE_BLOCKED</option>
                </select>
                <button onClick={handleSimulate} disabled={simulating}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50">
                  {simulating ? 'Disparando…' : 'Disparar'}
                </button>
                {simRes && (
                  <pre className="text-[10px] bg-slate-100 dark:bg-slate-800 p-2 rounded overflow-x-auto">
                    {JSON.stringify(simRes, null, 2)}
                  </pre>
                )}
              </div>
            </Collapse>

            <Collapse open={showAudit} onToggle={() => setShowAudit(!showAudit)}
              icon={<Clock className="w-4 h-4" />} title="Histórico de rotações" subtitle="Audit log de mudanças de credenciais">
              <AuditLogTable open={showAudit} />
            </Collapse>
          </GlassCard>

          {/* COMO ATIVAR — só se inativo */}
          {!ov.config.enabled && (
            <GlassCard className="p-5 border border-amber-500/30 bg-amber-500/5">
              <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Como ativar</p>
              <ol className="text-xs text-slate-700 dark:text-slate-300 space-y-1 list-decimal list-inside">
                <li>Acesse <a href="https://www.asaas.com" target="_blank" rel="noopener" className="text-cyan-600 underline">painel Asaas <ExternalLink className="w-3 h-3 inline" /></a> (produção) ou <a href="https://sandbox.asaas.com" target="_blank" rel="noopener" className="text-cyan-600 underline">sandbox</a></li>
                <li>Gere uma API key em Configurações → Integrações</li>
                <li>Use o card <strong>"Rotacionar API key"</strong> acima pra colar</li>
                <li>Use <strong>"Rotacionar webhook secret"</strong> pra gerar o token, copie e cole no painel Asaas em Webhooks → Editar</li>
                <li>Configure o webhook apontando pra <code>https://app.vsaas.com.br/api/webhooks/asaas</code></li>
              </ol>
            </GlassCard>
          )}
        </>
      )}
    </div>
  )
}

// ── Subcomponentes ───────────────────────────────────────────────────────────

function Badge({ label, kind }: { label: string; kind: 'ok' | 'warning' | 'neutral' }) {
  return (
    <span className={cn(
      'px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide',
      kind === 'ok'      && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      kind === 'warning' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      kind === 'neutral' && 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    )}>
      {label}
    </span>
  )
}

function Kpi({ label, value, icon, kind = 'neutral' }: { label: string; value: number; icon: React.ReactNode; kind?: 'ok' | 'warning' | 'neutral' }) {
  return (
    <GlassCard className={cn('p-3',
      kind === 'warning' && 'border-amber-500/30',
    )}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
        <span className="text-slate-400">{icon}</span>
      </div>
      <p className={cn('text-2xl font-medium mt-1',
        kind === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white',
      )}>
        {value}
      </p>
    </GlassCard>
  )
}

function StatusPill({ status }: { status: string }) {
  const c = status === 'PROCESSED' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
         : status === 'PENDING'    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
         : status === 'FAILED'     ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
         : status === 'ACTIVE'     ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
         : status === 'INACTIVE'   ? 'bg-slate-500/15 text-slate-600 dark:text-slate-400'
         :                            'bg-slate-500/15 text-slate-600'
  return <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium', c)}>{status}</span>
}

function Collapse({ open, onToggle, icon, title, subtitle, children }: {
  open: boolean; onToggle: () => void; icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <div className="border-t border-slate-200 dark:border-white/10 first:border-t-0 py-2">
      <button onClick={onToggle} className="w-full flex items-center justify-between text-left py-1.5">
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          <span className="text-slate-400">{icon}</span>
          <span>
            <span className="text-sm font-medium text-slate-900 dark:text-white">{title}</span>
            {subtitle && <span className="text-[11px] text-slate-500 ml-2">{subtitle}</span>}
          </span>
        </span>
      </button>
      {open && <div className="px-5 pb-2">{children}</div>}
    </div>
  )
}

function AuditLogTable({ open }: { open: boolean }) {
  const { data } = useSWR<AuditEntry[]>(open ? '/admin/billing/audit-log' : null, fetcher)
  if (!open) return null
  if (!data) return <p className="text-xs text-slate-500 py-2">Carregando…</p>
  if (data.length === 0) return <p className="text-xs text-slate-500 py-2">Sem rotações registradas ainda.</p>
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs min-w-[460px]">
        <thead className="text-slate-500">
          <tr>
            <th className="text-left p-1">Ação</th>
            <th className="text-left p-1">Por</th>
            <th className="text-left p-1">Quando</th>
            <th className="text-left p-1">Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.id} className="border-t border-slate-200 dark:border-white/5">
              <td className="p-1 font-mono text-[10px]">{r.action}</td>
              <td className="p-1">{r.actorEmail ?? r.actorName ?? '—'}</td>
              <td className="p-1 text-[10px] text-slate-500">{new Date(r.createdAt).toLocaleString('pt-BR')}</td>
              <td className="p-1 text-[10px] text-slate-500">
                {r.metadata ? Object.entries(r.metadata).map(([k, v]) => `${k}=${v}`).join(' · ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
