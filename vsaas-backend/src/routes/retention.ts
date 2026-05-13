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
import { sendMail } from '../lib/smtp'

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

/**
 * A6 (2026-05-09) — Notifica admins do integrador sobre um pedido de
 * upgrade pendente. Best-effort: falha silenciosa, não trava o request.
 *
 * Busca emails dos usuários INTEGRADOR_ADMIN do tenant + opcional integrador.email.
 * Dispara 1 email plain-text com link pro /billing onde o pedido aparece.
 */
async function notifyIntegradorOfPendingUpgrade(args: {
  integradorId:   string
  requestId:      string
  cameraId?:      string | null
  clienteFinalId?: string | null
  fromPlanoSlug?: string | null
  toPlanoSlug:    string
  deltaBrl:       number
}): Promise<void> {
  try {
    const [integrador, admins, ctxCamera, ctxCliente] = await Promise.all([
      prisma.integrador.findUnique({
        where: { id: args.integradorId },
        select: { name: true, email: true, tradeName: true },
      }),
      prisma.user.findMany({
        where: { integradorId: args.integradorId, role: 'INTEGRADOR_ADMIN', active: true },
        select: { email: true, name: true },
      }),
      args.cameraId
        ? prisma.camera.findUnique({ where: { id: args.cameraId }, select: { name: true } })
        : Promise.resolve(null),
      args.clienteFinalId
        ? prisma.clienteFinal.findUnique({ where: { id: args.clienteFinalId }, select: { name: true } })
        : Promise.resolve(null),
    ])

    const recipients = new Set<string>()
    for (const u of admins) if (u.email) recipients.add(u.email)
    if (integrador?.email) recipients.add(integrador.email)
    if (recipients.size === 0) {
      logger.warn({ integradorId: args.integradorId, requestId: args.requestId },
        'retention_pending_no_recipients')
      return
    }

    const scope = ctxCamera
      ? `câmera "${ctxCamera.name}"`
      : ctxCliente
        ? `cliente "${ctxCliente.name}"`
        : 'um recurso'
    const deltaStr = args.deltaBrl > 0
      ? `aumento de R$ ${args.deltaBrl.toFixed(2)}/mês`
      : args.deltaBrl < 0
        ? `redução de R$ ${Math.abs(args.deltaBrl).toFixed(2)}/mês`
        : 'sem variação de preço'

    const subject = `[VSaaS] Pedido de upgrade de retenção aguardando sua aprovação`
    const dashboardUrl = (process.env.PUBLIC_FRONTEND_URL ?? 'https://app.iacloud.com.br')
      .replace(/\/login$/, '') + '/billing'

    const text = [
      `Olá ${integrador?.tradeName ?? integrador?.name ?? 'time'},`,
      ``,
      `Um pedido de mudança de plano de retenção está aguardando sua aprovação:`,
      ``,
      `  • Escopo: ${scope}`,
      `  • Plano novo: ${args.toPlanoSlug}` +
        (args.fromPlanoSlug ? ` (antes: ${args.fromPlanoSlug})` : ''),
      `  • Impacto financeiro: ${deltaStr}`,
      ``,
      `Aprovar ou negar em: ${dashboardUrl}`,
      ``,
      `— VSaaS`,
    ].join('\n')

    await Promise.all([...recipients].map(to =>
      sendMail({ to, subject, text }).catch(err =>
        logger.warn({ err, to, requestId: args.requestId },
          'retention_pending_email_failed'),
      ),
    ))
    logger.info({
      requestId: args.requestId,
      integradorId: args.integradorId,
      recipientCount: recipients.size,
    }, 'retention_pending_notified')
  } catch (err) {
    logger.warn({ err, requestId: args.requestId },
      'retention_pending_notify_failed')
  }
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
// ATRIBUIÇÃO — câmera ou cliente final (Sprint 4: auto-approve híbrido + downgrade Opção 3)
// ═════════════════════════════════════════════════════════════════════════════

const assignSchema = z.object({
  retentionPlanId: z.string().uuid().nullable(),
  /// Sprint 4: comportamento de downgrade (Opção 3 — cliente escolhe)
  /// - 'soft' (default): segmentos antigos vivem até expirarem naturalmente.
  ///   Cobrança híbrida no mês corrente até estabilizar.
  /// - 'immediate': segmentos > nova retenção são marcados pra deleção imediata.
  ///   Cobrança nova começa no próximo mês (sem reembolso do mês atual).
  /// Ignorado se a mudança for upgrade (sempre soft naturalmente).
  downgradeBehavior: z.enum(['soft', 'immediate']).default('soft'),
})

/**
 * Sprint 4 — Decide se uma mudança de plano deve ser AUTO_APPROVED ou
 * PENDING_INTEGRADOR baseado nas regras híbridas do contract.
 *
 * Regras (todas configuráveis pelo integrador):
 *   - Downgrade (toPlano.dias < fromPlano.dias) → SEMPRE auto-aprovado
 *   - Upgrade com Δpreço ≤ autoApproveUpgradeLimitBrl → auto
 *   - Resolução do toPlano > autoApproveResolutionMax → pendente
 *   - retainDays do toPlano > autoApproveRetainDaysMax → pendente
 *   - Caso contrário (Δpreço > limit) → pendente
 */
async function decideUpgradeStatus(args: {
  fromPlanoId: string | null
  toPlanoId:   string
  integradorId: string
  usdBrlRate?: number
}): Promise<{
  status:    'AUTO_APPROVED' | 'PENDING_INTEGRADOR'
  reason:    string
  deltaBrl:  number
}> {
  const usdBrl = args.usdBrlRate ?? Number(process.env.USD_BRL_RATE ?? 5.30)

  const [contract, fromPlan, toPlan] = await Promise.all([
    prisma.integradorRetentionContract.findUnique({ where: { integradorId: args.integradorId } }),
    args.fromPlanoId
      ? prisma.retentionPlan.findUnique({ where: { id: args.fromPlanoId } })
      : Promise.resolve(null),
    prisma.retentionPlan.findUnique({ where: { id: args.toPlanoId } }),
  ])
  if (!toPlan) return { status: 'PENDING_INTEGRADOR', reason: 'plan_not_found', deltaBrl: 0 }

  const fromUsd = fromPlan ? Number(fromPlan.pricePerCameraMonthUsd) : 0
  const toUsd   = Number(toPlan.pricePerCameraMonthUsd)
  const deltaBrl = Number(((toUsd - fromUsd) * usdBrl).toFixed(2))

  // Regra 1: downgrade (preço cai) → sempre auto-aprovado
  if (deltaBrl <= 0) return { status: 'AUTO_APPROVED', reason: 'downgrade', deltaBrl }

  // Sem contract = usar defaults (auto até R$ 100, FHD, 90d)
  const limitBrl       = contract?.autoApproveUpgradeLimitBrl ? Number(contract.autoApproveUpgradeLimitBrl) : 100
  const resolutionMax  = contract?.autoApproveResolutionMax ?? 'FHD'
  const retainDaysMax  = contract?.autoApproveRetainDaysMax ?? 90

  // Regra 2: resolução acima do limite → pendente
  const resOrder: Record<string, number> = { ANY: 0, VGA: 1, HD: 2, FHD: 3, UHD_4K: 4 }
  if ((resOrder[toPlan.resolution] ?? 99) > (resOrder[resolutionMax] ?? 99)) {
    return { status: 'PENDING_INTEGRADOR', reason: 'resolution_above_limit', deltaBrl }
  }

  // Regra 3: retainDays acima do limite → pendente
  if (toPlan.retainDays > retainDaysMax) {
    return { status: 'PENDING_INTEGRADOR', reason: 'retain_days_above_limit', deltaBrl }
  }

  // Regra 4: Δpreço acima do limite → pendente
  if (deltaBrl > limitBrl) {
    return { status: 'PENDING_INTEGRADOR', reason: 'delta_above_limit', deltaBrl }
  }

  // Caso contrário → auto
  return { status: 'AUTO_APPROVED', reason: 'within_limits', deltaBrl }
}

/** Atribui plano à câmera (override). null = remove override (volta a herdar). */
retentionRouter.post('/cameras/:cameraId/plan', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  const { retentionPlanId, downgradeBehavior } = assignSchema.parse(req.body)

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

    // Sprint 4 — decide auto vs pendente. INTEGRADOR_ADMIN/SUPER_ADMIN força auto
    // (são quem aprovaria de qualquer jeito).
    const decision = isIntegradorAdmin(p.role)
      ? { status: 'AUTO_APPROVED' as const, reason: 'admin_override', deltaBrl: 0 }
      : await decideUpgradeStatus({
          fromPlanoId:  cam.retentionPlanId,
          toPlanoId:    retentionPlanId,
          integradorId: camIntegradorId,
        })

    if (decision.status === 'AUTO_APPROVED') {
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
            decisionNote:   `Auto-aprovado: ${decision.reason} (Δ R$ ${decision.deltaBrl.toFixed(2)}, downgrade: ${downgradeBehavior})`,
          },
        }),
        prisma.camera.update({
          where: { id: cam.id },
          data:  { retentionPlanId },
        }),
      ])
      const effective = await resolveEffectivePlan(cam.id)
      return res.json({
        ok: true, cameraId: cam.id, effective,
        decision: { status: 'AUTO_APPROVED', reason: decision.reason, deltaBrl: decision.deltaBrl, downgradeBehavior },
      })
    }

    // PENDING_INTEGRADOR — não muda Camera.retentionPlanId ainda
    const request = await prisma.retentionUpgradeRequest.create({
      data: {
        cameraId:       cam.id,
        fromPlanoId:    cam.retentionPlanId,
        toPlanoId:      retentionPlanId,
        status:         'PENDING_INTEGRADOR',
        requestedById:  p.sub,
        decisionNote:   `Aguarda aprovação INT: ${decision.reason} (Δ R$ ${decision.deltaBrl.toFixed(2)})`,
      },
    })
    // A6: notifica integrador async (não bloqueia resposta)
    const fromPlanForEmail = cam.retentionPlanId
      ? await prisma.retentionPlan.findUnique({
          where: { id: cam.retentionPlanId },
          select: { slug: true },
        })
      : null
    notifyIntegradorOfPendingUpgrade({
      integradorId:   camIntegradorId,
      requestId:      request.id,
      cameraId:       cam.id,
      fromPlanoSlug:  fromPlanForEmail?.slug ?? null,
      toPlanoSlug:    newPlan.slug,
      deltaBrl:       decision.deltaBrl,
    }).catch(() => {})

    return res.status(202).json({
      ok: true, requestId: request.id,
      decision: { status: 'PENDING_INTEGRADOR', reason: decision.reason, deltaBrl: decision.deltaBrl },
      message: 'Pedido enviado para aprovação do integrador',
    })
  } else {
    // Remoção do override — sem registro de upgrade (não muda plano efetivo materialmente)
    await prisma.camera.update({ where: { id: cam.id }, data: { retentionPlanId: null } })
    const effective = await resolveEffectivePlan(cam.id)
    return res.json({ ok: true, cameraId: cam.id, effective })
  }
}))

