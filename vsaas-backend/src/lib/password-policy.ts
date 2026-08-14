/**
 * password-policy.ts — Sprint B
 *
 * Valida senhas contra a TenantPolicy do cliente final e detecta
 * reutilização via histórico.
 *
 * Política aplicada:
 *   - passwordMinLength
 *   - passwordRequireSpecial / Number / Upper
 *   - passwordHistoryCount (impede reutilização das últimas N)
 *
 * Quando o user não tem `clienteFinalId` (SUPER_ADMIN, INTEGRADOR_ADMIN, ou
 * USER tipo INTEGRADOR_TECNICO), aplica defaults seguros (ver DEFAULT_POLICY).
 *
 * Histórico: armazenado no User.passwordHistory (String[]) — array de bcrypt
 * hashes. bcrypt.compare contra cada um.
 *
 * Plano: docs/40-PLAN-GESTAO-USUARIOS.md (Sprint B)
 */
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { logger } from './logger'

export interface ResolvedPolicy {
  passwordMinLength:      number
  passwordRequireSpecial: boolean
  passwordRequireNumber:  boolean
  passwordRequireUpper:   boolean
  passwordRotateDays:     number | null
  passwordHistoryCount:   number
  loginMaxAttempts:       number
  loginLockoutMinutes:    number
}

/**
 * Defaults usados quando o ator não tem tenant (SUPER_ADMIN, INTEGRADOR_ADMIN
 * ou USER sem clienteFinal). Mais frouxos que o default de TenantPolicy pra
 * não quebrar fluxo de seed/admin global.
 */
export const DEFAULT_POLICY: ResolvedPolicy = {
  passwordMinLength:      10,
  passwordRequireSpecial: true,
  passwordRequireNumber:  true,
  passwordRequireUpper:   true,
  passwordRotateDays:     null,
  passwordHistoryCount:   3,
  loginMaxAttempts:       5,
  loginLockoutMinutes:    15,
}

/**
 * Resolve a política aplicável ao cliente final. Cria registro com defaults
 * se ainda não existe (lazy init — alinhado com /me/cliente/tenant-policy GET).
 *
 * Se clienteFinalId é null, retorna DEFAULT_POLICY (em memória, sem hit no DB).
 */
export async function resolvePolicy(
  clienteFinalId: string | null,
): Promise<ResolvedPolicy> {
  if (!clienteFinalId) return DEFAULT_POLICY

  let policy = await prisma.tenantPolicy.findUnique({
    where:  { clienteFinalId },
    select: {
      passwordMinLength:      true,
      passwordRequireSpecial: true,
      passwordRequireNumber:  true,
      passwordRequireUpper:   true,
      passwordRotateDays:     true,
      passwordHistoryCount:   true,
      loginMaxAttempts:       true,
      loginLockoutMinutes:    true,
    },
  })

  if (!policy) {
    // Best-effort lazy create (defaults do schema). Se falhar (race), usa default.
    try {
      policy = await prisma.tenantPolicy.create({
        data: { clienteFinalId },
        select: {
          passwordMinLength:      true,
          passwordRequireSpecial: true,
          passwordRequireNumber:  true,
          passwordRequireUpper:   true,
          passwordRotateDays:     true,
          passwordHistoryCount:   true,
          loginMaxAttempts:       true,
          loginLockoutMinutes:    true,
        },
      })
    } catch {
      return DEFAULT_POLICY
    }
  }

  return policy
}

/**
 * Verifica se a senha está no histórico (últimos N hashes do user).
 *
 * `historyCount` é o limite atual da política — não compara mais que isso
 * mesmo se o array tiver guardado mais hashes (pra cobrir caso de redução
 * da política).
 *
 * Compara via bcrypt.compare (constant-time). Retorna true no primeiro hit.
 */
