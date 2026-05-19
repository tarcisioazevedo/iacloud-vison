import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, ValidationError, NotFoundError } from '../lib/errors'
import { logger } from '../lib/logger'
import { sendMail } from '../lib/smtp'

export const marketplaceRouter = Router()

const USD_BRL = Number(process.env.USD_BRL_RATE ?? 5.30)

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function isSuperAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
}

function isIntegradorAdmin(role: string): boolean {
  return role === 'INTEGRADOR_ADMIN' || isSuperAdmin(role)
}

function isClienteAdmin(role: string): boolean {
  return role === 'CLIENTE_ADMIN' || isIntegradorAdmin(role)
}

async function resolveIntegradorId(req: Express.Request & { jwtPayload?: any }): Promise<string | null> {
  const jwt = req.jwtPayload
  if (!jwt) return null
  if (jwt.integradorId) return jwt.integradorId
  if (jwt.clienteFinalId) {
    const cf = await prisma.clienteFinal.findUnique({
      where: { id: jwt.clienteFinalId },
      select: { integradorId: true },
    })
    return cf?.integradorId ?? null
  }
  return null
}

async function resolveClienteFinalId(req: any, queryParam?: string): Promise<string | null> {
  const jwt = req.jwtPayload
  if (!jwt) return null

  if (jwt.clienteFinalId) return jwt.clienteFinalId

  if (isIntegradorAdmin(jwt.role) && queryParam) return queryParam

  return null
}

async function getMarkupForIntegrador(integradorId: string): Promise<number> {
  const contract = await prisma.integradorRetentionContract.findUnique({
    where: { integradorId },
    select: { markupPct: true },
  })
  return Number(contract?.markupPct ?? 30)
}

/**
 * Notifica usuários ativos de um clienteFinal por e-mail.
 * Best-effort: falha silenciosa, nunca bloqueia a resposta.
 */
async function notifySubscriptionUsers(
  clienteFinalId: string,
  subject: string,
  text: string,
): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: { clienteFinalId, active: true },
      select: { email: true },
    })
    await Promise.all(
      users
        .filter(u => u.email)
        .map(u => sendMail({ to: u.email!, subject, text }).catch(() => {})),
    )
  } catch { /* best-effort */ }
}

/**
 * Notifica admins do integrador sobre um pedido de upgrade pendente de assinatura.
 * Padrão copiado de retention.ts > notifyIntegradorOfPendingUpgrade.
 */
