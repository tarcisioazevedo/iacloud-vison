/**
 * SudoGuard — Wrapper que exige elevação (sudo) pra renderizar o conteúdo.
 *
 * Usar em torno de páginas/rotas sensíveis (Live, Gravações, Faces, Placas)
 * pra atores INTEGRADOR_ADMIN. Se não houver sudo válido, mostra o modal e
 * bloqueia o conteúdo. Outras roles (CLIENTE_*, SUPER_ADMIN) passam direto
 * — backend tb não exige sudo delas.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { isSudoActive } from '../../lib/sudo'
import { SudoConfirmModal } from './SudoConfirmModal'

export interface SudoGuardProps {
  children: React.ReactNode
  targetLabel?: string
}

export function SudoGuard({ children, targetLabel }: SudoGuardProps) {
  const navigate = useNavigate()
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const needsSudo = role === 'INTEGRADOR_ADMIN'

  const [active, setActive] = useState(isSudoActive())
  const [showModal, setShow] = useState(needsSudo && !isSudoActive())

  useEffect(() => {
    if (!needsSudo) return
    function refresh() { setActive(isSudoActive()) }
    window.addEventListener('icv-sudo-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('icv-sudo-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [needsSudo])

  if (!needsSudo || active) return <>{children}</>

  return (
    <>
      <SudoConfirmModal
        open={showModal}
        onClose={() => { setShow(false); navigate('/', { replace: true }) }}
        onSuccess={() => { setActive(true); setShow(false) }}
        targetLabel={targetLabel}
      />
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Lock className="w-10 h-10 mb-3 text-amber-500/60" />
        <p className="text-sm">Esta área exige elevação por reautenticação.</p>
        <button
          onClick={() => setShow(true)}
          className="mt-4 px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 text-sm font-bold"
        >
          Solicitar elevação
        </button>
      </div>
    </>
  )
}
