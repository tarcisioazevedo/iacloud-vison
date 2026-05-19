import { motion, AnimatePresence } from 'framer-motion'
import { X, Share2, Download, Maximize2, ShieldAlert, Tag, Smile, User, Camera, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { EMOTION_CONFIG } from '../../lib/utils'
import { cn } from '../../lib/utils'

export interface DetectionEvent {
  id: string
  cameraId: string
  cameraName?: string
  eventType: string
  capturedAt: string
  thumbnailUrl: string | null
  dominantEmotion: string | null
  emotionJoy: number | null
  emotionSorrow: number | null
  emotionAnger: number | null
  emotionSurprise: number | null
  hasHat: boolean | null
  hasGlasses: boolean | null
  ppeCompliant: boolean | null
  labelsJson: string[] | null
  logosJson: Array<{ description: string; score: number }> | null
  occupancyCount: number | null
  evidenceExpiry: string | null
}

interface Props {
  event: DetectionEvent | null
  onClose: () => void
}

function ConfidenceArc({ value, color }: { value: number; color: string }) {
  const radius = 36
  const circ   = 2 * Math.PI * radius
  const dash   = (value / 100) * circ

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <motion.circle
          cx="48" cy="48" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - dash }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="text-center">
        <span className="text-2xl font-bold text-slate-900 dark:text-white">{value}<span className="text-sm">%</span></span>
        <p className="text-[9px] text-slate-500 mt-0.5">CONFIANÇA</p>
      </div>
    </div>
  )
}

function EmotionMeter({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-16 truncate text-slate-600 dark:text-slate-400">{label}</span>
      <div className="flex-1 h-1 rounded-full overflow-hidden bg-slate-200 dark:bg-white/5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
      <span className="text-xs w-8 text-right font-mono text-slate-500 dark:text-slate-500">{pct}%</span>
    </div>
  )
}

