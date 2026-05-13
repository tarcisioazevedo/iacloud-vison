/**
 * HealthActionRequired — card "Ações Necessárias" que aparece quando há
 * alertas ativos. Pode ser embebido em qualquer página.
 *
 * Comportamento:
 *   - 0 alertas ativos: nada renderizado (no-op)
 *   - 1+ alertas: card vermelho/amarelo com lista compacta + ack inline
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronRight, Check, RefreshCw } from 'lucide-react'
import { GlassCard } from './cards/GlassCard'
import { cn } from '../lib/utils'
import { api, useMyHealthAlerts, type HealthAlert } from '../api/client'

interface Props {
  /** Override pra usar lista de alertas externa (ex: AdminHealthAlertsPage) */
  alerts?: HealthAlert[]
  /** Mostrar título "Ações Necessárias" (default true) */
  showTitle?: boolean
  /** Limite de items exibidos (default 5) */
  limit?: number
}

export function HealthActionRequired({ alerts: externalAlerts, showTitle = true, limit = 5 }: Props) {
  const { data, mutate } = useMyHealthAlerts()
  const alerts = externalAlerts ?? data?.alerts ?? []
  const [acking, setAcking] = useState<string | null>(null)

  if (alerts.length === 0) return null

  const visible = alerts.slice(0, limit)
  const hasCritical = alerts.some(a => a.level === 'critical')
  const more = alerts.length - visible.length

  async function ack(id: string) {
    setAcking(id)
    try { await api.post(`/me/integrador/health-alerts/${id}/ack`); mutate() }
    catch (e: any) { alert(e?.response?.data?.error ?? e.message) }
    finally { setAcking(null) }
  }

  return (
    <GlassCard className={cn(
      'p-4 border-l-4',
      hasCritical
        ? 'border-l-rose-500 bg-rose-500/5'
        : 'border-l-amber-500 bg-amber-500/5',
    )}>
      {showTitle && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className={cn('w-4 h-4', hasCritical ? 'text-rose-500' : 'text-amber-500')} />
            <h3 className={cn('text-sm font-bold', hasCritical ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400')}>
              {alerts.length} cliente{alerts.length === 1 ? '' : 's'} precisa{alerts.length === 1 ? '' : 'm'} de atenção
            </h3>
          </div>
          <Link to="/health-scores" className="text-[10px] text-slate-500 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-0.5">
            Ver todos <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      )}

      <div className="space-y-2">
        {visible.map(a => (
          <div key={a.id} className="flex items-start justify-between gap-2 p-2 rounded border border-slate-200 dark:border-white/10 bg-white/50 dark:bg-space-900/40">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase',
                  a.level === 'critical'
                    ? 'bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                    : 'bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30',
                )}>
                  {a.level === 'critical' ? 'Crítico' : 'Atenção'}
                </span>
                <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{a.score}/100</span>
                <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {a.clienteFinal?.name ?? a.clienteFinalId}
                </span>
              </div>
              {a.suggestion && (
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug pl-1">{a.suggestion}</p>
              )}
            </div>
            <button
              onClick={() => ack(a.id)}
              disabled={acking === a.id}
              title="Marcar como visto"
              className="shrink-0 p-1.5 rounded border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 disabled:opacity-50"
            >
              {acking === a.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            </button>
          </div>
        ))}
      </div>

      {more > 0 && (
        <Link to="/health-scores" className="block mt-2 text-[10px] text-slate-500 hover:text-slate-900 dark:hover:text-white text-center">
          + {more} alertas adicionais
        </Link>
      )}
    </GlassCard>
  )
}
