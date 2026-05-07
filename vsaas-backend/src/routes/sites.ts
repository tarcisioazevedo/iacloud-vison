/**
 * Sites Routes — listagem com isolamento multi-tenant.
 *
 * Usado pelo Vsaas frontend no wizard de "Nova Câmera" para popular o
 * dropdown "Em qual site?". Também serve qualquer UI que precise listar
 * filiais/endereços do tenant logado.
 *
 * Escopo:
 *   - SUPER_ADMIN: vê todos os sites (ops da plataforma).
 *   - INTEGRADOR_ADMIN (+TECH): sites dos ClientesFinais que pertencem a ele.
 *   - CLIENT_ADMIN / VIEWER: apenas sites do próprio clienteFinalId do JWT.
 *
 * GET /sites              → lista todos acessíveis (com camerasCount)
 * GET /sites/:id          → detalhe
 * POST /sites             → criar (integrador cadastra site para um cliente)
 */
import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { NotFoundError, UnauthorizedError, ValidationError } from '../lib/errors'
import type { JwtPayload } from '../middleware/auth'
import { auditDelete } from '../lib/audit-helpers'

export const sitesRouter = Router()
sitesRouter.use(requireAuth)

/**
 * Constrói o filtro Prisma de escopo do tenant.
 * Espelha a lógica de cameraTenantWhere mas para o modelo Site.
 */
function siteTenantWhere(jwt: JwtPayload | undefined): Prisma.SiteWhereInput {
  if (!jwt) throw new UnauthorizedError()
  if (jwt.role === 'SUPER_ADMIN') return {}
  if (jwt.clienteFinalId) return { clienteFinalId: jwt.clienteFinalId }
  if (jwt.integradorId) return { clienteFinal: { integradorId: jwt.integradorId } }
  throw new UnauthorizedError('JWT sem tenant')
}

// =============================================================================
// GET /sites — lista sites acessíveis ao usuário (usado pelo wizard)
// =============================================================================

sitesRouter.get('/', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const tenantWhere = siteTenantWhere(jwt)

  // Query param `?includeInactive=true` traz também sites desativados.
  const includeInactive = req.query.includeInactive === 'true'
  const where: Prisma.SiteWhereInput = includeInactive
    ? tenantWhere
    : { ...tenantWhere, active: true }

  // `select` enxuto — wizard só precisa de id/name pra popular dropdown.
  // Inclui `camerasCount` para UI poder mostrar "3 câmeras".
  const sites = await prisma.site.findMany({
    where,
    orderBy: [{ clienteFinal: { name: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      active: true,
      clienteFinal: { select: { id: true, name: true, tradeName: true } },
      _count: { select: { cameras: true } },
    },
    take: 500, // proteção contra tenant gigante; paginação depois se precisar.
  })

  res.json({ sites, total: sites.length })
}))

// =============================================================================
// GET /sites/geo — sites geo-localizados para o mapa de presença
// (Onda 7 do docs/13-PLAN-COCKPIT-PREMIUM.md)
// Escopo automático via JWT: super-admin vê tudo, integrador vê próprios,
// cliente vê apenas próprios.
// =============================================================================

sitesRouter.get('/geo', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const tenantWhere = siteTenantWhere(jwt)

  // Apenas sites com lat E lng não-nulos
  const where: Prisma.SiteWhereInput = {
    ...tenantWhere,
    active: true,
    latitude:  { not: null },
    longitude: { not: null },
  }

  const sites = await prisma.site.findMany({
    where,
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      city: true,
      state: true,
      clienteFinal: {
        select: {
          id: true, name: true,
          integrador: { select: { id: true, name: true, tradeName: true } },
        },
      },
      _count: { select: { cameras: true, edgeNodes: true } },
    },
    take: 1000,
  })

  // Status de boxes online por site (uma query separada)
  const siteIds = sites.map(s => s.id)
  const onlineCounts = siteIds.length > 0
    ? await prisma.edgeNode.groupBy({
        by: ['siteId'],
        where: { siteId: { in: siteIds }, status: 'ONLINE' },
        _count: { _all: true },
      })
    : []
  const onlineMap = new Map(onlineCounts.map(c => [c.siteId, c._count._all]))

  const points = sites.map(s => {
    const boxesOnline = onlineMap.get(s.id) ?? 0
    const boxes = s._count.edgeNodes
    const healthScore = boxes > 0
      ? Math.round((boxesOnline / boxes) * 100)
      : null
    return {
      id: s.id,
      name: s.name,
      lat: s.latitude!,
      lng: s.longitude!,
      city: s.city,
      state: s.state,
      clienteName: s.clienteFinal?.name,
      integradorName: s.clienteFinal?.integrador?.tradeName ?? s.clienteFinal?.integrador?.name ?? null,
      healthScore,
      counts: {
        cameras: s._count.cameras,
        boxes,
        boxesOnline,
      },
    }
  })

  res.json({ points, total: points.length })
}))

