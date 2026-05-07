/**
 * Step-up auth ("sudo") — utilitário cliente.
 *
 * Mantém um JWT separado em localStorage que é enviado no header
 * `X-ICV-Sudo` quando válido. Backend valida em rotas sensíveis
 * (live/recordings/faces/plates) só pra atores INTEGRADOR_*.
 *
 * O token sudo é independente do `icv_token`: se expirar/for revogado,
 * o usuário continua logado normalmente — só perde acesso aos itens
 * que exigem elevação.
 */
import { api } from '../api/client'

const SUDO_TOKEN_KEY      = 'icv_sudo_token'
const SUDO_EXPIRES_AT_KEY = 'icv_sudo_expires_at'
const SUDO_REASON_KEY     = 'icv_sudo_reason'

export interface SudoGrantResponse {
  sudoToken: string
  expiresInSeconds: number
  expiresAt: string
}

export interface SudoRequestPayload {
  password: string
  reason: string
  durationSeconds?: number
  acknowledged: boolean
}

export async function requestSudo(payload: SudoRequestPayload): Promise<SudoGrantResponse> {
  const { data } = await api.post<SudoGrantResponse>('/auth/sudo', payload)
  localStorage.setItem(SUDO_TOKEN_KEY,      data.sudoToken)
  localStorage.setItem(SUDO_EXPIRES_AT_KEY, data.expiresAt)
  localStorage.setItem(SUDO_REASON_KEY,     payload.reason)
  // Notifica componentes (banner) via storage event sintético
  window.dispatchEvent(new Event('icv-sudo-changed'))
  return data
}

export function getSudoToken(): string | null {
  const token = localStorage.getItem(SUDO_TOKEN_KEY)
  if (!token) return null
  const exp = localStorage.getItem(SUDO_EXPIRES_AT_KEY)
  if (exp && new Date(exp).getTime() <= Date.now()) {
    clearSudo({ skipRevoke: true })
    return null
  }
  return token
}

export function getSudoExpiresAt(): Date | null {
  const exp = localStorage.getItem(SUDO_EXPIRES_AT_KEY)
  return exp ? new Date(exp) : null
}

export function getSudoReason(): string | null {
  return localStorage.getItem(SUDO_REASON_KEY)
}

export function isSudoActive(): boolean {
  return !!getSudoToken()
}

export function getSudoSecondsRemaining(): number {
  const exp = getSudoExpiresAt()
  if (!exp) return 0
  return Math.max(0, Math.floor((exp.getTime() - Date.now()) / 1000))
}

export async function clearSudo(opts?: { skipRevoke?: boolean }): Promise<void> {
  const had = !!localStorage.getItem(SUDO_TOKEN_KEY)
  localStorage.removeItem(SUDO_TOKEN_KEY)
  localStorage.removeItem(SUDO_EXPIRES_AT_KEY)
  localStorage.removeItem(SUDO_REASON_KEY)
  window.dispatchEvent(new Event('icv-sudo-changed'))
  if (had && !opts?.skipRevoke) {
    try { await api.post('/auth/sudo/revoke', {}) } catch { /* best effort */ }
  }
}
