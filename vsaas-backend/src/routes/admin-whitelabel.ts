/**
 * Admin de white-label — SUPER_ADMIN gerencia tier + capabilities por integrador.
 *
 * Endpoints:
 *   GET    /admin/whitelabel                       → lista todos os integradores + tier+caps
 *   GET    /admin/whitelabel/:integradorId         → detalhes (caps + defaults do tier)
 *   PUT    /admin/whitelabel/:integradorId/tier    → mudar tier
 *   PATCH  /admin/whitelabel/:integradorId/capabilities → override granular
 *   DELETE /admin/whitelabel/:integradorId/capabilities → reset (volta defaults do tier)
 *
 * Cada mutação invalida cache + grava AuditLog (action: WHITELABEL_*).
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireRole } from '../middleware/auth'
import {
  resolveCapabilities,
  defaultCapabilitiesForTier,
  invalidateCapabilityCache,
  type WhitelabelTier,
} from '../services/whitelabel.service'

const router = Router()
router.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

const TIERS = ['NONE', 'BASIC', 'PRO', 'ENTERPRISE'] as const

function uid(req: Request): string | undefined { return req.jwtPayload?.sub }
async function audit(req: Request, action: string, resourceId: string, metadata?: any) {
  try {
    await prisma.auditLog.create({
      data: {
        superAdminId: uid(req),
        action, resource: 'Integrador', resourceId,
        metadataJson: metadata ?? undefined,
      },
    })
  } catch (err) { console.warn('[admin-whitelabel] audit failed', err) }
}
function zodErr(res: Response, parsed: z.SafeParseError<any>) {
  return res.status(400).json({
    error: 'invalid_input',
    issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  })
}

// ── GET /admin/whitelabel — lista paginada com caps resolvidas ──────────
router.get('/', async (_req, res) => {
  const integradores = await prisma.integrador.findMany({
    select: {
      id: true, name: true, tradeName: true, email: true,
      whitelabelTier: true, whitelabelCapabilities: true,
      cfSubdomain: true, logoUrl: true, active: true, createdAt: true,
      _count: { select: { clienteFinais: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const enriched = await Promise.all(
    integradores.map(async i => {
      const { tier, capabilities } = await resolveCapabilities(i.id)
      return {
        ...i,
        clientesFinaisCount: i._count.clienteFinais,
        tierDefaults: defaultCapabilitiesForTier(tier),
        capabilitiesResolved: capabilities,
      }
    }),
  )
  res.json(enriched)
})

// ── GET /admin/whitelabel/:integradorId ─────────────────────────────────
router.get('/:integradorId', async (req, res) => {
  const integ = await prisma.integrador.findUnique({
    where: { id: req.params.integradorId },
    select: {
      id: true, name: true, tradeName: true, email: true,
      whitelabelTier: true, whitelabelCapabilities: true,
      cfSubdomain: true, logoUrl: true, active: true,
      maxEdgeNodes: true,
    },
  })
  if (!integ) return res.status(404).json({ error: 'integrador_not_found' })
  const { tier, capabilities } = await resolveCapabilities(integ.id)
  res.json({
    ...integ,
    tierDefaults: defaultCapabilitiesForTier(tier),
    capabilitiesResolved: capabilities,
  })
})

// ── PUT /tier ───────────────────────────────────────────────────────────
const TierSchema = z.object({ tier: z.enum(TIERS) })
router.put('/:integradorId/tier', async (req, res) => {
  const parsed = TierSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)

  const updated = await prisma.integrador.update({
    where: { id: req.params.integradorId },
    data: { whitelabelTier: parsed.data.tier as WhitelabelTier },
    select: { id: true, whitelabelTier: true },
  }).catch((err: any) => {
    if (err.code === 'P2025') return null
    throw err
  })
  if (!updated) return res.status(404).json({ error: 'integrador_not_found' })
  invalidateCapabilityCache(updated.id)
  await audit(req, 'WHITELABEL_TIER_CHANGED', updated.id, { tier: parsed.data.tier })
  const resolved = await resolveCapabilities(updated.id)
  res.json({ ...updated, capabilitiesResolved: resolved.capabilities })
})

// ── PATCH /capabilities (override granular) ─────────────────────────────
const CapsSchema = z.object({
  branding: z.boolean().optional(),
  domain: z.boolean().optional(),
  pricing: z.boolean().optional(),
  email: z.boolean().optional(),
  clientCustomization: z.boolean().optional(),
}).strict()

router.patch('/:integradorId/capabilities', async (req, res) => {
  const parsed = CapsSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)

  const existing = await prisma.integrador.findUnique({
    where: { id: req.params.integradorId },
    select: { whitelabelCapabilities: true },
  })
  if (!existing) return res.status(404).json({ error: 'integrador_not_found' })

  const merged = { ...(existing.whitelabelCapabilities as any ?? {}), ...parsed.data }

  const updated = await prisma.integrador.update({
    where: { id: req.params.integradorId },
    data: { whitelabelCapabilities: merged },
    select: { id: true, whitelabelTier: true, whitelabelCapabilities: true },
  })
  invalidateCapabilityCache(updated.id)
  await audit(req, 'WHITELABEL_CAPABILITIES_CHANGED', updated.id, { changed: Object.keys(parsed.data) })
  const resolved = await resolveCapabilities(updated.id)
  res.json({ ...updated, capabilitiesResolved: resolved.capabilities })
})

// ── DELETE /capabilities (reset) ────────────────────────────────────────
router.delete('/:integradorId/capabilities', async (req, res) => {
  const updated = await prisma.integrador.update({
    where: { id: req.params.integradorId },
    data: { whitelabelCapabilities: null as any },
    select: { id: true, whitelabelTier: true },
  }).catch((err: any) => {
    if (err.code === 'P2025') return null
    throw err
  })
  if (!updated) return res.status(404).json({ error: 'integrador_not_found' })
  invalidateCapabilityCache(updated.id)
  await audit(req, 'WHITELABEL_CAPABILITIES_RESET', updated.id)
  const resolved = await resolveCapabilities(updated.id)
  res.json({ ...updated, capabilitiesResolved: resolved.capabilities })
})

export default router
