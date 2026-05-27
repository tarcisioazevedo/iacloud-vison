/**
 * RecordingModeCards — seleção visual dos 4 modos de gravação por câmera.
 *
 * Substitui o dropdown bruto (ALL/MOTION/ACTIVE_OBJECTS/DISABLED) por cards
 * com ícone, label humana, descrição e estimativa de GB/dia calculada a partir
 * de resolution + fps + recordMode. Plano comercial atribuído entra como badge
 * informativo no topo (não bloqueia mudança de modo).
 *
 * Nomenclatura nova (2026-05-27): CONTINUOUS, MOTION, EVENT, DISABLED.
 * Backend aceita aliases ALL/ACTIVE_OBJECTS por compat — não usar aqui.
 */
import { Video, Activity, AlertTriangle, PowerOff, Info } from 'lucide-react'
import { cn } from '../../lib/utils'
import { confirm } from '../ConfirmDialog'

export type RecordingMode = 'CONTINUOUS' | 'MOTION' | 'EVENT' | 'DISABLED'

interface CameraLite {
  resolution: string | null
  fps: number | null
  retentionPlanId: string | null
}

interface PlanInfo {
  name: string
  retainDays: number
  source: 'CAMERA' | 'CLIENTE_FINAL' | 'INTEGRADOR' | null
}

interface Props {
  value: RecordingMode
  onChange: (m: RecordingMode) => void
  camera: CameraLite
  /** Plano atribuído (cascata Camera → Cliente → Integrador). null = sem plano. */
  plan?: PlanInfo | null
  disabled?: boolean
}

/**
 * Bitrate médio em Mbps por resolução. Valores típicos H.264 main profile, CBR.
 * Usado pra estimar GB/dia — números reais variam ±30% conforme cena/codec.
 */
const BITRATE_MBPS: Record<string, number> = {
  VGA:    1.0,
  HD:     2.5,
  '720P': 2.5,
  FHD:    4.5,
  '1080P': 4.5,
  UHD:    12.0,
  '4K':   12.0,
  UHD_4K: 12.0,
}

/** Resolve bitrate a partir de string resolution (suporta "1920x1080", "1080p", "FHD", etc). */
function bitrateMbpsFor(resolution: string | null): number {
  if (!resolution) return BITRATE_MBPS.HD
  const norm = resolution.toUpperCase().replace(/\s+/g, '')
  if (BITRATE_MBPS[norm]) return BITRATE_MBPS[norm]
  // Heurística por width/height: "1920x1080" → 2.0736MP → FHD
  const match = norm.match(/(\d+)X(\d+)/)
  if (match) {
    const pixels = parseInt(match[1]) * parseInt(match[2])
    if (pixels >= 7_000_000) return BITRATE_MBPS['4K']
    if (pixels >= 1_900_000) return BITRATE_MBPS.FHD
    if (pixels >= 800_000)   return BITRATE_MBPS.HD
    return BITRATE_MBPS.VGA
  }
  return BITRATE_MBPS.HD
}

/** GB/dia para CONTINUOUS. Mode reduz: MOTION ≈ 20%, EVENT ≈ 7%. */
function estimateGbPerDay(camera: CameraLite, mode: RecordingMode): number {
  if (mode === 'DISABLED') return 0
  const mbps = bitrateMbpsFor(camera.resolution)
  // Bitrate é independente de fps quando codec faz CBR/VBR controlado — fps
  // entra só como pequeno ajuste (≤5fps = -10%, ≥20fps = sem desconto).
  const fpsAdj = (camera.fps ?? 15) <= 5 ? 0.9 : 1.0
  const gbDayContinuous = (mbps * 1_000_000 * 86_400 * fpsAdj) / 8 / (1024 ** 3)
  const mult = mode === 'CONTINUOUS' ? 1.0 : mode === 'MOTION' ? 0.2 : 0.07
  return Math.max(0.1, gbDayContinuous * mult)
}

function formatGb(gb: number): string {
  if (gb < 1) return `${(gb * 1024).toFixed(0)} MB/dia`
  if (gb < 10) return `${gb.toFixed(1)} GB/dia`
  return `${gb.toFixed(0)} GB/dia`
}

interface ModeMeta {
  id: RecordingMode
  label: string
  description: string
  icon: typeof Video
  color: string
  warning?: string
}

