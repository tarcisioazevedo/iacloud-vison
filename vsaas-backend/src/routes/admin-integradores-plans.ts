/**
 * admin-integradores-plans.ts — gestão do plano de revenda de cada integrador.
 * SUPER_ADMIN / ADMIN_GLOBAL only.
 *
 *   POST   /admin/integradores/:id/assign-plan            atribui/troca plano
 *   POST   /admin/integradores/:id/grant-trial-extension  estende trial em N dias
 *   GET    /admin/plan-upgrade-requests                   lista solicitações pendentes
 *   PATCH  /admin/plan-upgrade-requests/:id               aprova/nega solicitação
 *   GET    /admin/integradores/:id/plan-history           histórico via PlanChangeLog
 */
import { Router } from 'express'
import { publicRoute } from '../middleware/require-capability'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, NotFoundError } from '../lib/errors'

export const adminIntegradoresPlansRouter = Router()
adminIntegradoresPlansRouter.use(requireAuth)
adminIntegradoresPlansRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

const AssignPlanSchema = z.object({
  planId: z.string().uuid(),
  /// Se true, inicia trial (preenche trialEndsAt baseado em plan.trialDays).
  startTrial: z.boolean().default(false),
  /// Motivo da mudança (auditoria).
  reason: z.string().max(500).optional(),
  /// Overrides comerciais opcionais (deal especial).
  maxClientesFinaisOverride: z.number().int().min(0).nullable().optional(),
  maxCamerasOverride: z.number().int().min(0).nullable().optional(),
})

const GrantTrialExtensionSchema = z.object({
  days: z.number().int().min(1).max(365),
  reason: z.string().max(500).optional(),
})

const DecideUpgradeSchema = z.object({
  decision: z.enum(['APPROVED', 'DENIED']),
  decisionNote: z.string().max(1000).optional(),
})

// ── POST /admin/integradores/:id/assign-plan ────────────────────────────────

adminIntegradoresPlansRouter.post('/integradores/:id/assign-plan',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const parsed = AssignPlanSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Payload inválido', { details: parsed.error.flatten() })
    const { planId, startTrial, reason, maxClientesFinaisOverride, maxCamerasOverride } = parsed.data

    const integrador = await prisma.integrador.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, tradeName: true, planId: true, pricingVersion: true, planActivatedAt: true, trialEndsAt: true },
    })
    if (!integrador) throw new NotFoundError('Integrador não encontrado')

    const plan = await prisma.platformPlan.findUnique({
      where: { id: planId },
      select: { id: true, slug: true, name: true, isTrial: true, trialDays: true, priceMonthly: true, pricingVersion: true, archived: true },
    })
    if (!plan) throw new NotFoundError('Plano não encontrado')
    if (plan.archived) throw new ValidationError('Plano arquivado — escolha outro')

    const now = new Date()
    const trialEndsAt = (startTrial && plan.isTrial && plan.trialDays > 0)
      ? new Date(now.getTime() + plan.trialDays * 24 * 3600 * 1000)
      : null

    const previousPlanId = integrador.planId

    // Atualizar integrador + log em transaction
    const updated = await prisma.$transaction(async tx => {
      const upd = await tx.integrador.update({
        where: { id: integrador.id },
        data: {
          planId:          plan.id,
          planActivatedAt: now,
          pricingVersion:  plan.pricingVersion,
          maxClientesFinaisOverride: maxClientesFinaisOverride ?? null,
          maxCamerasOverride:        maxCamerasOverride ?? null,
          ...(startTrial && plan.isTrial ? { trialEndsAt, trialActivatedAt: now } : {}),
        },
      })

      const action = previousPlanId
        ? (previousPlanId === plan.id ? 'reassign' : 'upgrade')
        : 'assign'

      await tx.planChangeLog.create({
        data: {
          integradorId: integrador.id,
          fromPlanId:   previousPlanId,
          toPlanId:     plan.id,
          action,
          reason:       reason ?? null,
          actorUserId:  req.jwtPayload?.sub ?? null,
          actorRole:    req.jwtPayload?.role ?? 'SUPER_ADMIN',
          metadata:     {
            startTrial,
            trialEndsAt: trialEndsAt?.toISOString() ?? null,
            overrides: { clientes: maxClientesFinaisOverride, cameras: maxCamerasOverride },
            planName: plan.name,
          },
        },
      })

      return upd
    })

    logger.info({
      integradorId: integrador.id,
      fromPlanId: previousPlanId,
      toPlanId: plan.id,
      startTrial,
    }, 'admin_assign_plan')

    res.json({ ok: true, integrador: updated, plan: { id: plan.id, slug: plan.slug, name: plan.name } })
  }),
)

// ── POST /admin/integradores/:id/grant-trial-extension ──────────────────────

