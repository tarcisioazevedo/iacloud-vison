/**
 * DiagnosticsCard — card permanente com diagnóstico em tempo real da câmera:
 *   - Status (STREAMING / OFFLINE / RECOVERING / NEVER_STREAMED)
 *   - Bytes/s (calculado entre 2 polls)
 *   - Último frame, último upload
 *   - Segmentos últimas 24h e gaps
 *
 * Onda 2 / P1 #6 + P1 #9 (badge bucket).
 *
 * Polling a cada 5s — endpoint /cameras/:id/diagnostics tem cache 1s.
 */
import { useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, Pause } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { getCameraDiagnostics, type CameraDiagnostics } from '../../api/client'
import { cn } from '../../lib/utils'

type Props = {
  cameraId: string
  className?: string
}

const POLL_MS = 5000

export function DiagnosticsCard({ cameraId, className }: Props) {
  const [diag, setDiag] = useState<CameraDiagnostics | null>(null)
  const prevRef = useRef<{ bytes: number; ts: number } | null>(null)
  const [mbps, setMbps] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const d = await getCameraDiagnostics(cameraId)
        if (cancelled) return
        setDiag(d)
        // Calcula bitrate como delta de bytes ÷ delta de tempo
        const now = Date.now()
        if (prevRef.current && d.push.bytesRecv != null && d.push.bytesRecv > prevRef.current.bytes) {
          const dB = d.push.bytesRecv - prevRef.current.bytes
          const dT = (now - prevRef.current.ts) / 1000
          if (dT > 0) setMbps((dB * 8) / dT / 1_000_000)
        } else if (!d.push.active) {
          setMbps(null)
        }
        if (d.push.bytesRecv != null) {
          prevRef.current = { bytes: d.push.bytesRecv, ts: now }
        }
      } catch { /* ignore */ }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [cameraId])

  if (!diag) return null

  const statusConfig = {
    STREAMING:      { icon: Activity,       color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Transmitindo' },
    RECOVERING:     { icon: Pause,          color: 'text-amber-500',   bg: 'bg-amber-500/10',   label: 'Reconectando' },
    OFFLINE:        { icon: AlertTriangle,  color: 'text-rose-500',    bg: 'bg-rose-500/10',    label: 'Offline' },
    NEVER_STREAMED: { icon: AlertTriangle,  color: 'text-slate-500',   bg: 'bg-slate-500/10',   label: 'Nunca conectou' },
  }[diag.status]
  const Icon = statusConfig.icon

  function fmtAgo(iso: string | null): string {
    if (!iso) return '—'
    const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
    if (sec < 60)    return `${sec}s atrás`
    if (sec < 3600)  return `${Math.round(sec / 60)}min atrás`
    if (sec < 86400) return `${Math.round(sec / 3600)}h atrás`
    return `${Math.round(sec / 86400)}d atrás`
  }

  return (
    <GlassCard className={cn('p-4 space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={cn('w-9 h-9 rounded-full flex items-center justify-center', statusConfig.bg)}>
            <Icon className={cn('w-4 h-4', statusConfig.color)} />
          </div>
          <div>
            <p className={cn('text-sm font-bold', statusConfig.color)}>{statusConfig.label}</p>
            <p className="text-[10px] text-slate-500">{diag.hint}</p>
          </div>
        </div>

        {/* Bitrate ao vivo */}
        {mbps !== null && (
          <div className="text-right">
            <p className="text-lg font-bold text-cyan-700 dark:text-cyan-400 font-mono">
              {mbps.toFixed(2)} <span className="text-xs">Mbps</span>
            </p>
            <p className="text-[10px] text-slate-500">tempo real</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <Metric label="Último frame"   value={fmtAgo(diag.push.lastFrameAt)} active={diag.push.active} />
        <Metric label="Último upload"  value={fmtAgo(diag.recording.lastUploadAt)} active={diag.recording.active} />
        <Metric label="Segments 24h"   value={String(diag.recording.segmentsLast24h)} />
        <Metric label="Gaps 24h"
                value={String(diag.recording.gapsLast24h)}
                badColor={diag.recording.gapsLast24h > 3} />
      </div>

      {diag.push.remoteAddr && (
        <p className="text-[10px] text-slate-500 font-mono">
          Push de <code className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800">{diag.push.remoteAddr}</code>
          {diag.push.formatName && <> · {diag.push.formatName.toUpperCase()}</>}
        </p>
      )}
    </GlassCard>
  )
}

function Metric({ label, value, active, badColor }: {
  label: string; value: string; active?: boolean; badColor?: boolean
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase text-slate-500 tracking-wider">{label}</span>
      <span className={cn(
        'font-mono font-semibold',
        badColor    ? 'text-rose-500' :
        active      ? 'text-emerald-500' :
                      'text-slate-700 dark:text-slate-300',
      )}>
        {value}
      </span>
    </div>
  )
}
