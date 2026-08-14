/**
 * Toast global que aparece quando alguma chamada API retorna 402 Payment Required.
 *
 * Escuta o evento 'icv:subscription-required' emitido pelo interceptor axios.
 * Mostra mensagem amigável + link "Ver no Marketplace".
 *
 * Para usar: monte UMA vez na raiz do App (App.tsx ou similar).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, X } from 'lucide-react'

interface ToastData {
  capability?: string
  upgradeUrl: string
  message?: string
  visible: boolean
}

export function SubscriptionRequiredToast() {
  const navigate = useNavigate()
  const [toast, setToast] = useState<ToastData>({ upgradeUrl: '/marketplace', visible: false })

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Omit<ToastData, 'visible'>
      setToast({ ...detail, visible: true })
      // Auto-hide after 8s
      setTimeout(() => setToast(t => ({ ...t, visible: false })), 8_000)
    }
    window.addEventListener('icv:subscription-required', handler)
    return () => window.removeEventListener('icv:subscription-required', handler)
  }, [])

  if (!toast.visible) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-50 max-w-sm animate-in slide-in-from-right-5 fade-in duration-300"
      role="alert"
    >
      <div className="rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-orange-500/10 backdrop-blur-md shadow-2xl shadow-amber-500/20 p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-amber-200 mb-1">
              Recurso requer assinatura
            </h4>
            <p className="text-xs text-amber-100/80 leading-relaxed mb-3">
              {toast.message || 'Para usar esse recurso, contrate o serviço no Marketplace.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  navigate(toast.upgradeUrl.replace(/^\/api/, ''))
                  setToast(t => ({ ...t, visible: false }))
                }}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold hover:opacity-90"
              >
                Ver no Marketplace →
              </button>
              <button
                onClick={() => setToast(t => ({ ...t, visible: false }))}
                className="px-2 py-1.5 rounded-lg text-amber-300 hover:bg-amber-500/10 text-xs"
              >
                Fechar
              </button>
            </div>
          </div>
          <button
            onClick={() => setToast(t => ({ ...t, visible: false }))}
            className="text-amber-400/60 hover:text-amber-200"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