async function notifyIntegradorOfPendingUpgrade(args: {
  integradorId: string
  requestId: string
  clienteFinalId?: string | null
  fromProductName?: string | null
  toProductName: string
  deltaBrl: number
}): Promise<void> {
  try {
    const [integrador, admins, ctxCliente] = await Promise.all([
      prisma.integrador.findUnique({
        where: { id: args.integradorId },
        select: { name: true, email: true, tradeName: true },
      }),
      prisma.user.findMany({
        where: { integradorId: args.integradorId, role: 'INTEGRADOR_ADMIN', active: true },
        select: { email: true, name: true },
      }),
      args.clienteFinalId
        ? prisma.clienteFinal.findUnique({ where: { id: args.clienteFinalId }, select: { name: true } })
        : Promise.resolve(null),
    ])

    const recipients = new Set<string>()
    for (const u of admins) if (u.email) recipients.add(u.email)
    if (integrador?.email) recipients.add(integrador.email)
    if (recipients.size === 0) {
      logger.warn({ integradorId: args.integradorId, requestId: args.requestId },
        'marketplace_pending_no_recipients')
      return
    }

    const scope = ctxCliente ? `cliente "${ctxCliente.name}"` : 'um cliente'
    const deltaStr = args.deltaBrl > 0
      ? `aumento de R$ ${args.deltaBrl.toFixed(2)}/mês`
      : `redução de R$ ${Math.abs(args.deltaBrl).toFixed(2)}/mês`

    const dashboardUrl = (process.env.PUBLIC_FRONTEND_URL ?? 'https://app.iacloud.com.br')
      .replace(/\/login$/, '') + '/billing'

    const subject = `[VSaaS] Pedido de upgrade de assinatura aguardando sua aprovação`
    const text = [
      `Olá ${integrador?.tradeName ?? integrador?.name ?? 'time'},`,
      ``,
      `Um pedido de mudança de assinatura está aguardando sua aprovação:`,
      ``,
      `  • Escopo: ${scope}`,
      `  • Produto novo: ${args.toProductName}` +
        (args.fromProductName ? ` (antes: ${args.fromProductName})` : ''),
      `  • Impacto financeiro: ${deltaStr}`,
      ``,
      `Aprovar ou negar em: ${dashboardUrl}`,
      ``,
      `— VSaaS`,
    ].join('\n')

    await Promise.all([...recipients].map(to =>
      sendMail({ to, subject, text }).catch(err =>
        logger.warn({ err, to, requestId: args.requestId }, 'marketplace_pending_email_failed'),
      ),
    ))
    logger.info({
      requestId: args.requestId,
      integradorId: args.integradorId,
      recipientCount: recipients.size,
    }, 'marketplace_pending_notified')
  } catch (err) {
    logger.warn({ err, requestId: args.requestId }, 'marketplace_pending_notify_failed')
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /marketplace/products
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/products',
  requireAuth,
  asyncHandler(async (req, res) => {
    const includeComingSoon = req.query.includeComingSoon === 'true'

    const products = await prisma.marketplaceProduct.findMany({
      where: includeComingSoon ? undefined : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    res.json({ products })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// GET /marketplace/products/:slug
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/products/:slug',
  requireAuth,
  asyncHandler(async (req, res) => {
    const product = await prisma.marketplaceProduct.findUnique({
      where: { slug: String(req.params.slug) },
    })
    if (!product) throw new NotFoundError('Produto não encontrado')
    res.json({ product })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /marketplace/waitlist
// ═════════════════════════════════════════════════════════════════════════════

const waitlistSchema = z.object({
  productSlug: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
})

marketplaceRouter.post(
  '/waitlist',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = waitlistSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

    const { productSlug, email, name } = parsed.data
    const jwt = req.jwtPayload!

    await prisma.productWaitlist.upsert({
      where: { productSlug_email: { productSlug, email } },
      create: {
        productSlug,
        email,
        name,
        clienteFinalId: jwt.clienteFinalId ?? null,
        integradorId: jwt.integradorId ?? null,
      },
      update: { name: name ?? undefined },
    })

    res.json({ ok: true })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// GET /marketplace/subscriptions
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/subscriptions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    let clienteFinalId: string | undefined

    if (jwt.clienteFinalId) {
      clienteFinalId = jwt.clienteFinalId
    } else if (isIntegradorAdmin(jwt.role) && req.query.clienteFinalId) {
      clienteFinalId = req.query.clienteFinalId as string
    }

    if (!clienteFinalId) throw new ForbiddenError('clienteFinalId não resolvido')

    const subscriptions = await prisma.clienteSubscription.findMany({
      where: { clienteFinalId },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    })

    const totalMonthlyBrl = subscriptions
      .filter(s => s.status === 'ACTIVE')
      .reduce((acc, s) => acc + Number(s.finalPriceBrl), 0)

    res.json({ subscriptions, totalMonthlyBrl: Number(totalMonthlyBrl.toFixed(2)) })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /marketplace/subscriptions
// ═════════════════════════════════════════════════════════════════════════════

const createSubscriptionSchema = z.object({
  productId: z.string().uuid(),
  cameraIds: z.array(z.string().uuid()).min(1),
  acceptedTermsVersion: z.string().default('v1'),
  markupPct: z.number().min(0).max(500).optional(),
})

marketplaceRouter.post(
  '/subscriptions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isClienteAdmin(jwt.role)) throw new ForbiddenError()

    const parsed = createSubscriptionSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

    const { productId, cameraIds, acceptedTermsVersion, markupPct: markupOverride } = parsed.data

    const clienteFinalId = jwt.clienteFinalId
    if (!clienteFinalId) throw new ForbiddenError('Operação requer contexto de cliente final')

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const product = await prisma.marketplaceProduct.findUnique({ where: { id: productId } })
    if (!product || !product.active) throw new NotFoundError('Produto não encontrado ou inativo')

    let markup: number
    if (markupOverride !== undefined && isIntegradorAdmin(jwt.role)) {
      markup = markupOverride
    } else {
      markup = await getMarkupForIntegrador(integradorId)
    }

    const basePriceUsd = Number(product.basePriceUsd)
    const finalPriceBrl = Number(((basePriceUsd * (1 + markup / 100)) * USD_BRL).toFixed(2))

    const now = new Date()

    const subscription = await prisma.clienteSubscription.create({
      data: {
        clienteFinalId,
        productId,
        cameraIds,
        status: 'ACTIVE',
        startedAt: now,
        basePriceUsd: product.basePriceUsd,
        markupPct: markup,
        finalPriceBrl,
        acceptedTermsAt: now,
        acceptedByUserId: jwt.sub,
        acceptedIp: req.ip ?? null,
        termsVersion: acceptedTermsVersion,
        productConfig: product.metadata ?? undefined,
      },
    })

    // Efeitos colaterais por categoria do produto
    if (product.category === 'STORAGE') {
      const meta = product.metadata as Record<string, unknown> | null
      const retentionPlanId = meta?.retentionPlanId as string | undefined
      if (retentionPlanId && cameraIds.length > 0) {
        await prisma.camera.updateMany({
          where: { id: { in: cameraIds } },
          data: { retentionPlanId },
        })
      }
    } else if (product.category === 'TIMELAPSE') {
      await prisma.camera.updateMany({
        where: { id: { in: cameraIds } },
        data: { recordEnabled: true },
      })
    }

    const changeRequest = await prisma.subscriptionChangeRequest.create({
      data: {
        subscriptionId: subscription.id,
        productId,
        type: 'UPGRADE',
        status: 'AUTO_APPROVED',
        toState: { cameraIds, markupPct: markup, finalPriceBrl },
        requestedByUserId: jwt.sub,
        requestedIp: req.ip ?? null,
        decidedAt: now,
        decisionNote: 'Auto-approved on creation',
      },
    })

    logger.info({ subscriptionId: subscription.id, productId, clienteFinalId }, 'marketplace_subscription_created')

    // E-mail de confirmação (best-effort)
    notifySubscriptionUsers(
      clienteFinalId,
      `✅ Assinatura ativada — ${product.name}`,
      `Sua assinatura de ${product.name} foi ativada com sucesso.\n\n` +
      `${cameraIds.length} câmera(s) cobertas.\n` +
      `Custo mensal: R$ ${finalPriceBrl.toFixed(2)}\n` +
      `Protocolo: ${subscription.id}\n\n— VSaaS`,
    )

    res.status(201).json({
      subscription,
      decision: { status: changeRequest.status },
    })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /marketplace/subscriptions/:id/cancel
// ═════════════════════════════════════════════════════════════════════════════

const cancelSchema = z.object({
  reason: z.string().optional(),
  downgradeBehavior: z.enum(['soft', 'immediate']),
  confirmedText: z.string(),
})

marketplaceRouter.post(
  '/subscriptions/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isClienteAdmin(jwt.role)) throw new ForbiddenError()

    const parsed = cancelSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

    const { reason, downgradeBehavior, confirmedText } = parsed.data
    if (confirmedText !== 'CANCELAR') {
      throw new ValidationError('Confirmação inválida. Digite CANCELAR para confirmar.')
    }

    const sub = await prisma.clienteSubscription.findUnique({
      where: { id: String(req.params.id) },
      include: { product: true },
    })
    if (!sub) throw new NotFoundError('Assinatura não encontrada')
    if (jwt.clienteFinalId && sub.clienteFinalId !== jwt.clienteFinalId) throw new ForbiddenError()
    if (sub.status !== 'ACTIVE') throw new ValidationError(`Assinatura não pode ser cancelada no status ${sub.status}`)

    // Calcula impacto atual
    const agg = await prisma.recordingSegment.aggregate({
      _sum: { sizeBytes: true },
      _count: true,
      where: { cameraId: { in: sub.cameraIds } },
    })
    const impactBytes = BigInt(agg._sum.sizeBytes ?? 0)
    const impactSegments = agg._count

    const now = new Date()
    const cancelGraceUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    await prisma.clienteSubscription.update({
      where: { id: sub.id },
      data: {
        status: 'GRACE',
        canceledAt: now,
        cancelGraceUntil,
        cancelReason: reason ?? null,
      },
    })

    const changeRequest = await prisma.subscriptionChangeRequest.create({
      data: {
        subscriptionId: sub.id,
        productId: sub.productId,
        type: 'CANCEL',
        status: 'AUTO_APPROVED',
        fromState: { status: 'ACTIVE', cameraIds: sub.cameraIds },
        toState: { status: 'GRACE', reason, downgradeBehavior },
        requestedByUserId: jwt.sub,
        requestedIp: req.ip ?? null,
        downgradeBehavior,
        impactBytes,
        impactSegments,
        decidedAt: now,
        decisionNote: 'Auto-approved on cancellation',
      },
    })

    if (downgradeBehavior === 'immediate') {
      await prisma.recordingSegment.deleteMany({
        where: { cameraId: { in: sub.cameraIds } },
      })
    }

    if (sub.cameraIds.length > 0) {
      await prisma.camera.updateMany({
        where: { id: { in: sub.cameraIds } },
        data: { recordEnabled: false },
      })
    }

    logger.info({ subscriptionId: sub.id, downgradeBehavior, impactBytes: String(impactBytes) }, 'marketplace_subscription_canceled')

    // E-mail de cancelamento (best-effort)
    notifySubscriptionUsers(
      sub.clienteFinalId,
      `⚠️ Assinatura cancelada — ${sub.product.name}`,
      `Sua assinatura de ${sub.product.name} foi cancelada.\n\n` +
      `Seus dados estarão disponíveis até ${cancelGraceUntil.toLocaleDateString('pt-BR')}.\n` +
      `Após essa data, todos os dados serão deletados permanentemente.\n\n` +
      `Protocolo: ${changeRequest.id}\n\n— VSaaS`,
    )

    res.json({
      ok: true,
      cancelGraceUntil,
      impactBytes: String(impactBytes),
      impactSegments,
    })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /marketplace/subscriptions/:id/reactivate
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.post(
  '/subscriptions/:id/reactivate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isClienteAdmin(jwt.role)) throw new ForbiddenError()

    const sub = await prisma.clienteSubscription.findUnique({
      where: { id: String(req.params.id) },
      include: { product: true },
    })
    if (!sub) throw new NotFoundError('Assinatura não encontrada')
    if (jwt.clienteFinalId && sub.clienteFinalId !== jwt.clienteFinalId) throw new ForbiddenError()

    if (sub.status !== 'GRACE') {
      throw new ValidationError(`Assinatura não está em período de graça (status: ${sub.status})`)
    }

    const now = new Date()
    if (sub.cancelGraceUntil && sub.cancelGraceUntil <= now) {
      throw new ValidationError('Período de graça expirado — reativação não permitida')
    }

    await prisma.clienteSubscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        canceledAt: null,
        cancelGraceUntil: null,
        reactivatedAt: now,
      },
    })

    if (sub.cameraIds.length > 0) {
      await prisma.camera.updateMany({
        where: { id: { in: sub.cameraIds } },
        data: { recordEnabled: true },
      })
    }

    logger.info({ subscriptionId: sub.id }, 'marketplace_subscription_reactivated')

    // E-mail de reativação (best-effort)
    notifySubscriptionUsers(
      sub.clienteFinalId,
      `✅ Assinatura reativada — ${sub.product.name}`,
      `Sua assinatura de ${sub.product.name} foi reativada com sucesso.\n\n` +
      `Suas gravações foram preservadas.\n\n— VSaaS`,
    )

    res.json({ ok: true })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// GET /marketplace/subscriptions/:id/impact
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/subscriptions/:id/impact',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!

    const sub = await prisma.clienteSubscription.findUnique({
      where: { id: String(req.params.id) },
    })
    if (!sub) throw new NotFoundError('Assinatura não encontrada')
    if (jwt.clienteFinalId && sub.clienteFinalId !== jwt.clienteFinalId) throw new ForbiddenError()

    const [agg, oldest, newest] = await Promise.all([
      prisma.recordingSegment.aggregate({
        _sum: { sizeBytes: true },
        _count: true,
        where: { cameraId: { in: sub.cameraIds } },
      }),
      prisma.recordingSegment.findFirst({
        where: { cameraId: { in: sub.cameraIds } },
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true },
      }),
      prisma.recordingSegment.findFirst({
        where: { cameraId: { in: sub.cameraIds } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      }),
    ])

    const bytesTotal = BigInt(agg._sum.sizeBytes ?? 0)
    const segmentsTotal = agg._count
    const oldestSegmentAt = oldest?.startedAt ?? null
    const newestSegmentAt = newest?.startedAt ?? null

    const daysAtRisk = oldestSegmentAt && newestSegmentAt
      ? Math.ceil((newestSegmentAt.getTime() - oldestSegmentAt.getTime()) / (24 * 60 * 60 * 1000))
      : 0

    res.json({
      bytesTotal: String(bytesTotal),
      segmentsTotal,
      oldestSegmentAt,
      newestSegmentAt,
      daysAtRisk,
    })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /marketplace/subscriptions/:id/upgrade
// ═════════════════════════════════════════════════════════════════════════════

const upgradeSchema = z.object({
  newProductId: z.string().uuid(),
  newCameraIds: z.array(z.string().uuid()).optional(),
  downgradeBehavior: z.enum(['soft', 'immediate']).optional().default('soft'),
})

marketplaceRouter.post(
  '/subscriptions/:id/upgrade',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isClienteAdmin(jwt.role)) throw new ForbiddenError()

    const parsed = upgradeSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

    const { newProductId, newCameraIds, downgradeBehavior } = parsed.data

    const sub = await prisma.clienteSubscription.findUnique({
      where: { id: String(req.params.id) },
      include: { product: true },
    })
    if (!sub) throw new NotFoundError('Assinatura não encontrada')
    if (jwt.clienteFinalId && sub.clienteFinalId !== jwt.clienteFinalId) throw new ForbiddenError()
    if (sub.status !== 'ACTIVE') throw new ValidationError(`Assinatura não pode ser alterada no status ${sub.status}`)

    const newProduct = await prisma.marketplaceProduct.findUnique({ where: { id: newProductId } })
    if (!newProduct || !newProduct.active) throw new NotFoundError('Produto de destino não encontrado ou inativo')

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const markup = await getMarkupForIntegrador(integradorId)
    const newBasePriceUsd = Number(newProduct.basePriceUsd)
    const oldBasePriceUsd = Number(sub.basePriceUsd)
    const newFinalPriceBrl = Number(((newBasePriceUsd * (1 + markup / 100)) * USD_BRL).toFixed(2))
    const oldFinalPriceBrl = Number(sub.finalPriceBrl)
    const deltaBrl = newFinalPriceBrl - oldFinalPriceBrl

    const now = new Date()
    const cameraIds = newCameraIds ?? sub.cameraIds

    // Downgrade (deltaBrl <= 0): auto-aprovado
    if (deltaBrl <= 0) {
      const changeRequest = await prisma.subscriptionChangeRequest.create({
        data: {
          subscriptionId: sub.id,
          productId: newProductId,
          type: 'DOWNGRADE',
          status: 'AUTO_APPROVED',
          fromState: { productId: sub.productId, productName: sub.product.name, finalPriceBrl: oldFinalPriceBrl },
          toState: { productId: newProductId, productName: newProduct.name, finalPriceBrl: newFinalPriceBrl, cameraIds },
          requestedByUserId: jwt.sub,
          requestedIp: req.ip ?? null,
          decidedAt: now,
          decisionNote: 'Auto-approved: downgrade',
          deltaBrl,
        },
      })

      await prisma.clienteSubscription.update({
        where: { id: sub.id },
        data: {
          productId: newProductId,
          cameraIds,
          basePriceUsd: newProduct.basePriceUsd,
          markupPct: markup,
          finalPriceBrl: newFinalPriceBrl,
          productConfig: newProduct.metadata ?? undefined,
        },
      })

      // Se immediate: deleta segmentos além do novo retainDays
      if (downgradeBehavior === 'immediate') {
        const meta = newProduct.metadata as Record<string, unknown> | null
        const retainDays = Number(meta?.retainDays ?? 7)
        const cutoff = new Date(now.getTime() - retainDays * 24 * 60 * 60 * 1000)
        await prisma.recordingSegment.deleteMany({
          where: {
            cameraId: { in: cameraIds },
            endedAt: { lt: cutoff },
          },
        })
      }

      logger.info({ subscriptionId: sub.id, newProductId, deltaBrl }, 'marketplace_downgrade_auto_approved')

      notifySubscriptionUsers(
        sub.clienteFinalId,
        `✅ Assinatura atualizada — ${newProduct.name}`,
        `Sua assinatura foi alterada para ${newProduct.name}.\n\n` +
        `Novo custo mensal: R$ ${newFinalPriceBrl.toFixed(2)}\n` +
        `Protocolo: ${changeRequest.id}\n\n— VSaaS`,
      )

      return res.json({ ok: true, decision: 'AUTO_APPROVED', changeRequestId: changeRequest.id })
    }

    // Upgrade (deltaBrl > 0): verificar limites do contrato
    const contract = await prisma.integradorRetentionContract.findUnique({
      where: { integradorId },
      select: { autoApproveUpgradeLimitBrl: true, active: true },
    })

    const autoApproveLimit = contract?.autoApproveUpgradeLimitBrl
      ? Number(contract.autoApproveUpgradeLimitBrl)
      : null

    const decision = (!autoApproveLimit || deltaBrl <= autoApproveLimit)
      ? 'AUTO_APPROVED'
      : 'PENDING_INTEGRADOR'

    if (decision === 'AUTO_APPROVED') {
      const changeRequest = await prisma.subscriptionChangeRequest.create({
        data: {
          subscriptionId: sub.id,
          productId: newProductId,
          type: 'UPGRADE',
          status: 'AUTO_APPROVED',
          fromState: { productId: sub.productId, productName: sub.product.name, finalPriceBrl: oldFinalPriceBrl },
          toState: { productId: newProductId, productName: newProduct.name, finalPriceBrl: newFinalPriceBrl, cameraIds },
          requestedByUserId: jwt.sub,
          requestedIp: req.ip ?? null,
          decidedAt: now,
          decisionNote: 'Auto-approved: within budget',
          deltaBrl,
        },
      })

      await prisma.clienteSubscription.update({
        where: { id: sub.id },
        data: {
          productId: newProductId,
          cameraIds,
          basePriceUsd: newProduct.basePriceUsd,
          markupPct: markup,
          finalPriceBrl: newFinalPriceBrl,
          productConfig: newProduct.metadata ?? undefined,
        },
      })

      logger.info({ subscriptionId: sub.id, newProductId, deltaBrl }, 'marketplace_upgrade_auto_approved')

      notifySubscriptionUsers(
        sub.clienteFinalId,
        `✅ Upgrade aprovado — ${newProduct.name}`,
        `Sua assinatura foi atualizada para ${newProduct.name}.\n\n` +
        `Novo custo mensal: R$ ${newFinalPriceBrl.toFixed(2)}\n` +
        `Protocolo: ${changeRequest.id}\n\n— VSaaS`,
      )

      return res.json({ ok: true, decision: 'AUTO_APPROVED', changeRequestId: changeRequest.id })
    }

    // PENDING_INTEGRADOR
    const changeRequest = await prisma.subscriptionChangeRequest.create({
      data: {
        subscriptionId: sub.id,
        productId: newProductId,
        type: 'UPGRADE',
        status: 'PENDING_INTEGRADOR',
        fromState: { productId: sub.productId, productName: sub.product.name, finalPriceBrl: oldFinalPriceBrl },
        toState: { productId: newProductId, productName: newProduct.name, finalPriceBrl: newFinalPriceBrl, cameraIds },
        requestedByUserId: jwt.sub,
        requestedIp: req.ip ?? null,
        deltaBrl,
      },
    })

    logger.info({ subscriptionId: sub.id, newProductId, deltaBrl, requestId: changeRequest.id }, 'marketplace_upgrade_pending')

    // Notifica integrador (best-effort)
    notifyIntegradorOfPendingUpgrade({
      integradorId,
      requestId: changeRequest.id,
      clienteFinalId: sub.clienteFinalId,
      fromProductName: sub.product.name,
      toProductName: newProduct.name,
      deltaBrl,
    })

    return res.status(202).json({
      ok: true,
      decision: 'PENDING_INTEGRADOR',
      requestId: changeRequest.id,
    })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// GET /marketplace/pending-approvals
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/pending-approvals',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) throw new ForbiddenError()

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    // Busca clientes finais do integrador para filtrar
    const clientesFInais = await prisma.clienteFinal.findMany({
      where: { integradorId },
      select: { id: true },
    })
    const clienteFinalIds = clientesFInais.map(cf => cf.id)

    // Busca subscriptions dos CFs do integrador
    const subscriptions = await prisma.clienteSubscription.findMany({
      where: { clienteFinalId: { in: clienteFinalIds } },
      select: { id: true },
    })
    const subscriptionIds = subscriptions.map(s => s.id)

    const items = await prisma.subscriptionChangeRequest.findMany({
      where: {
        subscriptionId: { in: subscriptionIds },
        status: 'PENDING_INTEGRADOR',
      },
      include: {
        subscription: {
          include: { product: true, clienteFinal: { select: { id: true, name: true } } },
        },
        product: true,
      },
      orderBy: { requestedAt: 'asc' },
    })

    res.json({ items, total: items.length })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /marketplace/subscriptions/:requestId/decide
// ═════════════════════════════════════════════════════════════════════════════

const decideSchema = z.object({
  decision: z.enum(['APPROVED', 'DENIED']),
  decisionNote: z.string().optional(),
})

marketplaceRouter.post(
  '/subscriptions/:requestId/decide',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) throw new ForbiddenError()

    const parsed = decideSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

    const { decision, decisionNote } = parsed.data

    const changeRequest = await prisma.subscriptionChangeRequest.findUnique({
      where: { id: String(req.params.requestId) },
      include: {
        subscription: {
          include: { product: true, clienteFinal: { select: { id: true, integradorId: true } } },
        },
        product: true,
      },
    })
    if (!changeRequest) throw new NotFoundError('Pedido não encontrado')
    if (changeRequest.status !== 'PENDING_INTEGRADOR') {
      throw new ValidationError(`Pedido já decidido (status: ${changeRequest.status})`)
    }

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    // Valida que o request pertence ao tenant do integrador
    const cfIntegradorId = changeRequest.subscription.clienteFinal.integradorId
    if (cfIntegradorId !== integradorId && !isSuperAdmin(jwt.role)) {
      throw new ForbiddenError('Pedido não pertence ao seu tenant')
    }

    const now = new Date()
    const sub = changeRequest.subscription

    await prisma.subscriptionChangeRequest.update({
      where: { id: changeRequest.id },
      data: {
        status: decision === 'APPROVED' ? 'APPROVED' : 'DENIED',
        decidedById: jwt.sub,
        decidedAt: now,
        decisionNote: decisionNote ?? null,
      },
    })

    if (decision === 'APPROVED') {
      // Aplica a mudança na subscription
      const toState = changeRequest.toState as Record<string, any>
      await prisma.clienteSubscription.update({
        where: { id: sub.id },
        data: {
          productId: changeRequest.productId,
          cameraIds: toState.cameraIds ?? sub.cameraIds,
          basePriceUsd: changeRequest.product.basePriceUsd,
          markupPct: toState.markupPct ?? sub.markupPct,
          finalPriceBrl: toState.finalPriceBrl ?? sub.finalPriceBrl,
          productConfig: changeRequest.product.metadata ?? undefined,
        },
      })

      logger.info({ requestId: changeRequest.id, subscriptionId: sub.id }, 'marketplace_upgrade_approved')

      notifySubscriptionUsers(
        sub.clienteFinalId,
        `✅ Upgrade aprovado — ${changeRequest.product.name}`,
        `Seu pedido de upgrade para ${changeRequest.product.name} foi aprovado pelo integrador.\n\n` +
        `Novo custo mensal: R$ ${Number(toState.finalPriceBrl ?? sub.finalPriceBrl).toFixed(2)}\n` +
        `Protocolo: ${changeRequest.id}\n\n— VSaaS`,
      )
    } else {
      logger.info({ requestId: changeRequest.id, subscriptionId: sub.id }, 'marketplace_upgrade_denied')

      // Busca nome do integrador para o e-mail
      const integrador = await prisma.integrador.findUnique({
        where: { id: integradorId },
        select: { name: true, tradeName: true },
      })
      const nomeIntegrador = integrador?.tradeName ?? integrador?.name ?? 'seu integrador'

      notifySubscriptionUsers(
        sub.clienteFinalId,
        `❌ Pedido de upgrade negado — ${changeRequest.product.name}`,
        `Seu pedido de upgrade para ${changeRequest.product.name} foi negado.\n\n` +
        `Entre em contato com ${nomeIntegrador} para mais informações.\n` +
        `Protocolo: ${changeRequest.id}\n\n— VSaaS`,
      )
    }

    res.json({ ok: true, decision })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// GET /marketplace/timelapse/jobs
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/timelapse/jobs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const clienteFinalId = jwt.clienteFinalId
    if (!clienteFinalId) throw new ForbiddenError('Operação requer contexto de cliente final')

    const limit = Math.min(Number(req.query.limit ?? 20), 100)
    const status = req.query.status as string | undefined
    const cameraId = req.query.cameraId as string | undefined

    const jobs = await prisma.timelapseJob.findMany({
      where: {
        clienteFinalId,
        ...(status ? { status: status as any } : {}),
        ...(cameraId ? { cameraId } : {}),
      },
      select: {
        id: true,
        cameraId: true,
        type: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        outputPath: true,
        durationSec: true,
        fileSizeBytes: true,
        generatedAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    res.json({ jobs, total: jobs.length })
  }),
)

// ─── Suspensão manual pelo integrador (inadimplência fora do Asaas) ──────────

marketplaceRouter.post(
  '/subscriptions/:id/suspend',
  requireAuth,
  asyncHandler(async (req: any, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const integradorId = await resolveIntegradorId(req)
    const { reason } = req.body

    const sub = await prisma.clienteSubscription.findUnique({
      where: { id: req.params.id },
      include: { clienteFinal: { select: { integradorId: true, id: true } } },
    })
    if (!sub) return res.status(404).json({ error: 'not_found' })
    if (!isSuperAdmin(jwt.role) && sub.clienteFinal.integradorId !== integradorId) {
      return res.status(403).json({ error: 'forbidden' })
    }
    if (sub.status === 'SUSPENDED') return res.json({ ok: true, alreadySuspended: true })
    if (!['ACTIVE', 'GRACE'].includes(sub.status)) {
      return res.status(400).json({ error: 'cannot_suspend', status: sub.status })
    }

    await prisma.clienteSubscription.update({
      where: { id: sub.id },
      data: { status: 'SUSPENDED', updatedAt: new Date() },
    })

    await notifySubscriptionUsers(
      sub.clienteFinalId,
      'Sua assinatura foi suspensa',
      `Sua assinatura foi suspensa pelo seu integrador.${reason ? ` Motivo: ${reason}` : ''} Entre em contato para regularizar.`,
    )

    logger.warn({ subscriptionId: sub.id, integradorId, reason }, 'integrador_subscription_suspended_manual')
    res.json({ ok: true })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// GET /marketplace/catalog
// Lista produtos ativos do catálogo com preço calculado (markup global ou por produto)
// e flag "enabled" indicando se este integrador já habilitou o produto para revenda.
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/catalog',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) throw new ForbiddenError()

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const [products, integradorProducts, globalMarkup] = await Promise.all([
      prisma.marketplaceProduct.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.integradorProduct.findMany({
        where: { integradorId },
      }),
      getMarkupForIntegrador(integradorId),
    ])

    const productMap = new Map(integradorProducts.map(ip => [ip.productId, ip]))

    const catalog = products.map(p => {
      const ip = productMap.get(p.id)
      const markupPct = ip?.markupPct !== undefined && ip.markupPct !== null
        ? Number(ip.markupPct)
        : globalMarkup
      const basePriceUsd = Number(p.basePriceUsd)
      const finalPriceBrl = Number(((basePriceUsd * (1 + markupPct / 100)) * USD_BRL).toFixed(2))

      return {
        id:            p.id,
        slug:          p.slug,
        category:      p.category,
        name:          p.name,
        tagline:       p.tagline,
        description:   p.description,
        features:      p.features,
        pricingModel:  p.pricingModel,
        comingSoon:    p.comingSoon,
        basePriceUsd:  basePriceUsd,
        markupPct,
        finalPriceBrl,
        enabled:       ip?.enabled ?? false,
        enabledAt:     ip?.enabledAt ?? null,
        disabledAt:    ip?.disabledAt ?? null,
      }
    })

    res.json({ catalog, globalMarkup, usdBrl: USD_BRL })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /marketplace/integrador/products/:productId/enable
// Habilita (ou reabilita) um produto do catálogo para revenda pelo integrador.
// Body opcional: { markupPct?: number }
// ═════════════════════════════════════════════════════════════════════════════

const enableProductSchema = z.object({
  markupPct: z.number().min(0).max(500).optional(),
})

marketplaceRouter.post(
  '/integrador/products/:productId/enable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) throw new ForbiddenError()

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const parsed = enableProductSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

    const product = await prisma.marketplaceProduct.findUnique({
      where: { id: String(req.params.productId) },
      select: { id: true, name: true, active: true },
    })
    if (!product || !product.active) throw new NotFoundError('Produto não encontrado ou inativo')

    const now = new Date()
    const record = await prisma.integradorProduct.upsert({
      where: { integradorId_productId: { integradorId, productId: product.id } },
      create: {
        integradorId,
        productId: product.id,
        enabled:   true,
        markupPct: parsed.data.markupPct ?? null,
        enabledAt: now,
      },
      update: {
        enabled:   true,
        markupPct: parsed.data.markupPct !== undefined ? parsed.data.markupPct : undefined,
        enabledAt: now,
        disabledAt: null,
      },
    })

    logger.info({ integradorId, productId: product.id, markupPct: record.markupPct }, 'integrador_product_enabled')
    res.status(201).json({ ok: true, integradorProduct: record })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /marketplace/integrador/products/:productId/enable
// Desabilita um produto do catálogo (o integrador não vai mais oferecer para revenda).
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.delete(
  '/integrador/products/:productId/enable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) throw new ForbiddenError()

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const existing = await prisma.integradorProduct.findUnique({
      where: { integradorId_productId: { integradorId, productId: String(req.params.productId) } },
    })
    if (!existing) throw new NotFoundError('Produto não estava habilitado para este integrador')

    const record = await prisma.integradorProduct.update({
      where: { id: existing.id },
      data: { enabled: false, disabledAt: new Date() },
    })

    logger.info({ integradorId, productId: existing.productId }, 'integrador_product_disabled')
    res.json({ ok: true, integradorProduct: record })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /marketplace/integrador/products/:productId/markup
// Atualiza o markup por produto. { markupPct: number | null } — null = volta ao global.
// ═════════════════════════════════════════════════════════════════════════════

const markupPatchSchema = z.object({
  markupPct: z.number().min(0).max(500).nullable(),
})

marketplaceRouter.patch(
  '/integrador/products/:productId/markup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) throw new ForbiddenError()

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const parsed = markupPatchSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

    const existing = await prisma.integradorProduct.findUnique({
      where: { integradorId_productId: { integradorId, productId: String(req.params.productId) } },
    })
    if (!existing) throw new NotFoundError('Produto não encontrado no catálogo do integrador — habilite-o primeiro')

    const record = await prisma.integradorProduct.update({
      where: { id: existing.id },
      data: { markupPct: parsed.data.markupPct },
    })

    logger.info({ integradorId, productId: existing.productId, markupPct: parsed.data.markupPct }, 'integrador_product_markup_updated')
    res.json({ ok: true, integradorProduct: record })
  }),
)

// ─── Reativação manual pelo integrador ────────────────────────────────────────

marketplaceRouter.post(
  '/subscriptions/:id/reactivate-integrador',
  requireAuth,
  asyncHandler(async (req: any, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const integradorId = await resolveIntegradorId(req)

    const sub = await prisma.clienteSubscription.findUnique({
      where: { id: req.params.id },
      include: { clienteFinal: { select: { integradorId: true, id: true } } },
    })
    if (!sub) return res.status(404).json({ error: 'not_found' })
    if (!isSuperAdmin(jwt.role) && sub.clienteFinal.integradorId !== integradorId) {
      return res.status(403).json({ error: 'forbidden' })
    }
    if (sub.status === 'ACTIVE') return res.json({ ok: true, alreadyActive: true })
    if (sub.status !== 'SUSPENDED') {
      return res.status(400).json({ error: 'cannot_reactivate', status: sub.status })
    }

    await prisma.clienteSubscription.update({
      where: { id: sub.id },
      data: { status: 'ACTIVE', reactivatedAt: new Date(), updatedAt: new Date() },
    })

    await notifySubscriptionUsers(
      sub.clienteFinalId,
      'Assinatura reativada',
      'Ótimas notícias! Sua assinatura foi reativada pelo seu integrador e está ativa novamente.',
    )

    logger.info({ subscriptionId: sub.id, integradorId }, 'integrador_subscription_reactivated_manual')
    res.json({ ok: true })
  }),
)
