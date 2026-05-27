/**
 * RecordingRetentionCard — UI organizada para os 4 níveis de retenção.
 *
 * Base (sem motion/event)         → recordRetainDays           (default 7d)
 * Com motion detectado            → recordDetectionRetainDays  (default 14d)
 * Com evento da IA (detection)    → recordAlertRetainDays      (default 30d)
 * Com alerta crítico (severity=ALERT) → recordCriticalRetainDays (default 90d)
 *
 * Plano comercial (RetentionPlan) atua como PISO da base — câmera nunca
 * retém menos do que o plano. Mostra badge inline indicando qual valor está
 * sendo sobrescrito.
 */
import { Database, Activity, Eye, Siren, Info } from 'lucide-react'

interface Props {
  base:        number
  motion:      number
  event:       number
  critical:    number
  onChange: (field: 'base' | 'motion' | 'event' | 'critical', v: number) => void
  /** Plano comercial em vigor — usado pra renderizar "piso" no nível Base. */
  plan?: { name: string; retainDays: number } | null
  disabled?: boolean
}

interface TierMeta {
  field:       'base' | 'motion' | 'event' | 'critical'
  label:       string
  description: string
  icon:        typeof Database
  color:       string
}

const TIERS: TierMeta[] = [
  {
    field: 'base',
    label: 'Trecho normal',
    description: 'Cena rotineira, sem movimento ou objeto identificado',
    icon:  Database,
    color: 'slate',
  },
  {
    field: 'motion',
    label: 'Com movimento na cena',
    description: 'Algo se moveu, mas a IA não classificou o que era',
    icon:  Activity,
    color: 'amber',
  },
  {
    field: 'event',
    label: 'Com objeto identificado',
    description: 'A IA reconheceu pessoa, carro, animal ou outro objeto relevante',
    icon:  Eye,
    color: 'orange',
  },
  {
    field: 'critical',
    label: 'Com alerta de segurança',
    description: 'Evento marcado como crítico pelo operador ou pela regra de alerta',
    icon:  Siren,
    color: 'rose',
  },
]

const COLOR_CLASSES: Record<string, { bg: string; text: string }> = {
  slate:  { bg: 'bg-slate-400/20',  text: 'text-slate-600 dark:text-slate-300' },
  amber:  { bg: 'bg-amber-500/20',  text: 'text-amber-700 dark:text-amber-300' },
  orange: { bg: 'bg-orange-500/20', text: 'text-orange-700 dark:text-orange-300' },
  rose:   { bg: 'bg-rose-500/20',   text: 'text-rose-700 dark:text-rose-300' },
}

export function RecordingRetentionCard(p: Props) {
  const values: Record<'base' | 'motion' | 'event' | 'critical', number> = {
    base: p.base, motion: p.motion, event: p.event, critical: p.critical,
  }
  const planFloors = p.plan && p.plan.retainDays > 0

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
        Retenção de Gravações
      </h3>

      {p.plan && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-[11px]">
          <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-blue-700 dark:text-blue-300">
              Plano comercial: {p.plan.name}
            </span>
            <span className="text-slate-600 dark:text-slate-400 ml-1">
              · piso de {p.plan.retainDays}d na base (campos abaixo só somam acima disso)
            </span>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {TIERS.map(t => {
          const c = COLOR_CLASSES[t.color]
          const Icon = t.icon
          const effective = t.field === 'base' && planFloors
            ? Math.max(values.base, p.plan!.retainDays)
            : values[t.field]
          const overridden = t.field === 'base' && planFloors && p.plan!.retainDays > values.base
          return (
            <div key={t.field} className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 dark:border-white/10">
              <div className={`p-2 rounded-lg shrink-0 ${c.bg} ${c.text}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {t.label}
                  </span>
                  {overridden && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-700 dark:text-blue-300 uppercase">
                      Plano dita
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.description}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={values[t.field]}
                  disabled={p.disabled}
                  onChange={e => p.onChange(t.field, Math.max(1, parseInt(e.target.value || '0', 10)))}
                  className="w-16 px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white text-right disabled:opacity-50"
                />
                <span className="text-[10px] text-slate-500 w-8">
                  {overridden ? <span className="line-through opacity-50">d</span> : 'dias'}
                </span>
                {overridden && (
                  <span className="text-[10px] font-mono font-bold text-blue-600 dark:text-blue-400 ml-1">
                    → {effective}d
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-slate-500 italic">
        Sempre vale a regra mais longa. Se um mesmo trecho teve movimento e alerta,
        ele é guardado pelo prazo do alerta (mais longo). O plano comercial garante
        o prazo mínimo do trecho normal.
      </p>
    </div>
  )
}
