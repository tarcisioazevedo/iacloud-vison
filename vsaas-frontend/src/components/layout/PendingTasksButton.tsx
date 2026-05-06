/**
 * PendingTasksButton — ícone de pendências comerciais/aprovações no TopBar.
 *
 * Apenas SUPER_ADMIN/ADMIN_GLOBAL. Combina:
 *   - leads novos (status NEW) → /admin/leads
 *   - approval requests pendentes → /approvals (redireciona para /admin/leads)
 *
 * Click padrão abre /admin/leads (página principal do funil comercial).
 * Para outras personas o componente retorna null.
 */
import { useNavigate } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { usePendingTasksCount } from '../../api/client'
import { cn } from '../../lib/utils'

export function PendingTasksButton() {
  const navigate = useNavigate()
  const { leads, approvals, total, enabled } = usePendingTasksCount()

  if (!enabled) return null

  const tooltip = total === 0
    ? 'Sem pendências comerciais'
    : `${leads} lead${leads !== 1 ? 's' : ''} novo${leads !== 1 ? 's' : ''} · ${approvals} aprovaç${approvals !== 1 ? 'ões' : 'ão'} pendente${approvals !== 1 ? 's' : ''}`

  return (
    <button
      onClick={() => navigate('/admin/leads')}
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'relative p-2 rounded-xl border transition-colors',
        total > 0
          ? 'bg-violet-500/10 border-violet-500/30 text-violet-600 dark:text-violet-300 hover:bg-violet-500/20'
          : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 dark:bg-white/5 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/10',
      )}
    >
      <Inbox className="w-3.5 h-3.5" />
      {total > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-violet-500 text-[9px] text-white font-bold flex items-center justify-center">
          {total > 99 ? '99+' : total}
        </span>
      )}
    </button>
  )
}
