/**
 * user-access.ts — Permission check completo pra ações do user.
 *
 * Considera, em ordem:
 *   1. Conta ativa (User.active)
 *   2. Conta não expirada (User.expiresAt)
 *   3. Conta não bloqueada (User.lockedUntil)
 *   4. LGPD consent dentro da política do tenant
 *   5. Horário permitido (User.accessSchedule)
 *   6. Escopo: site permitido (User.allowedSiteIds)
 *   7. Escopo: câmera permitida (User.allowedCameraIds)
 *   8. Capability gating (já existente em capability-check.ts) +
 *      capabilityOverrides do user
 *
 * Para gates de capability puros, continuar usando canUse() de capability-check.
 * Esta função adiciona as dimensões de USER (tempo, escopo físico, lifecycle).
 *
 * Fonte: docs/40-PLAN-GESTAO-USUARIOS.md (Sprint A)
 */
import { prisma } from './prisma'
import { canUse } from './capability-check'
import { logger } from './logger'

export interface AccessSchedule {
  weekdays: number[]   // 0=domingo .. 6=sábado
  hourStart: number    // 0-23
  hourEnd:   number    // 0-23 (se < hourStart, janela cruza meia-noite)
  timezone?: string    // default 'America/Sao_Paulo'
}

export interface CapabilityOverrides {
  add?: string[]      // capabilities adicionais sobre a role
  remove?: string[]   // capabilities removidas da role
}

export interface AccessTarget {
  siteId?: string
  cameraId?: string
}

export interface AccessResult {
  allowed: boolean
  reason?: string
  reasonCode?:
    | 'user_inactive'
    | 'user_expired'
    | 'user_locked'
    | 'lgpd_consent_missing'
    | 'schedule_blocked'
    | 'site_not_allowed'
    | 'camera_not_allowed'
    | 'capability_denied'
    | 'unknown_user'
}

/**
 * Verifica se o usuário pode executar uma ação agora num determinado alvo.
 *
 * @param userId        ID do User
 * @param capability    Capability necessária (ver lib/capabilities.ts).
 *                      Quando `undefined`, pula os checks de capability (etapa 8)
 *                      e valida apenas lifecycle/escopo/agenda. Útil pra ações
 *                      básicas (live view, etc) que não devem exigir subscription
 *                      premium — só isolamento de tenant + permissões físicas.
 * @param target        opcional: { siteId, cameraId } pra checar escopo físico
 */
