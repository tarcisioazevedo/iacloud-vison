/**
 * Retention Routes — Sprint 2 do plano docs/STORAGE-ARCHITECTURE.md
 *
 * Cobre 3 papéis em endpoints coesos:
 *
 *   Super Admin (catálogo)
 *     GET    /retention/plans                    — lista planos (público autenticado)
 *     POST   /retention/plans                    — cria plano (SUPER_ADMIN)
 *     PUT    /retention/plans/:id                — edita plano (SUPER_ADMIN)
 *     DELETE /retention/plans/:id                — soft delete (SUPER_ADMIN)
 *
 *   Integrador (contrato + atribuição)
 *     GET    /retention/contract                 — vê próprio contract
 *     PUT    /retention/contract                 — markup% e plano default (INT_ADMIN)
 *     POST   /retention/cameras/:cameraId/plan   — atribui plano à câmera (INT ou CLIENTE_ADMIN)
 *     POST   /retention/clientes/:cfId/plan     — define plano default do CF (INT_ADMIN)
 *
 *   Cliente Final (upgrade request)
 *     POST   /retention/upgrade-requests         — solicita upgrade (auto-approved hoje)
 *     GET    /retention/upgrade-requests         — histórico do tenant
 *
 *   Resolver (helper p/ frontend mostrar plano efetivo de uma câmera)
 *     GET    /retention/cameras/:cameraId/effective-plan
 *
 * Cascata de resolução de plano:
 *   Camera.retentionPlanId
 *     ?? ClienteFinal.retentionPlanDefaultId
 *     ?? IntegradorRetentionContract.defaultPlanoId
 *     ?? null
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, ValidationError, NotFoundError } from '../lib/errors'
import { logger } from '../lib/logger'

export const retentionRouter = Router()

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function isSuperAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
}

function isIntegradorAdmin(role: string): boolean {
  return role === 'INTEGRADOR_ADMIN' || isSuperAdmin(role)
}

/**
 * Resolve o plano efetivo para uma câmera (cascata).
 * Retorna o RetentionPlan + origem da decisão para a UI mostrar contexto.
 */
async function resolveEffectivePlan(cameraId: string) {
  const cam = await prisma.camera.findUnique({
    where:  { id: cameraId },
    select: {
      retentionPlanId: true,
      retentionPlan:   true,
      site: {
        select: {
          clienteFinal: {
            select: {
              id: true, integradorId: true,
              retentionPlanDefaultId: true,
              retentionPlanDefault:   true,
            },
          },
        },
      },
    },
  })
  if (!cam) return null

  if (cam.retentionPlan) return { plan: cam.retentionPlan, source: 'CAMERA' as const }
  const cf = cam.site.clienteFinal
  if (cf?.retentionPlanDefault) return { plan: cf.retentionPlanDefault, source: 'CLIENTE_FINAL' as const }
  if (cf?.integradorId) {
    const contract = await prisma.integradorRetentionContract.findUnique({
      where:   { integradorId: cf.integradorId },
      include: { defaultPlano: true },
    })
    if (contract?.active && contract.defaultPlano)
      return { plan: contract.defaultPlano, source: 'INTEGRADOR' as const }
  }
  return null
}

/** Calcula preço final ao Cliente Final em USD/cam/mês (atacado IACloud × markup INT). */
function computeFinalPriceUsd(plan: { pricePerCameraMonthUsd: Prisma.Decimal }, markupPct: Prisma.Decimal | number): number {
  const base   = Number(plan.pricePerCameraMonthUsd)
  const markup = Number(markupPct)
  return Number((base * (1 + markup / 100)).toFixed(4))
}

// ═════════════════════════════════════════════════════════════════════════════
// CATÁLOGO — Super Admin (CRUD) + lista pública autenticada
// ═════════════════════════════════════════════════════════════════════════════

/** GET /retention/plans — qualquer user autenticado (necessário pra UI). */
retentionRouter.get('/plans', requireAuth, asyncHandler(async (req, res) => {
  const onlyActive = req.query.includeInactive !== 'true'
  const plans = await prisma.retentionPlan.findMany({
    where:   onlyActive ? { active: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { retainDays: 'asc' }, { resolution: 'asc' }],
  })
  res.json({ plans, total: plans.length })
}))

