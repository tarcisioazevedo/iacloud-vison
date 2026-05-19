import { useEffect, useRef, useState } from 'react'
import { BASE_URL } from '../api/client'

interface SSEAlert {
  type: 'alert'
  title: string
  body: string
  cameraId?: string
  cameraName?: string
  severity?: string
  ts: number
}

export function useMobileSSE(onAlert: (a: SSEAlert) => void) {
  const [connected, setConnected] = useState(false)
  const esRef      = useRef<EventSource | null>(null)
  const retryDelay = useRef(1000)
  const onAlertRef = useRef(onAlert)
  onAlertRef.current = onAlert

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout>

    function connect() {
      if (cancelled) return
      const token = localStorage.getItem('icv_token')
      if (!token) return
      const url = `${BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`
      // EventSource doesn't support custom headers — use ?token= query param
      // Backend must accept token via query param for SSE
      const es = new EventSource(url)
      esRef.current = es

      es.addEventListener('ready', () => {
        setConnected(true)
        retryDelay.current = 1000
      })

      es.addEventListener('alert', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as SSEAlert
          onAlertRef.current(data)
        } catch {}
      })

      es.onerror = () => {
        setConnected(false)
        es.close()
        if (!cancelled) {
          retryTimer = setTimeout(() => {
            retryDelay.current = Math.min(retryDelay.current * 2, 30_000)
            connect()
          }, retryDelay.current)
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      esRef.current?.close()
      setConnected(false)
    }
  }, [])

  return { connected }
}
