/**
 * BillingOverdueBanner — banner sticky no topo se INTEGRADOR_ADMIN tem fatura
 * OVERDUE ou DUE_SOON. Mostra valor + link "Pagar agora".
 *
 * Aparece em QUALQUER página do app (montado no Layout). Sumir só quando
 * status volta a 'none'. SWR 60s.
 */
import useSWR from 'swr'
import { AlertTriangle, Clock, X, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '../../api/client'

interface Overview {
  current: null | {
    id: string
    totalAmountBrl: number
    asaasPaymentUrl: string | null
    dueDate: string | null
  }
  alert: { kind: 'overdue' | 'due_soon' | 'paid' | 'none'; daysUntilDue?: number; daysOverdue?: number }
}

const fetcher = (url: string) => api.get(url).then(r => r.data)

export function BillingOverdueBanner() {
  const role = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
  const isIntegradorAdmin = role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO'

  const { data } = useSWR<Overview>(
    isIntegradorAdmin ? '/me/integrador/billing/overview' : null,
    fetcher,
    { refreshInterval: 60_000 },
  )
  const [dismissed, setDismissed] = useState(false)

  if (!isIntegradorAdmin || !data || dismissed) return null
  const { alert, current } = data
  if (alert.kind !== 'overdue' && alert.kind !== 'due_soon') return null
  if (!current) return null

  const valor = current.totalAmountBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

  if (alert.kind === 'overdue') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 dark:bg-rose-900/20 border-b border-rose-200 dark:border-rose-700/30 text-xs text-rose-700 dark:text-rose-300">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="flex-1">
          <strong>Fatura em atraso</strong>
          {alert.daysOverdue != null && ` há ${alert.daysOverdue} dia${alert.daysOverdue !== 1 ? 's' : ''}`}
          {' '}— R$ {valor}. <strong>Suas câmeras podem ser suspensas a qualquer momento.</strong>
        </span>
        {current.asaasPaymentUrl && (
          <a href={current.asaasPaymentUrl} target="_blank" rel="noopener"
            className="px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700 inline-flex items-center gap-1 text-[11px] font-medium">
            <ExternalLink className="w-3 h-3" /> Pagar agora
          </a>
        )}
        <Link to="/me/integrador/minhas-assinaturas?tab=faturas" className="text-[11px] underline hover:no-underline">
          Detalhes
        </Link>
        <button onClick={() => setDismissed(true)} className="ml-1 opacity-60 hover:opacity-100" aria-label="Fechar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  // due_soon
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/30 text-xs text-amber-700 dark:text-amber-300">
      <Clock className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        Fatura vence em <strong>{alert.daysUntilDue} dia{alert.daysUntilDue !== 1 ? 's' : ''}</strong> — R$ {valor}.
      </span>
      {current.asaasPaymentUrl && (
        <a href={current.asaasPaymentUrl} target="_blank" rel="noopener"
          className="px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 inline-flex items-center gap-1 text-[11px] font-medium">
          <ExternalLink className="w-3 h-3" /> Pagar
        </a>
      )}
      <Link to="/me/integrador/minhas-assinaturas?tab=faturas" className="text-[11px] underline hover:no-underline">
        Ver fatura
      </Link>
      <button onClick={() => setDismissed(true)} className="ml-1 opacity-60 hover:opacity-100" aria-label="Fechar">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
