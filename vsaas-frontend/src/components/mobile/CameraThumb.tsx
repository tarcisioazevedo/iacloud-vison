/**
 * CameraThumb — miniatura de câmera com snapshot atualizado a cada 30s.
 *
 * Usa POST /cameras/:id/snapshot que emite um ticket de acesso único (60s de
 * validade) e retorna { snapshotUrl, expiresInSec }. O <img> faz GET nessa URL
 * que aciona o ffmpeg para capturar o frame JPEG diretamente do stream da câmera.
 *
 * Fallback: placeholder gradiente escuro com ícone de câmera ou wifi-off.
 */
import { useEffect, useRef, useState } from 'react'
import { Camera, WifiOff } from 'lucide-react'
import { api } from '../../api/client'

interface CameraThumbProps {
  cameraId: string
  isOnline: boolean
  className?: string
}

const REFRESH_MS = 30_000

export function CameraThumb({ cameraId, isOnline, className = '' }: CameraThumbProps) {
  const [url, setUrl]     = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchSnap() {
    if (!isOnline) { setUrl(null); setError(false); return }
    if (loading) return
    setLoading(true)
    try {
      // POST emite ticket curto (60s) e retorna URL tipo
      // /live/:id/snapshot-jpeg?ticket=... — não passa pelo /api/, vai direto ao Caddy→go2rtc
      const { data } = await api.post(`/cameras/${cameraId}/snapshot`)
      const snapshotUrl: string | undefined = data?.snapshotUrl
      if (snapshotUrl) {
        // A URL é relativa (/live/...) — precisa de origem completa para o <img>
        const absolute = snapshotUrl.startsWith('http')
          ? snapshotUrl
          : `${window.location.origin}${snapshotUrl}`
        setUrl(absolute)
        setError(false)
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSnap()
    timerRef.current = setInterval(fetchSnap, REFRESH_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, isOnline])

  const showImage = !!url && !error && isOnline

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900 ${className}`}>
      {showImage && (
        <img
          key={url}           // força re-mount a cada novo ticket → sem flicker
          src={url}
          alt="snapshot"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setError(true)}
        />
      )}

      {/* Placeholder quando offline ou sem snapshot */}
      {!showImage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          {isOnline
            ? <Camera className="w-6 h-6 text-slate-600" />
            : <WifiOff className="w-5 h-5 text-slate-600" />
          }
          {loading && (
            <span className="w-3 h-3 border border-slate-600 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      )}
    </div>
  )
}
