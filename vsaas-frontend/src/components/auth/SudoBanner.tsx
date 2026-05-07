/**
 * SudoBanner — Banner persistente durante elevação ativa (step-up auth).
 *
 * Aparece no topo da página quando há sudo token válido. Mostra countdown
 * regressivo + motivo + botão "Encerrar agora" (revoga + limpa storage).
 * Auto-some quando o token expira.
 */
import { useEffect, useState } from 'react'
import { Lock, X, Clock } from 'lucide-react'
import {
  isSudoActive,
  getSudoSecondsRemaining,
  getSudoReason,
  clearSudo,
} from '../../lib/sudo'

function formatRemaining(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function SudoBanner() {
  const [active, setActive]   = useState(isSudoActive())
  const [remaining, setRem]   = useState(getSudoSecondsRemaining())
  const [reason, setReason]   = useState(getSudoReason())
  const [ending, setEnding]   = useState(false)

  useEffect(() => {
    function refresh() {
      setActive(isSudoActive())
      setRem(getSudoSecondsRemaining())
      setReason(getSudoReason())
    }
    refresh()
    // Eventos: storage (outras abas) + custom (mesma aba via lib/sudo)
    const onChange = () => refresh()
    window.addEventListener('storage', onChange)
    window.addEventListener('icv-sudo-changed', onChange)
    // Tick 1s pra countdown
    const tick = setInterval(refresh, 1000)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener('icv-sudo-changed', onChange)
      clearInterval(tick)
    }
  }, [])

  if (!active) return null

  async function handleEnd() {
    setEnding(true)
    await clearSudo()
    setEnding(false)
  }

  const danger = remaining <= 60

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-b text-xs"
      style={{
        background: danger
          ? 'linear-gradient(to right, rgba(244,63,94,0.15), rgba(244,63,94,0.05))'
          : 'linear-gradient(to right, rgba(245,158,11,0.15), rgba(245,158,11,0.05))',
        borderColor: danger ? 'rgba(244,63,94,0.4)' : 'rgba(245,158,11,0.4)',
        color: danger ? '#fda4af' : '#fcd34d',
      }}
    >
      <Lock className="w-3.5 h-3.5 shrink-0" />
      <span className="font-bold uppercase tracking-wider">Modo elevado</span>
      <span className="opacity-80 truncate max-w-[40%]" title={reason ?? ''}>
        · motivo: {reason ?? '—'}
      </span>
      <span className="ml-auto flex items-center gap-1.5 font-mono">
        <Clock className="w-3 h-3" />
        {formatRemaining(remaining)}
      </span>
      <button
        onClick={handleEnd}
        disabled={ending}
        className="flex items-center gap-1 px-2 py-0.5 rounded border border-current/30 hover:bg-current/10 transition disabled:opacity-50"
      >
        <X className="w-3 h-3" />
        Encerrar agora
      </button>
    </div>
  )
}
