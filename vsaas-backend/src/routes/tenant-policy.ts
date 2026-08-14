/**
 * Tenant Policy Routes — política de segurança do cliente final.
 *
 * Permite CLIENTE_ADMIN configurar:
 *   - Política de senha (min length, rotação, history)
 *   - MFA enforcement (global ou por role)
 *   - Session timeout e max concorrentes
 *   - LGPD policy (consent obrigatório, versão, texto)
 *   - Lockout após N tentativas
 *
 * GET  /me/cliente/tenant-policy
 * PUT  /me/cliente/tenant-policy
 *
 * Sprint A · docs/40-PLAN-GESTAO-USUARIOS.md
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'
import { ValidationError, ForbiddenError } from '../lib/errors'
import { logger } from '../lib/logger'

export const tenantPolicyRouter = Router()
tenantPolicyRouter.use(requireAuth)

const PolicySchema = z.object({
  // Senha
  passwordMinLength:      z.number().int().min(6).max(64).optional(),
  passwordRequireSpecial: z.boolean().optional(),
  passwordRequireNumber:  z.boolean().optional(),
  passwordRequireUpper:   z.boolean().optional(),
  passwordRotateDays:     z.number().int().min(0).max(365).nullable().optional(),
  passwordHistoryCount:   z.number().int().min(0).max(20).optional(),

  // MFA
  mfaRequired:            z.boolean().optional(),
  mfaRequiredForRoles:    z.array(z.enum([
    'CLIENTE_ADMIN', 'CLIENTE_SUPERVISOR', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER',
  ])).optional(),

  // Sessão
  sessionTimeoutMinutes:  z.number().int().min(15).max(43200).optional(),  // 15min..30d
  sessionMaxConcurrent:   z.number().int().min(1).max(50).nullable().optional(),

  // Lockout
  loginMaxAttempts:       z.number().int().min(1).max(20).optional(),
  loginLockoutMinutes:    z.number().int().min(1).max(1440).optional(),

  // LGPD
  lgpdRequireConsent:     z.boolean().optional(),
  lgpdPolicyVersion:      z.string().min(1).max(20).optional(),
  lgpdPolicyText:         z.string().max(50_000).nullable().optional(),

  // Acesso
  maxConcurrentUsers:     z.number().int().min(1).max(1000).nullable().optional(),

  // Compliance avançado
  requireReasonForPlayback: z.boolean().optional(),
  exportWatermarkEnabled:   z.boolean().optional(),
  exportWatermarkTemplate:  z.string().min(1).max(200).optional(),
  exportWatermarkPosition:  z.enum(['bottom-left','bottom-right','top-left','top-right','center','tile']).optional(),
  exportWatermarkOpacity:   z.number().min(0.05).max(1).optional(),
  exportWatermarkFontSize:  z.number().int().min(10).max(72).optional(),
  exportWatermarkLogoUrl:   z.string().url().nullable().optional(),
  snapshotWatermarkEnabled: z.boolean().optional(),
})

function resolveClienteFinalId(jwt: any): string {
  if (jwt.role !== 'CLIENTE_ADMIN' && jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    throw new ForbiddenError('Apenas CLIENTE_ADMIN, INTEGRADOR_ADMIN ou SUPER_ADMIN podem gerenciar política do tenant')
  }
  if (jwt.clienteFinalId) return jwt.clienteFinalId
  throw new ValidationError('clienteFinalId requerido (informe via JWT ou query)')
}

// ── GET ────────────────────────────────────────────────────────────────────
tenantPolicyRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const clienteFinalId = resolveClienteFinalId(req.jwtPayload!)
    let policy = await prisma.tenantPolicy.findUnique({ where: { clienteFinalId } })

    if (!policy) {
      // Lazy init com defaults
      policy = await prisma.tenantPolicy.create({ data: { clienteFinalId } })
    }
    res.json({ policy })
  })
)

// ── PUT ────────────────────────────────────────────────────────────────────
tenantPolicyRouter.put('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const clienteFinalId = resolveClienteFinalId(jwt)
    const parse = PolicySchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

    const b = parse.data
    const updated = await prisma.tenantPolicy.upsert({
      where: { clienteFinalId },
      create: { clienteFinalId, ...b, updatedById: jwt.sub },
      update: { ...b, updatedById: jwt.sub },
    })

    await prisma.auditLog.create({
      data: {
        action: 'TENANT_POLICY_UPDATED',
        resource: 'TenantPolicy',
        resourceId: clienteFinalId,
        userId: jwt.sub,
        clienteFinalId,
        integradorId: jwt.integradorId ?? null,
        metadataJson: b as any,
      },
    }).catch(() => {})

    logger.info({ clienteFinalId, updatedBy: jwt.sub }, 'tenant_policy_updated')
    res.json({ policy: updated })
  })
)
