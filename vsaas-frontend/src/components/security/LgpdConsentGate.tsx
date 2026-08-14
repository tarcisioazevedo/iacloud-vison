/**
 * <LgpdConsentGate> — bloqueia uso do app até consentimento LGPD válido.
 *
 * Comportamento:
 *   1. No mount, faz GET /me/lgpd/status
 *   2. Se { required: true, accepted: false } → renderiza <LgpdConsentModal>
 *      bloqueante. User só vê o modal.
 *   3. Se aceito ou não exigido → renderiza children normalmente.
 *
 * Falhas de rede / 401 são ignoradas (deixa o axios interceptor lidar com auth).
 *
 * Sprint C · docs/40-PLAN-GESTAO-USUARIOS.md
 */
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import { LgpdConsentModal } from './LgpdConsentModal'

interface StatusResponse {
  required: boolean
  accepted: boolean
  currentVersion?: string
  acceptedVersion?: string | null
  acceptedAt?: string | null
  reason?: 'never_accepted' | 'version_outdated' | null
}

interface Props {
  children: ReactNode
}

export function LgpdConsentGate({ children }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let alive = true
    api.get<StatusResponse>('/me/lgpd/status')
      .then(({ data }) => { if (alive) setStatus(data) })
      .catch(() => { /* deixa axios interceptor cuidar; assume não-requerido */ })
      .finally(() => { if (alive) setChecked(true) })
    return () => { alive = false }
  }, [])

  // Antes do check inicial, mostra children pra não piscar tela em branco.
  // O modal só aparece quando confirmado required+!accepted.
  const showModal = checked && status?.required === true && status?.accepted === false

  function handleLogout() {
    import('../../lib/session').then(({ clearAllSession }) => {
      clearAllSession()
      window.location.href = '/login'
    })
  }

  function handleAccepted() {
    // Re-check para refletir aceite
    api.get<StatusResponse>('/me/lgpd/status')
      .then(({ data }) => setStatus(data))
      .catch(() => setStatus({ required: false, accepted: true }))
  }

  return (
    <>
      {children}
      {showModal && (
        <LgpdConsentModal
          currentVersion={status?.currentVersion ?? 'v1'}
          reason={status?.reason ?? null}
          onAccepted={handleAccepted}
          onLogout={handleLogout}
        />
      )}
    </>
  )
}
