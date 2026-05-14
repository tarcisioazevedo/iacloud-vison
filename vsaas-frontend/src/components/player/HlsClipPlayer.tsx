/**
 * HlsClipPlayer — player HLS para clipes curtos (event/bookmark).
 *
 * Por que existe: `<video src=".m3u8">` direto NÃO funciona em Chrome/Edge/
 * Firefox (só Safari tem HLS nativo). E mesmo no Safari não funcionaria
 * aqui, porque o endpoint exige `Authorization: Bearer` (carregado via
 * localStorage), header que o `<video>` nativo não permite injetar.
 *
 * RecordingPlayer já tinha a lógica, mas vem com timeline/scrub/UI pesada
 * que não cabe num clipe inline de 5–30s. Este componente é o subset mínimo.
 */
import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

interface Props {
  src:        string
  className?: string
  autoPlay?:  boolean
  controls?:  boolean
  muted?:     boolean
}

export function HlsClipPlayer({ src, className, autoPlay = true, controls = true, muted = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef   = useRef<Hls | null>(null)
  const [empty, setEmpty]   = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v || !src) return

    setEmpty(false)
    setError(null)

    if (hlsRef.current) {
      try { hlsRef.current.destroy() } catch { /* noop */ }
      hlsRef.current = null
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('icv_token') : null

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        xhrSetup: token
          ? (xhr) => xhr.setRequestHeader('Authorization', `Bearer ${token}`)
          : undefined,
      })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(v)
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        // Playlist sem segmentos (gap no recording — RTMP push da câmera caiu
        // durante a janela do evento). Mostra mensagem em vez de player vazio.
        if (!data?.levels?.[0]?.details || data.levels[0].details.fragments.length === 0) {
          setEmpty(true)
          return
        }
        if (autoPlay) v.play().catch(() => { /* user gesture required */ })
      })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError(data.details ?? 'Falha no clip')
      })
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src
      if (autoPlay) v.play().catch(() => { /* user gesture required */ })
    }

    return () => {
      if (hlsRef.current) {
        try { hlsRef.current.destroy() } catch { /* noop */ }
        hlsRef.current = null
      }
    }
  }, [src, autoPlay])

  if (empty || error) {
    return (
      <div className={`flex items-center justify-center ${className ?? ''}`}>
        <div className="text-center px-4">
          <p className="text-amber-400 text-sm font-semibold">
            {empty ? 'Sem gravação para este momento' : 'Falha ao carregar clip'}
          </p>
          <p className="text-slate-400 text-xs mt-1">
            {empty
              ? 'A câmera não estava enviando vídeo (RTMP push interrompido) quando este evento ocorreu.'
              : error}
          </p>
        </div>
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      className={className}
      controls={controls}
      muted={muted}
      playsInline
    />
  )
}
