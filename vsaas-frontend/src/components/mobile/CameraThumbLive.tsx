/**
 * CameraThumbLive — miniatura com vídeo ao vivo para mosaico mobile.
 *
 * Características:
 *   - Usa LivePlayer (WebRTC WHEP + fallback snapshot-poll automático)
 *   - Lazy-activate: só inicia a conexão quando o tile entra no viewport
 *     (IntersectionObserver) → evita 9 conexões simultâneas no 3×3
 *   - Quando sai do viewport, pausa o vídeo (não fecha conexão — reconectar
 *     é caro). Volta a reproduzir quando volta ao viewport.
 *   - Para câmeras offline: mostra placeholder estático (sem tentar conectar)
 *
 * Uso drop-in de CameraThumb: mesmas props (cameraId, isOnline, className)
 */
import { useEffect, useRef, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { LivePlayer } from '../player/LivePlayer'

interface Props {
  cameraId:  string
  isOnline:  boolean
  className?: string
}

export function CameraThumbLive({ cameraId, isOnline, className = '' }: Props) {
  const wrapRef   = useRef<HTMLDivElement>(null)
  const [active,  setActive]  = useState(false)  // entrou no viewport ao menos 1x
  const [paused,  setPaused]  = useState(false)  // sai do viewport → pausa

  // IntersectionObserver: activa na primeira entrada; pausa/resume nas seguintes
  useEffect(() => {
    if (!isOnline) return
    const el = wrapRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true)   // ativa (idempotente após 1ª vez)
          setPaused(false)  // resume
        } else {
          if (active) setPaused(true)  // pausa só após ativar
        }
      },
      { threshold: 0.1 },  // 10% visível já activa
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isOnline, active])

  return (
    <div ref={wrapRef} className={`relative overflow-hidden bg-slate-900 ${className}`}>
      {/* Câmera offline */}
      {!isOnline && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
          <WifiOff className="w-5 h-5 text-slate-600" />
        </div>
      )}

      {/* Live video — só monta quando entrou no viewport ao menos 1x */}
      {isOnline && active && (
        <LivePlayer
          cameraId={cameraId}
          muted={true}
          showOverlay={false}
          fit="cover"
          paused={paused}
          className="absolute inset-0 w-full h-full"
        />
      )}

      {/* Placeholder enquanto não ativou ainda */}
      {isOnline && !active && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
          <span className="w-4 h-4 border-2 border-cyan-500/50 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