export async function isPasswordInHistory(
  userId: string,
  newPassword: string,
  historyCount: number,
): Promise<boolean> {
  if (historyCount <= 0) return false

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { passwordHistory: true, passwordHash: true },
  })
  if (!user) return false

  // Senha atual também conta como "já usada"
  const candidates = [user.passwordHash, ...(user.passwordHistory ?? [])]
    .filter(Boolean)
    .slice(0, Math.max(historyCount, 1))

  for (const hash of candidates) {
    try {
      const match = await bcrypt.compare(newPassword, hash)
      if (match) return true
    } catch {
      // Hash inválido (ex: corrompido) — ignora e segue
      continue
    }
  }
  return false
}

/**
 * Valida a senha contra a política do tenant.
 *
 * Retorna `{ valid, errors }` com mensagens em PT-BR, prontas pra exibir
 * no frontend (lista de checkboxes ✓ verde / ✗ vermelho).
 *
 * Quando `options.skipHistory=true`, não consulta o DB pra histórico
 * (útil em /me/password-policy onde só queremos as regras visíveis).
 */
export async function validatePasswordAgainstPolicy(
  password: string,
  clienteFinalId: string | null,
  options?: { skipHistory?: boolean; userId?: string },
): Promise<{ valid: boolean; errors: string[]; policy: ResolvedPolicy }> {
  const policy = await resolvePolicy(clienteFinalId)
  const errors: string[] = []

  if (typeof password !== 'string' || password.length === 0) {
    errors.push('Senha vazia')
    return { valid: false, errors, policy }
  }

  if (password.length < policy.passwordMinLength) {
    errors.push(`Senha deve ter no mínimo ${policy.passwordMinLength} caracteres`)
  }
  if (policy.passwordRequireUpper && !/[A-Z]/.test(password)) {
    errors.push('Senha deve conter ao menos 1 letra maiúscula')
  }
  if (policy.passwordRequireNumber && !/[0-9]/.test(password)) {
    errors.push('Senha deve conter ao menos 1 número')
  }
  if (policy.passwordRequireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Senha deve conter ao menos 1 caractere especial (ex: !@#$%)')
  }

  // History check — só faz sentido pra User (não SuperAdmin/Integrador,
  // que não têm passwordHistory). E só se passar userId.
  if (!options?.skipHistory && options?.userId && policy.passwordHistoryCount > 0) {
    try {
      const reused = await isPasswordInHistory(options.userId, password, policy.passwordHistoryCount)
      if (reused) {
        errors.push(`Senha já foi usada anteriormente. Escolha uma diferente das últimas ${policy.passwordHistoryCount}.`)
      }
    } catch (err) {
      logger.warn({ err, userId: options.userId }, 'password_history_check_failed')
    }
  }

  return { valid: errors.length === 0, errors, policy }
}

/**
 * Helper para aplicar a nova senha + history rotation atomicamente.
 *
 * Push do `oldHash` no final do array; poda os mais antigos pra não exceder
 * historyCount. Usado pelo /change-password depois que validamos a nova senha.
 *
 * Retorna `passwordExpiresAt` calculado pra caller registrar no audit.
 */
export async function applyPasswordChange(opts: {
  userId:        string
  newHash:       string
  oldHash:       string
  policy:        ResolvedPolicy
}): Promise<{ passwordExpiresAt: Date | null }> {
  const { userId, newHash, oldHash, policy } = opts

  const now = new Date()
  const passwordExpiresAt = policy.passwordRotateDays && policy.passwordRotateDays > 0
    ? new Date(now.getTime() + policy.passwordRotateDays * 24 * 60 * 60_000)
    : null

  // Carrega histórico atual pra recompor com novo hash + poda excesso.
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { passwordHistory: true },
  })
  const prev = user?.passwordHistory ?? []
  // Mantém os mais recentes; histórico fica com até (historyCount - 1) hashes
  // antigos + o oldHash que estamos arquivando agora. Quando consultarmos no
  // futuro, somamos o passwordHash atual → total = historyCount.
  const keep = Math.max(0, policy.passwordHistoryCount - 1)
  const newHistory = [oldHash, ...prev].slice(0, keep)

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash:        newHash,
      passwordChangedAt:   now,
      passwordExpiresAt,
      mustChangePassword:  false,
      failedLoginAttempts: 0,
      lockedUntil:         null,
      passwordHistory:     newHistory,
    },
  })

  return { passwordExpiresAt }
}
