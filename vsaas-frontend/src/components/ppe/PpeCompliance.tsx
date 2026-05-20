import { motion } from 'framer-motion'
import { ShieldCheck, ShieldAlert, HardHat } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { usePpeCompliance } from '../../api/client'
import { cn } from '../../lib/utils'

function ComplianceRow({ cameraId, compliant: _compliant, violations, compliancePct, index }: any) {
  const isOk = compliancePct >= 90

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08 }}
      className="flex items-center gap-3 py-2.5 border-b last:border-0 border-slate-100 dark:border-white/5"
    >
      <div className={cn(
        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
        isOk
          ? 'bg-emerald-100 dark:bg-emerald-500/10'
          : 'bg-rose-100 dark:bg-rose-500/10',
      )}>
        {isOk
          ? <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          : <ShieldAlert className="w-4 h-4 text-rose-700 dark:text-rose-400" />
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium truncate text-slate-700 dark:text-slate-300">
            Cam {cameraId.slice(-6)}
          </p>
          <span className={cn(
            'text-xs font-bold',
            compliancePct >= 90 ? 'text-emerald-700 dark:text-emerald-400' :
            compliancePct >= 70 ? 'text-amber-700 dark:text-amber-400' :
                                  'text-rose-700 dark:text-rose-400',
          )}>
            {compliancePct}%
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden bg-slate-200 dark:bg-white/5">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${compliancePct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: index * 0.08 + 0.2 }}
            className={cn(
              'h-full rounded-full',
              compliancePct >= 90 ? 'bg-emerald-500' :
              compliancePct >= 70 ? 'bg-amber-500' : 'bg-rose-500',
            )}
          />
        </div>
      </div>

      {violations > 0 && (
        <div className="text-right shrink-0">
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">{violations}</p>
          <p className="text-[9px] text-slate-500 dark:text-slate-600">violações</p>
        </div>
      )}
    </motion.div>
  )
}

export function PpeCompliance({ delay = 0 }: { delay?: number }) {
  const { data, isLoading } = usePpeCompliance()
  const rows = data?.data ?? []

  const overallPct = rows.length
    ? Math.round(rows.reduce((s: number, r: any) => s + r.compliancePct, 0) / rows.length)
    : 100

  const violations = rows.reduce((s: number, r: any) => s + r.violations, 0)

  return (
    <GlassCard delay={delay} className="p-5" glow={violations > 0 ? 'rose' : 'emerald'}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
            <HardHat className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            Auditoria EPI
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Últimas 24h</p>
        </div>
        <div className="text-right">
          <p className={cn(
            'text-2xl font-bold',
            overallPct >= 90 ? 'text-emerald-700 dark:text-emerald-400' :
            overallPct >= 70 ? 'text-amber-700 dark:text-amber-400' :
                               'text-rose-700 dark:text-rose-400',
          )}>
            {overallPct}%
          </p>
          <p className="text-[10px] text-slate-500 dark:text-slate-600">compliance</p>
        </div>
      </div>

      {violations > 0 && (
        <div className={cn(
          'mb-3 flex items-center gap-2 rounded-xl px-3 py-2 border',
          'bg-rose-100 border-rose-200',
          'dark:bg-rose-500/10 dark:border-rose-500/20',
        )}>
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-700 dark:text-rose-400" />
          <p className="text-xs text-rose-700 dark:text-rose-300">
            <span className="font-bold">{violations}</span> violações detectadas — verificar imediatamente
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <ShieldCheck className="w-8 h-8 mb-2 text-emerald-600/50 dark:text-emerald-500/50" />
          <p className="text-xs text-slate-500 dark:text-slate-600">Sem câmeras PPE configuradas</p>
        </div>
      ) : (
        <div>
          {rows.map((r: any, i: number) => (
            <ComplianceRow key={r.cameraId} {...r} index={i} />
          ))}
        </div>
      )}
    </GlassCard>
  )
}
