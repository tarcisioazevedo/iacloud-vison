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
import { brtTime } from '../../lib/brt'

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
  /** Quando false, alertas SSE continuam alimentando o histórico mas não
   *  renderizam o toast flutuante. Persistido em localStorage. */
  toastsEnabled: boolean
  setToastsEnabled: (v: boolean) => void
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
    toastsEnabled: ctx.toastsEnabled,
    setToastsEnabled: ctx.setToastsEnabled,
  }
}

const TTL_MS = 8000          // toast some sozinho após 8s
const STORAGE_KEY = 'icv_alerts_history'
const TOASTS_ENABLED_KEY = 'icv_alerts_toasts_enabled'
const MAX_HISTORY = 100      // últimas 100 alertas

function loadToastsEnabled(): boolean {
  try {
    const v = localStorage.getItem(TOASTS_ENABLED_KEY)
    if (v === null) return true   // default: alertas ligados
    return v === '1'
  } catch { return true }
}

function saveToastsEnabled(v: boolean): void {
  try { localStorage.setItem(TOASTS_ENABLED_KEY, v ? '1' : '0') } catch {}
}

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
  const [toastsEnabled, setToastsEnabledState] = useState<boolean>(() => loadToastsEnabled())
  const esRef = useRef<EventSource | null>(null)

  const unreadCount = useMemo(() => history.filter(h => !h.read).length, [history])

  // Ref pra evitar stale-closure no callback `push` (registrado uma vez no SSE).
  const toastsEnabledRef = useRef(toastsEnabled)
  toastsEnabledRef.current = toastsEnabled

  const setToastsEnabled = useCallback((v: boolean) => {
    setToastsEnabledState(v)
    saveToastsEnabled(v)
    // Se desligou, limpa toasts já visíveis pra dar feedback imediato.
    if (!v) setToasts([])
  }, [])

  const push = useCallback((alert: AlertEvent) => {
    const id = `${alert.ts}-${Math.random().toString(36).slice(2, 8)}`
    const item: ToastItem = { ...alert, id }
    // Histórico SEMPRE recebe — sino do TopBar não depende do toggle.
    setHistory(prev => {
      const updated = [{ ...item, read: false } as HistoryItem, ...prev].slice(0, MAX_HISTORY)
      saveHistory(updated)
      return updated
    })
    // Toast só renderiza se o toggle estiver ligado.
    if (!toastsEnabledRef.current) return
    setToasts(prev => [item, ...prev].slice(0, 5))
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

    es.addEventListener('ready', () => {})

    es.onerror = (err) => {
      console.warn('[AlertToast] SSE error — auto-reconnect by browser', err)
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [push])

  return (
    <Ctx.Provider value={{ push, history, unreadCount, markAllRead, markRead, clearHistory, toastsEnabled, setToastsEnabled }}>
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
            src={`data:image/jpeg;base64,${item.snapshot}`}
            alt="snapshot"
            className="mt-2 rounded w-full max-h-40 object-cover cursor-pointer"
            onClick={() => {
              if (item.cameraId) {
                window.open(
                  `/recordings?cameraId=${item.cameraId}&at=${new Date(item.ts).toISOString()}`,
                  '_blank',
                )
              }
            }}
            title="Clique para abrir playback no momento do evento"
          />
        )}
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] opacity-60">
            {brtTime(item.ts)} BRT
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