const createPlanSchema = z.object({
  slug:                   z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  name:                   z.string().min(2).max(80),
  retainDays:             z.number().int().min(0).max(365),
  resolution:             z.enum(['ANY', 'VGA', 'HD', 'FHD', 'UHD_4K']),
  pricePerCameraMonthUsd: z.number().positive(),
  costR2EstimatedUsd:     z.number().min(0).optional(),
  description:            z.string().max(500).optional(),
  sortOrder:              z.number().int().min(0).max(9999).default(100),
})

retentionRouter.post('/plans', requireAuth, asyncHandler(async (req, res) => {
  if (!isSuperAdmin(req.jwtPayload.role)) throw new ForbiddenError('Apenas SUPER_ADMIN')
  const data = createPlanSchema.parse(req.body) as Prisma.RetentionPlanCreateInput
  try {
    const plan = await prisma.retentionPlan.create({ data })
    logger.info({ slug: plan.slug, by: req.jwtPayload.sub }, 'retention_plan_created')
    res.status(201).json(plan)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ValidationError('slug ou (resolution+retainDays) já existe')
    }
    throw e
  }
}))

const updatePlanSchema = createPlanSchema.partial().omit({ slug: true })   // slug imutável

retentionRouter.put('/plans/:id', requireAuth, asyncHandler(async (req, res) => {
  if (!isSuperAdmin(req.jwtPayload.role)) throw new ForbiddenError('Apenas SUPER_ADMIN')
  const data = updatePlanSchema.parse(req.body) as Prisma.RetentionPlanUpdateInput
  const plan = await prisma.retentionPlan.update({ where: { id: String(req.params.id) }, data })
  logger.info({ id: plan.id, by: req.jwtPayload.sub }, 'retention_plan_updated')
  res.json(plan)
}))

retentionRouter.delete('/plans/:id', requireAuth, asyncHandler(async (req, res) => {
  if (!isSuperAdmin(req.jwtPayload.role)) throw new ForbiddenError('Apenas SUPER_ADMIN')
  // Soft delete — marca inativo. Não deleta de fato pra preservar referências.
  const plan = await prisma.retentionPlan.update({
    where: { id: String(req.params.id) },
    data:  { active: false },
  })
  logger.info({ id: plan.id, by: req.jwtPayload.sub }, 'retention_plan_soft_deleted')
  res.json({ ok: true, plan })
}))

// ═════════════════════════════════════════════════════════════════════════════
// CONTRATO DO INTEGRADOR — markup + plano default
// ═════════════════════════════════════════════════════════════════════════════

retentionRouter.get('/contract', requireAuth, asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload
  let targetIntegradorId = integradorId
  if (isSuperAdmin(role)) {
    targetIntegradorId = (req.query.integradorId as string) ?? integradorId
  }
  if (!targetIntegradorId) throw new ValidationError('integradorId requerido')

  const contract = await prisma.integradorRetentionContract.findUnique({
    where:   { integradorId: targetIntegradorId },
    include: { defaultPlano: true },
  })
  res.json({ contract, integradorId: targetIntegradorId })
}))

const upsertContractSchema = z.object({
  defaultPlanoId: z.string().uuid(),
  markupPct:      z.number().min(0).max(500),  // até 500% (defensivo)
  notes:          z.string().max(500).optional(),
  active:         z.boolean().optional(),
})

retentionRouter.put('/contract', requireAuth, asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload
  if (!isIntegradorAdmin(role)) throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou SUPER_ADMIN')

  let targetIntegradorId = integradorId
  if (isSuperAdmin(role)) targetIntegradorId = (req.query.integradorId as string) ?? integradorId
  if (!targetIntegradorId) throw new ValidationError('integradorId requerido')

  const data = upsertContractSchema.parse(req.body)

  // valida que o plano default existe e está ativo
  const plan = await prisma.retentionPlan.findUnique({ where: { id: data.defaultPlanoId } })
  if (!plan || !plan.active) throw new ValidationError('Plano inválido ou inativo')

  const contract = await prisma.integradorRetentionContract.upsert({
    where:  { integradorId: targetIntegradorId },
    update: data as Prisma.IntegradorRetentionContractUpdateInput,
    create: { ...data, integradorId: targetIntegradorId } as Prisma.IntegradorRetentionContractUncheckedCreateInput,
    include: { defaultPlano: true },
  })
  logger.info({
    integradorId: targetIntegradorId,
    defaultPlano: plan.slug, markupPct: data.markupPct,
    by: req.jwtPayload.sub,
  }, 'retention_contract_upserted')
  res.json(contract)
}))

