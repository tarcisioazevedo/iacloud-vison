/**
 * FaturasTab — fatura corrente + histórico no padrão do design system.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Clock, ExternalLink, FileText, Loader2, RefreshCw, X, CreditCard, DollarSign, Calendar } from 'lucide-react'
import { api } from '../../api/client'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

type Overview = any

interface InvoiceRow {
  id: string; periodStart: string; periodEnd: string
  totalAmountBrl: number; status: string; dueDate: string | null; paidAt: string | null
  billingType: string | null; asaasPaymentUrl: string | null
  lineItemsCount: number; receiptsCount: number
}

interface InvoiceDetail extends InvoiceRow {
  lineItems: Array<{
    id: string; productSlug: string; productName: string
    cameraCount: number; unitPriceUsd: number; subtotalBrl: number
    clienteFinal: null | { id: string; name: string; tradeName: string | null }
  }>
  receipts: Array<{ id: string; asaasPaymentId: string; amountBrl: number; billingType: string; paidAt: string }>
}

function brl(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function FaturasTab({ overview }: { overview: Overview }) {
  const { data: invoices, mutate } = useSWR<InvoiceRow[]>('/me/integrador/billing/invoices?limit=12', fetcher)
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  const current = overview?.current
  const alertKind = overview?.alert?.kind ?? 'none'

  async function handleRegenerate(id: string) {
    setRegenerating(true)
    try { await api.post(`/me/integrador/billing/invoices/${id}/regenerate`); mutate() }
    catch (e: any) { alert('Falha: ' + (e?.response?.data?.message ?? e?.message)) }
    finally { setRegenerating(false) }
  }

  // EMPTY STATE
  if (!overview?.customerConfigured && !current && !invoices?.length) {
    return (
      <GlassCard className="p-8">
        <div className="text-center max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 mx-auto mb-4 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <FileText className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Você ainda não tem faturas</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 mb-4">
            Sua primeira fatura será gerada automaticamente no <strong>primeiro dia útil do mês</strong>,
            somando o que seus clientes finais contrataram.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500">
            Quando vencer, você receberá email + notificação push.
          </p>
        </div>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-4">
      {/* Alerta */}
      {alertKind === 'overdue' && (
        <GlassCard className="p-4 border-l-4 border-l-rose-500 border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
              Fatura em atraso{overview.alert.daysOverdue != null && ` há ${overview.alert.daysOverdue} dia${overview.alert.daysOverdue !== 1 ? 's' : ''}`}.
              Regularize para evitar suspensão das câmeras dos seus clientes.
            </p>
          </div>
        </GlassCard>
      )}
      {alertKind === 'due_soon' && (
        <GlassCard className="p-4 border-l-4 border-l-amber-500 border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              Fatura vence em <strong>{overview.alert.daysUntilDue} dia{overview.alert.daysUntilDue !== 1 ? 's' : ''}</strong>.
            </p>
          </div>
        </GlassCard>
      )}

      {/* Fatura corrente */}
      {current && (
        <GlassCard className="p-5 border-emerald-300 dark:border-emerald-500/20">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-300">Fatura atual</h3>
            </div>
            <div className="flex gap-2">
              {current.asaasPaymentUrl && current.status !== 'PAID' && (
                <>
                  <a href={current.asaasPaymentUrl} target="_blank" rel="noopener"
                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-md shadow-emerald-500/20 inline-flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> Pagar agora
                  </a>
                  <button onClick={() => handleRegenerate(current.id)} disabled={regenerating}
                    className="px-2 py-1.5 rounded-md text-xs border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1">
                    {regenerating ? '…' : <><RefreshCw className="w-3 h-3" /> Atualizar link</>}
                  </button>
                </>
              )}
              <button onClick={() => setOpenInvoiceId(current.id)}
                className="px-2 py-1.5 rounded-md text-xs border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1">
                <FileText className="w-3 h-3" /> Detalhes
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Mini label="Valor" value={`R$ ${brl(current.totalAmountBrl)}`} Icon={DollarSign} />
            <Mini label="Vencimento" value={current.dueDate ? new Date(current.dueDate).toLocaleDateString('pt-BR') : '—'} Icon={Calendar} sub={current.billingType ?? 'método não definido'} />
            <Mini label="Status" value={current.status} valueClass={
              current.status === 'OVERDUE' ? 'text-rose-600 dark:text-rose-400' :
              current.status === 'PAID'    ? 'text-emerald-600 dark:text-emerald-400' :
              'text-amber-600 dark:text-amber-400'
            } />
          </div>
        </GlassCard>
      )}

      {/* HISTÓRICO */}
      <GlassCard className="p-5">
        <h3 className="text-xs uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300 mb-4">Histórico</h3>
        {!invoices?.length ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Sem histórico ainda.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="text-left py-2 px-2 font-semibold uppercase tracking-wider">Período</th>
                  <th className="text-right py-2 px-2 font-semibold uppercase tracking-wider">Valor</th>
                  <th className="text-center py-2 px-2 font-semibold uppercase tracking-wider">Status</th>
                  <th className="text-left py-2 px-2 font-semibold uppercase tracking-wider">Vencimento</th>
                  <th className="text-left py-2 px-2 font-semibold uppercase tracking-wider">Pago em</th>
                  <th className="text-left py-2 px-2 font-semibold uppercase tracking-wider">Método</th>
                  <th className="text-right py-2 px-2 font-semibold uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(i => (
                  <tr key={i.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="py-2 px-2">{new Date(i.periodStart).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</td>
                    <td className="py-2 px-2 text-right font-mono font-semibold">R$ {brl(i.totalAmountBrl)}</td>
                    <td className="py-2 px-2 text-center"><StatusPill status={i.status} /></td>
                    <td className="py-2 px-2 text-xs text-slate-500">{i.dueDate ? new Date(i.dueDate).toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="py-2 px-2 text-xs text-slate-500">{i.paidAt ? new Date(i.paidAt).toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="py-2 px-2 text-xs">{i.billingType ?? '—'}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      <button onClick={() => setOpenInvoiceId(i.id)} className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Detalhes
                      </button>
                      {i.asaasPaymentUrl && i.status !== 'PAID' && (
                        <a href={i.asaasPaymentUrl} target="_blank" rel="noopener" className="ml-1 text-xs px-2 py-1 rounded bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 inline-flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> Pagar
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {openInvoiceId && <InvoiceDetailDrawer id={openInvoiceId} onClose={() => setOpenInvoiceId(null)} />}
    </div>
  )
}

function Mini({ label, value, sub, Icon, valueClass }: { label: string; value: string; sub?: string; Icon?: any; valueClass?: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-3 border border-slate-200 dark:border-white/10">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </div>
      <p className={cn('text-xl font-bold', valueClass ?? 'text-slate-900 dark:text-white')}>{value}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    PAID:      'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30',
    PENDING:   'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30',
    OVERDUE:   'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30',
    CANCELLED: 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-500/30',
    REFUNDED:  'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/30',
  }
  return <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase', map[status] ?? map.CANCELLED)}>{status}</span>
}

function InvoiceDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: inv, isLoading } = useSWR<InvoiceDetail>(`/me/integrador/billing/invoices/${id}`, fetcher)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <GlassCard className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Detalhes da fatura</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Breakdown por produto contratado pelos seus clientes finais</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        {isLoading && <p className="text-sm text-slate-500 text-center py-6"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Carregando…</p>}
        {inv && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <Field label="Período" value={`${new Date(inv.periodStart).toLocaleDateString('pt-BR')} → ${new Date(inv.periodEnd).toLocaleDateString('pt-BR')}`} />
              <Field label="Total" value={`R$ ${brl(inv.totalAmountBrl)}`} highlight />
              <Field label="Status" value={inv.status} />
              <Field label="Vencimento" value={inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('pt-BR') : '—'} />
            </div>

            <h4 className="text-xs uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300 mb-2">Linha por linha</h4>
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs">
                <thead className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="text-left py-2 px-1 font-semibold uppercase">Produto</th>
                    <th className="text-left py-2 px-1 font-semibold uppercase">Cliente</th>
                    <th className="text-right py-2 px-1 font-semibold uppercase">Câmeras</th>
                    <th className="text-right py-2 px-1 font-semibold uppercase">Atacado USD</th>
                    <th className="text-right py-2 px-1 font-semibold uppercase">Subtotal BRL</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lineItems.map(l => (
                    <tr key={l.id} className="border-b border-slate-100 dark:border-white/5">
                      <td className="py-2 px-1 font-mono text-[11px]">{l.productSlug}</td>
                      <td className="py-2 px-1">{l.clienteFinal?.tradeName ?? l.clienteFinal?.name ?? '—'}</td>
                      <td className="py-2 px-1 text-right">{l.cameraCount}</td>
                      <td className="py-2 px-1 text-right font-mono text-[11px]">${l.unitPriceUsd.toFixed(4)}</td>
                      <td className="py-2 px-1 text-right font-mono font-semibold">R$ {brl(l.subtotalBrl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {inv.receipts.length > 0 && (
              <>
                <h4 className="text-xs uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300 mb-2">Pagamentos confirmados</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="text-left py-2 px-1 font-semibold uppercase">Asaas Payment ID</th>
                        <th className="text-right py-2 px-1 font-semibold uppercase">Valor</th>
                        <th className="text-left py-2 px-1 font-semibold uppercase">Método</th>
                        <th className="text-left py-2 px-1 font-semibold uppercase">Pago em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.receipts.map(r => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-white/5">
                          <td className="py-2 px-1 font-mono text-[11px]">{r.asaasPaymentId}</td>
                          <td className="py-2 px-1 text-right font-mono font-semibold">R$ {brl(r.amountBrl)}</td>
                          <td className="py-2 px-1">{r.billingType}</td>
                          <td className="py-2 px-1 text-[11px]">{new Date(r.paidAt).toLocaleString('pt-BR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </GlassCard>
      </div>
    </div>
  )
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-lg p-2 border',
      highlight
        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30'
        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-white/10',
    )}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn('text-sm font-bold mt-0.5',
        highlight ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-white',
      )}>{value}</p>
    </div>
  )
}
