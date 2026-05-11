/**
 * AdminBillingPage — status do Asaas billing (provisionado, ativável).
 * SUPER_ADMIN apenas.
 */
import useSWR from 'swr'
import { CreditCard, AlertTriangle, CheckCircle, Clock, Power } from 'lucide-react'
import { api } from '../api/client'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface BillingStatus {
  enabled: boolean
  provisioned: boolean
  config: { hasApiKey: boolean; hasWebhookSecret: boolean; baseUrl: string; isSandbox: boolean; flag: string }
  counts: { customers: number; activeSubscriptions: number }
  recentWebhooks: { eventId: string; eventName: string; status: string; receivedAt: string }[]
  notes: string | null
}

export function AdminBillingPage() {
  const { data: status, error, isLoading } = useSWR<BillingStatus>('/admin/billing/status', fetcher)
  const { data: customers } = useSWR<any[]>('/admin/billing/customers', fetcher)
  const { data: subscriptions } = useSWR<any[]>('/admin/billing/subscriptions', fetcher)

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-emerald-500/10 via-cyan-500/5 to-transparent border-emerald-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg">
            <CreditCard className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Billing · Asaas</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              Boletos + Cartão + PIX + NF-e nativa (R$ 0,49/cobrança paga). Webhook em
              <code className="mx-1 text-cyan-600 dark:text-brand-sky">/webhooks/asaas</code>.
            </p>
          </div>
        </div>
      </GlassCard>

      {isLoading && <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando…</GlassCard>}
      {error && (
        <GlassCard className="p-6 text-center">
          <AlertTriangle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
          <p className="text-sm text-rose-600 dark:text-rose-400">Erro ao carregar status.</p>
        </GlassCard>
      )}

      {status && (
        <>
          {/* Status card */}
          <GlassCard className={cn('p-5 border-l-4',
            status.enabled
              ? 'border-l-emerald-500 bg-emerald-500/5'
              : 'border-l-amber-500 bg-amber-500/5',
          )}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {status.enabled
                  ? <CheckCircle className="w-6 h-6 text-emerald-500 mt-0.5" />
                  : <Power className="w-6 h-6 text-amber-500 mt-0.5" />}
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {status.enabled ? 'Billing ATIVO' : 'Billing PROVISIONADO (inativo)'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">{status.notes ?? 'Pronto pra emitir cobranças.'}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-500 uppercase">Modo</p>
                <p className={cn('text-xs font-mono font-semibold', status.config.isSandbox ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                  {status.config.isSandbox ? 'SANDBOX' : 'PRODUÇÃO'}
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Config + counts */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <GlassCard className="p-3">
              <p className="text-[10px] uppercase font-semibold text-slate-500">API Key</p>
              <p className={cn('text-sm font-semibold mt-1', status.config.hasApiKey ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500')}>
                {status.config.hasApiKey ? 'Configurada' : 'Não configurada'}
              </p>
            </GlassCard>
            <GlassCard className="p-3">
              <p className="text-[10px] uppercase font-semibold text-slate-500">Webhook Secret</p>
              <p className={cn('text-sm font-semibold mt-1', status.config.hasWebhookSecret ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500')}>
                {status.config.hasWebhookSecret ? 'Configurado' : 'Não configurado'}
              </p>
            </GlassCard>
            <GlassCard className="p-3">
              <p className="text-[10px] uppercase font-semibold text-slate-500">Customers</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{status.counts.customers}</p>
            </GlassCard>
            <GlassCard className="p-3">
              <p className="text-[10px] uppercase font-semibold text-slate-500">Assinaturas ativas</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{status.counts.activeSubscriptions}</p>
            </GlassCard>
          </div>

          {/* Webhooks recentes */}
          <GlassCard className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Últimos webhooks recebidos</p>
            {status.recentWebhooks.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">Nenhum evento ainda.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-slate-500"><tr><th className="text-left p-1">Evento</th><th className="text-left p-1">Status</th><th className="text-right p-1">Recebido</th></tr></thead>
                <tbody>
                  {status.recentWebhooks.map(w => (
                    <tr key={w.eventId} className="border-t border-slate-200 dark:border-white/5">
                      <td className="p-1 font-mono text-[10px]">{w.eventName}</td>
                      <td className="p-1"><span className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] font-semibold',
                        w.status === 'PROCESSED' && 'bg-emerald-500/15 text-emerald-700',
                        w.status === 'PENDING' && 'bg-amber-500/15 text-amber-700',
                        w.status === 'FAILED' && 'bg-rose-500/15 text-rose-700',
                      )}>{w.status}</span></td>
                      <td className="p-1 text-right text-[10px] text-slate-500"><Clock className="w-2.5 h-2.5 inline mr-0.5" />{new Date(w.receivedAt).toLocaleString('pt-BR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </GlassCard>

          {/* Customers */}
          {(customers?.length ?? 0) > 0 && (
            <GlassCard className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Clientes Asaas ({customers!.length})</p>
              <div className="space-y-2">
                {customers!.map(c => (
                  <div key={c.id} className="flex items-center justify-between text-xs p-2 rounded border border-slate-200 dark:border-white/10">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{c.integrador?.tradeName ?? c.integrador?.name}</p>
                      <p className="text-[10px] text-slate-500">{c.email ?? '—'} · cpfCnpj: {c.cpfCnpj ?? '—'}</p>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">{c.asaasCustomerId}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {/* Subscriptions */}
          {(subscriptions?.length ?? 0) > 0 && (
            <GlassCard className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Assinaturas ({subscriptions!.length})</p>
              <div className="overflow-x-auto"><table className="w-full text-xs min-w-[540px]">
                <thead className="text-slate-500"><tr><th className="text-left p-1">Integrador</th><th className="text-left p-1">Plano</th><th className="text-right p-1">Valor</th><th className="text-right p-1">Próximo venc.</th><th className="text-center p-1">Status</th></tr></thead>
                <tbody>
                  {subscriptions!.map(s => (
                    <tr key={s.id} className="border-t border-slate-200 dark:border-white/5">
                      <td className="p-1">{s.integrador?.tradeName ?? s.integrador?.name}</td>
                      <td className="p-1 font-mono text-[10px]">{s.planSlug}</td>
                      <td className="p-1 text-right font-mono">R$ {Number(s.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="p-1 text-right text-[10px]">{new Date(s.nextDueDate).toLocaleDateString('pt-BR')}</td>
                      <td className="p-1 text-center"><span className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] font-semibold',
                        s.status === 'ACTIVE' && 'bg-emerald-500/15 text-emerald-700',
                        s.status === 'INACTIVE' && 'bg-slate-500/15 text-slate-500',
                        s.status === 'EXPIRED' && 'bg-rose-500/15 text-rose-700',
                      )}>{s.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </GlassCard>
          )}

          {/* Como ativar */}
          {!status.enabled && (
            <GlassCard className="p-5 border border-amber-500/30 bg-amber-500/5">
              <p className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Como ativar</p>
              <ol className="text-xs text-slate-700 dark:text-slate-300 space-y-1 list-decimal list-inside">
                <li>Crie conta no Asaas (sandbox: <code>https://sandbox.asaas.com/</code>)</li>
                <li>Pegue API key em Configurações &gt; Integrações</li>
                <li>Configure webhook → URL: <code>https://app.iacloud.com.br/webhooks/asaas</code> + token aleatório</li>
                <li>Setar <code>ASAAS_API_KEY</code> + <code>ASAAS_WEBHOOK_SECRET</code> + <code>BILLING_ENABLED=true</code> no <code>.env</code></li>
                <li>Restart: <code>docker service update --force iacloud_backend</code></li>
              </ol>
            </GlassCard>
          )}
        </>
      )}
    </div>
  )
}
