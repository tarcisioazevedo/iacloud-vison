/**
 * session.ts — utilitários centralizados de sessão.
 *
 * Único ponto de verdade pra limpar TODAS as chaves icv_* do localStorage.
 *
 * Antes deste arquivo, logout estava espalhado em 5+ lugares e cada um
 * limpava só 2-3 chaves. Resultado: após logout, 11+ keys de sudo,
 * impersonate, biometric, branding portal ficavam no browser causando
 * session leak entre usuários no mesmo computador.
 *
 * QA Audit P0 #4 (docs/37) — 2026-05-23.
 */

/**
 * Lista MASTER de TODAS as chaves localStorage usadas pelo app.
 * Sempre que adicionar uma chave nova, adicionar aqui também.
 */
const ICV_KEYS = [
  // Auth/role
  'icv_token',
  'icv_role',
  'icv_must_change_pw',
  'icv_cliente_final',
  'icv_portal_branding',

  // Sudo (step-up auth)
  'icv_sudo_token',
  'icv_sudo_expires_at',

  // Impersonação (admin agindo como integrador, integrador como cliente)
  'icv_token_original',
  'icv_role_original',
  'icv_email_original',
  'icv_impersonate_target',

  // Biometria/WebAuthn (se vier)
  'icv_biometric_enabled',
  'icv_webauthn_credential_id',

  // Preferências de UI (não-críticas mas limpam pra evitar leak)
  'icv_sites_view_v2',
  'icv_clientes_view',
  'icv_pending_leads',
] as const

/**
 * Limpa TODAS as chaves de sessão do localStorage.
 *
 * Usado por:
 *   - LoginPage no logout manual
 *   - axios interceptor no 401 (token expirou)
 *   - SettingsPage botão "Sair de todas as sessões"
 *   - Portal session expiry
 *
 * Não chama redirect — quem chama decide para onde ir (login, portal entry, etc).
 */
export function clearAllSession(): void {
  for (const key of ICV_KEYS) {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  }
  // Defesa em profundidade: varre por qualquer chave icv_* não-mapeada acima.
  // Pega chaves novas que devs esqueceram de adicionar à lista.
  try {
    const allKeys = Object.keys(localStorage)
    for (const k of allKeys) {
      if (k.startsWith('icv_')) {
        try { localStorage.removeItem(k) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore — localStorage pode estar indisponível em SSR ou modo privacy */ }
}

/**
 * Logout completo: chama backend pra revogar UserSession e gerar audit LOGOUT,
 * depois limpa local state. Best-effort no backend (não bloqueia se falhar).
 *
 * Uso: botão "Sair" em SettingsPage, sessions tab self-revoke, LGPD modal cancel.
 */
export async function logoutAndClearSession(): Promise<void> {
  const token = (() => {
    try { return localStorage.getItem('icv_token') } catch { return null }
  })()
  if (token) {
    try {
      const { api } = await import('../api/client')
      await api.post('/auth/logout').catch(() => { /* best-effort */ })
    } catch { /* import falhou — segue limpando local */ }
  }
  clearAllSession()
}

/**
 * Limpa apenas as chaves de impersonação (volta pro usuário original).
 * Usado quando admin/integrador clica "Sair da impersonação".
 */
export function clearImpersonation(): void {
  const keys = ['icv_token_original', 'icv_role_original', 'icv_email_original', 'icv_impersonate_target']
  for (const k of keys) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  }
}

/**
 * Limpa apenas o sudo token (step-up auth expirado).
 */
export function clearSudo(): void {
  try { localStorage.removeItem('icv_sudo_token') } catch { /* ignore */ }
  try { localStorage.removeItem('icv_sudo_expires_at') } catch { /* ignore */ }
}

/**
 * Verifica se há sessão ativa (token presente).
 */
export function hasActiveSession(): boolean {
  try { return !!localStorage.getItem('icv_token') } catch { return false }
}