// =============================================================================
// GET /sites/:id — detalhe de um site
// =============================================================================

sitesRouter.get('/:id', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const where = siteTenantWhere(jwt)

  const site = await prisma.site.findFirst({
    where: { id: String(req.params.id), ...where },
    include: {
      clienteFinal: { select: { id: true, name: true, tradeName: true } },
      _count: { select: { cameras: true } },
    },
  })
  if (!site) throw new NotFoundError('Site')
  res.json(site)
}))

// =============================================================================
// POST /sites — criar site (apenas roles com integradorId ou SUPER_ADMIN)
// =============================================================================

const CreateSiteSchema = z.object({
  clienteFinalId: z.string().min(1),
  name:           z.string().min(1).max(120),
  address:        z.string().max(200).optional().nullable(),
  city:           z.string().max(80).optional().nullable(),
  state:          z.string().max(40).optional().nullable(),
  country:        z.string().length(2).optional(),
  latitude:       z.number().min(-90).max(90).optional().nullable(),
  longitude:      z.number().min(-180).max(180).optional().nullable(),
  timezone:       z.string().max(60).optional(),
}).strict()

sitesRouter.post(
  '/',
  requireRole('SUPER_ADMIN', 'INTEGRADOR_ADMIN'),
  asyncHandler(async (req, res) => {
    const parse = CreateSiteSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      const path = first.path.length ? first.path.join('.') : 'body'
      throw new ValidationError(`${path}: ${first.message}`)
    }
    const b = parse.data
    const jwt = req.jwtPayload!

    // Isolamento: integrador só pode criar site para clienteFinal que é dele.
    const cliente = await prisma.clienteFinal.findFirst({
      where: {
        id: b.clienteFinalId,
        ...(jwt.role === 'INTEGRADOR_ADMIN' ? { integradorId: jwt.integradorId } : {}),
      },
      select: { id: true },
    })
    if (!cliente) throw new NotFoundError('Cliente final')

    const site = await prisma.site.create({
      data: {
        clienteFinalId: cliente.id,
        name:           b.name,
        address:        b.address ?? null,
        city:           b.city ?? null,
        state:          b.state ?? null,
        country:        b.country ?? 'BR',
        latitude:       b.latitude ?? null,
        longitude:      b.longitude ?? null,
        timezone:       b.timezone ?? 'America/Sao_Paulo',
      },
    })
    res.status(201).json(site)
  }),
)

// =============================================================================
// PATCH /sites/:id — atualizar site
// =============================================================================
const UpdateSiteSchema = CreateSiteSchema.partial().omit({ clienteFinalId: true }).extend({
  active: z.boolean().optional(),
})

sitesRouter.patch(
  '/:id',
  requireRole('SUPER_ADMIN', 'INTEGRADOR_ADMIN'),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const where = siteTenantWhere(jwt)
    const existing = await prisma.site.findFirst({ where: { id: String(req.params.id), ...where } })
    if (!existing) throw new NotFoundError('Site')

    const parse = UpdateSiteSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
    const b = parse.data

    const updated = await prisma.site.update({
      where: { id: existing.id },
      data: b as any,
    })
    res.json(updated)
  }),
)

// =============================================================================
// DELETE /sites/:id — soft delete (active=false)
// =============================================================================
sitesRouter.delete(
  '/:id',
  requireRole('SUPER_ADMIN', 'INTEGRADOR_ADMIN'),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const where = siteTenantWhere(jwt)
    const existing = await prisma.site.findFirst({ where: { id: String(req.params.id), ...where } })
    if (!existing) throw new NotFoundError('Site')

    await prisma.site.update({
      where: { id: existing.id },
      data: { active: false },
    })

    // Onda 12.6 — SITE_DEACTIVATED com snapshot (forense LGPD).
    // É soft-delete (active=false), mas auditamos como evento crítico
    // porque desativa cascata: edge nodes do site, câmeras, etc.
    await auditDelete(prisma, {
      action:     'SITE_DEACTIVATED',
      resource:   'Site',
      resourceId: existing.id,
      snapshot:   existing,
      req,
    })

    res.json({ ok: true, deactivatedId: existing.id })
  }),
)
