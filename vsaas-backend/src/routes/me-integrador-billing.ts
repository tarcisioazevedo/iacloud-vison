/**
 * me-integrador-billing.ts — painel de cobrança DO INTEGRADOR.
 *
 *   GET    /me/integrador/billing/overview                   → fatura corrente + status
 *   GET    /me/integrador/billing/invoices?status=&limit=    → histórico de invoices
 *   GET    /me/integrador/billing/invoices/:id               → detalhe + lineItems + receipts
 *   POST   /me/integrador/billing/invoices/:id/regenerate    → re-busca invoiceUrl no Asaas (boleto expirou)
 *   GET    /me/integrador/billing/history                    → histórico de PaymentReceipt (últimos 24m)
 *
 * Anti-IDOR: TODOS os endpoints scope estrito por `req.jwtPayload.integradorId`.
 * SUPER_ADMIN não acessa esta rota (usa /admin/billing).
 */
import { Router } from 'express'
import { publicRoute } from '../middleware/require-capability'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, NotFoundError } from '../lib/errors'
import { getPayment, isBillingEnabled } from '../services/asaas.service'

export const meIntegradorBillingRouter = Router()
meIntegradorBillingRouter.use(requireAuth)

function assertIntegradorAdmin(role?: string, integradorId?: string): string {
  if (!integradorId) throw new ForbiddenError('Apenas integradores podem ver billing')
  if (!['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'SUPER_ADMIN', 'ADMIN_GLOBAL'].includes(role ?? '')) {
    throw new ForbiddenError('Acesso negado')
  }
  return integradorId
}

// ── GET /overview ────────────────────────────────────────────────────────────
// Tudo que o integrador precisa pra ver na home do billing:
//   - fatura corrente (mais recente PENDING ou OVERDUE)
//   - última fatura paga
//   - subscription ativa (se houver)
//   - alerta consolidado (atrasada / vence em N dias)

meIntegradorBillingRouter.get('/overview',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = assertIntegradorAdmin(req.jwtPayload?.role, req.jwtPayload?.integradorId)
    const now = new Date()

    const [current, lastPaid, sub, customer, kpiCounts] = await Promise.all([
      // Fatura corrente: a mais recente PENDING ou OVERDUE
      prisma.invoice.findFirst({
        where:   { integradorId, status: { in: ['PENDING', 'OVERDUE'] } },
        orderBy: { dueDate: 'asc' },
        include: { lineItems: true },
      }),
      // Última paga
      prisma.invoice.findFirst({
        where:   { integradorId, status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        select:  { id: true, periodStart: true, totalAmountBrl: true, paidAt: true, billingType: true },
      }),
      // Assinatura ativa (legado — info opcional)
      prisma.asaasSubscription.findFirst({
        where:   { integradorId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.asaasCustomer.findUnique({ where: { integradorId } }),
      // KPIs
      prisma.$transaction([
        prisma.invoice.count({ where: { integradorId, status: 'PAID',     paidAt: { gte: new Date(now.getFullYear(), 0, 1) } } }),
        prisma.invoice.count({ where: { integradorId, status: { in: ['PENDING', 'OVERDUE'] } } }),
        prisma.invoice.count({ where: { integradorId, status: 'OVERDUE' } }),
        prisma.invoice.aggregate({
          where:  { integradorId, status: 'PAID', paidAt: { gte: new Date(now.getFullYear(), 0, 1) } },
          _sum:   { totalAmountBrl: true },
        }),
      ]),
    ])

    let alert: { kind: 'overdue' | 'due_soon' | 'paid' | 'none'; daysUntilDue?: number; daysOverdue?: number } = { kind: 'none' }
    if (current) {
      const days = current.dueDate
        ? Math.ceil((current.dueDate.getTime() - now.getTime()) / 86400_000)
        : null
      if (current.status === 'OVERDUE') alert = { kind: 'overdue', daysOverdue: days != null ? Math.abs(days) : undefined }
      else if (days != null && days <= 3) alert = { kind: 'due_soon', daysUntilDue: days }
    } else if (lastPaid) {
      alert = { kind: 'paid' }
    }

    res.json({
      enabled:   isBillingEnabled(),
      customerConfigured: !!customer,
      current: current ? {
        id:              current.id,
        periodStart:     current.periodStart,
        periodEnd:       current.periodEnd,
        totalAmountBrl:  Number(current.totalAmountBrl),
        status:          current.status,
        dueDate:         current.dueDate,
        billingType:     current.billingType,
        asaasPaymentUrl: current.asaasPaymentUrl,
        lineItems:       current.lineItems.length,
      } : null,
      lastPaid: lastPaid ? {
        ...lastPaid,
        totalAmountBrl: Number(lastPaid.totalAmountBrl),
      } : null,
      subscription: sub ? {
        id:           sub.asaasSubscriptionId,
        planSlug:     sub.planSlug,
        cycle:        sub.cycle,
        value:        Number(sub.value),
        status:       sub.status,
        nextDueDate:  sub.nextDueDate,
        billingType:  sub.billingType,
      } : null,
      counts: {
        paidThisYear:      kpiCounts[0],
        pending:           kpiCounts[1],
        overdue:           kpiCounts[2],
        totalPaidThisYear: Number(kpiCounts[3]._sum.totalAmountBrl ?? 0),
      },
      alert,
    })
  }),
)

// ── GET /invoices ────────────────────────────────────────────────────────────

meIntegradorBillingRouter.get('/invoices',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = assertIntegradorAdmin(req.jwtPayload?.role, req.jwtPayload?.integradorId)
    const limit  = Math.min(Number(req.query.limit ?? 20), 100)
    const status = req.query.status as string | undefined

    const where: any = { integradorId }
    if (status) where.status = status

    const items = await prisma.invoice.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      take:    limit,
      select: {
        id: true, periodStart: true, periodEnd: true,
        totalAmountBrl: true, status: true, dueDate: true, paidAt: true,
        billingType: true, asaasPaymentUrl: true,
        _count: { select: { lineItems: true, receipts: true } },
      },
    })

    res.json(items.map(i => ({
      ...i,
      totalAmountBrl: Number(i.totalAmountBrl),
      lineItemsCount: i._count.lineItems,
      receiptsCount:  i._count.receipts,
      _count: undefined,
    })))
  }),
)

