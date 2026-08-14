/**
 * Subscription Trial endpoints.
 *
 * Distinto do legacy `trials.ts` (trial de Integrador). Aqui é trial em
 * nível de assinatura de produto do marketplace pelo cliente final.
 *
 * Endpoints:
 *
 *   ADMIN (SUPER_ADMIN / ADMIN_GLOBAL):
 *     GET    /admin/subscription-trials                 → lista todos os trials ativos
 *     POST   /admin/subscription-trials/grant           → concede pra qualquer cliente
 *     POST   /admin/subscription-trials/cron-run        → força execução do cron
 *
 *   INTEGRADOR (INTEGRADOR_ADMIN):
 *     POST   /me/integrador/subscription-trials/grant   → concede pra cliente DO PRÓPRIO TENANT
 *
 *   CLIENTE FINAL (self-service):
 *     POST   /me/cliente/start-trial/:productId         → inicia trial sozinho
 *                                                         (só se product.allowSelfTrial=true)
 *
 * Plano: docs/35-AUDIT-CONSISTENCIA-E2E.md
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'
import {
  grantTrial,
  processExpiredTrials,
} from '../services/subscription-trial.service'
import { logger } from '../lib/logger'

function uid(req: Request): string | undefined {
  return req.jwtPayload?.sub
}

async function audit(req: Request, action: string, resourceId: string, metadata?: any) {
  try {
    const jwt = req.jwtPayload
    await prisma.auditLog.create({
      data: {
        superAdminId: jwt?.role === 'SUPER_ADMIN' || jwt?.role === 'ADMIN_GLOBAL' ? uid(req) : undefined,
        integradorId: jwt?.integradorId ?? undefined,
        action,
        resource:     'ClienteSubscription',
        resourceId,
        metadataJson: metadata ?? undefined,
      },
    })
  } catch (err) {
    logger.warn({ err, action }, 'subscription_trial_audit_failed')
  }
}

/**
 * Valida que o integrador chamando é dono do clienteFinal alvo.
 * Throws 403 (via ForbiddenError-like via res.status) se não for.
 */
async function assertIntegradorOwnsCliente(
  jwtPayload: any,
  clienteFinalId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  // SUPER_ADMIN passa
  if (jwtPayload?.role === 'SUPER_ADMIN' || jwtPayload?.role === 'ADMIN_GLOBAL') {
    return { ok: true }
  }
  const integradorId = jwtPayload?.integradorId
  if (!integradorId) {
    return { ok: false, status: 403, error: 'no_integrador_context' }
  }
  const cf = await prisma.clienteFinal.findUnique({
    where: { id: clienteFinalId },
    select: { integradorId: true },
  })
  if (!cf) return { ok: false, status: 404, error: 'cliente_not_found' }
  if (cf.integradorId !== integradorId) {
    return { ok: false, status: 403, error: 'cliente_not_in_tenant' }
  }
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN router — /admin/subscription-trials
// ═══════════════════════════════════════════════════════════════════════

export const adminSubscriptionTrialsRouter = Router()
adminSubscriptionTrialsRouter.use(requireAuth)
adminSubscriptionTrialsRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

adminSubscriptionTrialsRouter.get('/',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const integradorFilter = req.query.integradorId as string | undefined
    const productFilter = req.query.productId as string | undefined
    const onlyActive = req.query.onlyActive !== 'false'

    const where: any = {
      status: 'TRIAL',
    }
    if (productFilter) where.productId = productFilter
    if (onlyActive) where.trialUntil = { gt: new Date() }

    const trials = await prisma.clienteSubscription.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, slug: true, category: true } },
        clienteFinal: {
          select: {
            id: true, name: true, integradorId: true,
            integrador: { select: { id: true, name: true, tradeName: true } },
          },
        },
      },
      orderBy: { trialUntil: 'asc' },
    })

    // Filtro de integrador (no aplicativo — ClienteFinal.integradorId, não na sub)
    const filtered = integradorFilter
      ? trials.filter(t => t.clienteFinal.integradorId === integradorFilter)
      : trials

    const now = Date.now()
    const enriched = filtered.map(t => {
      const daysLeft = t.trialUntil
        ? Math.max(0, Math.ceil((t.trialUntil.getTime() - now) / (1000 * 60 * 60 * 24)))
        : null
      return {
        id:              t.id,
        clienteFinalId:  t.clienteFinalId,
        clienteName:     t.clienteFinal.name,
        integradorId:    t.clienteFinal.integradorId,
        integradorName:  t.clienteFinal.integrador?.tradeName ?? t.clienteFinal.integrador?.name ?? null,
        productId:       t.productId,
        productName:     t.product.name,
        productCategory: t.product.category,
        status:          t.status,
        startedAt:       t.startedAt.toISOString(),
        trialUntil:      t.trialUntil?.toISOString() ?? null,
        trialDays:       t.trialDays,
        trialGrantedBy:  t.trialGrantedBy,
        campaign:        t.trialFromCampaign,
        daysLeft,
      }
    })

    res.json({ trials: enriched, total: enriched.length })
  }),
)

const adminGrantSchema = z.object({
  clienteFinalId:     z.string().uuid(),
  productId:          z.string().uuid(),
  customDurationDays: z.number().int().min(1).max(365).optional(),
  campaign:           z.string().max(120).optional(),
})

