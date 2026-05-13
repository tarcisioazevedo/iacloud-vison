/**
 * QuickAlertsButton — ícone de alertas críticos no TopBar (RBAC server-side).
 *
 * Apenas SUPER_ADMIN/ADMIN_GLOBAL — usa /admin/alerts/active (que combina quota
 * crítica, boxes offline >24h, etc). Para outras personas o componente retorna
 * null silenciosamente (sino + histórico local cobre).
 *
 * Badge:
 *   - rose pulsante quando há ≥1 critical
 *   - amber estático quando há só warnings
 *   - hidden quando zerado
 *
 * Click: navega para /admin/alerts (página completa).
 * Hover/long-press: tooltip com contagem por severidade.
 */
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useAdminAlertsActive } from '../../api/client'
import { cn } from '../../lib/utils'

export function QuickAlertsButton() {
  const navigate = useNavigate()
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const enabled = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'

  const { data } = useAdminAlertsActive()
  if (!enabled) return null

  const alerts = data?.alerts ?? []
  const critical = alerts.filter(a => a.severity === 'critical').length
  const warning  = alerts.filter(a => a.severity === 'warning').length
  const total = alerts.length

  const tone: 'critical' | 'warning' | 'idle' = critical > 0 ? 'critical' : warning > 0 ? 'warning' : 'idle'
  const tooltip = total === 0
    ? 'Sem alertas ativos'
    : `${critical} crítico${critical !== 1 ? 's' : ''} · ${warning} atenção · clique para ver`

  return (
    <button
      onClick={() => navigate('/admin/alerts')}
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'relative p-2 rounded-xl border transition-colors',
        tone === 'critical'
          ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300 hover:bg-rose-500/20'
          : tone === 'warning'
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-300 hover:bg-amber-500/20'
            : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 dark:bg-white/5 dark:border-white/10 dark:text-slate-400 dark:hover:bg-slate-100 dark:bg-white/10',
      )}
    >
      <AlertTriangle className="w-3.5 h-3.5" />
      {total > 0 && (
        <span className={cn(
          'absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] text-white font-bold flex items-center justify-center',
          tone === 'critical' ? 'bg-rose-500 animate-pulse' : 'bg-amber-500',
        )}>
          {total > 99 ? '99+' : total}
        </span>
      )}
    </button>
  )
}
