/**
 * Pricing público (CMS) — /pricing.
 *
 * Multi-tenant: detecta integrador via X-ICV-Tenant ou JWT e mescla overrides.
 * Cache 60s in-memory por tenant. Invalidado por edits no admin/me pricing.
 */
import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { resolveIntegradorId } from '../middleware/tenant-context'
import { logger } from '../lib/logger'
import { publicRoute } from '../middleware/require-capability'

const router = Router()

type CacheEntry = { ts: number; data: any }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000
function cacheKey(tenantId: string | null) { return tenantId ?? 'master' }

export function invalidatePricingCache(tenantId?: string | null) {
  if (tenantId === undefined) { cache.clear(); return }
  cache.delete(cacheKey(tenantId))
}

router.get('/',
  publicRoute(),
  async (req, res) => {
  const tenantId = resolveIntegradorId(req)

  try {
    const key = cacheKey(tenantId)
    const cached = cache.get(key)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      res.set('X-Pricing-Cache', 'HIT')
      res.set('X-Pricing-Scope', tenantId ? 'tenant' : 'master')
      return res.json(cached.data)
    }

    const [hero, settings, masterPlans, ais, vms, competitors, tenantPlans] = await Promise.all([
      prisma.pricingHero.findFirst({ where: { active: true } }),
      prisma.pricingSettings.findFirst(),
      prisma.platformPlan.findMany({
        where: { tenantId: null, archived: false, publicVisible: true },
        orderBy: { displayOrder: 'asc' },
      }),
      prisma.aIAddonPlan.findMany({
        where: { archived: false, publicVisible: true },
        orderBy: { displayOrder: 'asc' },
      }),
      prisma.vMSStoragePrice.findMany({
        where: { active: true },
        orderBy: [{ resolution: 'asc' }, { days: 'asc' }],
      }),
      prisma.competitorComparison.findMany({
        where: { active: true },
        orderBy: { displayOrder: 'asc' },
      }),
      tenantId
        ? prisma.platformPlan.findMany({
            where: { tenantId, archived: false, publicVisible: true },
          })
        : Promise.resolve([]),
    ])

    const overrideBySlug = new Map(tenantPlans.map(p => [p.slug, p]))
    const plans = masterPlans.map(m => {
      const o = overrideBySlug.get(m.slug)
      return {
        id: m.slug, slug: m.slug, name: m.name,
        tagline: o?.tagline ?? m.tagline,
        priceMonthly: (o?.priceMonthly ?? m.priceMonthly) !== null ? Number(o?.priceMonthly ?? m.priceMonthly) : null,
        priceMonuv: (o?.priceMonuv ?? m.priceMonuv) !== null ? Number(o?.priceMonuv ?? m.priceMonuv) : null,
        connections: m.connections, retention: m.retention, totalAIs: m.totalAIs,
        ctaLabel: o?.ctaLabel ?? m.ctaLabel, ctaKind: m.ctaKind,
        ctaUrl: o?.ctaUrl ?? m.ctaUrl,
        highlights: (o?.highlights && o.highlights.length > 0) ? o.highlights : m.highlights,
        recommended: o?.recommended ?? m.recommended,
        accent: o?.accent ?? m.accent,
        maxCameras: m.maxCameras, retentionDays: m.retentionDays,
        modulesIncluded: m.modulesIncluded, edgeBoxScenario: m.edgeBoxScenario,
      }
    })

    const vmsMatrix: Record<string, Record<number, number>> = {}
    for (const row of vms) {
      if (!vmsMatrix[row.resolution]) vmsMatrix[row.resolution] = {}
      vmsMatrix[row.resolution][row.days] = Number(row.priceIACV)
    }

    const data = {
      scope: tenantId ? 'tenant' : 'master',
      hero: hero ? {
        tagline: hero.tagline, headline: hero.headline,
        headlineHighlights: hero.headlineHighlights ?? [],
        subtitle: hero.subtitle,
        ctaLogin: { text: hero.ctaLoginText, url: hero.ctaLoginUrl },
        ctaConsultant: { text: hero.ctaConsultantText, url: hero.ctaConsultantUrl },
      } : null,
      settings: settings ? {
        showAnnualToggle: settings.showAnnualToggle, annualDiscountPct: settings.annualDiscountPct,
        showTabPlans: settings.showTabPlans, showTabAIs: settings.showTabAIs, showTabVMS: settings.showTabVMS,
        showCompetitorSection: settings.showCompetitorSection, defaultCurrency: settings.defaultCurrency,
      } : null,
      plans,
      ais: ais.map(a => ({
        id: a.slug, slug: a.slug, name: a.name, iconKey: a.iconKey,
        priceIACV: a.priceIACV !== null ? Number(a.priceIACV) : null,
        priceMonuv: a.priceMonuv !== null ? Number(a.priceMonuv) : null,
        exclusive: a.exclusive, color: a.color, description: a.description,
        analyticsModel: a.analyticsModel,
      })),
      vmsStorage: { resolutions: Object.keys(vmsMatrix), matrix: vmsMatrix },
      competitors: competitors.map(c => ({
        iconKey: c.iconKey, label: c.label, ourValue: c.ourValue, ourValueColor: c.ourValueColor,
        theirValue: c.theirValue, description: c.description,
      })),
      currency: 'BRL' as const, period: 'month' as const,
      tiers: [
        { tier: 'BRONZE', price: 199 }, { tier: 'SILVER', price: 499 },
        { tier: 'GOLD', price: 999 }, { tier: 'PLATINUM', price: 1999 },
      ],
      technical: [
        { tier: 'STATIC_VISION', model: 'pay-per-call' },
        { tier: 'STREAMING_ANALYTICS', model: 'pay-per-hour' },
      ],
    }

    cache.set(key, { ts: Date.now(), data })
    res.set('X-Pricing-Cache', 'MISS')
    res.set('X-Pricing-Scope', tenantId ? 'tenant' : 'master')
    res.json(data)
  } catch (err) {
    logger.error({ err }, 'pricing_fetch_failed')
    res.status(503).json({ error: 'pricing_unavailable' })
  }
})

export default router
