import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Fingerprint, Lock, LogOut } from 'lucide-react'
import { cn } from '../../lib/utils'

export function AppLockGuard({ children }: { children: React.ReactNode }) {
  const enrolled = typeof window !== 'undefined' && localStorage.getItem('icv_biometric_enrolled') === '1'
  const initiallyUnlocked = typeof window !== 'undefined' && sessionStorage.getItem('icv_biometric_unlocked') === '1'
  
  // Estado que define se o app está bloqueado
  const [isLocked, setIsLocked] = useState(enrolled && !initiallyUnlocked)
  const [checking, setChecking] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const requestUnlock = useCallback(async (auto: boolean = false) => {
    if (!enrolled) return
    setChecking(true)
    setErrorMsg('')
    try {
      const idBase64 = localStorage.getItem('icv_biometric_id')
      let allowCredentials = undefined

      if (idBase64) {
        const binaryString = atob(idBase64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        allowCredentials = [{
          id: bytes,
          type: 'public-key' as const,
          transports: ['internal' as AuthenticatorTransport],
        }]
      }

      // Cria a chamada WebAuthn (Passkey / Face ID / Digital)
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: window.location.hostname,
          userVerification: 'required',
          allowCredentials,
          timeout: 60000,
        },
      })
      
      if (cred) {
        setIsLocked(false)
        sessionStorage.setItem('icv_biometric_unlocked', '1')
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        if (!auto) setErrorMsg('Autenticação cancelada. Tente novamente.')
      } else {
        setErrorMsg('Falha na autenticação biométrica.')
      }
    } finally {
      setChecking(false)
    }
  }, [enrolled])

  useEffect(() => {
    // Se não está matriculado, ignora
    if (!enrolled) {
      setIsLocked(false)
      return
    }

    // Ao carregar pela primeira vez, checa se a sessão já foi destravada
    const unlocked = sessionStorage.getItem('icv_biometric_unlocked') === '1'
    if (!unlocked) {
      setIsLocked(true)
      // Tenta abrir a biometria direto
      setTimeout(() => requestUnlock(true), 300)
    }

    // Escuta minimização (Background)
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // App foi pro background, bloqueia imediatamente por segurança!
        setIsLocked(true)
        sessionStorage.removeItem('icv_biometric_unlocked')
      } else if (document.visibilityState === 'visible' && !isLocked) {
        // Se voltou ao foco e o estado local não atualizou, força bloqueio
        const unlockedCheck = sessionStorage.getItem('icv_biometric_unlocked') === '1'
        if (!unlockedCheck) {
          setIsLocked(true)
          requestUnlock(true)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [enrolled, isLocked, requestUnlock])

  function handleLogout() {
    localStorage.removeItem('icv_token')
    localStorage.removeItem('icv_role')
    localStorage.removeItem('icv_biometric_enrolled') // Força remoção se quiser trocar user
    sessionStorage.removeItem('icv_biometric_unlocked')
    window.location.href = '/login'
  }

  // Se não tem biometria ligada ou destravou, renderiza o App
  if (!enrolled || !isLocked) {
    return <>{children}</>
  }

  // Tela de Bloqueio Intransponível
  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col items-center justify-center p-6 text-center select-none overflow-hidden touch-none">
      
      {/* Background Cinematics */}
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-slate-950" />
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/20 via-slate-950 to-slate-950" />

      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative z-10 flex flex-col items-center"
      >
        <div className="w-20 h-20 rounded-full bg-slate-900 border border-slate-800 shadow-2xl flex items-center justify-center mb-6">
          <Lock className="w-8 h-8 text-cyan-400" />
        </div>

        <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">VSaaS App Lock</h1>
        <p className="text-sm text-slate-400 mb-8 max-w-xs">
          O aplicativo foi bloqueado por segurança. Utilize sua biometria para continuar.
        </p>

        <button
          onClick={() => requestUnlock(false)}
          disabled={checking}
          className={cn(
            "relative group overflow-hidden w-full max-w-[240px] flex items-center justify-center gap-3 py-4 rounded-2xl bg-cyan-500 text-slate-950 text-sm font-bold shadow-[0_0_20px_rgba(6,182,212,0.2)] transition-all",
            checking ? "opacity-80 scale-95" : "active:scale-95 hover:bg-cyan-400"
          )}
        >
          <Fingerprint className={cn("w-5 h-5", checking && "animate-pulse")} />
          {checking ? 'Verificando...' : 'Desbloquear'}
        </button>

        {errorMsg && (
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs text-rose-400 mt-4 max-w-xs"
          >
            {errorMsg}
          </motion.p>
        )}

        <button
          onClick={handleLogout}
          className="mt-12 flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" /> Sair da conta
        </button>
      </motion.div>
    </div>
  )
}
