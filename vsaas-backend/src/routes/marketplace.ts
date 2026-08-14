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

async function assertCanAccessSubscription(
  jwt: NonNullable<Express.Request['jwtPayload']>,
  clienteFinalId: string,
): Promise<void> {
  if (isSuperAdmin(jwt.role)) return
  if (jwt.clienteFinalId) {
    if (jwt.clienteFinalId !== clienteFinalId) throw new ForbiddenError()
    return
  }
  if (jwt.integradorId) {
    const owned = await prisma.clienteFinal.findFirst({
      where: { id: clienteFinalId, integradorId: jwt.integradorId },
      select: { id: true },
    })
    if (!owned) throw new ForbiddenError()
    return
  }
  throw new ForbiddenError()
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
    const allClientes = req.query.allClientes === 'true'

    if (jwt.clienteFinalId) {
      clienteFinalId = jwt.clienteFinalId
    } else if (isIntegradorAdmin(jwt.role) && req.query.clienteFinalId) {
      // SEGURANÇA (auditoria 2026-06-24): clienteFinalId vem do query (input do
      // cliente). Antes, um INTEGRADOR_ADMIN podia ler assinaturas/faturamento
      // de clientes de OUTROS integradores. Validamos posse na árvore dele.
      const requested = req.query.clienteFinalId as string
      const owned = await prisma.clienteFinal.findFirst({
        where: { id: requested, integradorId: jwt.integradorId! },
        select: { id: true },
      })
      if (!owned) throw new ForbiddenError('ClienteFinal fora do seu tenant')
      clienteFinalId = requested
    }

    // Integrador pedindo todas as assinaturas dos seus clientes
    if (allClientes && isIntegradorAdmin(jwt.role) && !clienteFinalId) {
      const clientes = await prisma.clienteFinal.findMany({
        where: { integradorId: jwt.integradorId! },
        select: { id: true },
      })
      const clienteIds = clientes.map(c => c.id)

      const rows = await prisma.clienteSubscription.findMany({
        where: { clienteFinalId: { in: clienteIds } },
        include: { product: true },
        orderBy: { createdAt: 'desc' },
      })

      const subscriptions = rows.map(s => {
        const now = Date.now()
        const graceMs = s.cancelGraceUntil ? s.cancelGraceUntil.getTime() - now : 0
        return {
          id: s.id,
          clienteFinalId: s.clienteFinalId,
          productName: s.product.name,
          productSlug: s.product.slug,
          productCategory: s.product.category,
          status: s.status,
          cameraIds: s.cameraIds,
          cameraCount: s.cameraIds.length,
          monthlyPrice: Number(s.finalPriceBrl),
          startedAt: s.startedAt.toISOString(),
          graceDaysRemaining: graceMs > 0 ? Math.ceil(graceMs / (1000 * 60 * 60 * 24)) : undefined,
          expiresAt: s.cancelGraceUntil?.toISOString(),
        }
      })

      const totalMonthlyBrl = subscriptions
        .filter(s => s.status === 'ACTIVE')
        .reduce((acc, s) => acc + s.monthlyPrice, 0)

      res.json({ subscriptions, totalMonthlyBrl: Number(totalMonthlyBrl.toFixed(2)) })
      return
    }

    if (!clienteFinalId) throw new ForbiddenError('clienteFinalId não resolvido')

    const rows = await prisma.clienteSubscription.findMany({
      where: { clienteFinalId },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    })

    // Mapeia pro schema esperado pelo frontend (MinhasAssinaturasPage).
    // Converte Decimal → Number (Prisma serializa Decimal como string no JSON).
    const subscriptions = rows.map(s => {
      const now = Date.now()
      const graceMs = s.cancelGraceUntil ? s.cancelGraceUntil.getTime() - now : 0
      return {
        id: s.id,
        productName: s.product.name,
        productSlug: s.product.slug,
        productCategory: s.product.category,
        status: s.status,
        cameraIds: s.cameraIds,
        cameraCount: s.cameraIds.length,
        monthlyPrice: Number(s.finalPriceBrl),
        startedAt: s.startedAt.toISOString(),
        graceDaysRemaining: graceMs > 0 ? Math.ceil(graceMs / (1000 * 60 * 60 * 24)) : undefined,
        expiresAt: s.cancelGraceUntil?.toISOString(),
      }
    })

    const totalMonthlyBrl = subscriptions
      .filter(s => s.status === 'ACTIVE')
      .reduce((acc, s) => acc + s.monthlyPrice, 0)

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

    // Regra de negócio: TODA contratação iniciada pelo cliente final passa por
    // aprovação do integrador. Não há mais auto-approve na criação. O integrador
    // é responsável comercial e técnico — aprova/rejeita em /marketplace/integrador.
    //
    // Comportamento:
    //   - Subscription criada com status=PENDING (não ACTIVE)
    //   - Nenhum efeito colateral aplicado (retentionPlan, recordEnabled, etc.)
    //   - ChangeRequest criada com status=PENDING_INTEGRADOR
    //   - Câmeras não começam a gravar até aprovação
    //   - Aprovação manual em POST /subscriptions/:requestId/decide aplica os efeitos
    const subscription = await prisma.clienteSubscription.create({
      data: {
        clienteFinalId,
        productId,
        cameraIds,
        status: 'PENDING',
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

    const changeRequest = await prisma.subscriptionChangeRequest.create({
      data: {
        subscriptionId: subscription.id,
        productId,
        type: 'UPGRADE',
        status: 'PENDING_INTEGRADOR',
        toState: { cameraIds, markupPct: markup, finalPriceBrl, category: product.category, metadata: product.metadata },
        requestedByUserId: jwt.sub,
        requestedIp: req.ip ?? null,
        decisionNote: 'Pendente de aprovação do integrador',
      },
    })

    logger.info({ subscriptionId: subscription.id, productId, clienteFinalId, decision: 'PENDING_INTEGRADOR' }, 'marketplace_subscription_pending_approval')

    // E-mail de confirmação ao cliente
    notifySubscriptionUsers(
      clienteFinalId,
      `⏳ Solicitação enviada — ${product.name}`,
      `Sua solicitação de assinatura de ${product.name} foi enviada para aprovação do integrador.\n\n` +
      `${cameraIds.length} câmera(s) selecionadas.\n` +
      `Custo mensal previsto: R$ ${finalPriceBrl.toFixed(2)}\n` +
      `Protocolo: ${subscription.id}\n\n` +
      `Você receberá notificação assim que for aprovada.\n\n— VSaaS`,
    )

    res.status(201).json({
      subscription,
      changeRequestId: changeRequest.id,
      decision: { status: changeRequest.status, type: 'PENDING_INTEGRADOR' },
      message: 'Solicitação enviada para aprovação do integrador.',
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
    await assertCanAccessSubscription(jwt, sub.clienteFinalId)
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
    await assertCanAccessSubscription(jwt, sub.clienteFinalId)

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
    await assertCanAccessSubscription(jwt, sub.clienteFinalId)

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
// GET /marketplace/subscriptions/:id/usage
//
// Extrato de uso da assinatura — agregado + lista detalhada, filtrado por
// período (`from`, `to`, ISO-8601) e opcionalmente por `siteId` e `userId`.
//
// Resposta varia por categoria do produto:
//  - AI         → eventos = SemanticRuleFire (1 linha por disparo)
//                + custo Gemini agregado (GeminiCallLog.estimatedCost)
//  - STORAGE    → uso de bytes/segmentos agregado por dia
//  - TIMELAPSE  → eventos = gerações timelapse (futuro — placeholder)
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/subscriptions/:id/usage',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!

    const sub = await prisma.clienteSubscription.findUnique({
      where: { id: String(req.params.id) },
      include: { product: { select: { category: true, name: true } } },
    })
    if (!sub) throw new NotFoundError('Assinatura não encontrada')
    await assertCanAccessSubscription(jwt, sub.clienteFinalId)

    // ── Filtros ─────────────────────────────────────────────────────────────
    const now = new Date()
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // 30d
    const from = req.query.from ? new Date(String(req.query.from)) : defaultFrom
    const to   = req.query.to   ? new Date(String(req.query.to))   : now
    const siteId = req.query.siteId ? String(req.query.siteId) : undefined
    const userId = req.query.userId ? String(req.query.userId) : undefined

    // Câmeras da assinatura (já restritas ao subscription.cameraIds)
    // Aplica filtro de site se vier no query (filtra cameraIds → câmeras desse site)
    let cameraIdsScope = sub.cameraIds
    if (siteId) {
      const camsInSite = await prisma.camera.findMany({
        where: { id: { in: sub.cameraIds }, siteId },
        select: { id: true },
      })
      cameraIdsScope = camsInSite.map(c => c.id)
    }

    // Resolver Sites cobertos (pra dropdown de filtro no UI)
    const camerasResolved = await prisma.camera.findMany({
      where: { id: { in: sub.cameraIds } },
      select: { id: true, name: true, siteId: true, site: { select: { id: true, name: true } } },
    })
    const sitesMap = new Map<string, { id: string; name: string }>()
    for (const c of camerasResolved) {
      if (c.site) sitesMap.set(c.site.id, { id: c.site.id, name: c.site.name })
    }
    const sites = Array.from(sitesMap.values())
    const camNameById = new Map(camerasResolved.map(c => [c.id, c.name]))
    const camSiteById = new Map(camerasResolved.map(c => [c.id, c.site?.name ?? '—']))

    // ── Resolver Usuários (criadores de regras desta assinatura) ─────────────
    // Só faz sentido pra AI (SemanticRule tem createdById)
    let users: Array<{ id: string; name: string; email: string }> = []
    let rulesScope: Array<{ id: string; cameraId: string; createdById: string | null; prompt: string }> = []
    if (sub.product.category === 'AI') {
      rulesScope = await prisma.semanticRule.findMany({
        where: { cameraId: { in: cameraIdsScope } },
        select: { id: true, cameraId: true, createdById: true, prompt: true },
      })
      const userIds = Array.from(new Set(rulesScope.map(r => r.createdById).filter((v): v is string => !!v)))
      if (userIds.length > 0) {
        const userRows = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
        users = userRows.map(u => ({ id: u.id, name: u.name ?? u.email, email: u.email }))
      }
    }

    // ── Por categoria ───────────────────────────────────────────────────────
    if (sub.product.category === 'AI') {
      // Filtra regras pelo userId selecionado (se houver)
      const ruleIdsScope = userId
        ? rulesScope.filter(r => r.createdById === userId).map(r => r.id)
        : rulesScope.map(r => r.id)
      const ruleById = new Map(rulesScope.map(r => [r.id, r]))

      // Disparos no período
      const fires = await prisma.semanticRuleFire.findMany({
        where: {
          ruleId: { in: ruleIdsScope.length > 0 ? ruleIdsScope : ['__none__'] },
          firedAt: { gte: from, lte: to },
        },
        orderBy: { firedAt: 'desc' },
        take: 500,
        select: { id: true, ruleId: true, cameraId: true, firedAt: true, reason: true, severity: true, verdict: true },
      })

      // Custo Gemini (todas as chamadas dessa subscription no período)
      const callsAgg = await prisma.geminiCallLog.aggregate({
        where: {
          subscriptionId: sub.id,
          ts: { gte: from, lte: to },
          ...(cameraIdsScope.length < sub.cameraIds.length ? { cameraId: { in: cameraIdsScope } } : {}),
        },
        _count: true,
        _sum: { tokensIn: true, tokensOut: true, estimatedCost: true },
      })

      // Agregação diária pro mini-gráfico (eventos por dia)
      const dailyMap = new Map<string, number>()
      for (const f of fires) {
        const day = f.firedAt.toISOString().slice(0, 10)
        dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1)
      }
      const daily = Array.from(dailyMap.entries())
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day))

      // Eventos enriquecidos
      const events = fires.map(f => {
        const r = ruleById.get(f.ruleId)
        const creatorId = r?.createdById ?? null
        const creator = creatorId ? users.find(u => u.id === creatorId) : null
        return {
          id: f.id,
          ruleId: f.ruleId,  // necessário pra montar URL do snapshot
          ts: f.firedAt.toISOString(),
          cameraId: f.cameraId,
          cameraName: camNameById.get(f.cameraId) ?? f.cameraId.slice(0, 8),
          siteName: camSiteById.get(f.cameraId) ?? '—',
          rulePrompt: r?.prompt.slice(0, 80) ?? '—',
          reason: f.reason ?? '',
          severity: f.severity,
          verdict: f.verdict,
          userName: creator?.name ?? '—',
          userEmail: creator?.email ?? null,
        }
      })

      res.json({
        category: 'AI',
        period: { from: from.toISOString(), to: to.toISOString() },
        filters: { sites, users, applied: { siteId: siteId ?? null, userId: userId ?? null } },
        kpis: {
          totalEvents:   fires.length,
          totalCalls:    callsAgg._count,
          totalCostBrl:  Number(callsAgg._sum.estimatedCost ?? 0).toFixed(4),
          tokensIn:      callsAgg._sum.tokensIn ?? 0,
          tokensOut:     callsAgg._sum.tokensOut ?? 0,
        },
        daily,
        events,
      })
      return
    }

    if (sub.product.category === 'STORAGE') {
      // Agregação diária de gravação por câmera/site no período
      const segments = await prisma.recordingSegment.findMany({
        where: {
          cameraId: { in: cameraIdsScope.length > 0 ? cameraIdsScope : ['__none__'] },
          startedAt: { gte: from, lte: to },
        },
        orderBy: { startedAt: 'desc' },
        take: 5000,
        select: { id: true, cameraId: true, startedAt: true, durationSec: true, sizeBytes: true },
      })

      const dailyMap = new Map<string, { bytes: bigint; segs: number }>()
      let totalBytes = 0n
      let totalSecs = 0
      for (const s of segments) {
        const day = s.startedAt.toISOString().slice(0, 10)
        const cur = dailyMap.get(day) ?? { bytes: 0n, segs: 0 }
        cur.bytes += BigInt(s.sizeBytes ?? 0)
        cur.segs += 1
        dailyMap.set(day, cur)
        totalBytes += BigInt(s.sizeBytes ?? 0)
        totalSecs += s.durationSec ?? 0
      }
      const daily = Array.from(dailyMap.entries())
        .map(([day, v]) => ({ day, bytes: String(v.bytes), segments: v.segs }))
        .sort((a, b) => a.day.localeCompare(b.day))

      // Lista (top 200 mais recentes)
      const events = segments.slice(0, 200).map(s => ({
        id: s.id,
        ts: s.startedAt.toISOString(),
        cameraId: s.cameraId,
        cameraName: camNameById.get(s.cameraId) ?? s.cameraId.slice(0, 8),
        siteName: camSiteById.get(s.cameraId) ?? '—',
        durationSec: s.durationSec ?? 0,
        sizeBytes: String(s.sizeBytes ?? 0),
      }))

      res.json({
        category: 'STORAGE',
        period: { from: from.toISOString(), to: to.toISOString() },
        filters: { sites, users: [], applied: { siteId: siteId ?? null, userId: null } },
        kpis: {
          totalBytes:  String(totalBytes),
          totalSegs:   segments.length,
          totalHours:  (totalSecs / 3600).toFixed(1),
        },
        daily,
        events,
      })
      return
    }

    // Categorias sem extrato detalhado ainda (TIMELAPSE / ADDON)
    res.json({
      category: sub.product.category,
      period: { from: from.toISOString(), to: to.toISOString() },
      filters: { sites, users: [], applied: {} },
      kpis: {},
      daily: [],
      events: [],
      message: 'Extrato detalhado em breve para esta categoria.',
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
    await assertCanAccessSubscription(jwt, sub.clienteFinalId)
    if (sub.status !== 'ACTIVE') throw new ValidationError(`Assinatura não pode ser alterada no status ${sub.status}`)

    const newProduct = await prisma.marketplaceProduct.findUnique({ where: { id: newProductId } })
    if (!newProduct || !newProduct.active) throw new NotFoundError('Produto de destino não encontrado ou inativo')

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const markup = await getMarkupForIntegrador(integradorId)
    const newBasePriceUsd = Number(newProduct.basePriceUsd)
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

    // Detecta se é uma CREATION (subscription ainda em PENDING) ou um UPGRADE
    // (subscription já ACTIVE pedindo mudança). Copy de email + efeitos
    // colaterais diferem entre os dois.
    const isCreation = sub.status === 'PENDING'

    if (decision === 'APPROVED') {
      const toState = changeRequest.toState as Record<string, any>
      const cameraIds = toState.cameraIds ?? sub.cameraIds

      // Aplica a mudança na subscription
      await prisma.clienteSubscription.update({
        where: { id: sub.id },
        data: {
          status: isCreation ? 'ACTIVE' : sub.status,
          startedAt: isCreation ? now : sub.startedAt,
          productId: changeRequest.productId,
          cameraIds,
          basePriceUsd: changeRequest.product.basePriceUsd,
          markupPct: toState.markupPct ?? sub.markupPct,
          finalPriceBrl: toState.finalPriceBrl ?? sub.finalPriceBrl,
          productConfig: changeRequest.product.metadata ?? undefined,
        },
      })

      // Em CREATION aplicamos AGORA os efeitos colaterais que foram pulados na
      // criação inicial: retentionPlan pra STORAGE, recordEnabled pra TIMELAPSE.
      if (isCreation && cameraIds.length > 0) {
        if (changeRequest.product.category === 'STORAGE') {
          const meta = changeRequest.product.metadata as Record<string, unknown> | null
          const retentionPlanId = meta?.retentionPlanId as string | undefined
          if (retentionPlanId) {
            await prisma.camera.updateMany({
              where: { id: { in: cameraIds } },
              data: { retentionPlanId, recordEnabled: true },
            })
          } else {
            await prisma.camera.updateMany({
              where: { id: { in: cameraIds } },
              data: { recordEnabled: true },
            })
          }
        } else if (changeRequest.product.category === 'TIMELAPSE') {
          await prisma.camera.updateMany({
            where: { id: { in: cameraIds } },
            data: { recordEnabled: true },
          })
        }
      }

      logger.info({
        requestId: changeRequest.id, subscriptionId: sub.id, kind: isCreation ? 'creation' : 'upgrade',
      }, 'marketplace_decision_approved')

      const finalBrl = Number(toState.finalPriceBrl ?? sub.finalPriceBrl).toFixed(2)
      notifySubscriptionUsers(
        sub.clienteFinalId,
        isCreation
          ? `✅ Assinatura aprovada — ${changeRequest.product.name}`
          : `✅ Upgrade aprovado — ${changeRequest.product.name}`,
        isCreation
          ? `Sua assinatura de ${changeRequest.product.name} foi aprovada pelo integrador e já está ativa.\n\n` +
            `${cameraIds.length} câmera(s) cobertas.\n` +
            `Custo mensal: R$ ${finalBrl}\n` +
            `Protocolo: ${changeRequest.id}\n\n— VSaaS`
          : `Seu pedido de upgrade para ${changeRequest.product.name} foi aprovado pelo integrador.\n\n` +
            `Novo custo mensal: R$ ${finalBrl}\n` +
            `Protocolo: ${changeRequest.id}\n\n— VSaaS`,
      )
    } else {
      // DENIED — em CREATION, marca a subscription como CANCELED (não faz
      // sentido manter PENDING denied). Em UPGRADE, só nega o changeRequest.
      if (isCreation) {
        await prisma.clienteSubscription.update({
          where: { id: sub.id },
          data: { status: 'CANCELED', canceledAt: now, cancelReason: decisionNote ?? 'Negado pelo integrador' },
        })
      }

      logger.info({
        requestId: changeRequest.id, subscriptionId: sub.id, kind: isCreation ? 'creation' : 'upgrade',
      }, 'marketplace_decision_denied')

      const integrador = await prisma.integrador.findUnique({
        where: { id: integradorId },
        select: { name: true, tradeName: true },
      })
      const nomeIntegrador = integrador?.tradeName ?? integrador?.name ?? 'seu integrador'

      notifySubscriptionUsers(
        sub.clienteFinalId,
        isCreation
          ? `❌ Solicitação negada — ${changeRequest.product.name}`
          : `❌ Pedido de upgrade negado — ${changeRequest.product.name}`,
        (isCreation
          ? `Sua solicitação de assinatura de ${changeRequest.product.name} foi negada.\n\n`
          : `Seu pedido de upgrade para ${changeRequest.product.name} foi negado.\n\n`) +
        (decisionNote ? `Motivo: ${decisionNote}\n\n` : '') +
        `Entre em contato com ${nomeIntegrador} para mais informações.\n` +
        `Protocolo: ${changeRequest.id}\n\n— VSaaS`,
      )
    }

    res.json({ ok: true, decision, kind: isCreation ? 'creation' : 'upgrade' })
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
// GET /marketplace/integrador/catalog
// Lista produtos ativos do catálogo com preço calculado (markup global ou por produto)
// e flag "enabled" indicando se este integrador já habilitou o produto para revenda.
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/integrador/catalog',
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

// ═════════════════════════════════════════════════════════════════════════════
// GET /marketplace/catalog
// Catálogo unificado para Cliente Final (e Integrador navegando como cliente).
//
// Lista produtos ativos com:
//   - markup do integrador APLICADO (cliente vê só preço final em BRL);
//   - filtro opcional por `?category=STORAGE|AI|TIMELAPSE|ADDON`;
//   - filtro opcional por `?search=` (nome+descrição+tagline);
//   - flag `subscribed` indicando se o clienteFinal logado já tem sub ativa
//     desse produto (front usa pra trocar CTA "Configurar →" por "Gerenciar").
//
// Diferente de `/integrador/catalog` (que mostra markup editável + flag enabled
// pro integrador configurar quais produtos revende), esta rota é a vitrine
// final pro CLIENTE comprar.
// ═════════════════════════════════════════════════════════════════════════════

marketplaceRouter.get(
  '/catalog',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!

    // Resolve integrador (cliente final via clienteFinal.integradorId; integrador via jwt.integradorId)
    const integradorId = await resolveIntegradorId(req)

    const category = String(req.query.category ?? '').toUpperCase()
    const search = String(req.query.search ?? '').trim()
    const includeComingSoon = req.query.includeComingSoon !== 'false'

    const allowedCategories = new Set(['STORAGE', 'AI', 'TIMELAPSE', 'ADDON'])
    const where: any = { active: true }
    if (category && allowedCategories.has(category)) where.category = category
    if (!includeComingSoon) where.comingSoon = false

    const products = await prisma.marketplaceProduct.findMany({
      where,
      orderBy: [
        { comingSoon: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    })

    // Filtra por search depois (case-insensitive em pt-BR).
    const filtered = search
      ? products.filter(p => {
          const hay = `${p.name} ${p.tagline ?? ''} ${p.description ?? ''}`.toLowerCase()
          return hay.includes(search.toLowerCase())
        })
      : products

    // Resolve markup (por produto se houver; fallback no global do contrato).
    let markupByProduct: Record<string, number> = {}
    let globalMarkup = 30
    if (integradorId) {
      const [integradorProducts, globalMarkupResolved] = await Promise.all([
        prisma.integradorProduct.findMany({
          where: { integradorId, enabled: true },
        }),
        getMarkupForIntegrador(integradorId),
      ])
      globalMarkup = globalMarkupResolved
      for (const ip of integradorProducts) {
        if (ip.markupPct !== null && ip.markupPct !== undefined) {
          markupByProduct[ip.productId] = Number(ip.markupPct)
        }
      }
    }

    // Resolve subscriptions ativas do cliente (pra marcar "Já contratado").
    let subscribedProductIds = new Set<string>()
    if (jwt.clienteFinalId) {
      const subs = await prisma.clienteSubscription.findMany({
        where: {
          clienteFinalId: jwt.clienteFinalId,
          status: { in: ['ACTIVE', 'GRACE'] },
        },
        select: { productId: true },
      })
      subscribedProductIds = new Set(subs.map(s => s.productId))
    }

    const enriched = filtered.map(p => {
      const markup = markupByProduct[p.id] ?? globalMarkup
      const basePriceUsd = Number(p.basePriceUsd)
      const finalPriceBrl = Number(((basePriceUsd * (1 + markup / 100)) * USD_BRL).toFixed(2))
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        category: p.category,
        features: p.features,
        pricingModel: p.pricingModel,
        comingSoon: p.comingSoon,
        sortOrder: p.sortOrder,
        basePriceUsd,
        markupPct: markup,
        /** Preço final em BRL — já com markup do integrador embutido. */
        finalPriceBrl,
        /** Preço "a partir de" pra exibir no card (mesmo que finalPriceBrl no modelo PER_CAMERA_MONTH). */
        fromPriceBrl: finalPriceBrl,
        capabilities: p.capabilities,
        metadata: p.metadata,
        /** Cliente final já tem sub ativa desse produto? (false pra integrador). */
        subscribed: subscribedProductIds.has(p.id),
        /** Trial self-service habilitado pelo fabricante. */
        allowSelfTrial: p.allowSelfTrial,
        /** Duração default do trial em dias. */
        trialDays: p.trialDays,
      }
    })

    res.json({ products: enriched, usdBrl: USD_BRL })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /marketplace/calculate-price
// Recebe { productId, config: { cameraIds?, cameras?, retentionDays?, resolution? } }
// e retorna { finalPriceBrl, breakdown } em tempo real (sem persistir).
//
// Usado pelo QuickPurchaseModal pra mostrar preço enquanto cliente ajusta opções.
// Reaproveita o markup do integrador resolvido pelo JWT do cliente.
// ═════════════════════════════════════════════════════════════════════════════

const calculatePriceSchema = z.object({
  productId: z.string().uuid(),
  config: z.object({
    cameraIds:     z.array(z.string().uuid()).optional(),
    /** Override do qtd de câmeras quando o front ainda não selecionou ids */
    cameras:       z.number().int().min(0).max(10000).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
    resolution:    z.string().optional(),
  }).default({}),
})

marketplaceRouter.post(
  '/calculate-price',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = calculatePriceSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

    const { productId, config } = parsed.data

    const product = await prisma.marketplaceProduct.findUnique({ where: { id: productId } })
    if (!product || !product.active) throw new NotFoundError('Produto não encontrado ou inativo')

    const integradorId = await resolveIntegradorId(req)
    let markup = 30
    if (integradorId) {
      const ip = await prisma.integradorProduct.findUnique({
        where: { integradorId_productId: { integradorId, productId } },
      })
      markup = ip?.markupPct !== null && ip?.markupPct !== undefined
        ? Number(ip.markupPct)
        : await getMarkupForIntegrador(integradorId)
    }

    const cameraCount = Math.max(
      0,
      (config.cameraIds?.length ?? config.cameras ?? 0),
    )

    const basePriceUsd = Number(product.basePriceUsd)
    const pricePerCameraBrl = Number((basePriceUsd * (1 + markup / 100) * USD_BRL).toFixed(2))

    let totalBrl = 0
    let breakdown: Record<string, unknown> = {
      pricingModel: product.pricingModel,
      basePriceUsd,
      markupPct: markup,
      usdBrl: USD_BRL,
      pricePerCameraBrl,
      cameraCount,
    }

    if (product.pricingModel === 'PER_CAMERA_MONTH') {
      totalBrl = Number((pricePerCameraBrl * cameraCount).toFixed(2))
      breakdown = { ...breakdown, formula: `${cameraCount} câm × R$ ${pricePerCameraBrl.toFixed(2)}/câm` }
    } else if (product.pricingModel === 'FLAT_MONTH') {
      totalBrl = pricePerCameraBrl
      breakdown = { ...breakdown, formula: `flat R$ ${pricePerCameraBrl.toFixed(2)}/mês` }
    } else if (product.pricingModel === 'PER_GENERATION') {
      // Sem qtd de gerações conhecida no momento da compra — devolve preço
      // unitário e flagga como "estimativa".
      totalBrl = pricePerCameraBrl
      breakdown = {
        ...breakdown,
        formula: `R$ ${pricePerCameraBrl.toFixed(2)}/geração`,
        estimated: true,
      }
    }

    // Anota a config recebida no breakdown pro debug
    if (config.retentionDays) breakdown.retentionDays = config.retentionDays
    if (config.resolution) breakdown.resolution = config.resolution

    res.json({
      productId,
      productName: product.name,
      finalPriceBrl: totalBrl,
      pricePerCameraBrl,
      cameraCount,
      breakdown,
    })
  }),
)

// ═════════════════════════════════════════════════════════════════════════════
// Fase 3 — Camada Integrador (docs/29 mockup 4)
// ═════════════════════════════════════════════════════════════════════════════
// Endpoints "verbosos" pra UI de gestão de catálogo do integrador:
//   - lista produtos com markup + receita + clientes contratando por produto;
//   - 1 endpoint único pra alternar enabled + markup (PUT estilo upsert);
//   - sumário de receita total + breakdown por produto.
// Coexistem com /integrador/catalog (lista plana) por compatibilidade.
// ═════════════════════════════════════════════════════════════════════════════

// ─── GET /marketplace/integrador/products ────────────────────────────────────
// Lista catálogo do fabricante + status do integrador (enabled, markup) +
// métricas comerciais por produto (clientCount, monthlyRevenueBrl).
marketplaceRouter.get(
  '/integrador/products',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) throw new ForbiddenError()

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const [products, myProducts, globalMarkup, clientesDoIntegrador] = await Promise.all([
      prisma.marketplaceProduct.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.integradorProduct.findMany({ where: { integradorId } }),
      getMarkupForIntegrador(integradorId),
      prisma.clienteFinal.findMany({
        where: { integradorId },
        select: { id: true },
      }),
    ])

    const clienteIds = clientesDoIntegrador.map(c => c.id)

    // Agrega receita ativa por produto pros clientes desse integrador.
    const subsByProduct = clienteIds.length > 0
      ? await prisma.clienteSubscription.groupBy({
          by: ['productId'],
          _count: { _all: true },
          _sum: { finalPriceBrl: true },
          where: {
            clienteFinalId: { in: clienteIds },
            status: 'ACTIVE',
          },
        })
      : []

    const metricsMap = new Map(
      subsByProduct.map(r => [r.productId, {
        clientCount: r._count._all,
        monthlyRevenueBrl: Number(r._sum.finalPriceBrl ?? 0),
      }]),
    )
    const integradorProductMap = new Map(myProducts.map(p => [p.productId, p]))

    const enriched = products.map(p => {
      const ip = integradorProductMap.get(p.id)
      const markup = ip?.markupPct !== null && ip?.markupPct !== undefined
        ? Number(ip.markupPct)
        : globalMarkup
      const basePriceUsd = Number(p.basePriceUsd)
      const finalPriceBrl = Number((basePriceUsd * (1 + markup / 100) * USD_BRL).toFixed(2))
      const m = metricsMap.get(p.id) ?? { clientCount: 0, monthlyRevenueBrl: 0 }

      return {
        id: p.id,
        slug: p.slug,
        category: p.category,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        features: p.features,
        pricingModel: p.pricingModel,
        comingSoon: p.comingSoon,
        basePriceUsd,
        /// Markup efetivo (custom ou global), em %.
        markupPct: markup,
        /// Preço final em BRL/mês cobrado do cliente final.
        finalPriceBrl,
        /// Status do integrador pro produto.
        myStatus: {
          enabled: ip?.enabled ?? false,
          markupPct: ip?.markupPct !== null && ip?.markupPct !== undefined ? Number(ip.markupPct) : null,
          enabledAt: ip?.enabledAt ?? null,
          disabledAt: ip?.disabledAt ?? null,
        },
        /// Métricas comerciais agregadas (apenas subs ACTIVE).
        clientCount: m.clientCount,
        monthlyRevenueBrl: Number(m.monthlyRevenueBrl.toFixed(2)),
      }
    })

    res.json({
      products: enriched,
      globalMarkup,
      usdBrl: USD_BRL,
    })
  }),
)

// ─── PUT /marketplace/integrador/products/:productId ─────────────────────────
// Upsert único: atualiza enabled e/ou markupPct em uma chamada só.
// Body: { enabled?: boolean, markupPct?: number | null }
//   - markupPct=null → volta ao markup global do contrato
//   - omitir o campo → mantém valor atual
const integradorProductUpdateSchema = z.object({
  enabled:   z.boolean().optional(),
  markupPct: z.number().min(0).max(500).nullable().optional(),
})

marketplaceRouter.put(
  '/integrador/products/:productId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) throw new ForbiddenError()

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const parsed = integradorProductUpdateSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)
    const { enabled, markupPct } = parsed.data

    const product = await prisma.marketplaceProduct.findUnique({
      where: { id: String(req.params.productId) },
      select: { id: true, name: true, active: true },
    })
    if (!product || !product.active) throw new NotFoundError('Produto não encontrado ou inativo')

    const now = new Date()
    const existing = await prisma.integradorProduct.findUnique({
      where: { integradorId_productId: { integradorId, productId: product.id } },
    })

    let record
    if (!existing) {
      // Cria com defaults sensatos: enabled=true a menos que vier false explícito.
      record = await prisma.integradorProduct.create({
        data: {
          integradorId,
          productId: product.id,
          enabled:   enabled ?? true,
          markupPct: markupPct === null ? null : (markupPct ?? null),
          enabledAt: enabled === false ? now : now,
          disabledAt: enabled === false ? now : null,
        },
      })
    } else {
      // Update parcial — só os campos enviados.
      const updateData: Record<string, unknown> = {}
      if (enabled !== undefined) {
        updateData.enabled = enabled
        if (enabled && !existing.enabled) updateData.enabledAt = now
        if (!enabled && existing.enabled) updateData.disabledAt = now
        if (enabled && existing.enabled === false) updateData.disabledAt = null
      }
      if (markupPct !== undefined) updateData.markupPct = markupPct
      record = await prisma.integradorProduct.update({
        where: { id: existing.id },
        data: updateData,
      })
    }

    logger.info({
      integradorId,
      productId: product.id,
      enabled: record.enabled,
      markupPct: record.markupPct,
    }, 'integrador_product_updated')

    res.json({ ok: true, integradorProduct: record })
  }),
)

