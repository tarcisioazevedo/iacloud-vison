/**
 * AlertToastProvider — popup em tempo real para alertas vindos do backend.
 *
 * Conecta em GET /notifications/stream (SSE) com o JWT do usuário e renderiza
 * toasts no canto superior direito quando o backend publica `event: alert`.
 *
 * Sem libs externas — implementação minimalista com Tailwind + portal manual.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface AlertEvent {
  type:        'alert'
  severity:    'INFO' | 'WARNING' | 'CRITICAL'
  title:       string
  body:        string
  cameraName?: string
  cameraId?:   string
  snapshot?:   string
  eventId?:    string
  ts:         number
}

interface ToastItem extends AlertEvent {
  id: string
}

interface ToastContext {
  push: (alert: AlertEvent) => void
}

const Ctx = createContext<ToastContext | null>(null)

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside <AlertToastProvider>')
  return ctx
}

const TTL_MS = 8000  // toast some sozinho após 8s

export function AlertToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const esRef = useRef<EventSource | null>(null)

  const push = useCallback((alert: AlertEvent) => {
    const id = `${alert.ts}-${Math.random().toString(36).slice(2, 8)}`
    setToasts(prev => [{ ...alert, id }, ...prev].slice(0, 5))   // máx 5 simultâneos
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), TTL_MS)
  }, [])

  // ── SSE connection ─────────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('icv_token')
    if (!token) return

    // EventSource não suporta headers customizados → JWT vai como query param.
    // O middleware requireAuth no backend aceita ?token=... como fallback (a confirmar).
    // Alternativa: adicionar suporte explícito a query token na auth middleware.
    const apiBase = (import.meta as any).env?.VITE_API_BASE_URL ?? '/api'
    const url = `${apiBase}/notifications/stream?token=${encodeURIComponent(token)}`

    const es = new EventSource(url, { withCredentials: false })
    esRef.current = es

    es.addEventListener('alert', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as AlertEvent
        push(data)
      } catch (err) {
        console.warn('[AlertToast] invalid payload', err)
      }
    })

    es.addEventListener('ready', () => {
      console.debug('[AlertToast] connected to SSE stream')
    })

    es.onerror = (err) => {
      console.warn('[AlertToast] SSE error — auto-reconnect by browser', err)
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [push])

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none"
      >
        {toasts.map(t => <Toast key={t.id} item={t} onClose={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />)}
      </div>
    </Ctx.Provider>
  )
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const colors = {
    INFO:     'bg-sky-500 border-sky-300',
    WARNING:  'bg-amber-500 border-amber-300',
    CRITICAL: 'bg-rose-600 border-rose-300 animate-pulse',
  }[item.severity]

  return (
    <div className={`pointer-events-auto rounded-lg border-l-4 ${colors} shadow-lg overflow-hidden text-white`}>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm leading-tight">{item.title}</h4>
            <p className="text-xs opacity-90 mt-1 break-words">{item.body}</p>
            {item.cameraName && (
              <p className="text-[10px] opacity-75 mt-1">📷 {item.cameraName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="fechar"
            className="text-white/70 hover:text-white text-lg leading-none px-1"
          >×</button>
        </div>
        {item.snapshot && (
          <img
            src={`data:image/webp;base64,${item.snapshot}`}
            alt="snapshot"
            className="mt-2 rounded w-full max-h-32 object-cover"
          />
        )}
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] opacity-60">
            {new Date(item.ts).toLocaleTimeString('pt-BR')}
          </span>
          {item.cameraId && (
            <button
              onClick={() => {
                // Reprodução instantânea: abre player no momento exato do evento
                const params = new URLSearchParams({
                  cameraId: item.cameraId!,
                  at: new Date(item.ts).toISOString(),
                })
                window.open(`/recordings?${params.toString()}`, '_blank')
              }}
              className="text-[10px] bg-white/20 hover:bg-white/30 px-2 py-1 rounded font-semibold flex items-center gap-1 transition"
              title="Abrir reprodução instantânea no momento do evento"
            >
              ▶ Reproduzir
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
