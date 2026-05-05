/**
 * AlertToastProvider — popup em tempo real + histórico persistido.
 *
 * 1. Conecta em GET /notifications/stream (SSE) com o JWT do usuário
 * 2. Renderiza toasts no canto superior direito
 * 3. Mantém histórico das últimas 100 notificações em localStorage
 * 4. Expõe useToast (push) e useAlertHistory (lista + markAllRead)
 *
 * O sino do TopBar consome useAlertHistory para mostrar dropdown com itens
 * já fechados.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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

interface HistoryItem extends ToastItem {
  read: boolean
}

interface ToastContext {
  push: (alert: AlertEvent) => void
  history: HistoryItem[]
  unreadCount: number
  markAllRead: () => void
  markRead: (id: string) => void
  clearHistory: () => void
}

const Ctx = createContext<ToastContext | null>(null)

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside <AlertToastProvider>')
  return ctx
}

/** Hook dedicado para componentes que só querem o histórico (ex: sino do TopBar) */
export function useAlertHistory() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAlertHistory must be used inside <AlertToastProvider>')
  return {
    history: ctx.history,
    unreadCount: ctx.unreadCount,
    markAllRead: ctx.markAllRead,
    markRead: ctx.markRead,
    clearHistory: ctx.clearHistory,
  }
}

const TTL_MS = 8000          // toast some sozinho após 8s
const STORAGE_KEY = 'icv_alerts_history'
const MAX_HISTORY = 100      // últimas 100 alertas

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryItem[]
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : []
  } catch { return [] }
}

function saveHistory(items: HistoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)))
  } catch { /* quota exceeded - ignore */ }
}

export function AlertToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory())
  const esRef = useRef<EventSource | null>(null)

  const unreadCount = useMemo(() => history.filter(h => !h.read).length, [history])

  const push = useCallback((alert: AlertEvent) => {
    const id = `${alert.ts}-${Math.random().toString(36).slice(2, 8)}`
    const item: ToastItem = { ...alert, id }
    setToasts(prev => [item, ...prev].slice(0, 5))
    setHistory(prev => {
      const updated = [{ ...item, read: false } as HistoryItem, ...prev].slice(0, MAX_HISTORY)
      saveHistory(updated)
      return updated
    })
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), TTL_MS)
  }, [])

  const markAllRead = useCallback(() => {
    setHistory(prev => {
      const updated = prev.map(h => ({ ...h, read: true }))
      saveHistory(updated)
      return updated
    })
  }, [])

  const markRead = useCallback((id: string) => {
    setHistory(prev => {
      const updated = prev.map(h => h.id === id ? { ...h, read: true } : h)
      saveHistory(updated)
      return updated
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    saveHistory([])
  }, [])

  // ── SSE connection ─────────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('icv_token')
    if (!token) return

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
    <Ctx.Provider value={{ push, history, unreadCount, markAllRead, markRead, clearHistory }}>
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