const MODES: ModeMeta[] = [
  {
    id:    'CONTINUOUS',
    label: 'Contínuo',
    description: 'Grava 24 horas por dia. Indicado para áreas críticas e exigência legal.',
    icon:  Video,
    color: 'emerald',
  },
  {
    id:    'MOTION',
    label: 'Movimento',
    description: 'Só guarda os trechos com movimento na cena. Economiza armazenamento.',
    icon:  Activity,
    color: 'amber',
  },
  {
    id:    'EVENT',
    label: 'Eventos',
    description: 'Só guarda os trechos em que a IA identificou pessoa, carro ou objeto relevante.',
    icon:  AlertTriangle,
    color: 'orange',
  },
  {
    id:    'DISABLED',
    label: 'Sem gravação',
    description: 'A câmera continua online (live), mas nada é gravado.',
    icon:  PowerOff,
    color: 'slate',
    warning: 'O plano de armazenamento continua sendo cobrado mesmo sem gravar.',
  },
]

const COLOR_CLASSES: Record<string, { ring: string; bg: string; iconBg: string; text: string }> = {
  emerald: { ring: 'ring-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', iconBg: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300', text: 'text-emerald-700 dark:text-emerald-300' },
  amber:   { ring: 'ring-amber-500',   bg: 'bg-amber-50 dark:bg-amber-500/10',     iconBg: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',     text: 'text-amber-700 dark:text-amber-300' },
  orange:  { ring: 'ring-orange-500',  bg: 'bg-orange-50 dark:bg-orange-500/10',   iconBg: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',   text: 'text-orange-700 dark:text-orange-300' },
  slate:   { ring: 'ring-slate-400',   bg: 'bg-slate-50 dark:bg-slate-500/10',     iconBg: 'bg-slate-400/20 text-slate-600 dark:text-slate-300',      text: 'text-slate-600 dark:text-slate-300' },
}

export function RecordingModeCards({ value, onChange, camera, plan, disabled }: Props) {
  // Quando o operador escolhe DESLIGADO, confirma — câmera para de gravar mas
  // o plano continua sendo cobrado. Pegadinha clássica.
  async function handleSelect(m: RecordingMode) {
    if (m === value) return
    if (m === 'DISABLED') {
      const ok = await confirm({
        title:       'Desligar gravação desta câmera?',
        description:
          'A câmera continua online (live), mas nenhuma gravação será salva ' +
          'enquanto o modo "Sem gravação" estiver ativo.\n\n' +
          (plan
            ? `O plano comercial "${plan.name}" continua sendo cobrado ` +
              'normalmente, mesmo sem gravação.'
            : 'Não há plano comercial atribuído a esta câmera no momento.'),
        confirmLabel: 'Sim, desligar',
        cancelLabel:  'Cancelar',
        destructive:  true,
      })
      if (!ok) return
    }
    onChange(m)
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
        Modo de Gravação
      </h3>

      {plan && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-[11px]">
          <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-blue-700 dark:text-blue-300">
              Plano ativo: {plan.name}
            </span>
            <span className="text-slate-600 dark:text-slate-400 ml-1">
              · garante retenção mínima de {plan.retainDays}d
            </span>
            {plan.source && plan.source !== 'CAMERA' && (
              <span className="text-slate-500 ml-1">
                (herdado de {plan.source === 'CLIENTE_FINAL' ? 'cliente' : 'integrador'})
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {MODES.map(m => {
          const selected = value === m.id
          const c = COLOR_CLASSES[m.color]
          const Icon = m.icon
          const gb = estimateGbPerDay(camera, m.id)
          return (
            <button
              key={m.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelect(m.id)}
              className={cn(
                'group text-left p-3 rounded-xl border transition-all',
                'border-slate-200 dark:border-white/10',
                'hover:border-slate-300 dark:hover:border-white/20',
                selected && cn('ring-2', c.ring, c.bg, 'border-transparent'),
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <div className="flex items-start gap-2.5">
                <div className={cn('p-2 rounded-lg shrink-0', c.iconBg)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-bold', selected ? c.text : 'text-slate-800 dark:text-slate-200')}>
                      {m.label}
                    </span>
                    {selected && (
                      <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded uppercase', c.iconBg)}>
                        Ativo
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                    {m.description}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      {m.id === 'DISABLED' ? '0 GB/dia' : `~${formatGb(gb)}`}
                    </span>
                  </div>
                  {m.warning && (
                    <p className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      {m.warning}
                    </p>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