// ── GET /invoices/:id ────────────────────────────────────────────────────────

meIntegradorBillingRouter.get('/invoices/:id',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = assertIntegradorAdmin(req.jwtPayload?.role, req.jwtPayload?.integradorId)
    const inv = await prisma.invoice.findFirst({
      where: { id: req.params.id, integradorId },
      include: {
        lineItems: { orderBy: { subtotalBrl: 'desc' } },
        receipts:  { orderBy: { paidAt: 'desc' } },
      },
    })
    if (!inv) throw new NotFoundError('Fatura não encontrada')

    // Enriquecer lineItems com nome do clienteFinal
    const cfIds = [...new Set(inv.lineItems.map(l => l.clienteFinalId).filter(Boolean))] as string[]
    const cfs = cfIds.length
      ? await prisma.clienteFinal.findMany({ where: { id: { in: cfIds } }, select: { id: true, name: true, tradeName: true } })
      : []
    const cfMap = new Map(cfs.map(c => [c.id, c]))

    res.json({
      ...inv,
      totalAmountBrl: Number(inv.totalAmountBrl),
      lineItems: inv.lineItems.map(l => ({
        ...l,
        unitPriceUsd: Number(l.unitPriceUsd),
        fxRateBrl:    Number(l.fxRateBrl),
        subtotalBrl:  Number(l.subtotalBrl),
        clienteFinal: l.clienteFinalId ? cfMap.get(l.clienteFinalId) ?? null : null,
      })),
      receipts: inv.receipts.map(r => ({ ...r, amountBrl: Number(r.amountBrl) })),
    })
  }),
)