adminIntegradoresPlansRouter.post('/integradores/:id/grant-trial-extension',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const parsed = GrantTrialExtensionSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Payload inválido', { details: parsed.error.flatten() })
    const { days, reason } = parsed.data

    const integrador = await prisma.integrador.findUnique({
      where: { id: req.params.id },
      select: { id: true, planId: true, trialEndsAt: true, trialActivatedAt: true },
    })
    if (!integrador) throw new NotFoundError('Integrador não encontrado')
    if (!integrador.trialEndsAt) throw new ValidationError('Integrador não está em trial')

    const newEnd = new Date(integrador.trialEndsAt.getTime() + days * 24 * 3600 * 1000)

    await prisma.$transaction([
      prisma.integrador.update({
        where: { id: integrador.id },
        data:  { trialEndsAt: newEnd },
      }),
      prisma.planChangeLog.create({
        data: {
          integradorId: integrador.id,
          fromPlanId:   integrador.planId,
          toPlanId:     integrador.planId,
          action:       'trial_extend',
          reason:       reason ?? `+${days} dias`,
          actorUserId:  req.jwtPayload?.sub ?? null,
          actorRole:    req.jwtPayload?.role ?? 'SUPER_ADMIN',
          metadata:     { days, previousEnd: integrador.trialEndsAt.toISOString(), newEnd: newEnd.toISOString() },
        },
      }),
    ])

    res.json({ ok: true, trialEndsAt: newEnd })
  }),
)

// ── GET /admin/plan-upgrade-requests ────────────────────────────────────────

adminIntegradoresPlansRouter.get('/plan-upgrade-requests',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const status = (req.query.status as string ?? 'PENDING').toUpperCase()
    const list = await prisma.planUpgradeRequest.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        integrador: { select: { id: true, name: true, tradeName: true, email: true } },
      },
    })

    // Hidrata fromPlan/toPlan
    const planIds = Array.from(new Set([
      ...list.map(r => r.fromPlanId).filter(Boolean) as string[],
      ...list.map(r => r.toPlanId),
    ]))
    const plans = await prisma.platformPlan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, slug: true, name: true, priceMonthly: true, maxClientesFinais: true, maxCameras: true },
    })
    const planMap = new Map(plans.map(p => [p.id, p]))

    res.json(list.map(r => ({
      ...r,
      fromPlan: r.fromPlanId ? planMap.get(r.fromPlanId) ?? null : null,
      toPlan:   planMap.get(r.toPlanId) ?? null,
    })))
  }),
)

// ── PATCH /admin/plan-upgrade-requests/:id ──────────────────────────────────

adminIntegradoresPlansRouter.patch('/plan-upgrade-requests/:id',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const parsed = DecideUpgradeSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Payload inválido', { details: parsed.error.flatten() })
    const { decision, decisionNote } = parsed.data

    const upgrade = await prisma.planUpgradeRequest.findUnique({ where: { id: req.params.id } })
    if (!upgrade) throw new NotFoundError('Solicitação não encontrada')
    if (upgrade.status !== 'PENDING') throw new ValidationError('Solicitação já foi decidida')

    const userId = req.jwtPayload?.sub ?? null
    const now = new Date()

    if (decision === 'APPROVED') {
      const plan = await prisma.platformPlan.findUnique({ where: { id: upgrade.toPlanId } })
      if (!plan || plan.archived) throw new ValidationError('Plano destino arquivado/inexistente')

      await prisma.$transaction([
        prisma.integrador.update({
          where: { id: upgrade.integradorId },
          data: {
            planId:          plan.id,
            planActivatedAt: now,
            pricingVersion:  plan.pricingVersion,
          },
        }),
        prisma.planUpgradeRequest.update({
          where: { id: upgrade.id },
          data:  { status: 'APPROVED', decidedByUserId: userId, decidedAt: now, decisionNote: decisionNote ?? null },
        }),
        prisma.planChangeLog.create({
          data: {
            integradorId: upgrade.integradorId,
            fromPlanId:   upgrade.fromPlanId,
            toPlanId:     upgrade.toPlanId,
            action:       'upgrade',
            reason:       `Aprovado: ${upgrade.reason ?? '(sem motivo)'}`,
            actorUserId:  userId,
            actorRole:    req.jwtPayload?.role ?? 'SUPER_ADMIN',
            metadata:     { upgradeRequestId: upgrade.id, decisionNote },
          },
        }),
      ])
    } else {
      await prisma.planUpgradeRequest.update({
        where: { id: upgrade.id },
        data:  { status: 'DENIED', decidedByUserId: userId, decidedAt: now, decisionNote: decisionNote ?? null },
      })

      await prisma.planChangeLog.create({
        data: {
          integradorId: upgrade.integradorId,
          fromPlanId:   upgrade.fromPlanId,
          toPlanId:     upgrade.toPlanId,
          action:       'upgrade_denied',
          reason:       decisionNote ?? null,
          actorUserId:  userId,
          actorRole:    req.jwtPayload?.role ?? 'SUPER_ADMIN',
          metadata:     { upgradeRequestId: upgrade.id },
        },
      })
    }

    res.json({ ok: true, decision })
  }),
)

// ── GET /admin/integradores/:id/plan-history ────────────────────────────────

adminIntegradoresPlansRouter.get('/integradores/:id/plan-history',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const list = await prisma.planChangeLog.findMany({
      where:   { integradorId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take:    100,
    })

    const planIds = Array.from(new Set([
      ...list.map(r => r.fromPlanId).filter(Boolean) as string[],
      ...list.map(r => r.toPlanId).filter(Boolean) as string[],
    ]))
    const plans = await prisma.platformPlan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, slug: true, name: true },
    })
    const planMap = new Map(plans.map(p => [p.id, p]))

    res.json(list.map(r => ({
      ...r,
      fromPlan: r.fromPlanId ? planMap.get(r.fromPlanId) ?? null : null,
      toPlan:   r.toPlanId ? planMap.get(r.toPlanId) ?? null : null,
    })))
  }),
)