adminSubscriptionTrialsRouter.post('/grant',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const parse = adminGrantSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({ error: 'invalid_input', issues: parse.error.issues })
    }
    const grantedByUserId = uid(req)
    if (!grantedByUserId) return res.status(401).json({ error: 'no_user_context' })

    try {
      const sub = await grantTrial({
        ...parse.data,
        grantedByUserId,
        acceptedIp: req.ip ?? null,
      })
      await audit(req, 'SUBSCRIPTION_TRIAL_GRANTED_ADMIN', sub.id, {
        clienteFinalId:     parse.data.clienteFinalId,
        productId:          parse.data.productId,
        customDurationDays: parse.data.customDurationDays,
        campaign:           parse.data.campaign,
      })
      res.status(201).json({
        id:         sub.id,
        status:     sub.status,
        trialUntil: sub.trialUntil,
        trialDays:  sub.trialDays,
      })
    } catch (err: any) {
      const msg = err.message
      if (msg === 'product_not_found') return res.status(404).json({ error: msg })
      if (msg === 'product_inactive')  return res.status(400).json({ error: msg })
      if (msg === 'already_has_subscription') return res.status(409).json({ error: msg })
      throw err
    }
  }),
)

adminSubscriptionTrialsRouter.post('/cron-run',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await processExpiredTrials()
    await audit(req, 'SUBSCRIPTION_TRIAL_CRON_FORCED', 'all', result)
    res.json(result)
  }),
)

// ═══════════════════════════════════════════════════════════════════════
// INTEGRADOR router — /me/integrador/subscription-trials
// Integrador concede trial pra cliente DO SEU TENANT
// ═══════════════════════════════════════════════════════════════════════

export const integradorSubscriptionTrialsRouter = Router()
integradorSubscriptionTrialsRouter.use(requireAuth)
integradorSubscriptionTrialsRouter.use(
  requireRole('INTEGRADOR_ADMIN', 'SUPER_ADMIN', 'ADMIN_GLOBAL'),
)

const integradorGrantSchema = z.object({
  clienteFinalId:     z.string().uuid(),
  productId:          z.string().uuid(),
  customDurationDays: z.number().int().min(1).max(90).optional(),
  campaign:           z.string().max(120).optional(),
})

integradorSubscriptionTrialsRouter.post('/grant',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const parse = integradorGrantSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({ error: 'invalid_input', issues: parse.error.issues })
    }

    const ownership = await assertIntegradorOwnsCliente(req.jwtPayload, parse.data.clienteFinalId)
    if (!ownership.ok) {
      return res.status(ownership.status).json({ error: ownership.error })
    }

    const grantedByUserId = uid(req)
    if (!grantedByUserId) return res.status(401).json({ error: 'no_user_context' })

    try {
      const sub = await grantTrial({
        ...parse.data,
        grantedByUserId,
        acceptedIp: req.ip ?? null,
      })
      await audit(req, 'SUBSCRIPTION_TRIAL_GRANTED_INTEGRADOR', sub.id, {
        clienteFinalId:     parse.data.clienteFinalId,
        productId:          parse.data.productId,
        customDurationDays: parse.data.customDurationDays,
        campaign:           parse.data.campaign,
      })
      res.status(201).json({
        id:         sub.id,
        status:     sub.status,
        trialUntil: sub.trialUntil,
        trialDays:  sub.trialDays,
      })
    } catch (err: any) {
      const msg = err.message
      if (msg === 'product_not_found') return res.status(404).json({ error: msg })
      if (msg === 'product_inactive')  return res.status(400).json({ error: msg })
      if (msg === 'already_has_subscription') return res.status(409).json({ error: msg })
      throw err
    }
  }),
)

// ═══════════════════════════════════════════════════════════════════════
// CLIENTE FINAL router — /me/cliente/start-trial/:productId
// Self-service: cliente inicia trial sozinho (só se allowSelfTrial=true)
// ═══════════════════════════════════════════════════════════════════════

export const meClienteTrialRouter = Router()
meClienteTrialRouter.use(requireAuth)

meClienteTrialRouter.post('/start-trial/:productId',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = req.jwtPayload
    const clienteFinalId = jwt?.clienteFinalId
    if (!clienteFinalId) {
      return res.status(403).json({ error: 'no_cliente_context' })
    }

    const product = await prisma.marketplaceProduct.findUnique({
      where: { id: String(req.params.productId) },
      select: { id: true, active: true, allowSelfTrial: true, name: true, trialDays: true },
    })
    if (!product) return res.status(404).json({ error: 'product_not_found' })
    if (!product.active) return res.status(400).json({ error: 'product_inactive' })
    if (!product.allowSelfTrial) {
      return res.status(403).json({ error: 'self_trial_not_allowed' })
    }

    try {
      const sub = await grantTrial({
        clienteFinalId,
        productId:       product.id,
        grantedByUserId: jwt.sub,
        campaign:        'self-service',
        acceptedIp:      req.ip ?? null,
      })
      await audit(req, 'SUBSCRIPTION_TRIAL_GRANTED_SELF', sub.id, {
        productId:   product.id,
        productName: product.name,
      })
      res.status(201).json({
        id:          sub.id,
        productName: product.name,
        status:      sub.status,
        trialUntil:  sub.trialUntil,
        trialDays:   sub.trialDays,
      })
    } catch (err: any) {
      const msg = err.message
      if (msg === 'already_has_subscription') {
        return res.status(409).json({ error: msg })
      }
      throw err
    }
  }),
)