// ── POST /invoices/:id/regenerate ────────────────────────────────────────────
// Re-busca dados do payment no Asaas (caso boleto tenha expirado, etc.)

meIntegradorBillingRouter.post('/invoices/:id/regenerate',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = assertIntegradorAdmin(req.jwtPayload?.role, req.jwtPayload?.integradorId)
    const inv = await prisma.invoice.findFirst({ where: { id: req.params.id, integradorId } })
    if (!inv) throw new NotFoundError('Fatura não encontrada')
    if (!inv.asaasPaymentId) {
      return res.status(409).json({ error: 'no_asaas_payment', message: 'Esta fatura não tem cobrança no Asaas ainda.' })
    }
    if (inv.status === 'PAID') {
      return res.status(409).json({ error: 'already_paid', message: 'Fatura já está paga.' })
    }

    try {
      const pay = await getPayment(inv.asaasPaymentId)
      const updated = await prisma.invoice.update({
        where: { id: inv.id },
        data:  { asaasPaymentUrl: pay.invoiceUrl },
      })
      logger.info({ invoiceId: inv.id, actorUserId: req.jwtPayload?.sub }, 'invoice_payment_link_regenerated')
      res.json({ ok: true, asaasPaymentUrl: updated.asaasPaymentUrl })
    } catch (err: any) {
      logger.warn({ err, invoiceId: inv.id }, 'invoice_payment_link_regenerate_failed')
      res.status(502).json({ error: 'asaas_error', message: err?.message ?? 'unknown' })
    }
  }),
)

// ── Catálogo (IntegradorProduct) — habilita/desabilita + markup ─────────────

// GET /catalogo — todos MarketplaceProduct + status no catálogo do integrador
meIntegradorBillingRouter.get('/catalogo',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = assertIntegradorAdmin(req.jwtPayload?.role, req.jwtPayload?.integradorId)

    const [products, integradorProducts, contract] = await Promise.all([
      prisma.marketplaceProduct.findMany({
        where:   { active: true },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      }),
      prisma.integradorProduct.findMany({ where: { integradorId } }),
      prisma.integradorRetentionContract.findFirst({
        where:  { integradorId, active: true },
        select: { markupPct: true },
      }),
    ])

    const ipMap = new Map(integradorProducts.map(ip => [ip.productId, ip]))
    const defaultMarkup = contract ? Number(contract.markupPct) : 30

    res.json({
      defaultMarkupPct: defaultMarkup,
      products: products.map(p => {
        const ip = ipMap.get(p.id)
        const markup = ip?.markupPct != null ? Number(ip.markupPct) : defaultMarkup
        const baseBrl = Number(p.basePriceUsd) * Number(process.env.USD_TO_BRL ?? 5.20)
        return {
          id:               p.id,
          slug:             p.slug,
          name:             p.name,
          category:         p.category,
          basePriceUsd:     Number(p.basePriceUsd),
          basePriceBrl:     Number(baseBrl.toFixed(2)),
          markupPct:        markup,
          isCustomMarkup:   ip?.markupPct != null,
          finalPriceBrl:    Number((baseBrl * (1 + markup / 100)).toFixed(2)),
          enabled:          ip?.enabled ?? false,
          enabledAt:        ip?.enabledAt ?? null,
        }
      }),
    })
  }),
)