// ─── GET /marketplace/integrador/revenue ─────────────────────────────────────
// Sumário comercial do integrador: MRR total, contagens, breakdown por produto
// e por categoria. Tudo considerando apenas subs ACTIVE dos clientes do tenant.
marketplaceRouter.get(
  '/integrador/revenue',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    if (!isIntegradorAdmin(jwt.role)) throw new ForbiddenError()

    const integradorId = await resolveIntegradorId(req)
    if (!integradorId) throw new ForbiddenError('Integrador não resolvido')

    const clientes = await prisma.clienteFinal.findMany({
      where: { integradorId },
      select: { id: true },
    })
    const clienteIds = clientes.map(c => c.id)

    if (clienteIds.length === 0) {
      res.json({
        mrrTotalBrl: 0,
        clientesTotal: 0,
        clientesAtivos: 0,
        subscriptionsAtivas: 0,
        avgMarkupPct: null,
        byProduct: [],
        byCategory: [],
      })
      return
    }

    const [subs, integradorProducts, globalMarkup] = await Promise.all([
      prisma.clienteSubscription.findMany({
        where: {
          clienteFinalId: { in: clienteIds },
          status: 'ACTIVE',
        },
        select: {
          id: true,
          clienteFinalId: true,
          productId: true,
          finalPriceBrl: true,
          markupPct: true,
          product: { select: { id: true, name: true, slug: true, category: true } },
        },
      }),
      prisma.integradorProduct.findMany({ where: { integradorId } }),
      getMarkupForIntegrador(integradorId),
    ])

    const productMap = new Map<string, {
      productId: string; productName: string; productSlug: string; category: string
      clientes: Set<string>; subs: number; mrrBrl: number
    }>()

    let mrrTotal = 0
    const markupsObservados: number[] = []
    const clientesAtivos = new Set<string>()

    for (const s of subs) {
      mrrTotal += Number(s.finalPriceBrl)
      markupsObservados.push(Number(s.markupPct))
      clientesAtivos.add(s.clienteFinalId)
      if (!productMap.has(s.productId)) {
        productMap.set(s.productId, {
          productId: s.productId,
          productName: s.product.name,
          productSlug: s.product.slug,
          category: s.product.category,
          clientes: new Set(),
          subs: 0,
          mrrBrl: 0,
        })
      }
      const row = productMap.get(s.productId)!
      row.clientes.add(s.clienteFinalId)
      row.subs++
      row.mrrBrl += Number(s.finalPriceBrl)
    }

    const integradorProductMap = new Map(integradorProducts.map(p => [p.productId, p]))

    const byProduct = [...productMap.values()].map(r => {
      const ip = integradorProductMap.get(r.productId)
      const markup = ip?.markupPct !== null && ip?.markupPct !== undefined
        ? Number(ip.markupPct)
        : globalMarkup
      return {
        productId:    r.productId,
        productName:  r.productName,
        productSlug:  r.productSlug,
        category:     r.category,
        clientCount:  r.clientes.size,
        subsCount:    r.subs,
        mrrBrl:       Number(r.mrrBrl.toFixed(2)),
        markupPct:    markup,
      }
    }).sort((a, b) => b.mrrBrl - a.mrrBrl)

    const categoryAgg = new Map<string, { category: string; mrrBrl: number; subsCount: number }>()
    for (const p of byProduct) {
      if (!categoryAgg.has(p.category)) {
        categoryAgg.set(p.category, { category: p.category, mrrBrl: 0, subsCount: 0 })
      }
      const row = categoryAgg.get(p.category)!
      row.mrrBrl += p.mrrBrl
      row.subsCount += p.subsCount
    }
    const byCategory = [...categoryAgg.values()]
      .map(r => ({ ...r, mrrBrl: Number(r.mrrBrl.toFixed(2)) }))
      .sort((a, b) => b.mrrBrl - a.mrrBrl)

    const avgMarkup = markupsObservados.length > 0
      ? Number((markupsObservados.reduce((a, n) => a + n, 0) / markupsObservados.length).toFixed(2))
      : null

    res.json({
      mrrTotalBrl: Number(mrrTotal.toFixed(2)),
      clientesTotal: clienteIds.length,
      clientesAtivos: clientesAtivos.size,
      subscriptionsAtivas: subs.length,
      avgMarkupPct: avgMarkup,
      byProduct,
      byCategory,
      globalMarkup,
    })
  }),
)