export function DetectionModal({ event, onClose }: Props) {
  if (!event) return null

  const emotCfg   = EMOTION_CONFIG[event.dominantEmotion ?? 'neutral'] ?? EMOTION_CONFIG.neutral
  const expiresIn = event.evidenceExpiry
    ? Math.max(0, Math.round((new Date(event.evidenceExpiry).getTime() - Date.now()) / 3600_000))
    : null

  const emotions: { label: string; value: number; color: string }[] = [
    { label: 'Alegria',   value: event.emotionJoy     ?? 0, color: '#fbbf24' },
    { label: 'Neutro',    value: 1 - Math.max(event.emotionJoy ?? 0, event.emotionSorrow ?? 0, event.emotionAnger ?? 0, event.emotionSurprise ?? 0), color: '#94a3b8' },
    { label: 'Surpresa',  value: event.emotionSurprise ?? 0, color: '#a78bfa' },
    { label: 'Tristeza',  value: event.emotionSorrow  ?? 0, color: '#60a5fa' },
    { label: 'Raiva',     value: event.emotionAnger   ?? 0, color: '#f87171' },
  ].filter(e => e.value > 0.02)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className={cn(
            'relative w-full max-w-3xl rounded-2xl border overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.25)]',
            'bg-white border-slate-200',
            'dark:bg-space-850 dark:border-white/10 dark:shadow-[0_24px_80px_rgba(0,0,0,0.6)]',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/8">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse-slow" />
              <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-900 dark:text-white">
                Detection Details — Event #{event.id.slice(-6).toUpperCase()}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors',
                'text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200',
                'dark:text-slate-400 dark:hover:text-white dark:bg-white/5 dark:hover:bg-slate-100 dark:bg-white/10',
              )}>
                <Share2 className="w-3 h-3" /> Compartilhar
              </button>
              <button className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors',
                'text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200',
                'dark:text-slate-400 dark:hover:text-white dark:bg-white/5 dark:hover:bg-slate-100 dark:bg-white/10',
              )}>
                <Download className="w-3 h-3" /> Exportar
              </button>
              <button
                onClick={onClose}
                className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  'text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200',
                  'dark:text-slate-500 dark:hover:text-white dark:bg-white/5 dark:hover:bg-slate-100 dark:bg-white/10',
                )}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-0">
            {/* Thumbnail — col 3 */}
            <div className="col-span-3 relative bg-black/40">
              {event.thumbnailUrl ? (
                <img
                  src={event.thumbnailUrl}
                  alt="detection"
                  className="w-full h-64 object-cover"
                />
              ) : (
                <div className="w-full h-64 flex items-center justify-center bg-space-900">
                  <Camera className="w-10 h-10 text-slate-700" />
                </div>
              )}

              {/* Bounding box overlay */}
              <div className="absolute inset-0 pointer-events-none">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="absolute border-2 border-cyan-400 rounded"
                  style={{ top: '20%', left: '35%', width: '28%', height: '62%',
                           boxShadow: '0 0 0 1px rgba(6,182,212,0.3), 0 0 20px rgba(6,182,212,0.2)' }}
                >
                  <div className="absolute -top-5 left-0 bg-cyan-500/90 text-black text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                    PERSON #{event.id.slice(-4).toUpperCase()} [98%]
                  </div>
                  {/* Corner accents */}
                  {['top-0 left-0 border-t-2 border-l-2',
                    'top-0 right-0 border-t-2 border-r-2',
                    'bottom-0 left-0 border-b-2 border-l-2',
                    'bottom-0 right-0 border-b-2 border-r-2'].map((cls, i) => (
                    <div key={i} className={`absolute w-3 h-3 border-cyan-300 ${cls}`} />
                  ))}
                </motion.div>
              </div>

              {/* Bottom meta bar */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <Camera className="w-3 h-3" />
                  {event.cameraName ?? event.cameraId.slice(-8)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">
                    {format(new Date(event.capturedAt), 'dd/MM/yyyy HH:mm:ss', { locale: ptBR })}
                  </span>
                  <span className="text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded">HD 1080p</span>
                </div>
              </div>
            </div>

            {/* AI Analysis Panel — col 2 */}
            <div className={cn(
              'col-span-2 border-l p-4 space-y-4 overflow-y-auto max-h-64',
              'bg-slate-50 border-slate-200',
              'dark:bg-space-900/60 dark:border-white/8',
            )}>

              {/* Confidence arc */}
              <div className="flex flex-col items-center pb-3 border-b border-slate-200 dark:border-white/8">
                <p className="text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1 text-slate-500 dark:text-slate-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> AI ANALYSIS
                </p>
                <ConfidenceArc value={98} color="#00C0D0" />
              </div>

              {/* Object type */}
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-slate-500" />
                <div>
                  <p className="text-[9px] uppercase text-slate-500 dark:text-slate-600">Tipo</p>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">Pessoa</p>
                </div>
              </div>

              {/* Sentiment */}
              {event.dominantEmotion && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Smile className="w-3.5 h-3.5 text-slate-500 dark:text-slate-500" />
                    <div>
                      <p className="text-[9px] uppercase text-slate-500 dark:text-slate-600">Sentimento</p>
                      <p className="text-xs font-semibold" style={{ color: emotCfg.color }}>
                        {emotCfg.emoji} {emotCfg.label.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {emotions.map(e => <EmotionMeter key={e.label} {...e} />)}
                  </div>
                </div>
              )}

              {/* Labels */}
              {event.labelsJson?.length ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Tag className="w-3.5 h-3.5 text-slate-500 dark:text-slate-500" />
                    <p className="text-[9px] uppercase text-slate-500 dark:text-slate-600">Labels IA</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {event.labelsJson.slice(0, 6).map(l => (
                      <span key={l} className={cn(
                        'text-[9px] px-1.5 py-0.5 rounded border',
                        'bg-violet-100 text-violet-700 border-violet-200',
                        'dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20',
                      )}>
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* PPE */}
              {event.ppeCompliant !== null && (
                <div className="flex items-center gap-2">
                  <ShieldAlert className={cn('w-3.5 h-3.5',
                    event.ppeCompliant
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400',
                  )} />
                  <div>
                    <p className="text-[9px] uppercase text-slate-500 dark:text-slate-600">EPI</p>
                    <p className={cn('text-xs font-semibold',
                      event.ppeCompliant
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400',
                    )}>
                      {event.ppeCompliant ? '✓ Em conformidade' : '✗ Violação EPI'}
                    </p>
                  </div>
                </div>
              )}

              {/* Evidence TTL */}
              {expiresIn !== null && (
                <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-white/8">
                  <Clock className="w-3 h-3 text-slate-500 dark:text-slate-600" />
                  <p className="text-[9px] text-slate-500 dark:text-slate-600">
                    Evidência expira em{' '}
                    <span className={cn('font-medium',
                      expiresIn < 12
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-slate-700 dark:text-slate-400',
                    )}>
                      {expiresIn}h
                    </span>
                    {' '}(LGPD)
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
