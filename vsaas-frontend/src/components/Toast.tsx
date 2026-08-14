/**
 * Toast UI utilitário — substitui `window.alert()` em ações de usuário.
 *
 * Diferença do AlertToastProvider:
 *  - AlertToastProvider = alertas em tempo real vindos do backend (SSE/IA)
 *  - Este Toast.tsx     = feedback de ação síncrona (salvou, falhou, ...)
 *
 * Uso:
 *   1) Em App.tsx, envolver a árvore com <UiToastProvider>
 *   2) Em componentes: `const toast = useUiToast(); toast.error('Falhou')`
 *
 * Métodos:
 *   - toast.success(msg | { title, description, action })
 *   - toast.error(msg | { title, description, action })
 *   - toast.warning(msg | { title, description, action })
 *   - toast.info(msg | { title, description, action })
 *
 * Cada toast desaparece sozinho após `duration` ms (default 5000).
 * Aparece no canto inferior direito, empilhado, com glassmorphism.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastInput {
  title?: string
  description?: string
  action?: ToastAction
  duration?: number
}

interface ToastItem extends Required<Pick<ToastInput, 'duration'>> {
  id: string
  kind: ToastKind
  title?: string
  description?: string
  action?: ToastAction
}

interface UiToastApi {
  success: (msg: string | ToastInput) => string
  error:   (msg: string | ToastInput) => string
  warning: (msg: string | ToastInput) => string
  info:    (msg: string | ToastInput) => string
  dismiss: (id: string) => void
  dismissAll: () => void
}

const Ctx = createContext<UiToastApi | null>(null)

const DEFAULT_DURATION_MS = 5000
const MAX_VISIBLE = 5

function normalize(msg: string | ToastInput): Omit<ToastInput, 'duration'> & { duration: number } {
  if (typeof msg === 'string') {
    return { description: msg, duration: DEFAULT_DURATION_MS }
  }
  return {
    title:       msg.title,
    description: msg.description,
    action:      msg.action,
    duration:    msg.duration ?? DEFAULT_DURATION_MS,
  }
}

export function UiToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    const t = timersRef.current.get(id)
    if (t) {
      clearTimeout(t)
      timersRef.current.delete(id)
    }
    setItems(prev => prev.filter(x => x.id !== id))
  }, [])

  const dismissAll = useCallback(() => {
    timersRef.current.forEach(t => clearTimeout(t))
    timersRef.current.clear()
    setItems([])
  }, [])

  const push = useCallback((kind: ToastKind, msg: string | ToastInput): string => {
    const id = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const n  = normalize(msg)
    const item: ToastItem = {
      id,
      kind,
      title:       n.title,
      description: n.description,
      action:      n.action,
      duration:    n.duration,
    }
    setItems(prev => [item, ...prev].slice(0, MAX_VISIBLE))
    if (item.duration > 0) {
      const t = setTimeout(() => dismiss(id), item.duration)
      timersRef.current.set(id, t)
    }
    return id
  }, [dismiss])

  const api = useMemo<UiToastApi>(() => ({
    success: (m) => push('success', m),
    error:   (m) => push('error',   m),
    warning: (m) => push('warning', m),
    info:    (m) => push('info',    m),
    dismiss,
    dismissAll,
  }), [push, dismiss, dismissAll])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(t => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [])

  // Bus global — escuta eventos disparados por módulos não-React (lib/*).
  useEffect(() => {
    const handler = (ev: Event) => {
      const det = (ev as CustomEvent).detail as { kind: ToastKind; msg: string | ToastInput } | undefined
      if (!det) return
      push(det.kind, det.msg)
    }
    window.addEventListener(BUS_EVENT, handler)
    return () => window.removeEventListener(BUS_EVENT, handler)
  }, [push])

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-[10000] flex flex-col-reverse gap-2 w-full max-w-sm pointer-events-none"
      >
        {items.map(it => (
          <ToastCard key={it.id} item={it} onClose={() => dismiss(it.id)} />
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useUiToast(): UiToastApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUiToast must be used inside <UiToastProvider>')
  return ctx
}

// ── Bus global pra módulos não-React (lib/*) ─────────────────────────────────
//
// Permite disparar um toast de utilitários puros (ex.: src/lib/channels.ts)
// sem precisar receber o hook por parâmetro. O provider escuta o evento.
//
// Uso: import { toast } from '@/components/Toast'; toast.error('Algo deu errado')
const BUS_EVENT = 'icv:ui-toast'

interface BusPayload {
  kind: ToastKind
  msg:  string | ToastInput
}

export const toast = {
  success: (m: string | ToastInput) => dispatchToast('success', m),
  error:   (m: string | ToastInput) => dispatchToast('error',   m),
  warning: (m: string | ToastInput) => dispatchToast('warning', m),
  info:    (m: string | ToastInput) => dispatchToast('info',    m),
}

function dispatchToast(kind: ToastKind, msg: string | ToastInput): void {
  if (typeof window === 'undefined') return
  const detail: BusPayload = { kind, msg }
  window.dispatchEvent(new CustomEvent(BUS_EVENT, { detail }))
}

// ── card ─────────────────────────────────────────────────────────────────────
const STYLES: Record<ToastKind, {
  border: string
  bg:     string
  iconBg: string
  iconFg: string
  titleFg: string
  bodyFg:  string
  Icon:    typeof CheckCircle2
}> = {
  success: {
    border:  'border-emerald-500/40',
    bg:      'from-emerald-500/10 to-green-500/10 shadow-emerald-500/20',
    iconBg:  'bg-emerald-500/20 border-emerald-500/40',
    iconFg:  'text-emerald-400',
    titleFg: 'text-emerald-200',
    bodyFg:  'text-emerald-100/85',
    Icon:    CheckCircle2,
  },
  error: {
    border:  'border-rose-500/40',
    bg:      'from-rose-500/10 to-red-500/10 shadow-rose-500/20',
    iconBg:  'bg-rose-500/20 border-rose-500/40',
    iconFg:  'text-rose-400',
    titleFg: 'text-rose-200',
    bodyFg:  'text-rose-100/85',
    Icon:    XCircle,
  },
  warning: {
    border:  'border-amber-500/40',
    bg:      'from-amber-500/10 to-yellow-500/10 shadow-amber-500/20',
    iconBg:  'bg-amber-500/20 border-amber-500/40',
    iconFg:  'text-amber-400',
    titleFg: 'text-amber-200',
    bodyFg:  'text-amber-100/85',
    Icon:    AlertTriangle,
  },
  info: {
    border:  'border-cyan-500/40',
    bg:      'from-cyan-500/10 to-sky-500/10 shadow-cyan-500/20',
    iconBg:  'bg-cyan-500/20 border-cyan-500/40',
    iconFg:  'text-cyan-400',
    titleFg: 'text-cyan-200',
    bodyFg:  'text-cyan-100/85',
    Icon:    Info,
  },
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const s = STYLES[item.kind]
  const Icon = s.Icon
  const hasTitle = !!item.title
  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto rounded-xl border ${s.border} bg-gradient-to-br ${s.bg} backdrop-blur-md shadow-2xl animate-in slide-in-from-right-5 fade-in duration-300`}
    >
      <div className="p-3 flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg border ${s.iconBg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-4 h-4 ${s.iconFg}`} />
        </div>
        <div className="flex-1 min-w-0">
          {hasTitle && (
            <h4 className={`text-sm font-bold mb-1 ${s.titleFg}`}>{item.title}</h4>
          )}
          {item.description && (
            <p className={`text-xs leading-relaxed break-words whitespace-pre-wrap ${s.bodyFg}`}>
              {item.description}
            </p>
          )}
          {item.action && (
            <div className="mt-2">
              <button
                onClick={() => { item.action!.onClick(); onClose() }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 ${s.titleFg} transition`}
              >
                {item.action.label}
              </button>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar notificação"
          className={`${s.iconFg} opacity-60 hover:opacity-100 transition`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