// ═════════════════════════════════════════════════════════════════════════════
// ATRIBUIÇÃO — câmera ou cliente final
// ═════════════════════════════════════════════════════════════════════════════

const assignSchema = z.object({
  retentionPlanId: z.string().uuid().nullable(),
})

/** Atribui plano à câmera (override). null = remove override (volta a herdar). */
retentionRouter.post('/cameras/:cameraId/plan', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  const { retentionPlanId } = assignSchema.parse(req.body)

  // Resolve a câmera + tenant — valida acesso
  const cam = await prisma.camera.findUnique({
    where: { id: String(req.params.cameraId) },
    select: {
      id: true, name: true, retentionPlanId: true,
      site: { select: { clienteFinal: { select: { id: true, integradorId: true } } } },
    },
  })
  if (!cam) throw new NotFoundError('Câmera não encontrada')
  const camIntegradorId  = cam.site.clienteFinal.integradorId
  const camClienteFinalId = cam.site.clienteFinal.id

  // RBAC: CLIENTE_ADMIN do próprio cliente, INTEGRADOR_* do tenant, SUPER_ADMIN
  if (!isSuperAdmin(p.role)
      && !(isIntegradorAdmin(p.role) && p.integradorId === camIntegradorId)
      && !(p.role === 'CLIENTE_ADMIN' && p.clienteFinalId === camClienteFinalId)) {
    throw new ForbiddenError('Sem permissão para alterar plano desta câmera')
  }

  // Se um plano novo foi especificado, valida e cria o histórico de upgrade
  if (retentionPlanId) {
    const newPlan = await prisma.retentionPlan.findUnique({ where: { id: retentionPlanId } })
    if (!newPlan || !newPlan.active) throw new ValidationError('Plano inválido ou inativo')

    await prisma.$transaction([
      prisma.retentionUpgradeRequest.create({
        data: {
          cameraId:       cam.id,
          fromPlanoId:    cam.retentionPlanId,
          toPlanoId:      retentionPlanId,
          status:         'AUTO_APPROVED',
          requestedById:  p.sub,
          decidedById:    p.sub,
          decidedAt:      new Date(),
          decisionNote:   'Auto-aprovado (Sprint 2 — workflow não ativado)',
        },
      }),
      prisma.camera.update({
        where: { id: cam.id },
        data:  { retentionPlanId },
      }),
    ])
  } else {
    // Remoção do override — sem registro de upgrade (não muda plano efetivo materialmente)
    await prisma.camera.update({ where: { id: cam.id }, data: { retentionPlanId: null } })
  }

  const effective = await resolveEffectivePlan(cam.id)
  res.json({ ok: true, cameraId: cam.id, effective })
}))

/** Define plano default de TODAS as câmeras do cliente que não têm override. */
retentionRouter.post('/clientes/:cfId/plan', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  const { retentionPlanId } = assignSchema.parse(req.body)

  const cf = await prisma.clienteFinal.findUnique({
    where:  { id: String(req.params.cfId) },
    select: { id: true, integradorId: true, retentionPlanDefaultId: true },
  })
  if (!cf) throw new NotFoundError('Cliente final não encontrado')

  if (!isSuperAdmin(p.role)
      && !(isIntegradorAdmin(p.role) && p.integradorId === cf.integradorId)
      && !(p.role === 'CLIENTE_ADMIN' && p.clienteFinalId === cf.id)) {
    throw new ForbiddenError('Sem permissão para alterar plano deste cliente')
  }

  if (retentionPlanId) {
    const newPlan = await prisma.retentionPlan.findUnique({ where: { id: retentionPlanId } })
    if (!newPlan || !newPlan.active) throw new ValidationError('Plano inválido ou inativo')

    await prisma.$transaction([
      prisma.retentionUpgradeRequest.create({
        data: {
          clienteFinalId: cf.id,
          fromPlanoId:    cf.retentionPlanDefaultId,
          toPlanoId:      retentionPlanId,
          status:         'AUTO_APPROVED',
          requestedById:  p.sub,
          decidedById:    p.sub,
          decidedAt:      new Date(),
          decisionNote:   'Auto-aprovado (Sprint 2 — workflow não ativado)',
        },
      }),
      prisma.clienteFinal.update({
        where: { id: cf.id },
        data:  { retentionPlanDefaultId: retentionPlanId },
      }),
    ])
  } else {
    await prisma.clienteFinal.update({ where: { id: cf.id }, data: { retentionPlanDefaultId: null } })
  }
  res.json({ ok: true, clienteFinalId: cf.id })
}))