/** Define plano default de TODAS as câmeras do cliente que não têm override. */
retentionRouter.post('/clientes/:cfId/plan', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  const { retentionPlanId, downgradeBehavior } = assignSchema.parse(req.body)

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

    // Sprint 4 — auto-approve híbrido (mesma lógica do /cameras/plan)
    const decision = isIntegradorAdmin(p.role)
      ? { status: 'AUTO_APPROVED' as const, reason: 'admin_override', deltaBrl: 0 }
      : await decideUpgradeStatus({
          fromPlanoId:  cf.retentionPlanDefaultId,
          toPlanoId:    retentionPlanId,
          integradorId: cf.integradorId,
        })

    if (decision.status === 'AUTO_APPROVED') {
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
            decisionNote:   `Auto-aprovado: ${decision.reason} (Δ R$ ${decision.deltaBrl.toFixed(2)}, downgrade: ${downgradeBehavior})`,
          },
        }),
        prisma.clienteFinal.update({
          where: { id: cf.id },
          data:  { retentionPlanDefaultId: retentionPlanId },
        }),
      ])
      return res.json({
        ok: true, clienteFinalId: cf.id,
        decision: { status: 'AUTO_APPROVED', reason: decision.reason, deltaBrl: decision.deltaBrl, downgradeBehavior },
      })
    }

    // PENDING_INTEGRADOR — não aplica ainda
    const request = await prisma.retentionUpgradeRequest.create({
      data: {
        clienteFinalId: cf.id,
        fromPlanoId:    cf.retentionPlanDefaultId,
        toPlanoId:      retentionPlanId,
        status:         'PENDING_INTEGRADOR',
        requestedById:  p.sub,
        decisionNote:   `Aguarda aprovação INT: ${decision.reason} (Δ R$ ${decision.deltaBrl.toFixed(2)})`,
      },
    })
    // A6: notifica integrador async
    const fromPlanForEmail = cf.retentionPlanDefaultId
      ? await prisma.retentionPlan.findUnique({
          where: { id: cf.retentionPlanDefaultId },
          select: { slug: true },
        })
      : null
    notifyIntegradorOfPendingUpgrade({
      integradorId:   cf.integradorId,
      requestId:      request.id,
      clienteFinalId: cf.id,
      fromPlanoSlug:  fromPlanForEmail?.slug ?? null,
      toPlanoSlug:    newPlan.slug,
      deltaBrl:       decision.deltaBrl,
    }).catch(() => {})

    return res.status(202).json({
      ok: true, requestId: request.id,
      decision: { status: 'PENDING_INTEGRADOR', reason: decision.reason, deltaBrl: decision.deltaBrl },
      message: 'Pedido enviado para aprovação do integrador',
    })
  } else {
    await prisma.clienteFinal.update({ where: { id: cf.id }, data: { retentionPlanDefaultId: null } })
    return res.json({ ok: true, clienteFinalId: cf.id })
  }
}))

