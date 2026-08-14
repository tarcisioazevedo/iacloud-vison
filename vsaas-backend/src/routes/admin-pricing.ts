/**
 * Admin CRUD do Pricing CMS — só SUPER_ADMIN edita o master (tenantId=null).
 * Overrides por integrador são feitos em /me/integrador/pricing/*.
 *
 * Endpoints (prefixo /admin/pricing):
 *   GET    /full
 *   GET    /plans   POST /plans   PATCH/DELETE /plans/:slug
 *   GET    /ais     POST /ais     PATCH/DELETE /ais/:slug
 *   GET    /vms     PUT bulk      PATCH /vms/:resolution/:days
 *   GET/PUT /hero
 *   GET/PUT /settings
 *   GET    /competitors  POST  PATCH/DELETE /:id
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireRole } from '../middleware/auth'
import { invalidatePricingCache } from './pricing'
import { logger } from '../lib/logger'
import { publicRoute } from '../middleware/require-capability'

const router = Router()
router.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

function uid(req: Request): string | undefined { return req.jwtPayload?.sub }
async function audit(req: Request, action: string, resource: string, resourceId?: string, metadata?: any) {
  try {
    await prisma.auditLog.create({
      data: { superAdminId: uid(req), action, resource, resourceId, metadataJson: metadata ?? undefined },
    })
  } catch (err) { logger.warn({ err }, 'admin_pricing_audit_failed') }
}
function zodErr(res: Response, parsed: z.SafeParseError<any>) {
  return res.status(400).json({
    error: 'invalid_input',
    issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  })
}

router.get('/full',
  publicRoute(),
  async (_req, res) => {
  const [hero, settings, plans, ais, vms, competitors] = await Promise.all([
    prisma.pricingHero.findFirst(),
    prisma.pricingSettings.findFirst(),
    prisma.platformPlan.findMany({ where: { tenantId: null }, orderBy: { displayOrder: 'asc' } }),
    prisma.aIAddonPlan.findMany({ orderBy: { displayOrder: 'asc' } }),
    prisma.vMSStoragePrice.findMany({ orderBy: [{ resolution: 'asc' }, { days: 'asc' }] }),
    prisma.competitorComparison.findMany({ orderBy: { displayOrder: 'asc' } }),
  ])
  res.json({ hero, settings, plans, ais, vms, competitors })
})

// ─── PlatformPlan (master) ──────────────────────────────────────
const PlanCreateSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  tagline: z.string().min(1),
  priceMonthly: z.number().nullable().optional(),
  priceMonuv: z.number().nullable().optional(),
  wholesalePriceMonthly: z.number().nullable().optional(),
  connections: z.string().min(1),
  retention: z.string().min(1),
  totalAIs: z.string().min(1),
  ctaLabel: z.string().min(1),
  ctaKind: z.enum(['self-service', 'consultant']),
  ctaUrl: z.string().url().nullable().optional(),
  highlights: z.array(z.string()).default([]),
  recommended: z.boolean().default(false),
  accent: z.string().default('cyan'),
  maxCameras: z.number().int().nullable().optional(),
  retentionDays: z.number().int().nullable().optional(),
  modulesIncluded: z.array(z.string()).optional(),
  edgeBoxScenario: z.string().nullable().optional(),
  displayOrder: z.number().int().default(0),
  publicVisible: z.boolean().default(true),

  // ── Sprint 0 (Variação B revenda B2B2B) ──────────────────────────────
  /// Limite de clientes finais. null = ilimitado (Enterprise).
  maxClientesFinais: z.number().int().min(0).nullable().optional(),
  /// Preço mensal por cliente adicional acima do limite.
  extraClientePriceBrl: z.number().min(0).nullable().optional(),
  /// Preço mensal por câmera adicional acima do limite.
  extraCameraPriceBrl: z.number().min(0).nullable().optional(),
  /// Marca o plano como Trial Free (não cobra mensalidade, expira).
  isTrial: z.boolean().default(false),
  /// Duração em dias (só relevante se isTrial=true).
  trialDays: z.number().int().min(0).default(0),
  /// "soft" cobra adicional automaticamente | "hard" bloqueia cadastro.
  enforcementMode: z.enum(['soft', 'hard']).default('soft'),
  /// Versão do pricing. Incrementar quando mudar valores.
  pricingVersion: z.number().int().min(1).default(1),
}).passthrough()
const PlanUpdateSchema = PlanCreateSchema.partial().extend({ archived: z.boolean().optional() })

router.get('/plans',
  publicRoute(),
  async (_req, res) => {
  res.json(await prisma.platformPlan.findMany({ where: { tenantId: null }, orderBy: { displayOrder: 'asc' } }))
})

router.post('/plans',
  publicRoute(),
  async (req, res) => {
  const parsed = PlanCreateSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const data = parsed.data
  try {
    const plan = await prisma.platformPlan.create({
      data: { ...data, tenantId: null, isOverride: false, modulesIncluded: data.modulesIncluded as any, updatedBy: uid(req) },
    })
    invalidatePricingCache()
    await audit(req, 'PRICING_PLAN_CREATED', 'PlatformPlan', plan.id, { slug: plan.slug })
    res.status(201).json(plan)
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'slug_already_exists' })
    throw err
  }
})

router.patch('/plans/:slug',
  publicRoute(),
  async (req, res) => {
  const parsed = PlanUpdateSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const data = parsed.data
  const existing = await prisma.platformPlan.findFirst({ where: { tenantId: null, slug: req.params.slug }, select: { id: true } })
  if (!existing) return res.status(404).json({ error: 'plan_not_found' })
  const plan = await prisma.platformPlan.update({
    where: { id: existing.id },
    data: { ...data, modulesIncluded: data.modulesIncluded as any, updatedBy: uid(req) },
  })
  invalidatePricingCache()
  await audit(req, 'PRICING_PLAN_UPDATED', 'PlatformPlan', plan.id, { slug: plan.slug, fields: Object.keys(data) })
  res.json(plan)
})

router.delete('/plans/:slug',
  publicRoute(),
  async (req, res) => {
  const existing = await prisma.platformPlan.findFirst({ where: { tenantId: null, slug: req.params.slug }, select: { id: true } })
  if (!existing) return res.status(404).json({ error: 'plan_not_found' })

  // Sprint 0: bloqueia archive se houver integradores ativos no plano
  const inUse = await prisma.integrador.count({ where: { planId: existing.id, active: true } })
  if (inUse > 0) {
    return res.status(409).json({ error: 'plan_in_use', message: `${inUse} integrador(es) ativos usam este plano. Mude-os antes de arquivar.`, integradoresCount: inUse })
  }

  const plan = await prisma.platformPlan.update({
    where: { id: existing.id },
    data: { archived: true, publicVisible: false, updatedBy: uid(req) },
  })
  invalidatePricingCache()
  await audit(req, 'PRICING_PLAN_ARCHIVED', 'PlatformPlan', plan.id, { slug: plan.slug })
  res.json({ ok: true })
})

// ─── AIAddonPlan ──────────────────────────────────────────
const AICreateSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1), iconKey: z.string().min(1),
  priceIACV: z.number().nullable().optional(),
  priceMonuv: z.number().nullable().optional(),
  exclusive: z.boolean().default(false),
  color: z.string().default('text-cyan-400'),
  description: z.string().nullable().optional(),
  analyticsModel: z.string().nullable().optional(),
  displayOrder: z.number().int().default(0),
  publicVisible: z.boolean().default(true),
}).passthrough()
const AIUpdateSchema = AICreateSchema.partial().extend({ archived: z.boolean().optional() })

router.get('/ais',
  publicRoute(),
  async (_req, res) => res.json(await prisma.aIAddonPlan.findMany({ orderBy: { displayOrder: 'asc' } })))
router.post('/ais',
  publicRoute(),
  async (req, res) => {
  const parsed = AICreateSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  try {
    const ai = await prisma.aIAddonPlan.create({
      data: { ...parsed.data, analyticsModel: parsed.data.analyticsModel as any, updatedBy: uid(req) },
    })
    invalidatePricingCache()
    await audit(req, 'PRICING_AI_CREATED', 'AIAddonPlan', ai.id, { slug: ai.slug })
    res.status(201).json(ai)
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'slug_already_exists' })
    throw err
  }
})
router.patch('/ais/:slug',
  publicRoute(),
  async (req, res) => {
  const parsed = AIUpdateSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const ai = await prisma.aIAddonPlan.update({
    where: { slug: req.params.slug },
    data: { ...parsed.data, analyticsModel: parsed.data.analyticsModel as any, updatedBy: uid(req) },
  }).catch((err: any) => err.code === 'P2025' ? null : Promise.reject(err))
  if (!ai) return res.status(404).json({ error: 'ai_not_found' })
  invalidatePricingCache()
  await audit(req, 'PRICING_AI_UPDATED', 'AIAddonPlan', ai.id)
  res.json(ai)
})
router.delete('/ais/:slug',
  publicRoute(),
  async (req, res) => {
  const ai = await prisma.aIAddonPlan.update({
    where: { slug: req.params.slug },
    data: { archived: true, publicVisible: false, updatedBy: uid(req) },
  }).catch((err: any) => err.code === 'P2025' ? null : Promise.reject(err))
  if (!ai) return res.status(404).json({ error: 'ai_not_found' })
  invalidatePricingCache()
  await audit(req, 'PRICING_AI_ARCHIVED', 'AIAddonPlan', ai.id)
  res.json({ ok: true })
})

// ─── VMS ───────────────────────────────────────────────────
const VMSCellSchema = z.object({
  resolution: z.string().min(1),
  days: z.number().int().nonnegative(),
  priceIACV: z.number().nonnegative(),
  priceMonuv: z.number().nullable().optional(),
  active: z.boolean().default(true),
})
router.get('/vms',
  publicRoute(),
  async (_req, res) => res.json(await prisma.vMSStoragePrice.findMany({ orderBy: [{ resolution: 'asc' }, { days: 'asc' }] })))
router.put('/vms',
  publicRoute(),
  async (req, res) => {
  const parsed = z.array(VMSCellSchema).safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const results = []
  for (const c of parsed.data) {
    const r = await prisma.vMSStoragePrice.upsert({
      where: { resolution_days: { resolution: c.resolution, days: c.days } },
      update: { priceIACV: c.priceIACV, priceMonuv: c.priceMonuv, active: c.active, updatedBy: uid(req) },
      create: { resolution: c.resolution, days: c.days, priceIACV: c.priceIACV, priceMonuv: c.priceMonuv ?? null, active: c.active, updatedBy: uid(req) },
    })
    results.push(r)
  }
  invalidatePricingCache()
  await audit(req, 'PRICING_VMS_BULK_UPDATED', 'VMSStoragePrice', undefined, { count: parsed.data.length })
  res.json(results)
})

// ─── Hero (singleton) ──────────────────────────────────────
const HeroSchema = z.object({
  tagline: z.string().min(1).optional(),
  headline: z.string().min(1).optional(),
  headlineHighlights: z.any().optional(),
  subtitle: z.string().min(1).optional(),
  ctaLoginText: z.string().optional(),
  ctaLoginUrl: z.string().optional(),
  ctaConsultantText: z.string().optional(),
  ctaConsultantUrl: z.string().nullable().optional(),
  active: z.boolean().optional(),
}).passthrough()
router.get('/hero',
  publicRoute(),
  async (_req, res) => res.json(await prisma.pricingHero.findFirst()))
router.put('/hero',
  publicRoute(),
  async (req, res) => {
  const parsed = HeroSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const data = { ...parsed.data, updatedBy: uid(req) }
  const existing = await prisma.pricingHero.findFirst()
  const hero = existing
    ? await prisma.pricingHero.update({ where: { id: existing.id }, data })
    : await prisma.pricingHero.create({ data: data as any })
  invalidatePricingCache()
  await audit(req, 'PRICING_HERO_UPDATED', 'PricingHero', hero.id)
  res.json(hero)
})

// ─── Settings (singleton) ───────────────────────────────────
const SettingsSchema = z.object({
  showAnnualToggle: z.boolean().optional(),
  annualDiscountPct: z.number().int().min(0).max(100).optional(),
  showTabPlans: z.boolean().optional(),
  showTabAIs: z.boolean().optional(),
  showTabVMS: z.boolean().optional(),
  showCompetitorSection: z.boolean().optional(),
  defaultCurrency: z.string().optional(),
}).passthrough()
router.get('/settings',
  publicRoute(),
  async (_req, res) => res.json(await prisma.pricingSettings.findFirst()))
router.put('/settings',
  publicRoute(),
  async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const data = { ...parsed.data, updatedBy: uid(req) }
  const existing = await prisma.pricingSettings.findFirst()
  const s = existing
    ? await prisma.pricingSettings.update({ where: { id: existing.id }, data })
    : await prisma.pricingSettings.create({ data: data as any })
  invalidatePricingCache()
  await audit(req, 'PRICING_SETTINGS_UPDATED', 'PricingSettings', s.id)
  res.json(s)
})

// ─── Competitors ───────────────────────────────────────────
const CompetitorSchema = z.object({
  iconKey: z.string().min(1), label: z.string().min(1),
  ourValue: z.string().min(1), ourValueColor: z.string().default('text-cyan-400'),
  theirValue: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  displayOrder: z.number().int().default(0),
  active: z.boolean().default(true),
}).passthrough()
router.get('/competitors',
  publicRoute(),
  async (_req, res) => res.json(await prisma.competitorComparison.findMany({ orderBy: { displayOrder: 'asc' } })))
router.post('/competitors',
  publicRoute(),
  async (req, res) => {
  const parsed = CompetitorSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const c = await prisma.competitorComparison.create({ data: { ...parsed.data, updatedBy: uid(req) } })
  invalidatePricingCache()
  await audit(req, 'PRICING_COMPETITOR_CREATED', 'CompetitorComparison', c.id, { label: c.label })
  res.status(201).json(c)
})
router.patch('/competitors/:id',
  publicRoute(),
  async (req, res) => {
  const parsed = CompetitorSchema.partial().safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const c = await prisma.competitorComparison.update({
    where: { id: req.params.id },
    data: { ...parsed.data, updatedBy: uid(req) },
  }).catch((err: any) => err.code === 'P2025' ? null : Promise.reject(err))
  if (!c) return res.status(404).json({ error: 'competitor_not_found' })
  invalidatePricingCache()
  await audit(req, 'PRICING_COMPETITOR_UPDATED', 'CompetitorComparison', c.id)
  res.json(c)
})
router.delete('/competitors/:id',
  publicRoute(),
  async (req, res) => {
  const c = await prisma.competitorComparison.delete({ where: { id: req.params.id } })
    .catch((err: any) => err.code === 'P2025' ? null : Promise.reject(err))
  if (!c) return res.status(404).json({ error: 'competitor_not_found' })
  invalidatePricingCache()
  await audit(req, 'PRICING_COMPETITOR_DELETED', 'CompetitorComparison', c.id, { label: c.label })
  res.json({ ok: true })
})

export default router
