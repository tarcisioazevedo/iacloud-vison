import { useState } from 'react'
import { motion } from 'framer-motion'
import { Camera, Clock, ShieldAlert, Smile } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { GlassCard } from '../cards/GlassCard'
import { DetectionModal, type DetectionEvent } from './DetectionModal'
import { useEvidence } from '../../api/client'
import { EMOTION_CONFIG, cn } from '../../lib/utils'

function EvidenceThumb({ event, index, onClick }: { event: DetectionEvent; index: number; onClick: () => void }) {
  const emotCfg = EMOTION_CONFIG[event.dominantEmotion ?? 'neutral'] ?? EMOTION_CONFIG.neutral

  const expiresIn = event.evidenceExpiry
    ? Math.max(0, Math.round((new Date(event.evidenceExpiry).getTime() - Date.now()) / 3600_000))
    : null

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06 }}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all',
        'border-slate-200 bg-slate-50 hover:border-cyan-300 hover:bg-slate-100',
        'dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-cyan-500/30 dark:hover:bg-white/[0.05]',
      )}
    >
      {/* Thumbnail — sempre escuro (frame de câmera) em ambos os temas */}
      <div className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-space-800">
        {event.thumbnailUrl ? (
          <img src={event.thumbnailUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="w-5 h-5 text-slate-700" />
          </div>
        )}
        {/* Event type badge */}
        <div className={cn(
          'absolute bottom-0.5 left-0.5 text-[8px] font-bold px-1 rounded',
          event.ppeCompliant === false ? 'bg-rose-500/90 text-white' : 'bg-cyan-500/80 text-black',
        )}>
          {event.ppeCompliant === false ? 'EPI' : event.eventType.replace('LINE_CROSS_', '')}
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium truncate text-slate-900 dark:text-white">
            {event.cameraName ?? `Câmera ${event.cameraId.slice(-4)}`}
          </p>
          {event.dominantEmotion && (
            <span className="text-sm ml-1">{emotCfg.emoji}</span>
          )}
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {format(new Date(event.capturedAt), "HH:mm:ss · dd/MM", { locale: ptBR })}
        </p>
        <div className="flex items-center gap-1.5 mt-1.5">
          {event.dominantEmotion && (
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{
              background: `${emotCfg.color}22`,
              color: emotCfg.color,
              border: `1px solid ${emotCfg.color}44`,
            }}>
              {emotCfg.label}
            </span>
          )}
          {event.ppeCompliant !== null && (
            <span className={cn(
              'text-[9px] px-1.5 py-0.5 rounded border flex items-center gap-0.5',
              event.ppeCompliant
                ? 'text-emerald-700 bg-emerald-100 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20'
                : 'text-rose-700 bg-rose-100 border-rose-200 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/20',
            )}>
              <ShieldAlert className="w-2 h-2" />
              {event.ppeCompliant ? 'OK' : 'Violação'}
            </span>
          )}
          {expiresIn !== null && expiresIn < 24 && (
            <span className="text-[9px] text-amber-700 dark:text-amber-400/70">⏱ {expiresIn}h</span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

interface EvidenceGalleryProps {
  delay?: number
}

export function EvidenceGallery({ delay = 0 }: EvidenceGalleryProps) {
  const { data, isLoading } = useEvidence(12)
  const [selected, setSelected] = useState<DetectionEvent | null>(null)

  const events: DetectionEvent[] = data?.data ?? []

  return (
    <>
      <GlassCard delay={delay} className="p-5 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
              <Smile className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              Provas Visuais Recentes
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">TTL 72h • LGPD compliant</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
            <span className="text-xs text-slate-500">{events.length} evidências</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
            <Camera className="w-8 h-8 mb-2 text-slate-400 dark:text-slate-700" />
            <p className="text-xs text-slate-500 dark:text-slate-600">Nenhuma evidência ativa</p>
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto max-h-80 pr-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
            {events.map((ev, i) => (
              <EvidenceThumb key={ev.id} event={ev} index={i} onClick={() => setSelected(ev)} />
            ))}
          </div>
        )}

        {events.length > 0 && (
          <button className={cn(
            'mt-3 w-full text-xs py-2 border rounded-lg transition-colors',
            'text-slate-600 hover:text-cyan-700 border-slate-200 hover:border-cyan-300',
            'dark:text-slate-500 dark:hover:text-cyan-400 dark:border-white/5 dark:hover:border-cyan-500/20',
          )}>
            Ver todas as evidências →
          </button>
        )}
      </GlassCard>

      <DetectionModal event={selected} onClose={() => setSelected(null)} />
    </>
  )
}
