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
import { Database, Activity, Eye, Siren, Info, Sparkles } from 'lucide-react'

interface Props {
  base:        number
  motion:      number
  event:       number
  critical:    number
  onChange: (field: 'base' | 'motion' | 'event' | 'critical', v: number) => void
  /** Aplica os 4 tiers de uma vez (atalho de preset). */
  onApplyPreset?: (preset: { base: number; motion: number; event: number; critical: number }) => void
  /** Plano comercial em vigor — usado pra renderizar "piso" no nível Base. */
  plan?: { name: string; retainDays: number } | null
  disabled?: boolean
}

/**
 * Presets pensados para os 3 perfis típicos de câmera em VMS:
 *
 * - ECONÔMICA: corredor secundário, estoque, área externa de baixa criticidade.
 *   Objetivo: minimizar consumo R2. Aceita perder cena rotineira rápido.
 * - MONITORAMENTO: câmera padrão de operação (default da maioria das instalações).
 *   Equilibra custo e cobertura — mesmos defaults do schema.
 * - EVIDÊNCIA: câmera crítica (caixa, cofre, ponto sensível). Tudo retém muito,
 *   alerta crítico fica 1 ano. Para cumprimento legal / auditoria.
 */
export const RETENTION_PRESETS = {
  ECONOMICA: {
    label: 'Econômica',
    description: 'Mínimo custo · corredores secundários, áreas de baixa criticidade',
    base: 3, motion: 7, event: 15, critical: 90,
  },
  MONITORAMENTO: {
    label: 'Monitoramento',
    description: 'Equilíbrio padrão · operação típica do dia a dia',
    base: 7, motion: 14, event: 30, critical: 90,
  },
  EVIDENCIA: {
    label: 'Evidência',
    description: 'Alta retenção · caixa, cofre, ponto sensível, cumprimento legal',
    base: 30, motion: 60, event: 90, critical: 365,
  },
} as const
export type RetentionPresetKey = keyof typeof RETENTION_PRESETS

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

  // Detecta se valores atuais coincidem com algum preset → marca como ativo.
  const activePreset = (Object.entries(RETENTION_PRESETS) as [RetentionPresetKey, typeof RETENTION_PRESETS[RetentionPresetKey]][])
    .find(([, ps]) =>
      ps.base === values.base &&
      ps.motion === values.motion &&
      ps.event === values.event &&
      ps.critical === values.critical,
    )?.[0]

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
        Retenção de Gravações
      </h3>

      {/* Presets — 3 cards rápidos para definir os 4 tiers de uma vez */}
      {p.onApplyPreset && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
            <Sparkles className="w-3 h-3" />
            Atalhos rápidos
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {(Object.entries(RETENTION_PRESETS) as [RetentionPresetKey, typeof RETENTION_PRESETS[RetentionPresetKey]][]).map(([key, ps]) => {
              const isActive = activePreset === key
              return (
                <button
                  key={key}
                  type="button"
                  disabled={p.disabled}
                  onClick={() => p.onApplyPreset!({ base: ps.base, motion: ps.motion, event: ps.event, critical: ps.critical })}
                  className={
                    'text-left p-2 rounded-lg border transition ' +
                    (isActive
                      ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10'
                      : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                    ) + (p.disabled ? ' opacity-50 cursor-not-allowed' : '')
                  }
                  title={ps.description}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={'text-xs font-bold ' + (isActive ? 'text-cyan-700 dark:text-cyan-300' : 'text-slate-800 dark:text-slate-200')}>
                      {ps.label}
                    </span>
                    {isActive && <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 uppercase">Ativo</span>}
                  </div>
                  <p className="text-[9px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    {ps.base}/{ps.motion}/{ps.event}/{ps.critical}d
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )}

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
