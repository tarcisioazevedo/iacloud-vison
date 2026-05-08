/**
 * ImpersonateBanner — Banner vermelho persistente durante sessão de impersonação.
 *
 * Onda 9.B — fica fixed no topo da página enquanto JWT.impersonatedBy estiver
 * presente. Mostra countdown até o auto-logout e botão "Encerrar agora".
 */
import { useEffect, useState } from 'react'
import { UserX, Clock, X } from 'lucide-react'
import { api } from '../../api/client'

interface ImpersonateTarget {
  id: string
  email: string
  role: string
  targetName?: string
  reason?: string
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}

function formatRemaining(sec: number): string {
  if (sec <= 0) return '00:00'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function ImpersonateBanner() {
  const [now, setNow] = useState(Date.now())

  // Tick 1Hz para countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (typeof window === 'undefined') return null

  const token = localStorage.getItem('icv_token') ?? ''
  if (!token) return null
  const payload = decodeJwt(token)
  if (!payload || !payload.impersonatedBy) return null

  const expiresAt = (payload.impersonationExpiresAt as number | undefined)
    ?? Math.floor(now / 1000) + 60  // fallback 1min se não tem campo
  const remainingSec = Math.max(0, expiresAt - Math.floor(now / 1000))

  let target: ImpersonateTarget | null = null
  try {
    const raw = localStorage.getItem('icv_impersonate_target')
    target = raw ? JSON.parse(raw) : null
  } catch {}

  async function handleEnd() {
    try {
      await api.post('/auth/impersonate/end')
    } catch {}
    // Limpa metadata da impersonação
    localStorage.removeItem('icv_impersonate_expires_at')
    localStorage.removeItem('icv_impersonate_target')

    // Restaura sessão ORIGINAL (SUPER_ADMIN) salva antes de impersonar
    const originalToken = localStorage.getItem('icv_token_original')
    const originalRole  = localStorage.getItem('icv_role_original')
    const originalEmail = localStorage.getItem('icv_email_original')
    if (originalToken) {
      localStorage.setItem('icv_token', originalToken)
      localStorage.setItem('icv_role', originalRole ?? '')
      localStorage.setItem('icv_email', originalEmail ?? '')
      localStorage.removeItem('icv_token_original')
      localStorage.removeItem('icv_role_original')
      localStorage.removeItem('icv_email_original')
      // Volta pro dashboard do ator original (SUPER_ADMIN), sem passar pelo login
      window.location.href = '/admin/tenants'
    } else {
      // Fallback: sem sessão original salva → desloga
      localStorage.removeItem('icv_token')
      localStorage.removeItem('icv_role')
      localStorage.removeItem('icv_email')
      window.location.href = '/login'
    }
  }

  // Auto-logout quando countdown zera
  if (remainingSec === 0) {
    handleEnd()
    return null
  }

  // Próximo do fim → animar pulse
  const isExpiring = remainingSec < 60
  const targetLabel = target?.targetName ?? target?.email ?? 'usuário'

  return (
    <div className={`sticky top-0 z-[60] flex items-center justify-between gap-3 px-4 py-2 border-b ${
      isExpiring
        ? 'bg-rose-500/20 border-rose-500/50 animate-pulse'
        : 'bg-rose-500/15 border-rose-500/30'
    }`}>
      <div className="flex items-center gap-2 text-xs text-rose-200 dark:text-rose-200 min-w-0">
        <UserX className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          <strong className="font-bold">Modo de impersonação ativo</strong>
          {' · '}
          Você está como <strong className="text-white">{targetLabel}</strong>
          {target?.reason && <span className="text-rose-300"> · {target.reason}</span>}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`flex items-center gap-1 text-xs font-mono font-bold tabular-nums ${
          isExpiring ? 'text-rose-100' : 'text-rose-200'
        }`}>
          <Clock className="w-3 h-3" />
          {formatRemaining(remainingSec)}
        </span>
        <button
          onClick={handleEnd}
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-rose-300/50 text-rose-100 hover:bg-rose-500/20 transition text-[11px] font-bold"
        >
          <X className="w-3 h-3" />
          Encerrar agora
        </button>
      </div>
    </div>
  )
}
