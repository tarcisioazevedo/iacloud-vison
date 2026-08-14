/**
 * useLiveDetections — assina SSE de detecções IA para uma câmera.
 *
 * Backend publica em /live/detections/:cameraId/stream a cada frame com bboxes.
 * Este hook mantém o último payload em memória; o componente que usa renderiza
 * via requestAnimationFrame.
 *
 * Auto-cleanup quando cameraId muda ou componente desmonta.
 *
 * Auth: EventSource nativo NÃO suporta headers customizados (limitação do navegador).
 * Solução: passamos o JWT como query param. Backend aceita Authorization OU ?token=.
 * Em produção, o cookie httpOnly futuro elimina essa necessidade.
 */
import { useEffect, useRef, useState } from 'react'
import { BASE_URL } from '../api/client'

export interface Detection {
  /** type: "person", "car", "dog", ... */
  t: string
  /** confidence 0..1 */
  c: number
  /** bbox normalizado [x, y, w, h] em 0..1 */
  b: [number, number, number, number]
  /** trackId opcional (presente quando Norfair confirmou) */
  i?: string
}

export interface DetectionPayload {
  /** timestamp ms (server-side) */
  ts: number
  /** largura do frame em px (para client renderizar bbox em proporção) */
  w: number
  /** altura do frame em px */
  h: number
  /** lista de detecções */
  d: Detection[]
}

export interface UseLiveDetectionsResult {
  /** Último payload recebido — null enquanto não houver detecções */
  payload: DetectionPayload | null
  /** Status da conexão SSE */
  status: 'idle' | 'connecting' | 'connected' | 'error' | 'closed'
  /** Erro humano-readable (último) */
  error: string | null
  /** Força reconexão */
  reconnect: () => void
}

interface Options {
  /** Default true. Quando false, hook não conecta (toggle desligado pelo operador). */
  enabled?: boolean
  /** Descarta payloads mais velhos que isso (ms). Default 1500ms — evita render de frame estale. */
  maxStaleMs?: number
}

export function useLiveDetections(
  cameraId: string | null | undefined,
  options: Options = {},
): UseLiveDetectionsResult {
  // 600ms: motion_gate filtra frames sem movimento → worker para de publicar.
  // Em câmera estática, esperamos 600ms antes de limpar bbox — equilibra entre
  // "fantasma persistente" (bbox sobre objeto que saiu) e "bbox piscando" (limpa
  // antes da próxima publicação chegar). 600ms = ~6 frames @10fps de publicação.
  // Quando objeto sai do frame, o worker publica payload vazio → limpa na hora.
  const { enabled = true, maxStaleMs = 600 } = options

  const [payload, setPayload] = useState<DetectionPayload | null>(null)
  const [status,  setStatus]  = useState<UseLiveDetectionsResult['status']>('idle')
  const [error,   setError]   = useState<string | null>(null)
  const [nonce,   setNonce]   = useState(0)

  const esRef = useRef<EventSource | null>(null)
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!cameraId || !enabled) {
      setStatus('idle')
      return
    }

    const token = localStorage.getItem('icv_token') ?? ''
    if (!token) {
      setStatus('error')
      setError('Sem token de autenticação')
      return
    }

    const url = `${BASE_URL}/live/detections/${encodeURIComponent(cameraId)}/stream?token=${encodeURIComponent(token)}`
    setStatus('connecting')
    setError(null)

    const es = new EventSource(url)
    esRef.current = es

    es.addEventListener('ready', () => {
      setStatus('connected')
    })

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as DetectionPayload
        if (data && Array.isArray(data.d)) {
          setPayload(data)
          if (status !== 'connected') setStatus('connected')
        }
      } catch {
        // ignora payload malformado
      }
    }

    es.onerror = () => {
      // EventSource tenta reconectar sozinho. Marca status mas não fecha.
      setStatus('error')
      setError('Conexão SSE caiu, reconectando…')
    }

    // Timer que zera o payload se ficar muito velho (worker parou de publicar)
    staleTimerRef.current = setInterval(() => {
      setPayload(prev => {
        if (!prev) return prev
        if (Date.now() - prev.ts > maxStaleMs) return null
        return prev
      })
    }, 500)

    return () => {
      es.close()
      esRef.current = null
      if (staleTimerRef.current) {
        clearInterval(staleTimerRef.current)
        staleTimerRef.current = null
      }
      setStatus('closed')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, enabled, nonce, maxStaleMs])

  return {
    payload,
    status,
    error,
    reconnect: () => setNonce(n => n + 1),
  }
}
