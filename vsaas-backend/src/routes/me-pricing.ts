/**
 * Pricing CMS por tenant (integrador) — gated por capability "pricing".
 *
 * Floor: priceMonthly do override NUNCA pode ser menor que
 * wholesalePriceMonthly do master correspondente.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { resolveIntegradorId } from '../middleware/tenant-context'
import { invalidatePricingCache } from './pricing'

const router = Router()

function uid(req: Request): string | undefined { return req.jwtPayload?.sub }
function tenant(req: Request): string | null { return resolveIntegradorId(req) }
function zodErr(res: Response, parsed: z.SafeParseError<any>) {
  return res.status(400).json({
    error: 'invalid_input',
    issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  })
}
async function audit(req: Request, action: string, resource: string, resourceId?: string, metadata?: any) {
  try {
    await prisma.auditLog.create({
      data: {
        integradorId: tenant(req) ?? undefined,
        superAdminId: req.jwtPayload?.role === 'SUPER_ADMIN' ? uid(req) : undefined,
        action, resource, resourceId,
        metadataJson: metadata ?? undefined,
      },
    })
  } catch (err) { console.warn('[me-pricing] audit failed', err) }
}

async function mergePlansForTenant(integradorId: string) {
  const [masters, overrides] = await Promise.all([
    prisma.platformPlan.findMany({ where: { tenantId: null, archived: false }, orderBy: { displayOrder: 'asc' } }),
    prisma.platformPlan.findMany({ where: { tenantId: integradorId, archived: false }, orderBy: { displayOrder: 'asc' } }),
  ])
  const overrideBySlug = new Map(overrides.map(o => [o.slug, o]))
  return masters.map(m => {
    const o = overrideBySlug.get(m.slug)
    if (!o) return { ...m, _isOverride: false, _hasOverride: false, _wholesalePriceMonthly: m.wholesalePriceMonthly }
    return {
      ...m,
      priceMonthly: o.priceMonthly,
      priceMonuv: o.priceMonuv,
      tagline: o.tagline ?? m.tagline,
      ctaLabel: o.ctaLabel ?? m.ctaLabel,
      ctaUrl: o.ctaUrl ?? m.ctaUrl,
      highlights: (o.highlights && o.highlights.length > 0) ? o.highlights : m.highlights,
      accent: o.accent ?? m.accent,
      recommended: o.recommended,
      publicVisible: o.publicVisible,
      _isOverride: true, _hasOverride: true, _overrideId: o.id,
      _wholesalePriceMonthly: m.wholesalePriceMonthly,
    }
  })
}

router.get('/full', async (req, res) => {
  const integradorId = tenant(req)
  if (!integradorId) {
    if (req.jwtPayload?.role === 'SUPER_ADMIN' || req.jwtPayload?.role === 'ADMIN_GLOBAL') {
      const masters = await prisma.platformPlan.findMany({ where: { tenantId: null, archived: false }, orderBy: { displayOrder: 'asc' } })
      return res.json({ scope: 'global', plans: masters })
    }
    return res.status(401).json({ error: 'no_tenant_context' })
  }
  const [plans, hero, settings] = await Promise.all([
    mergePlansForTenant(integradorId),
    prisma.pricingHero.findFirst({ where: { active: true } }),
    prisma.pricingSettings.findFirst(),
  ])
  res.json({ scope: 'tenant', integradorId, plans, hero, settings })
})

const OverrideCreateSchema = z.object({
  priceMonthly: z.number().nullable().optional(),
  priceMonuv: z.number().nullable().optional(),
  tagline: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaUrl: z.string().nullable().optional(),
  highlights: z.array(z.string()).optional(),
  accent: z.string().optional(),
  recommended: z.boolean().optional(),
  publicVisible: z.boolean().optional(),
}).passthrough()

router.post('/plans/:slug/override', async (req, res) => {
  const integradorId = tenant(req)
  if (!integradorId) return res.status(401).json({ error: 'no_tenant_context' })

  const parsed = OverrideCreateSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const data = parsed.data

  const master = await prisma.platformPlan.findFirst({ where: { tenantId: null, slug: req.params.slug } })
  if (!master) return res.status(404).json({ error: 'master_plan_not_found' })

  if (data.priceMonthly !== null && data.priceMonthly !== undefined && master.wholesalePriceMonthly) {
    const floor = Number(master.wholesalePriceMonthly)
    if (Number(data.priceMonthly) < floor) {
      return res.status(400).json({
        error: 'price_below_wholesale_floor', floor,
        message: `Preço de override não pode ser inferior ao atacado (R$ ${floor.toFixed(2)}).`,
      })
    }
  }

  try {
    const override = await prisma.platformPlan.create({
      data: {
        tenantId: integradorId, isOverride: true,
        slug: master.slug, name: master.name,
        connections: master.connections, retention: master.retention,
        totalAIs: master.totalAIs, ctaKind: master.ctaKind,
        modulesIncluded: master.modulesIncluded, edgeBoxScenario: master.edgeBoxScenario,
        maxCameras: master.maxCameras, retentionDays: master.retentionDays,
        displayOrder: master.displayOrder,
        tagline: data.tagline ?? master.tagline,
        priceMonthly: data.priceMonthly === null ? null : data.priceMonthly === undefined ? master.priceMonthly : data.priceMonthly,
        priceMonuv: data.priceMonuv === null ? null : data.priceMonuv === undefined ? master.priceMonuv : data.priceMonuv,
        ctaLabel: data.ctaLabel ?? master.ctaLabel,
        ctaUrl: data.ctaUrl ?? master.ctaUrl,
        highlights: data.highlights ?? master.highlights,
        accent: data.accent ?? master.accent,
        recommended: data.recommended ?? master.recommended,
        publicVisible: data.publicVisible ?? master.publicVisible,
        updatedBy: uid(req),
      },
    })
    invalidatePricingCache(integradorId)
    invalidatePricingCache(null)
    await audit(req, 'PRICING_TENANT_OVERRIDE_CREATED', 'PlatformPlan', override.id, { slug: master.slug })
    res.status(201).json(override)
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'override_already_exists' })
    throw err
  }
})

router.patch('/plans/:slug', async (req, res) => {
  const integradorId = tenant(req)
  if (!integradorId) return res.status(401).json({ error: 'no_tenant_context' })

  const parsed = OverrideCreateSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const data = parsed.data

  const master = await prisma.platformPlan.findFirst({ where: { tenantId: null, slug: req.params.slug } })
  if (!master) return res.status(404).json({ error: 'master_plan_not_found' })

  if (data.priceMonthly !== null && data.priceMonthly !== undefined && master.wholesalePriceMonthly) {
    const floor = Number(master.wholesalePriceMonthly)
    if (Number(data.priceMonthly) < floor) {
      return res.status(400).json({
        error: 'price_below_wholesale_floor', floor,
        message: `Preço de override não pode ser inferior ao atacado (R$ ${floor.toFixed(2)}).`,
      })
    }
  }

  const existing = await prisma.platformPlan.findFirst({
    where: { tenantId: integradorId, slug: req.params.slug },
    select: { id: true },
  })
  if (!existing) return res.status(404).json({ error: 'override_not_found' })

  const updated = await prisma.platformPlan.update({
    where: { id: existing.id },
    data: { ...data, updatedBy: uid(req) },
  })
  invalidatePricingCache(integradorId)
  await audit(req, 'PRICING_TENANT_OVERRIDE_UPDATED', 'PlatformPlan', updated.id, { slug: req.params.slug, fields: Object.keys(data) })
  res.json(updated)
})

router.delete('/plans/:slug/override', async (req, res) => {
  const integradorId = tenant(req)
  if (!integradorId) return res.status(401).json({ error: 'no_tenant_context' })

  const existing = await prisma.platformPlan.findFirst({
    where: { tenantId: integradorId, slug: req.params.slug },
    select: { id: true },
  })
  if (!existing) return res.status(404).json({ error: 'override_not_found' })

  const deleted = await prisma.platformPlan.delete({ where: { id: existing.id } })
  invalidatePricingCache(integradorId)
  await audit(req, 'PRICING_TENANT_OVERRIDE_REMOVED', 'PlatformPlan', deleted.id, { slug: req.params.slug })
  res.json({ ok: true })
})

export default router
