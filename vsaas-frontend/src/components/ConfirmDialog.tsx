/**
 * <ConfirmDialog> — modal de confirmação que substitui window.confirm() nativo.
 *
 * Vantagens vs confirm() nativo:
 *   - Visual consistente (não estilo Windows 95)
 *   - Não bloqueia thread JS (token pode renovar durante o prompt)
 *   - Suporta título + descrição rica + ícone + ação destrutiva (vermelho)
 *   - Animação suave (não pop)
 *   - Permite "Não perguntar de novo" se aplicável
 *   - Acessível (Esc fecha, Tab navega, focus trap)
 *
 * Uso programático (recomendado):
 *   const ok = await confirm({
 *     title: 'Excluir câmera?',
 *     description: 'Esta ação não pode ser desfeita.',
 *     destructive: true,
 *     confirmLabel: 'Excluir',
 *   })
 *   if (!ok) return
 *
 * QA Audit P0 #3 (docs/37) — 2026-05-23. Substitui 20+ window.confirm().
 */
import { useEffect, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { X, AlertTriangle, Trash2, HelpCircle } from 'lucide-react'

export interface ConfirmOptions {
  title: string
  description?: string
  /** Label do botão principal (default: 'Confirmar') */
  confirmLabel?: string
  /** Label do botão cancelar (default: 'Cancelar') */
  cancelLabel?: string
  /** Ação destrutiva = botão vermelho + ícone de lixeira */
  destructive?: boolean
  /** Texto de "digite para confirmar" (ex: nome do recurso). Se passado,
   *  o botão fica disabled até o usuário digitar exatamente esse texto. */
  typeToConfirm?: string
  /** Ícone customizado (override do default baseado em destructive) */
  icon?: React.ComponentType<{ className?: string }>
}

interface DialogProps extends ConfirmOptions {
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialogModal({
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  typeToConfirm,
  icon: CustomIcon,
  onConfirm,
  onCancel,
}: DialogProps) {
  const [typed, setTyped] = useState('')
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)

  // Focus inicial no Cancelar (mais seguro pra ações destrutivas)
  useEffect(() => {
    const target = destructive ? cancelBtnRef.current : confirmBtnRef.current
    target?.focus()
  }, [destructive])

  // Esc cancela, Enter confirma (se válido)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter' && (!typeToConfirm || typed === typeToConfirm)) {
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [typed, typeToConfirm, onConfirm, onCancel])

  const Icon = CustomIcon ?? (destructive ? Trash2 : (description ? AlertTriangle : HelpCircle))
  const canConfirm = !typeToConfirm || typed === typeToConfirm

  const accent = destructive
    ? { border: 'border-rose-500/40', iconBg: 'bg-rose-500/20 border-rose-500/40', iconColor: 'text-rose-400', btn: 'bg-rose-500 hover:bg-rose-600' }
    : { border: 'border-cyan-500/40', iconBg: 'bg-cyan-500/20 border-cyan-500/40', iconColor: 'text-cyan-400', btn: 'bg-cyan-500 hover:bg-cyan-600' }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onCancel}
    >
      <div
        className={`relative w-full max-w-md bg-slate-900 border ${accent.border} rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200`}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-3 right-3 w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-4 mb-4">
          <div className={`w-12 h-12 rounded-xl border ${accent.iconBg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-6 h-6 ${accent.iconColor}`} />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <h2 id="confirm-dialog-title" className="text-base font-bold text-white mb-1">
              {title}
            </h2>
            {description && (
              <p className="text-sm text-slate-300 leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>

        {typeToConfirm && (
          <div className="mb-4">
            <label className="block text-xs text-slate-400 mb-1.5">
              Digite <code className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-amber-300">{typeToConfirm}</code> para confirmar:
            </label>
            <input
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
              autoComplete="off"
              autoFocus
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-semibold text-slate-300 border border-white/10 transition"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => canConfirm && onConfirm()}
            disabled={!canConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition disabled:opacity-50 disabled:cursor-not-allowed ${accent.btn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * API programática: `await confirm({...})` retorna Promise<boolean>.
 * Mais ergonômico que mount manual. Cria root temporário, monta, aguarda.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    function cleanup() {
      root.unmount()
      try { document.body.removeChild(container) } catch { /* ignore */ }
    }

    root.render(
      <ConfirmDialogModal
        {...options}
        onConfirm={() => { cleanup(); resolve(true) }}
        onCancel={() => { cleanup(); resolve(false) }}
      />
    )
  })
}

export { ConfirmDialogModal }