export async function canUserAccess(
  userId: string,
  capability: string | undefined,
  target?: AccessTarget,
): Promise<AccessResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, active: true, role: true,
      clienteFinalId: true, integradorId: true,
      expiresAt: true, lockedUntil: true,
      lgpdAcceptedAt: true, lgpdPolicyVersion: true,
      accessSchedule: true,
      allowedSiteIds: true, allowedCameraIds: true,
      capabilityOverrides: true,
    },
  })

  if (!user) return { allowed: false, reasonCode: 'unknown_user', reason: 'Usuário não encontrado' }

  // 1. Conta ativa
  if (!user.active) {
    return { allowed: false, reasonCode: 'user_inactive', reason: 'Conta suspensa pelo administrador' }
  }

  // 2. Não expirada
  if (user.expiresAt && user.expiresAt < new Date()) {
    return { allowed: false, reasonCode: 'user_expired', reason: `Conta expirou em ${user.expiresAt.toLocaleDateString('pt-BR')}` }
  }

  // 3. Não bloqueada (tentativas falhadas)
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000)
    return { allowed: false, reasonCode: 'user_locked', reason: `Conta temporariamente bloqueada (${minutes}min restantes)` }
  }

  // 4. LGPD consent (apenas se tenant exige)
  if (user.clienteFinalId) {
    const policy = await prisma.tenantPolicy.findUnique({
      where: { clienteFinalId: user.clienteFinalId },
      select: { lgpdRequireConsent: true, lgpdPolicyVersion: true },
    })
    if (policy?.lgpdRequireConsent) {
      const consented = !!user.lgpdAcceptedAt && user.lgpdPolicyVersion === policy.lgpdPolicyVersion
      if (!consented) {
        return { allowed: false, reasonCode: 'lgpd_consent_missing', reason: 'É necessário aceitar a política LGPD antes de continuar' }
      }
    }
  }

  // 5. Horário permitido
  if (user.accessSchedule) {
    const schedule = user.accessSchedule as unknown as AccessSchedule
    if (!isWithinSchedule(schedule, new Date())) {
      return { allowed: false, reasonCode: 'schedule_blocked', reason: 'Acesso fora do horário permitido pelo seu perfil' }
    }
  }

  // 6. Escopo: site
  if (target?.siteId && user.allowedSiteIds.length > 0) {
    if (!user.allowedSiteIds.includes(target.siteId)) {
      return { allowed: false, reasonCode: 'site_not_allowed', reason: 'Você não tem acesso a este site' }
    }
  }

  // 7. Escopo: câmera (mais granular que site)
  if (target?.cameraId && user.allowedCameraIds.length > 0) {
    if (!user.allowedCameraIds.includes(target.cameraId)) {
      return { allowed: false, reasonCode: 'camera_not_allowed', reason: 'Você não tem acesso a esta câmera' }
    }
  }

  // 8. Capability (com overrides do user). Pulado quando capability=undefined
  // (caller decidiu que a ação é básica e não exige subscription).
  if (capability !== undefined) {
    const overrides = user.capabilityOverrides as unknown as CapabilityOverrides | null
    if (overrides?.remove?.includes(capability)) {
      return { allowed: false, reasonCode: 'capability_denied', reason: 'Esta ação foi explicitamente bloqueada para você' }
    }
    if (overrides?.add?.includes(capability)) {
      return { allowed: true }  // override positivo libera mesmo sem subscription
    }
    if (user.clienteFinalId) {
      const allowed = await canUse(user.clienteFinalId, capability)
      if (!allowed) {
        return { allowed: false, reasonCode: 'capability_denied', reason: `Recurso requer subscription que cubra: ${capability}` }
      }
    }
  }

  return { allowed: true }
}

/**
 * Verifica se o instante `now` está dentro da janela permitida.
 *
 * Considera:
 *   - Dia da semana (weekdays: 0=dom .. 6=sab)
 *   - Faixa de horário (hourStart..hourEnd)
 *   - Janela cruzando meia-noite (hourEnd < hourStart, ex: 22-06)
 *   - Timezone (default America/Sao_Paulo)
 */
export function isWithinSchedule(schedule: AccessSchedule, now: Date): boolean {
  const tz = schedule.timezone || 'America/Sao_Paulo'

  // Converte 'now' pra timezone do schedule usando Intl
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekday = wdMap[parts.find(p => p.type === 'weekday')?.value ?? ''] ?? 0
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)

  // Dia da semana
  if (schedule.weekdays.length > 0 && !schedule.weekdays.includes(weekday)) {
    return false
  }

  // Horário
  if (schedule.hourEnd >= schedule.hourStart) {
    // Janela simples (mesmo dia): 08-18 → 8 <= h < 18
    return hour >= schedule.hourStart && hour < schedule.hourEnd
  } else {
    // Janela cruzando meia-noite: 22-06 → h >= 22 OU h < 6
    return hour >= schedule.hourStart || hour < schedule.hourEnd
  }
}

/**
 * Helper pra rotas Express: trava request se canUserAccess negar.
 * Uso:
 *   router.post('/cameras/:id/recording',
 *     requireAuth,
 *     requireUserAccess('storage.recording.continuous', req => ({ cameraId: req.params.id })),
 *     asyncHandler(handler)
 *   )
 */
export function requireUserAccess(
  capability: string,
  targetFn?: (req: any) => AccessTarget | undefined,
) {
  return async (req: any, res: any, next: any) => {
    const userId = req.jwtPayload?.sub
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const target = targetFn?.(req)
    const result = await canUserAccess(userId, capability, target)

    if (!result.allowed) {
      logger.info({
        userId, capability, target,
        reasonCode: result.reasonCode,
        path: req.path,
      }, 'user_access_denied')

      return res.status(403).json({
        error: result.reasonCode,
        message: result.reason,
      })
    }

    next()
  }
}
