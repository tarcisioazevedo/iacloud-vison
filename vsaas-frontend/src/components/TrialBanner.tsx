/**
 * TrialBanner — Banner de status de trial pro integrador.
 *
 * Visibilidade:
 *   - isTrial=false → não renderiza (no-op)
 *   - isTrial=true + isActive=true → banner verde/amarelo/vermelho conforme dias
 *   - isTrial=true + isActive=false → banner crítico "expirado"
 *
 * Cores semafóricas:
 *   > 7 dias: cyan (informativo)
 *   3-7 dias: amber (atenção)
 *   1-3 dias: orange (urgente)
 *   ≤ 0 dias: rose (expirado)
 *
 * Mostra também limite de câmeras quando overlimit.
 */
import { Sparkles, AlertTriangle, Clock, MessageCircle } from 'lucide-react'
import { useMyTrialStatus } from '../api/client'
import { cn } from '../lib/utils'
import { BRAND } from '../lib/brand'

export function TrialBanner() {
  const { data: status } = useMyTrialStatus()
  if (!status?.isTrial) return null

  const days = status.daysRemaining
  const expired = !status.isActive || days <= 0
  const overlimit = status.camerasOverLimit

  // Cores
  const tone =
    expired ? 'rose' :
    days <= 1 ? 'orange' :
    days <= 3 ? 'amber' :
    days <= 7 ? 'amber' :
    'cyan'

  const ringClass = {
    rose: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400',
    orange: 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    cyan: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  }[tone]

  const Icon = expired ? AlertTriangle : days <= 3 ? Clock : Sparkles

  return (
    <div className={cn(
      'flex items-center justify-between gap-3 px-4 py-2 border-b text-xs',
      ringClass,
    )}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Icon className="w-4 h-4 shrink-0" />
        <span className="font-semibold">
          {expired
            ? 'Seu período trial expirou.'
            : days === 0
              ? 'Seu trial expira HOJE.'
              : `Trial ativo · ${days} dia${days === 1 ? '' : 's'} restante${days === 1 ? '' : 's'}`}
        </span>
        <span className="hidden md:inline opacity-75">
          · {status.camerasUsed}/{status.maxCameras} câmeras
          {overlimit && <span className="ml-1 font-bold">(LIMITE EXCEDIDO)</span>}
        </span>
      </div>
      <a
        href={`mailto:${BRAND.email.sales}?subject=Converter%20trial%20em%20plano%20pago`}
        className={cn(
          'inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition',
          expired || days <= 3
            ? 'bg-current text-white opacity-90 hover:opacity-100'
            : 'border border-current hover:bg-current hover:text-white',
        )}
      >
        <MessageCircle className="w-3 h-3" /> {expired ? 'Reativar' : 'Converter pra plano pago'}
      </a>
    </div>
  )
}
