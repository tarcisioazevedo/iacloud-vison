/**
 * Admin CRUD de MarketplaceProduct — apenas SUPER_ADMIN / ADMIN_GLOBAL.
 * Padrão: ver src/routes/admin-pricing.ts
 *
 * Endpoints (prefixo /admin/marketplace):
 *   GET    /products              — lista todos (incluindo inativos)
 *   POST   /products              — cria novo produto
 *   PUT    /products/:id          — edita produto
 *   DELETE /products/:id          — soft delete (active=false)
 *   GET    /subscriptions         — lista todas as subscriptions (paginado)
 *   GET    /stats                 — receita total, assinaturas ativas por produto
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireRole } from '../middleware/auth'
import { logger } from '../lib/logger'
import { publicRoute } from '../middleware/require-capability'

export const adminMarketplaceRouter = Router()
adminMarketplaceRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

function uid(req: Request): string | undefined { return (req as any).jwtPayload?.sub }

async function audit(req: Request, action: string, resource: string, resourceId?: string, metadata?: any) {
  try {
    await prisma.auditLog.create({
      data: { superAdminId: uid(req), action, resource, resourceId, metadataJson: metadata ?? undefined },
    })
  } catch (err) { logger.warn({ err }, 'admin_marketplace_audit_failed') }
}

function zodErr(res: Response, parsed: z.SafeParseError<any>) {
  return res.status(400).json({
    error: 'invalid_input',
    issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  })
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const ProductCreateSchema = z.object({
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  category: z.enum(['STORAGE', 'TIMELAPSE', 'AI', 'ADDON']),
  name: z.string().min(1).max(120),
  tagline: z.string().max(200).optional(),
  description: z.string().optional(),
  features: z.array(z.string()).default([]),
  pricingModel: z.enum(['PER_CAMERA_MONTH', 'PER_GENERATION', 'FLAT_MONTH']).default('PER_CAMERA_MONTH'),
  basePriceUsd: z.number().positive(),
  active: z.boolean().default(true),
  comingSoon: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(100),
  metadata: z.record(z.unknown()).optional(),
})

const ProductUpdateSchema = ProductCreateSchema.partial()

// ── GET /admin/marketplace/products ──────────────────────────────────────────

adminMarketplaceRouter.get('/products',
  publicRoute(),
  async (_req, res) => {
  try {
    const products = await prisma.marketplaceProduct.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    res.json({ products, total: products.length })
  } catch (err) {
    logger.error({ err }, 'admin_marketplace_list_products_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── POST /admin/marketplace/products ─────────────────────────────────────────

adminMarketplaceRouter.post('/products',
  publicRoute(),
  async (req, res) => {
  const parsed = ProductCreateSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)

  try {
    const product = await prisma.marketplaceProduct.create({
      data: {
        ...parsed.data,
        metadata: parsed.data.metadata ?? undefined,
      } as any,
    })
    await audit(req, 'CREATE', 'MarketplaceProduct', product.id, { slug: product.slug })
    logger.info({ productId: product.id, slug: product.slug }, 'admin_marketplace_product_created')
    res.status(201).json({ product })
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'conflict', message: 'Slug já existe' })
      return
    }
    logger.error({ err }, 'admin_marketplace_create_product_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── PUT /admin/marketplace/products/:id ──────────────────────────────────────

adminMarketplaceRouter.put('/products/:id',
  publicRoute(),
  async (req, res) => {
  const parsed = ProductUpdateSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)

  try {
    const product = await prisma.marketplaceProduct.update({
      where: { id: String(req.params.id) },
      data: parsed.data as any,
    })
    await audit(req, 'UPDATE', 'MarketplaceProduct', product.id, parsed.data)
    logger.info({ productId: product.id }, 'admin_marketplace_product_updated')
    res.json({ product })
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'not_found', message: 'Produto não encontrado' })
      return
    }
    logger.error({ err }, 'admin_marketplace_update_product_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── DELETE /admin/marketplace/products/:id ────────────────────────────────────

adminMarketplaceRouter.delete('/products/:id',
  publicRoute(),
  async (req, res) => {
  try {
    const product = await prisma.marketplaceProduct.update({
      where: { id: String(req.params.id) },
      data: { active: false },
    })
    await audit(req, 'SOFT_DELETE', 'MarketplaceProduct', product.id)
    logger.info({ productId: product.id }, 'admin_marketplace_product_deactivated')
    res.json({ ok: true, productId: product.id })
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'not_found', message: 'Produto não encontrado' })
      return
    }
    logger.error({ err }, 'admin_marketplace_delete_product_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── GET /admin/marketplace/subscriptions ─────────────────────────────────────

adminMarketplaceRouter.get('/subscriptions',
  publicRoute(),
  async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(Number(req.query.pageSize ?? 50), 200)
    const skip = (page - 1) * pageSize

    const status = req.query.status as string | undefined
    const productId = req.query.productId as string | undefined
    const clienteFinalId = req.query.clienteFinalId as string | undefined

    const where: any = {}
    if (status) where.status = status
    if (productId) where.productId = productId
    if (clienteFinalId) where.clienteFinalId = clienteFinalId

    const [subscriptions, total] = await Promise.all([
      prisma.clienteSubscription.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, slug: true, category: true } },
          clienteFinal: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.clienteSubscription.count({ where }),
    ])

    res.json({ subscriptions, total, page, pageSize, pages: Math.ceil(total / pageSize) })
  } catch (err) {
    logger.error({ err }, 'admin_marketplace_list_subscriptions_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── GET /admin/marketplace/stats ─────────────────────────────────────────────

adminMarketplaceRouter.get('/stats',
  publicRoute(),
  async (_req, res) => {
  try {
    // Receita total das assinaturas ativas
    const activeAgg = await prisma.clienteSubscription.aggregate({
      _sum: { finalPriceBrl: true },
      _count: true,
      where: { status: 'ACTIVE' },
    })

    // Assinaturas ativas por produto
    const byProduct = await prisma.clienteSubscription.groupBy({
      by: ['productId'],
      _count: true,
      _sum: { finalPriceBrl: true },
      where: { status: 'ACTIVE' },
      orderBy: { _count: { productId: 'desc' } },
    })

    // Enriquece com nome do produto
    const productIds = byProduct.map(b => b.productId)
    const products = await prisma.marketplaceProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, slug: true, category: true },
    })
    const productMap = new Map(products.map(p => [p.id, p]))

    const byProductEnriched = byProduct.map(b => ({
      product: productMap.get(b.productId) ?? { id: b.productId },
      activeSubscriptions: b._count,
      monthlyRevenueBrl: Number(b._sum.finalPriceBrl ?? 0).toFixed(2),
    }))

    // Contagem por status
    const byStatus = await prisma.clienteSubscription.groupBy({
      by: ['status'],
      _count: true,
    })

    res.json({
      totalActiveSubscriptions: activeAgg._count,
      totalMonthlyRevenueBrl: Number(activeAgg._sum.finalPriceBrl ?? 0).toFixed(2),
      byProduct: byProductEnriched,
      byStatus: byStatus.map(s => ({ status: s.status, count: s._count })),
    })
  } catch (err) {
    logger.error({ err }, 'admin_marketplace_stats_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── Suspensão e reativação manual (SUPER_ADMIN) ─────────────────────────────

adminMarketplaceRouter.post('/subscriptions/:id/suspend',
  publicRoute(),
  async (req: Request, res: Response) => {
  const { reason } = req.body
  try {
    const sub = await prisma.clienteSubscription.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    })
    if (!sub) return res.status(404).json({ error: 'not_found' })
    if (sub.status === 'SUSPENDED') return res.json({ ok: true, alreadySuspended: true })

    await prisma.clienteSubscription.update({
      where: { id: sub.id },
      data: { status: 'SUSPENDED', updatedAt: new Date() },
    })
    await audit(req, 'SUBSCRIPTION_SUSPENDED', 'ClienteSubscription', sub.id, { reason })
    logger.warn({ subscriptionId: sub.id, by: uid(req), reason }, 'admin_subscription_suspended')
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'admin_subscription_suspend_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

adminMarketplaceRouter.post('/subscriptions/:id/reactivate',
  publicRoute(),
  async (req: Request, res: Response) => {
  const { reason } = req.body
  try {
    const sub = await prisma.clienteSubscription.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    })
    if (!sub) return res.status(404).json({ error: 'not_found' })
    if (sub.status === 'ACTIVE') return res.json({ ok: true, alreadyActive: true })
    if (!['SUSPENDED', 'GRACE'].includes(sub.status)) {
      return res.status(400).json({ error: 'cannot_reactivate', status: sub.status })
    }

    await prisma.clienteSubscription.update({
      where: { id: sub.id },
      data: { status: 'ACTIVE', reactivatedAt: new Date(), updatedAt: new Date() },
    })
    await audit(req, 'SUBSCRIPTION_REACTIVATED', 'ClienteSubscription', sub.id, { reason })
    logger.info({ subscriptionId: sub.id, by: uid(req), reason }, 'admin_subscription_reactivated')
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'admin_subscription_reactivate_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── GET /admin/marketplace/integradores — breakdown por integrador ──────────

adminMarketplaceRouter.get('/integradores',
  publicRoute(),
  async (_req: Request, res: Response) => {
  try {
    // Receita e contagens por integrador (via CF → assinaturas)
    const subs = await prisma.clienteSubscription.findMany({
      where: { status: { in: ['ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELED'] } },
      select: {
        id: true, status: true, finalPriceBrl: true, productId: true,
        clienteFinalId: true,
        clienteFinal: {
          select: {
            id: true, tradeName: true, name: true, integradorId: true,
          },
        },
        product: { select: { category: true } },
      },
    })

    // Resolve integradores em batch
    const integradorIds = [...new Set(subs.map(s => s.clienteFinal.integradorId).filter(Boolean))] as string[]
    const integradores = await prisma.integrador.findMany({
      where: { id: { in: integradorIds } },
      select: { id: true, name: true, tradeName: true },
    })
    const igMap = new Map(integradores.map(ig => [ig.id, ig]))

    // Agrupar por integrador
    const map = new Map<string, {
      integradorId: string; name: string
      active: number; grace: number; suspended: number; canceled: number
      monthlyRevenueBrl: number; cfIds: Set<string>
      storageCount: number; timelapseCount: number; iaCount: number
    }>()

    for (const sub of subs) {
      const igId = sub.clienteFinal.integradorId
      if (!igId) continue
      const ig = igMap.get(igId)
      if (!ig) continue
      if (!map.has(ig.id)) {
        map.set(ig.id, {
          integradorId: ig.id, name: ig.tradeName ?? ig.name,
          active: 0, grace: 0, suspended: 0, canceled: 0,
          monthlyRevenueBrl: 0, cfIds: new Set(),
          storageCount: 0, timelapseCount: 0, iaCount: 0,
        })
      }
      const row = map.get(ig.id)!
      row.cfIds.add(sub.clienteFinal.id)
      if (sub.status === 'ACTIVE') { row.active++; row.monthlyRevenueBrl += Number(sub.finalPriceBrl) }
      if (sub.status === 'GRACE')     row.grace++
      if (sub.status === 'SUSPENDED') row.suspended++
      if (sub.status === 'CANCELED')  row.canceled++
      const cat = sub.product.category
      if (cat === 'STORAGE')    row.storageCount++
      if (cat === 'TIMELAPSE')  row.timelapseCount++
      if (cat === 'AI')         row.iaCount++
    }

    // Timelapse jobs por integrador (últimas 24h)
    const yesterday = new Date(Date.now() - 86400_000)
    const tlJobs = await prisma.timelapseJob.groupBy({
      by: ['integradorId', 'status'],
      _count: true,
      where: { createdAt: { gte: yesterday } },
    })
    const tlMap = new Map<string, { pending: number; processing: number; done: number; failed: number }>()
    for (const j of tlJobs) {
      if (!j.integradorId) continue
      if (!tlMap.has(j.integradorId)) tlMap.set(j.integradorId, { pending: 0, processing: 0, done: 0, failed: 0 })
      const row = tlMap.get(j.integradorId)!
      if (j.status === 'PENDING')    row.pending    += j._count
      if (j.status === 'PROCESSING') row.processing += j._count
      if (j.status === 'DONE')       row.done       += j._count
      if (j.status === 'FAILED')     row.failed     += j._count
    }

    const result = [...map.values()].map(row => ({
      integradorId:      row.integradorId,
      name:              row.name,
      totalClientes:     row.cfIds.size,
      activeSubscriptions: row.active,
      graceSubscriptions:  row.grace,
      suspendedSubscriptions: row.suspended,
      canceledSubscriptions:  row.canceled,
      monthlyRevenueBrl: row.monthlyRevenueBrl.toFixed(2),
      storageCount:      row.storageCount,
      timelapseCount:    row.timelapseCount,
      iaCount:           row.iaCount,
      tlJobs24h:         tlMap.get(row.integradorId) ?? { pending: 0, processing: 0, done: 0, failed: 0 },
    })).sort((a, b) => Number(b.monthlyRevenueBrl) - Number(a.monthlyRevenueBrl))

    // Totais globais
    const totals = result.reduce((acc, r) => ({
      integradores:   acc.integradores + 1,
      clientes:       acc.clientes + r.totalClientes,
      active:         acc.active + r.activeSubscriptions,
      grace:          acc.grace + r.graceSubscriptions,
      suspended:      acc.suspended + r.suspendedSubscriptions,
      revenueBrl:     acc.revenueBrl + Number(r.monthlyRevenueBrl),
    }), { integradores: 0, clientes: 0, active: 0, grace: 0, suspended: 0, revenueBrl: 0 })

    res.json({
      totals: { ...totals, revenueBrl: totals.revenueBrl.toFixed(2) },
      integradores: result,
    })
  } catch (err) {
    logger.error({ err }, 'admin_marketplace_integradores_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Fase 4 — Camada Fabricante (docs/29 mockup 5)
// ═════════════════════════════════════════════════════════════════════════════

// ─── POST /admin/marketplace/products/:id/sunset ─────────────────────────────
// Marca produto como SUNSET com aviso de 90d aos integradores.
// Não muda `active`/`comingSoon` imediatamente — só anota metadata
// (`sunsetAt`, `sunsetMessage`, `sunsetHideAt`) pra UI/integrador.
// Após `sunsetHideAt` ser atingido, um cron separado pode desativar.
const SunsetSchema = z.object({
  graceDays: z.number().int().min(1).max(365).default(90),
  message:   z.string().max(500).optional(),
})

adminMarketplaceRouter.post('/products/:id/sunset',
  publicRoute(),
  async (req: Request, res: Response) => {
  const parsed = SunsetSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)

  try {
    const product = await prisma.marketplaceProduct.findUnique({
      where: { id: String(req.params.id) },
    })
    if (!product) return res.status(404).json({ error: 'not_found' })

    const now = new Date()
    const hideAt = new Date(now.getTime() + parsed.data.graceDays * 24 * 60 * 60 * 1000)
    const existing = (product.metadata && typeof product.metadata === 'object')
      ? (product.metadata as Record<string, unknown>) : {}

    const newMetadata = {
      ...existing,
      sunsetAt:      now.toISOString(),
      sunsetHideAt:  hideAt.toISOString(),
      sunsetMessage: parsed.data.message ?? null,
      sunsetGraceDays: parsed.data.graceDays,
    }

    const updated = await prisma.marketplaceProduct.update({
      where: { id: product.id },
      data: { metadata: newMetadata },
    })
    await audit(req, 'PRODUCT_SUNSET_STARTED', 'MarketplaceProduct', product.id, {
      graceDays: parsed.data.graceDays,
      hideAt: hideAt.toISOString(),
    })
    logger.warn({ productId: product.id, hideAt }, 'admin_marketplace_product_sunset')
    res.json({ ok: true, product: updated })
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'not_found' })
      return
    }
    logger.error({ err }, 'admin_marketplace_sunset_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── DELETE /admin/marketplace/products/:id/sunset ───────────────────────────
// Cancela um sunset em andamento (remove metadata.sunset*).
adminMarketplaceRouter.delete('/products/:id/sunset',
  publicRoute(),
  async (req: Request, res: Response) => {
  try {
    const product = await prisma.marketplaceProduct.findUnique({
      where: { id: String(req.params.id) },
    })
    if (!product) return res.status(404).json({ error: 'not_found' })

    const existing = (product.metadata && typeof product.metadata === 'object')
      ? (product.metadata as Record<string, unknown>) : {}
    const clean = { ...existing }
    delete clean.sunsetAt
    delete clean.sunsetHideAt
    delete clean.sunsetMessage
    delete clean.sunsetGraceDays

    await prisma.marketplaceProduct.update({
      where: { id: product.id },
      data: { metadata: clean as any },
    })
    await audit(req, 'PRODUCT_SUNSET_CANCELED', 'MarketplaceProduct', product.id)
    res.json({ ok: true })
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'not_found' })
      return
    }
    logger.error({ err }, 'admin_marketplace_sunset_cancel_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── GET /admin/marketplace/analytics ────────────────────────────────────────
// Analytics da rede pro fabricante: MRR total + top produtos + churn +
// adoção por integrador + tendência últimos 6 meses.
adminMarketplaceRouter.get('/analytics',
  publicRoute(),
  async (_req: Request, res: Response) => {
  try {
    const now = new Date()
    const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const since6m  = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

    const [
      activeAgg,
      productMetricsRaw,
      productCatalog,
      canceledLast30d,
      activeLast30d,
      newSubsLast6m,
      integradorAdoptionRaw,
      integradoresCount,
    ] = await Promise.all([
      prisma.clienteSubscription.aggregate({
        _sum: { finalPriceBrl: true },
        _count: true,
        where: { status: 'ACTIVE' },
      }),
      prisma.clienteSubscription.groupBy({
        by: ['productId'],
        _count: true,
        _sum: { finalPriceBrl: true },
        where: { status: 'ACTIVE' },
      }),
      prisma.marketplaceProduct.findMany({
        select: { id: true, name: true, slug: true, category: true, active: true, comingSoon: true },
      }),
      prisma.clienteSubscription.count({
        where: { canceledAt: { gte: since30d, not: null } },
      }),
      prisma.clienteSubscription.count({
        where: { status: 'ACTIVE', startedAt: { lt: since30d } },
      }),
      prisma.clienteSubscription.findMany({
        where: { startedAt: { gte: since6m } },
        select: { startedAt: true, productId: true, finalPriceBrl: true },
      }),
      prisma.integradorProduct.groupBy({
        by: ['productId'],
        _count: true,
        where: { enabled: true },
      }),
      prisma.integrador.count({ where: { active: true } }),
    ])

    const productMap = new Map(productCatalog.map(p => [p.id, p]))

    // Top produtos por MRR
    const topProducts = productMetricsRaw.map(p => {
      const meta = productMap.get(p.productId)
      return {
        productId:           p.productId,
        productName:         meta?.name ?? p.productId,
        slug:                meta?.slug ?? null,
        category:            meta?.category ?? null,
        activeSubscriptions: p._count,
        mrrBrl:              Number(p._sum.finalPriceBrl ?? 0),
      }
    }).sort((a, b) => b.mrrBrl - a.mrrBrl)

    // Churn mensal (rolling 30d)
    const churnPct = activeLast30d > 0
      ? Number((canceledLast30d / activeLast30d * 100).toFixed(2))
      : 0

    // Tendência últimos 6 meses: agrupar new subs por mês YYYY-MM
    const monthMap = new Map<string, { month: string; newSubs: number; addedMrrBrl: number }>()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(key, { month: key, newSubs: 0, addedMrrBrl: 0 })
    }
    for (const s of newSubsLast6m) {
      const d = s.startedAt
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const row = monthMap.get(key)
      if (row) {
        row.newSubs++
        row.addedMrrBrl += Number(s.finalPriceBrl)
      }
    }
    const monthlyTrend = [...monthMap.values()]
      .map(r => ({ ...r, addedMrrBrl: Number(r.addedMrrBrl.toFixed(2)) }))

    // Adoção por integrador (quantos enabled cada produto, vs total integradores)
    const integradorAdoption = integradorAdoptionRaw.map(p => {
      const meta = productMap.get(p.productId)
      return {
        productId:           p.productId,
        productName:         meta?.name ?? p.productId,
        slug:                meta?.slug ?? null,
        integradoresAtivos:  p._count,
        integradoresTotal:   integradoresCount,
        adoptionPct: integradoresCount > 0
          ? Number((p._count / integradoresCount * 100).toFixed(1))
          : 0,
      }
    }).sort((a, b) => b.integradoresAtivos - a.integradoresAtivos)

    res.json({
      mrrTotalBrl:           Number((activeAgg._sum.finalPriceBrl ?? 0)).toFixed(2),
      activeSubscriptions:   activeAgg._count,
      churnPctMensal:        churnPct,
      canceledLast30d,
      activeProductsCount:   productCatalog.filter(p => p.active && !p.comingSoon).length,
      totalProductsCount:    productCatalog.length,
      integradoresAtivos:    integradoresCount,
      topProducts:           topProducts.slice(0, 10),
      monthlyTrend,
      integradorAdoption,
    })
  } catch (err) {
    logger.error({ err }, 'admin_marketplace_analytics_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── GET /admin/marketplace/timelapse-jobs — monitor global de TimelapseJobs ─

adminMarketplaceRouter.get('/timelapse-jobs',
  publicRoute(),
  async (req: Request, res: Response) => {
  try {
    const { status, limit = '50', integradorId } = req.query as Record<string, string>
    const where: any = {}
    if (status) where.status = status
    if (integradorId) where.integradorId = integradorId

    const [jobs, total] = await Promise.all([
      prisma.timelapseJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        select: {
          id: true, cameraId: true, integradorId: true, clienteFinalId: true,
          type: true, status: true, attempts: true,
          periodStart: true, periodEnd: true,
          speedFactor: true, durationSec: true, fileSizeBytes: true,
          generatedAt: true, expiresAt: true, errorMessage: true,
          createdAt: true, updatedAt: true,
          camera: { select: { name: true } },
        },
      }),
      prisma.timelapseJob.count({ where }),
    ])

    res.json({
      jobs: jobs.map(j => ({ ...j, fileSizeBytes: j.fileSizeBytes?.toString() ?? null })),
      total,
    })
  } catch (err) {
    logger.error({ err }, 'admin_timelapse_jobs_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})
