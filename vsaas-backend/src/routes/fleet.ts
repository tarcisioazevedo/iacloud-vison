/**
 * Fleet Routes — gestão centralizada de Edge Nodes
 *
 * GET  /fleet/summary           ← contagens por status (dashboard cards)
 * GET  /fleet                   ← lista rica com telemetria + tenant hierarchy
 * GET  /fleet/:id               ← detalhe completo (cameras, commands, heartbeats)
 * GET  /fleet/:id/heartbeats    ← série temporal para sparklines
 * POST /fleet/:id/commands      ← enfileira comando para a Box
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { NotFoundError, UnauthorizedError, ValidationError } from '../lib/errors'
import { publicRoute } from '../middleware/require-capability'

export const fleetRouter = Router()

// ── Auth obrigatório em todas as rotas ───────────────────────────────────────
fleetRouter.use(requireAuth)

// ── Tenant scoping ───────────────────────────────────────────────────────────

function buildTenantWhere(jwt: any): object {
  const { role, integradorId, clienteFinalId } = jwt
  if (role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL') return {}
  if (role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO') {
    if (!integradorId) throw new UnauthorizedError('Token sem integradorId')
    return { site: { clienteFinal: { integradorId } } }
  }
  if (clienteFinalId) {
    return { site: { clienteFinalId } }
  }
  throw new UnauthorizedError('Sem escopo de tenant válido')
}

// Campos que nunca saem nas respostas (segredos de infra)
function sanitizeNode(node: any) {
  const { apiToken: _t, go2rtcAuth: _a, ...safe } = node
  return safe
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /fleet/summary   — contagens para os cards do dashboard
// ═════════════════════════════════════════════════════════════════════════════
fleetRouter.get('/summary',
  publicRoute(),
  async (req: Request, res: Response) => {
  const where = buildTenantWhere(req.jwtPayload!)

  const [total, online, offline, degraded, maintenance, provisioning, pendingCmds] =
    await Promise.all([
      prisma.edgeNode.count({ where }),
      prisma.edgeNode.count({ where: { ...where, status: 'ONLINE'       } }),
      prisma.edgeNode.count({ where: { ...where, status: 'OFFLINE'      } }),
      prisma.edgeNode.count({ where: { ...where, status: 'DEGRADED'     } }),
      prisma.edgeNode.count({ where: { ...where, status: 'MAINTENANCE'  } }),
      prisma.edgeNode.count({ where: { ...where, status: 'PROVISIONING' } }),
      (prisma as any).edgeCommand.count({
        where: { ackedAt: null, edgeNode: where },
      }),
    ])

  res.json({
    total,
    byStatus: { online, offline, degraded, maintenance, provisioning },
    pendingCommands: pendingCmds,
    healthPct: total > 0 ? Math.round((online / total) * 100) : 0,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /fleet   — lista paginada com telemetria atual
// ═════════════════════════════════════════════════════════════════════════════
fleetRouter.get('/',
  publicRoute(),
  async (req: Request, res: Response) => {
  const jwt      = req.jwtPayload!
  const tenantWhere = buildTenantWhere(jwt)
  const { status, q, limit = '50', offset = '0' } = req.query as Record<string, string>

  const filter: any = { ...tenantWhere }
  if (status) filter.status = status
  if (q?.trim()) {
    filter.OR = [
      { name:         { contains: q.trim(), mode: 'insensitive' } },
      { serialNumber: { contains: q.trim(), mode: 'insensitive' } },
      { ipLocal:      { contains: q.trim(), mode: 'insensitive' } },
      { model:        { contains: q.trim(), mode: 'insensitive' } },
    ]
  }

  const [nodes, total] = await Promise.all([
    prisma.edgeNode.findMany({
      where: filter,
      include: {
        site: {
          select: {
            id: true, name: true, city: true, state: true,
            clienteFinal: {
              select: {
                id: true, name: true, vertical: true,
                integrador: { select: { id: true, name: true } },
              },
            },
          },
        },
        _count: { select: { cameras: { where: { active: true } } } },
        commands: { where: { ackedAt: null }, select: { id: true } },
        heartbeats: {
          orderBy: { recordedAt: 'desc' },
          take: 1,
          select: {
            cpuUsage: true, memUsage: true, diskUsage: true,
            tempCelsius: true, fpsCurrent: true, recordedAt: true,
          },
        },
      },
      orderBy: [
        // ONLINE primeiro, depois DEGRADED, MAINTENANCE, PROVISIONING, OFFLINE
        { status: 'asc' },
        { name:   'asc' },
      ],
      take: Math.min(Number(limit) || 50, 200),
      skip: Number(offset) || 0,
    }),
    prisma.edgeNode.count({ where: filter }),
  ])

  res.json({
    total,
    items: nodes.map(n => {
      const safe = sanitizeNode(n)
      return {
        ...safe,
        cameraCount:         safe._count.cameras,
        pendingCommandCount: safe.commands.length,
        lastHeartbeat:       safe.heartbeats[0] ?? null,
        _count:    undefined,
        commands:  undefined,
        heartbeats: undefined,
      }
    }),
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /fleet/:id   — detalhe completo
// ═════════════════════════════════════════════════════════════════════════════
fleetRouter.get('/:id',
  publicRoute(),
  async (req: Request, res: Response) => {
  const tenantWhere = buildTenantWhere(req.jwtPayload!)

  const node = await prisma.edgeNode.findFirst({
    where: { id: req.params.id, ...tenantWhere },
    include: {
      site: {
        include: {
          clienteFinal: {
            include: {
              integrador: {
                select: { id: true, name: true, tradeName: true, logoUrl: true },
              },
            },
          },
        },
      },
      cameras: {
        where: { active: true },
        select: {
          id: true, name: true, status: true, tier: true, pipeline: true,
          rtspMainUrl: true, rtspSubUrl: true, go2rtcStreamId: true,
          brand: true, model: true, resolution: true, fps: true,
          healthScore: true, lastOnlineAt: true,
          zones: {
            where: { active: true },
            select: {
              id: true, name: true, type: true,
              coordinates: true, direction: true, maxOccupancy: true,
            },
          },
        },
      },
      commands: {
        orderBy: { issuedAt: 'desc' },
        take: 30,
        select: {
          id: true, type: true, payload: true,
          issuedAt: true, ackedAt: true, createdById: true,
          // ACK enriquecido (item 1.13 docs/08, bridge be9c457)
          ackStatus: true, ackDurationSec: true,
          ackErrorMessage: true, ackInfo: true,
        },
      },
      // Últimos 60 heartbeats (~1h se intervalo 60s) para sparklines
      heartbeats: {
        orderBy: { recordedAt: 'desc' },
        take: 60,
        select: {
          cpuUsage: true, memUsage: true, diskUsage: true,
          tempCelsius: true, fpsCurrent: true,
          networkInBps: true, networkOutBps: true,
          recordedAt: true,
        },
      },
    },
  })

  if (!node) throw new NotFoundError('Edge node')

  // Camera count com scope correto (site + edgeNode)
  const cameraCount = await prisma.camera.count({
    where: { edgeNodeId: node.id, siteId: node.siteId, active: true },
  })

  const safe = sanitizeNode(node)

  res.json({
    ...safe,
    cameraCount,
    pendingCommandCount: safe.commands.filter((c: any) => !c.ackedAt).length,
    // Ordem crescente para sparklines no frontend
    heartbeatSeries: [...safe.heartbeats].reverse(),
    heartbeats: undefined,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /fleet/:id/heartbeats   — série temporal completa (últimas N horas)
// ═════════════════════════════════════════════════════════════════════════════
fleetRouter.get('/:id/heartbeats',
  publicRoute(),
  async (req: Request, res: Response) => {
  const tenantWhere = buildTenantWhere(req.jwtPayload!)
  const { hours = '24' } = req.query as Record<string, string>

  const node = await prisma.edgeNode.findFirst({
    where: { id: req.params.id, ...tenantWhere },
    select: { id: true },
  })
  if (!node) throw new NotFoundError('Edge node')

  const since = new Date(Date.now() - Math.min(Number(hours) || 24, 168) * 3_600_000)

  const series = await prisma.edgeHeartbeat.findMany({
    where: { edgeNodeId: node.id, recordedAt: { gte: since } },
    orderBy: { recordedAt: 'asc' },
    select: {
      cpuUsage: true, memUsage: true, diskUsage: true,
      tempCelsius: true, fpsCurrent: true,
      networkInBps: true, networkOutBps: true,
      recordedAt: true,
    },
  })

  res.json({ edgeNodeId: node.id, hours: Number(hours), series })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /fleet/:id/commands   — enfileira comando para a Box
// ═════════════════════════════════════════════════════════════════════════════
const CommandSchema = z.object({
  type:    z.string().min(1).max(64),
  payload: z.record(z.unknown()).optional().default({}),
})

fleetRouter.post('/:id/commands',
  publicRoute(),
  async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  if (!['SUPER_ADMIN', 'ADMIN_GLOBAL', 'INTEGRADOR_ADMIN'].includes(jwt.role)) {
    throw new UnauthorizedError('Permissão insuficiente para enfileirar comandos')
  }

  const tenantWhere = buildTenantWhere(jwt)
  const node = await prisma.edgeNode.findFirst({
    where: { id: req.params.id, ...tenantWhere },
    select: { id: true },
  })
  if (!node) throw new NotFoundError('Edge node')

  const parse = CommandSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const cmd = await (prisma as any).edgeCommand.create({
    data: {
      edgeNodeId:  node.id,
      type:        parse.data.type,
      payload:     parse.data.payload,
      createdById: jwt.sub,
    },
  })

  res.status(201).json(cmd)
})