// ═════════════════════════════════════════════════════════════════════════════
// UPGRADE REQUESTS — histórico (auto-approved no MVP)
// ═════════════════════════════════════════════════════════════════════════════

retentionRouter.get('/upgrade-requests', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  const where: Prisma.RetentionUpgradeRequestWhereInput = {}
  if (p.role.startsWith('CLIENTE_')) {
    where.OR = [
      { clienteFinalId: p.clienteFinalId ?? '' },
      { camera: { site: { clienteFinalId: p.clienteFinalId ?? '' } } },
    ]
  } else if (p.role.startsWith('INTEGRADOR_')) {
    where.OR = [
      { clienteFinal: { integradorId: p.integradorId ?? '' } },
      { camera: { site: { clienteFinal: { integradorId: p.integradorId ?? '' } } } },
    ]
  }
  // SUPER_ADMIN: sem filtro

  const items = await prisma.retentionUpgradeRequest.findMany({
    where, orderBy: { requestedAt: 'desc' }, take: 100,
    include: {
      fromPlano:   { select: { slug: true, name: true } },
      toPlano:     { select: { slug: true, name: true, pricePerCameraMonthUsd: true } },
      camera:      { select: { id: true, name: true } },
      clienteFinal: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
    },
  })
  res.json({ items, total: items.length })
}))

// ═════════════════════════════════════════════════════════════════════════════
// EFFECTIVE PLAN — pra UI mostrar o plano em vigor + origem
// ═════════════════════════════════════════════════════════════════════════════

retentionRouter.get('/cameras/:cameraId/effective-plan', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  const cam = await prisma.camera.findUnique({
    where:  { id: String(req.params.cameraId) },
    select: { id: true, site: { select: { clienteFinal: { select: { id: true, integradorId: true } } } } },
  })
  if (!cam) throw new NotFoundError('Câmera não encontrada')
  const camIntegradorId   = cam.site.clienteFinal.integradorId
  const camClienteFinalId = cam.site.clienteFinal.id

  if (!isSuperAdmin(p.role)
      && !(p.role.startsWith('INTEGRADOR_') && p.integradorId === camIntegradorId)
      && !(p.role.startsWith('CLIENTE_')    && p.clienteFinalId === camClienteFinalId)) {
    throw new ForbiddenError('Sem acesso a esta câmera')
  }

  const effective = await resolveEffectivePlan(cam.id)
  if (!effective) {
    return res.json({ effective: null, reason: 'no_plan_configured' })
  }

  // Calcula preço final aplicando markup do integrador
  const contract = await prisma.integradorRetentionContract.findUnique({
    where: { integradorId: camIntegradorId },
  })
  const markupPct = contract?.markupPct ?? new Prisma.Decimal(30)
  const finalUsd  = computeFinalPriceUsd(effective.plan, markupPct)
  const usdBrl    = Number(process.env.USD_BRL_RATE ?? 5.30)
  const finalBrl  = Number((finalUsd * usdBrl).toFixed(2))

  res.json({
    effective: {
      plan:      effective.plan,
      source:    effective.source,         // 'CAMERA' | 'CLIENTE_FINAL' | 'INTEGRADOR'
      markupPct: Number(markupPct),
      pricePerCameraMonthUsd: Number(effective.plan.pricePerCameraMonthUsd),
      finalPriceUsd: finalUsd,
      finalPriceBrl: finalBrl,
    },
  })
}))