// PUT /catalogo/:productId — habilita produto + define markup
meIntegradorBillingRouter.put('/catalogo/:productId',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = assertIntegradorAdmin(req.jwtPayload?.role, req.jwtPayload?.integradorId)
    const productId = req.params.productId
    const { enabled, markupPct } = req.body ?? {}

    const product = await prisma.marketplaceProduct.findUnique({ where: { id: productId } })
    if (!product) throw new NotFoundError('Produto não encontrado')

    const existing = await prisma.integradorProduct.findFirst({ where: { integradorId, productId } })
    const data = {
      enabled:    enabled !== false,
      markupPct:  markupPct != null ? Number(markupPct) : null,
      enabledAt:  enabled === false ? existing?.enabledAt : new Date(),
      disabledAt: enabled === false ? new Date() : null,
    }

    if (existing) {
      await prisma.integradorProduct.update({ where: { id: existing.id }, data })
    } else {
      await prisma.integradorProduct.create({ data: { integradorId, productId, ...data } as any })
    }

    logger.info({ integradorId, productId, enabled, markupPct }, 'integrador_catalogo_updated')
    res.json({ ok: true })
  }),
)

// ── GET /clientes-contratacoes ───────────────────────────────────────────────
// Lista clientes finais do integrador com suas ClienteSubscriptions agrupadas.
// Aba "Contratações dos clientes".

meIntegradorBillingRouter.get('/clientes-contratacoes',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = assertIntegradorAdmin(req.jwtPayload?.role, req.jwtPayload?.integradorId)

    const clientes = await prisma.clienteFinal.findMany({
      where:   { integradorId, active: true },
      orderBy: { name: 'asc' },
      include: {
        marketplaceSubscriptions: {
          where:   { status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] } },
          include: { product: { select: { slug: true, name: true, category: true } } },
        },
      },
    })

    res.json(clientes.map(cf => {
      const subs = cf.marketplaceSubscriptions
      const totalBrl = subs.reduce((s, sub) =>
        s + Number(sub.finalPriceBrl) * (sub.cameraIds?.length ?? 0), 0)
      const cameras = subs.reduce((s, sub) => s + (sub.cameraIds?.length ?? 0), 0)
      return {
        id:           cf.id,
        name:         cf.tradeName ?? cf.name,
        razaoSocial:  cf.name,
        subscriptionsCount: subs.length,
        cameras,
        totalMensalBrl: Number(totalBrl.toFixed(2)),
        subscriptions: subs.map(s => ({
          id:             s.id,
          status:         s.status,
          startedAt:      s.startedAt,
          productSlug:    s.product.slug,
          productName:    s.product.name,
          category:       s.product.category,
          cameraCount:    s.cameraIds?.length ?? 0,
          finalPriceBrl:  Number(s.finalPriceBrl),
          subtotalBrl:    Number(s.finalPriceBrl) * (s.cameraIds?.length ?? 0),
          trialUntil:     s.trialUntil,
        })),
      }
    }))
  }),
)

// ── GET /dashboard ───────────────────────────────────────────────────────────
// KPIs consolidados pra aba "Resumo": próxima fatura + receita do mês +
// margem estimada + câmeras ativas + atividade recente.