/**
 * POST /retention/upgrade-requests/:id/decide
 * Integrador aprova / rejeita pedido pendente.
 */
const decideSchema = z.object({
  decision:     z.enum(['APPROVED', 'DENIED']),
  decisionNote: z.string().max(500).optional(),
})

retentionRouter.post('/upgrade-requests/:id/decide', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  if (!isIntegradorAdmin(p.role)) throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou SUPER_ADMIN pode decidir')

  const { decision, decisionNote } = decideSchema.parse(req.body)

  const request = await prisma.retentionUpgradeRequest.findUnique({
    where: { id: String(req.params.id) },
    include: {
      camera: { select: { id: true, site: { select: { clienteFinal: { select: { integradorId: true } } } } } },
      clienteFinal: { select: { id: true, integradorId: true } },
    },
  })
  if (!request) throw new NotFoundError('Pedido não encontrado')
  if (request.status !== 'PENDING_INTEGRADOR') {
    throw new ValidationError(`Pedido já foi decidido (status atual: ${request.status})`)
  }

  // RBAC — apenas o INT do tenant ou SA
  const tenantId = request.camera?.site.clienteFinal.integradorId ?? request.clienteFinal?.integradorId
  if (!isSuperAdmin(p.role) && p.integradorId !== tenantId) {
    throw new ForbiddenError('Você só pode decidir pedidos do seu tenant')
  }

  // Atualiza request + aplica plano (se APPROVED)
  if (decision === 'APPROVED') {
    await prisma.$transaction(async (tx) => {
      await tx.retentionUpgradeRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          decidedById: p.sub,
          decidedAt: new Date(),
          decisionNote: decisionNote ?? 'Aprovado pelo integrador',
        },
      })
      if (request.cameraId) {
        await tx.camera.update({
          where: { id: request.cameraId },
          data:  { retentionPlanId: request.toPlanoId },
        })
      } else if (request.clienteFinalId) {
        await tx.clienteFinal.update({
          where: { id: request.clienteFinalId },
          data:  { retentionPlanDefaultId: request.toPlanoId },
        })
      }
    })
    logger.info({ requestId: request.id, by: p.sub }, 'retention_upgrade_approved')
  } else {
    await prisma.retentionUpgradeRequest.update({
      where: { id: request.id },
      data: {
        status: 'DENIED',
        decidedById: p.sub,
        decidedAt: new Date(),
        decisionNote: decisionNote ?? 'Negado pelo integrador',
      },
    })
    logger.info({ requestId: request.id, by: p.sub }, 'retention_upgrade_denied')
  }

  res.json({ ok: true, requestId: request.id, decision })
}))