meIntegradorBillingRouter.get('/dashboard',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = assertIntegradorAdmin(req.jwtPayload?.role, req.jwtPayload?.integradorId)
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

    const [
      nextInvoice,
      activeSubs,
      cameras,
      clientes,
      recentPaid,
      recentSubs,
    ] = await Promise.all([
      // Próxima fatura PENDING/OVERDUE
      prisma.invoice.findFirst({
        where: { integradorId, status: { in: ['PENDING', 'OVERDUE'] } },
        orderBy: { dueDate: 'asc' },
        select: { id: true, totalAmountBrl: true, dueDate: true, status: true, asaasPaymentUrl: true },
      }),
      // Subs ativas (calcular receita mensal estimada)
      prisma.clienteSubscription.findMany({
        where: {
          status:       'ACTIVE',
          clienteFinal: { integradorId },
        },
        select: { finalPriceBrl: true, basePriceUsd: true, cameraIds: true },
      }),
      // Câmeras totais do integrador
      prisma.camera.count({
        where: {
          active: true,
          site: { clienteFinal: { integradorId } },
        },
      }),
      prisma.clienteFinal.count({ where: { integradorId, active: true } }),
      prisma.paymentReceipt.findMany({
        where: { integradorId, paidAt: { gte: monthStart } },
        orderBy: { paidAt: 'desc' },
        take: 5,
        select: { id: true, amountBrl: true, billingType: true, paidAt: true },
      }),
      prisma.clienteSubscription.findMany({
        where: {
          clienteFinal: { integradorId },
          startedAt:    { gte: new Date(Date.now() - 30 * 86400_000) },
        },
        orderBy: { startedAt: 'desc' },
        take: 5,
        include: {
          product:      { select: { name: true, slug: true } },
          clienteFinal: { select: { name: true, tradeName: true } },
        },
      }),
    ])

    const USD_TO_BRL = Number(process.env.USD_TO_BRL ?? 5.20)
    const receitaPrevista = activeSubs.reduce((sum, s) => sum + Number(s.finalPriceBrl) * (s.cameraIds?.length ?? 0), 0)
    const custoPrevisto   = activeSubs.reduce((sum, s) => sum + Number(s.basePriceUsd) * (s.cameraIds?.length ?? 0) * USD_TO_BRL, 0)
    const margemEstimada  = receitaPrevista - custoPrevisto

    res.json({
      proximaFatura: nextInvoice ? {
        ...nextInvoice,
        totalAmountBrl: Number(nextInvoice.totalAmountBrl),
      } : null,
      receitaPrevistaMensal: Number(receitaPrevista.toFixed(2)),
      custoPrevistoMensal:   Number(custoPrevisto.toFixed(2)),
      margemEstimadaMensal:  Number(margemEstimada.toFixed(2)),
      margemPct:             receitaPrevista > 0
        ? Number(((margemEstimada / receitaPrevista) * 100).toFixed(1))
        : 0,
      camerasAtivas:    cameras,
      clientesAtivos:   clientes,
      assinaturasAtivas: activeSubs.length,
      atividadeRecente: [
        ...recentSubs.map(s => ({
          kind:      'subscription_created' as const,
          when:      s.startedAt,
          subject:   `${(s.clienteFinal as any).tradeName ?? s.clienteFinal.name} contratou ${s.product.name}`,
          valueBrl:  Number(s.finalPriceBrl) * (s.cameraIds?.length ?? 0),
        })),
        ...recentPaid.map(r => ({
          kind:     'invoice_paid' as const,
          when:     r.paidAt,
          subject:  `Fatura paga via ${r.billingType}`,
          valueBrl: Number(r.amountBrl),
        })),
      ].sort((a, b) => b.when.getTime() - a.when.getTime()).slice(0, 8),
    })
  }),
)

// ── GET /history ─────────────────────────────────────────────────────────────
// Histórico de pagamentos confirmados (PaymentReceipt). Últimos 24 meses.

meIntegradorBillingRouter.get('/history',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = assertIntegradorAdmin(req.jwtPayload?.role, req.jwtPayload?.integradorId)
    const since = new Date()
    since.setMonth(since.getMonth() - 24)

    const receipts = await prisma.paymentReceipt.findMany({
      where: { integradorId, paidAt: { gte: since } },
      orderBy: { paidAt: 'desc' },
      take: 100,
      include: {
        invoice: {
          select: { id: true, periodStart: true, periodEnd: true, totalAmountBrl: true },
        },
      },
    })

    res.json(receipts.map(r => ({
      id:             r.id,
      asaasPaymentId: r.asaasPaymentId,
      amountBrl:      Number(r.amountBrl),
      billingType:    r.billingType,
      paidAt:         r.paidAt,
      invoice: {
        id:             r.invoice.id,
        periodStart:    r.invoice.periodStart,
        periodEnd:      r.invoice.periodEnd,
        totalAmountBrl: Number(r.invoice.totalAmountBrl),
      },
    })))
  }),
)