// ═════════════════════════════════════════════════════════════════════════════
// UPGRADE REQUESTS — histórico (auto-approved no MVP)
// ═════════════════════════════════════════════════════════════════════════════

retentionRouter.get('/upgrade-requests', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  const where: Prisma.RetentionUpgradeRequestWhereInput = {}

  // RBAC: filtro de tenant
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
  // SUPER_ADMIN: sem filtro de tenant

  // B4 (2026-05-09): filtros opcionais por query string pra UIs
  // específicas (timeline por câmera, lista por cliente, status pendente).
  if (req.query.cameraId) {
    where.cameraId = String(req.query.cameraId)
  }
  if (req.query.clienteFinalId) {
    where.clienteFinalId = String(req.query.clienteFinalId)
  }
  if (req.query.status) {
    const s = String(req.query.status).toUpperCase()
    if (['AUTO_APPROVED', 'PENDING_INTEGRADOR', 'APPROVED', 'DENIED', 'CANCELED'].includes(s)) {
      where.status = s as any
    }
  }
  const take = Math.min(500, Math.max(1, Number(req.query.limit) || 100))

  const items = await prisma.retentionUpgradeRequest.findMany({
    where, orderBy: { requestedAt: 'desc' }, take,
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

// ═════════════════════════════════════════════════════════════════════════════
// A1 (2026-05-09) — EFFECTIVE PLAN AGREGADO POR CLIENTE FINAL
// Retorna o "plano dominante" + total mensal estimado considerando câmeras
// de uma clienteFinalId. Resolve cada câmera via resolveEffectivePlan,
// agrupa por planoId, devolve o plano com mais câmeras + o custo agregado.
// ═════════════════════════════════════════════════════════════════════════════

retentionRouter.get('/clientes/:cfId/effective-plan', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  const cfId = String(req.params.cfId)

  const cf = await prisma.clienteFinal.findUnique({
    where:  { id: cfId },
    select: { id: true, integradorId: true },
  })
  if (!cf) throw new NotFoundError('Cliente final não encontrado')

  // RBAC: SUPER_ADMIN sempre; INTEGRADOR_* do tenant; CLIENTE_* do próprio.
  if (!isSuperAdmin(p.role)
      && !(p.role.startsWith('INTEGRADOR_') && p.integradorId === cf.integradorId)
      && !(p.role.startsWith('CLIENTE_')    && p.clienteFinalId === cfId)) {
    throw new ForbiddenError('Sem acesso a este cliente final')
  }

  // Lista câmeras ativas + gravando do cliente
  const cameras = await prisma.camera.findMany({
    where: {
      site: { clienteFinalId: cfId },
      active: true,
      recordEnabled: true,
    },
    select: { id: true },
  })

  // Resolve plano efetivo de cada uma — paralelo
  const resolved = await Promise.all(
    cameras.map(async c => ({ cameraId: c.id, eff: await resolveEffectivePlan(c.id) })),
  )

  // Agrupa por plano + identifica dominante
  const byPlan = new Map<string, {
    planId: string
    plan: any
    source: 'CAMERA' | 'CLIENTE_FINAL' | 'INTEGRADOR'
    count: number
  }>()
  for (const r of resolved) {
    if (!r.eff) continue
    const k = r.eff.plan.id
    const existing = byPlan.get(k)
    if (existing) {
      existing.count++
      // se mais de uma origem, prevalece a mais específica
      const priority = { CAMERA: 3, CLIENTE_FINAL: 2, INTEGRADOR: 1 }
      if (priority[r.eff.source] > priority[existing.source]) existing.source = r.eff.source
    } else {
      byPlan.set(k, { planId: k, plan: r.eff.plan, source: r.eff.source, count: 1 })
    }
  }

  // Dominante (mais câmeras). Empate → mantém o primeiro.
  const groups = [...byPlan.values()].sort((a, b) => b.count - a.count)
  const dominant = groups[0] ?? null

  // Cálculo de custo total mensal aplicando markup do integrador
  const contract = await prisma.integradorRetentionContract.findUnique({
    where: { integradorId: cf.integradorId },
  })
  const markupPct = contract?.markupPct ?? new Prisma.Decimal(30)
  const usdBrl    = Number(process.env.USD_BRL_RATE ?? 5.30)

  let totalMonthlyBrl = 0
  for (const g of groups) {
    const finalUsd = computeFinalPriceUsd(g.plan, markupPct)
    totalMonthlyBrl += finalUsd * usdBrl * g.count
  }

  res.json({
    clienteFinalId: cfId,
    cameraCount:    cameras.length,
    coveredCount:   resolved.filter(r => r.eff).length,
    uncoveredCount: resolved.filter(r => !r.eff).length,
    markupPct:      Number(markupPct),
    usdBrlRate:     usdBrl,
    totalMonthlyBrl: Number(totalMonthlyBrl.toFixed(2)),
    dominant: dominant ? {
      plan:        dominant.plan,
      source:      dominant.source,
      cameraCount: dominant.count,
      finalPriceUsd: computeFinalPriceUsd(dominant.plan, markupPct),
      finalPriceBrl: Number((computeFinalPriceUsd(dominant.plan, markupPct) * usdBrl).toFixed(2)),
    } : null,
    breakdown: groups.map(g => ({
      planId:        g.planId,
      planName:      g.plan.name,
      planSlug:      g.plan.slug,
      retainDays:    g.plan.retainDays,
      resolution:    g.plan.resolution,
      cameraCount:   g.count,
      source:        g.source,
      finalPriceUsd: computeFinalPriceUsd(g.plan, markupPct),
      finalPriceBrl: Number((computeFinalPriceUsd(g.plan, markupPct) * usdBrl).toFixed(2)),
      subtotalBrl:   Number((computeFinalPriceUsd(g.plan, markupPct) * usdBrl * g.count).toFixed(2)),
    })),
  })
}))

// ═════════════════════════════════════════════════════════════════════════════
// A5 (2026-05-09) — LISTA CÂMERAS × PLANO EFETIVO (integrador / super admin)
// Tabela compacta pra UI de gestão (com paginação simples).
// ═════════════════════════════════════════════════════════════════════════════

retentionRouter.get('/cameras', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload
  if (!isIntegradorAdmin(p.role) && p.role !== 'CLIENTE_ADMIN') {
    throw new ForbiddenError('Apenas INTEGRADOR_ADMIN, CLIENTE_ADMIN ou SUPER_ADMIN')
  }

  // Filtros de escopo
  const where: Record<string, unknown> = { active: true }
  if (isSuperAdmin(p.role)) {
    if (req.query.integradorId) {
      where.site = { clienteFinal: { integradorId: String(req.query.integradorId) } }
    }
  } else if (p.role.startsWith('INTEGRADOR_')) {
    if (!p.integradorId) throw new ValidationError('Token sem integradorId')
    where.site = { clienteFinal: { integradorId: p.integradorId } }
  } else if (p.role === 'CLIENTE_ADMIN') {
    if (!p.clienteFinalId) throw new ValidationError('Token sem clienteFinalId')
    where.site = { clienteFinalId: p.clienteFinalId }
  }

  // Filtro opcional por clienteFinalId (super admin / integrador)
  if (req.query.clienteFinalId) {
    where.site = { clienteFinalId: String(req.query.clienteFinalId) }
  }

  const cams = await prisma.camera.findMany({
    where: where as any,
    select: {
      id: true, name: true,
      recordEnabled: true,
      recordRetainDays: true,
      retentionPlanId: true,
      site: {
        select: {
          name: true,
          clienteFinal: { select: { id: true, name: true, integradorId: true } },
        },
      },
    },
    orderBy: [{ name: 'asc' }],
    take: 500,
  })

  // Resolve plano efetivo de cada câmera + custo
  const resolved = await Promise.all(cams.map(async cam => {
    const eff = await resolveEffectivePlan(cam.id)
    return { cam, eff }
  }))

  // Carrega contratos uma vez por integradorId
  const integradorIds = [...new Set(resolved
    .map(r => r.cam.site.clienteFinal.integradorId)
    .filter((x): x is string => !!x))]
  const contracts = await prisma.integradorRetentionContract.findMany({
    where: { integradorId: { in: integradorIds } },
  })
  const contractByInt = new Map(contracts.map(c => [c.integradorId, c]))
  const usdBrl = Number(process.env.USD_BRL_RATE ?? 5.30)

  const items = resolved.map(({ cam, eff }) => {
    const contract = contractByInt.get(cam.site.clienteFinal.integradorId)
    const markupPct = contract?.markupPct ?? new Prisma.Decimal(30)
    const finalUsd = eff ? computeFinalPriceUsd(eff.plan, markupPct) : 0
    const finalBrl = finalUsd * usdBrl
    return {
      cameraId:    cam.id,
      cameraName:  cam.name,
      siteName:    cam.site.name,
      clienteName: cam.site.clienteFinal.name,
      clienteFinalId: cam.site.clienteFinal.id,
      hasOverride: !!cam.retentionPlanId,
      legacyRetainDays: cam.recordRetainDays,
      plan: eff ? {
        id:         eff.plan.id,
        name:       eff.plan.name,
        slug:       eff.plan.slug,
        retainDays: eff.plan.retainDays,
        resolution: eff.plan.resolution,
        source:     eff.source,
      } : null,
      finalPriceBrl: Number(finalBrl.toFixed(2)),
      markupPct:     Number(markupPct),
    }
  })

  // Stats agregados
  const totalMonthlyBrl = items.reduce((s, i) => s + i.finalPriceBrl, 0)
  const withPlan    = items.filter(i => i.plan).length
  const withoutPlan = items.length - withPlan

  res.json({
    items,
    total: items.length,
    stats: {
      withPlan,
      withoutPlan,
      totalMonthlyBrl: Number(totalMonthlyBrl.toFixed(2)),
    },
  })
}))
