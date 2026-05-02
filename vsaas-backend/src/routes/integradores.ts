/**
 * Integradores Routes — gerenciado pelo SuperAdmin.
 * CRUD completo + quota status.
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { requireAuth, requireRole } from '../middleware/auth'
import { quotaService } from '../services/quota.service'
import { prisma } from '../lib/prisma'
import { ValidationError, NotFoundError } from '../lib/errors'

export const integradorRouter = Router()
integradorRouter.use(requireAuth)
integradorRouter.use(requireRole('SUPER_ADMIN'))

const CreateSchema = z.object({
  name:          z.string().min(1),
  tradeName:     z.string().optional(),
  cnpj:          z.string().optional(),
  email:         z.string().email(),
  password:      z.string().min(8),
  phone:         z.string().optional(),
  gcpProjectId:  z.string().optional(),
  maxEdgeNodes:  z.number().int().positive().nullable().optional(),
  staticVisionMonthlyLimit:  z.number().int().positive().default(50000),
  streamingMinutesLimit:     z.number().positive().default(6000),
})

const PatchSchema = z.object({
  name:         z.string().min(1).optional(),
  tradeName:    z.string().optional(),
  phone:        z.string().optional(),
  active:       z.boolean().optional(),
  maxEdgeNodes: z.number().int().positive().nullable().optional(),
})

integradorRouter.post('/', async (req: Request, res: Response) => {
  const parse = CreateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const b = parse.data

  const integrador = await prisma.integrador.create({
    data: {
      name:         b.name,
      tradeName:    b.tradeName ?? null,
      cnpj:         b.cnpj ?? null,
      email:        b.email,
      passwordHash: await bcrypt.hash(b.password, 12),
      phone:        b.phone ?? null,
      gcpProjectId: b.gcpProjectId ?? null,
      maxEdgeNodes: b.maxEdgeNodes ?? null,
    },
  })

  // Criar quota para o mês atual
  const now        = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  await prisma.apiQuota.create({
    data: {
      integradorId:             integrador.id,
      staticVisionMonthlyLimit: b.staticVisionMonthlyLimit,
      streamingMinutesLimit:    b.streamingMinutesLimit,
      periodStart,
      periodEnd,
    },
  })

  await prisma.auditLog.create({
    data: {
      superAdminId: req.jwtPayload!.sub,
      action:       'INTEGRADOR_CREATED',
      resource:     'Integrador',
      resourceId:   integrador.id,
    },
  })

  res.status(201).json({ id: integrador.id, name: integrador.name, email: integrador.email })
})

integradorRouter.get('/', async (_req: Request, res: Response) => {
  const integradores = await prisma.integrador.findMany({
    select: {
      id: true, name: true, tradeName: true, email: true, phone: true,
      active: true, maxEdgeNodes: true, createdAt: true,
      _count: { select: { clienteFinais: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Conta EdgeNodes ativos por integrador (ONLINE + PROVISIONING + DEGRADED)
  const activeNodeCounts = await prisma.edgeNode.groupBy({
    by: ['integradorId'],
    where: {
      status: { in: ['ONLINE', 'PROVISIONING', 'DEGRADED'] },
      integradorId: { not: null },
    },
    _count: { id: true },
  })
  const nodeCountMap = Object.fromEntries(
    activeNodeCounts.map(r => [r.integradorId!, r._count.id])
  )

  res.json({
    integradores: integradores.map(i => ({
      ...i,
      edgeNodesUsed:      nodeCountMap[i.id] ?? 0,
      edgeNodesAvailable: i.maxEdgeNodes != null
        ? Math.max(0, i.maxEdgeNodes - (nodeCountMap[i.id] ?? 0))
        : null,
    })),
    total: integradores.length,
  })
})

// PATCH /integradores/:id — SUPER_ADMIN atualiza dados do integrador (incl. maxEdgeNodes)
integradorRouter.patch('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id)
  const parse = PatchSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const integrador = await prisma.integrador.findUnique({ where: { id } })
  if (!integrador) throw new NotFoundError('Integrador')

  const updated = await prisma.integrador.update({
    where: { id },
    data: {
      ...(parse.data.name         !== undefined ? { name: parse.data.name }               : {}),
      ...(parse.data.tradeName    !== undefined ? { tradeName: parse.data.tradeName }     : {}),
      ...(parse.data.phone        !== undefined ? { phone: parse.data.phone }             : {}),
      ...(parse.data.active       !== undefined ? { active: parse.data.active }           : {}),
      ...(parse.data.maxEdgeNodes !== undefined ? { maxEdgeNodes: parse.data.maxEdgeNodes } : {}),
    },
    select: { id: true, name: true, email: true, active: true, maxEdgeNodes: true },
  })

  await prisma.auditLog.create({
    data: {
      superAdminId: req.jwtPayload!.sub,
      action:       'INTEGRADOR_UPDATED',
      resource:     'Integrador',
      resourceId:   id,
    },
  })

  res.json(updated)
})

integradorRouter.get('/:id/quota', async (req: Request, res: Response) => {
  const id = String(req.params.id)
  const integrador = await prisma.integrador.findUnique({ where: { id } })
  if (!integrador) throw new NotFoundError('Integrador')
  const status = await quotaService.getStatus(id)

  const edgeNodesUsed = await prisma.edgeNode.count({
    where: {
      status: { in: ['ONLINE', 'PROVISIONING', 'DEGRADED'] },
      site:   { clienteFinal: { integradorId: id } },
    },
  })

  res.json({
    integrador: {
      id: integrador.id, name: integrador.name,
      maxEdgeNodes:      integrador.maxEdgeNodes,
      edgeNodesUsed,
      edgeNodesAvailable: integrador.maxEdgeNodes != null
        ? Math.max(0, integrador.maxEdgeNodes - edgeNodesUsed)
        : null,
    },
    quota: status,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// COCKPIT: Endpoints consolidados para gestão completa do tenant
// ═══════════════════════════════════════════════════════════════════════════

// GET /:id/overview — KPIs consolidados do integrador
integradorRouter.get('/:id/overview', async (req: Request, res: Response) => {
  const integradorId = String(req.params.id)

  const integrador = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: {
      id: true, name: true, tradeName: true, email: true, phone: true,
      cnpj: true, active: true, createdAt: true, updatedAt: true,
      maxEdgeNodes: true, storageRetainDays: true,
      billingCycle: true, gcpProjectId: true,
    },
  })
  if (!integrador) throw new NotFoundError('Integrador')

  // Counts paralelos
  const [
    clientesCount,
    usersCount,
    sitesCount,
    camerasCount,
    edgeNodesStats,
    modulesCount,
    quota,
    recentLogs,
  ] = await Promise.all([
    prisma.clienteFinal.count({ where: { integradorId, active: true } }),
    Promise.all([
      prisma.user.count({ where: { integrador: { id: integradorId } } }),
      prisma.user.count({ where: { clienteFinal: { integradorId } } }),
    ]).then(([a, b]) => a + b),
    prisma.site.count({ where: { clienteFinal: { integradorId }, active: true } }),
    prisma.camera.count({ where: { site: { clienteFinal: { integradorId } }, active: true } }),
    prisma.edgeNode.groupBy({
      by: ['status'],
      where: { site: { clienteFinal: { integradorId } } },
      _count: { id: true },
    }),
    prisma.integradorModule.count({ where: { integradorId, enabled: true } }),
    quotaService.getStatus(integradorId),
    prisma.auditLog.findMany({
      where: { integradorId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, action: true, resource: true, createdAt: true },
    }),
  ])

  // Processar stats de edge nodes
  const edgeStats = {
    total: 0,
    online: 0,
    offline: 0,
    degraded: 0,
    provisioning: 0,
  }
  for (const s of edgeNodesStats) {
    edgeStats.total += s._count.id
    if (s.status === 'ONLINE') edgeStats.online = s._count.id
    else if (s.status === 'OFFLINE') edgeStats.offline = s._count.id
    else if (s.status === 'DEGRADED') edgeStats.degraded = s._count.id
    else if (s.status === 'PROVISIONING') edgeStats.provisioning = s._count.id
  }

  // Calcular uso de quota
  const quotaUsage = quota ? {
    staticVision: {
      used: quota.staticVisionMonthlyUsed,
      limit: quota.staticVisionMonthlyLimit,
      percent: Math.round((quota.staticVisionMonthlyUsed / Math.max(1, quota.staticVisionMonthlyLimit)) * 100),
    },
    streaming: {
      used: quota.streamingMinutesUsed,
      limit: quota.streamingMinutesLimit,
      percent: Math.round((quota.streamingMinutesUsed / Math.max(1, quota.streamingMinutesLimit)) * 100),
    },
    periodStart: quota.periodStart,
    periodEnd: quota.periodEnd,
  } : null

  res.json({
    integrador,
    kpis: {
      clientes: clientesCount,
      usuarios: usersCount,
      sites: sitesCount,
      cameras: camerasCount,
      modules: modulesCount,
    },
    edgeNodes: {
      ...edgeStats,
      maxAllowed: integrador.maxEdgeNodes,
      available: integrador.maxEdgeNodes ? Math.max(0, integrador.maxEdgeNodes - edgeStats.total) : null,
    },
    quota: quotaUsage,
    recentActivity: recentLogs,
  })
})

// GET /:id/clients — Clientes finais do integrador com stats
integradorRouter.get('/:id/clients', async (req: Request, res: Response) => {
  const integradorId = String(req.params.id)
  const { search, status } = req.query

  const integrador = await prisma.integrador.findUnique({ where: { id: integradorId } })
  if (!integrador) throw new NotFoundError('Integrador')

  const where: any = { integradorId }
  if (search) {
    where.OR = [
      { name: { contains: String(search), mode: 'insensitive' } },
      { email: { contains: String(search), mode: 'insensitive' } },
    ]
  }
  if (status === 'active') where.active = true
  if (status === 'inactive') where.active = false

  const clients = await prisma.clienteFinal.findMany({
    where,
    select: {
      id: true, name: true, tradeName: true, email: true, phone: true,
      vertical: true, active: true, createdAt: true,
      _count: {
        select: {
          sites: true,
          users: true,
        },
      },
      sites: {
        select: {
          _count: { select: { cameras: true, edgeNodes: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  const clientsWithStats = clients.map(c => ({
    id: c.id,
    name: c.name,
    tradeName: c.tradeName,
    email: c.email,
    phone: c.phone,
    vertical: c.vertical,
    active: c.active,
    createdAt: c.createdAt,
    stats: {
      sites: c._count.sites,
      users: c._count.users,
      cameras: c.sites.reduce((acc, s) => acc + s._count.cameras, 0),
      edgeNodes: c.sites.reduce((acc, s) => acc + s._count.edgeNodes, 0),
    },
  }))

  res.json({
    clients: clientsWithStats,
    total: clientsWithStats.length,
    active: clientsWithStats.filter(c => c.active).length,
  })
})

// GET /:id/users — Todos usuários do tenant (integrador + clientes)
integradorRouter.get('/:id/users', async (req: Request, res: Response) => {
  const integradorId = String(req.params.id)
  const { search, role, clienteFinalId } = req.query

  const integrador = await prisma.integrador.findUnique({ where: { id: integradorId } })
  if (!integrador) throw new NotFoundError('Integrador')

  // Usuários do integrador
  const integradorWhere: any = { integradorId }
  if (search) {
    integradorWhere.OR = [
      { name: { contains: String(search), mode: 'insensitive' } },
      { email: { contains: String(search), mode: 'insensitive' } },
    ]
  }
  if (role) integradorWhere.role = String(role)

  const integradorUsers = await prisma.user.findMany({
    where: integradorWhere,
    select: {
      id: true, name: true, email: true, role: true, active: true,
      lastLoginAt: true, createdAt: true,
    },
  })

  // Usuários dos clientes finais
  const clienteWhere: any = { clienteFinal: { integradorId } }
  if (search) {
    clienteWhere.OR = [
      { name: { contains: String(search), mode: 'insensitive' } },
      { email: { contains: String(search), mode: 'insensitive' } },
    ]
  }
  if (role) clienteWhere.role = String(role)
  if (clienteFinalId) clienteWhere.clienteFinalId = String(clienteFinalId)

  const clienteUsers = await prisma.user.findMany({
    where: clienteWhere,
    select: {
      id: true, name: true, email: true, role: true, active: true,
      lastLoginAt: true, createdAt: true,
      clienteFinal: { select: { id: true, name: true } },
    },
  })

  const allUsers = [
    ...integradorUsers.map(u => ({ ...u, scope: 'integrador' as const, clienteFinal: null })),
    ...clienteUsers.map(u => ({ ...u, scope: 'cliente' as const })),
  ].sort((a, b) => a.name.localeCompare(b.name))

  res.json({
    users: allUsers,
    total: allUsers.length,
    byRole: {
      INTEGRADOR_ADMIN: allUsers.filter(u => u.role === 'INTEGRADOR_ADMIN').length,
      INTEGRADOR_TECNICO: allUsers.filter(u => u.role === 'INTEGRADOR_TECNICO').length,
      CLIENTE_ADMIN: allUsers.filter(u => u.role === 'CLIENTE_ADMIN').length,
      CLIENTE_SUPERVISOR: allUsers.filter(u => u.role === 'CLIENTE_SUPERVISOR').length,
      CLIENTE_OPERADOR: allUsers.filter(u => u.role === 'CLIENTE_OPERADOR').length,
      CLIENTE_VIEWER: allUsers.filter(u => u.role === 'CLIENTE_VIEWER').length,
    },
  })
})

// GET /:id/boxes — Edge Boxes com licenças e telemetria
integradorRouter.get('/:id/boxes', async (req: Request, res: Response) => {
  const integradorId = String(req.params.id)
  const { status, clienteFinalId } = req.query

  const integrador = await prisma.integrador.findUnique({ where: { id: integradorId } })
  if (!integrador) throw new NotFoundError('Integrador')

  const where: any = { site: { clienteFinal: { integradorId } } }
  if (status) where.status = String(status)
  if (clienteFinalId) where.site = { ...where.site, clienteFinalId: String(clienteFinalId) }

  const boxes = await prisma.edgeNode.findMany({
    where,
    select: {
      id: true, name: true, serialNumber: true, model: true, accelerator: true,
      status: true, lastHeartbeat: true, firmwareVersion: true,
      licenseExpiresAt: true, maxCameras: true, configRevision: true,
      cpuUsage: true, memUsage: true, diskUsage: true, tempCelsius: true,
      ipLocal: true, macAddress: true,
      site: {
        select: {
          id: true, name: true,
          clienteFinal: { select: { id: true, name: true } },
        },
      },
      _count: { select: { cameras: true } },
    },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  })

  const boxesWithHealth = boxes.map(b => {
    const now = new Date()
    const licenseExpired = b.licenseExpiresAt && new Date(b.licenseExpiresAt) < now
    const camerasOverLimit = b.maxCameras && b._count.cameras > b.maxCameras

    return {
      ...b,
      camerasUsed: b._count.cameras,
      _count: undefined,
      license: {
        expiresAt: b.licenseExpiresAt,
        expired: licenseExpired,
        maxCameras: b.maxCameras,
        camerasUsed: b._count.cameras,
        overLimit: camerasOverLimit,
      },
      health: {
        cpu: b.cpuUsage,
        memory: b.memUsage,
        disk: b.diskUsage,
        temp: b.tempCelsius,
        lastSeen: b.lastHeartbeat,
        isStale: b.lastHeartbeat && (now.getTime() - new Date(b.lastHeartbeat).getTime()) > 5 * 60 * 1000,
      },
    }
  })

  // Stats
  const stats = {
    total: boxes.length,
    online: boxes.filter(b => b.status === 'ONLINE').length,
    offline: boxes.filter(b => b.status === 'OFFLINE').length,
    degraded: boxes.filter(b => b.status === 'DEGRADED').length,
    licensesExpired: boxesWithHealth.filter(b => b.license.expired).length,
    camerasOverLimit: boxesWithHealth.filter(b => b.license.overLimit).length,
  }

  res.json({
    boxes: boxesWithHealth,
    stats,
    limits: {
      maxAllowed: integrador.maxEdgeNodes,
      used: boxes.length,
      available: integrador.maxEdgeNodes ? Math.max(0, integrador.maxEdgeNodes - boxes.length) : null,
    },
  })
})

// GET /:id/storage — Uso de storage do integrador
integradorRouter.get('/:id/storage', async (req: Request, res: Response) => {
  const integradorId = String(req.params.id)

  const integrador = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: {
      id: true, name: true,
      storageEndpoint: true, storageBucket: true, storageRetainDays: true,
      storageAccessKeyEnc: true,
    },
  })
  if (!integrador) throw new NotFoundError('Integrador')

  // Importar r2Storage dinamicamente para evitar dependência circular
  const { r2Storage } = await import('../services/r2-storage.service')

  const hasCustomStorage = !!(integrador.storageEndpoint && integrador.storageAccessKeyEnc)
  const storageType = hasCustomStorage ? 'custom' : (r2Storage.isEnabled() ? 'r2' : 'none')

  let bucketStats = { totalBytes: 0, objectCount: 0 }
  let bucketName = integrador.storageBucket

  if (storageType === 'r2' && r2Storage.isEnabled()) {
    bucketName = r2Storage.getBucketName(integradorId)
    const exists = await r2Storage.bucketExists(integradorId)
    if (exists) {
      bucketStats = await r2Storage.getStats(integradorId)
    }
  }

  // Breakdown por cliente final
  const clients = await prisma.clienteFinal.findMany({
    where: { integradorId, active: true },
    select: {
      id: true, name: true,
      sites: {
        select: {
          cameras: {
            where: { active: true },
            select: { id: true },
          },
        },
      },
    },
  })

  const clientBreakdown = await Promise.all(clients.map(async (c) => {
    const cameraIds = c.sites.flatMap(s => s.cameras.map(cam => cam.id))
    let usedBytes = 0

    if (storageType === 'r2' && r2Storage.isEnabled()) {
      for (const camId of cameraIds) {
        try {
          const stats = await r2Storage.getStats(integradorId, `${camId}/`)
          usedBytes += stats.totalBytes
        } catch { /* ignore */ }
      }
    }

    return {
      clienteFinalId: c.id,
      clienteFinalName: c.name,
      cameras: cameraIds.length,
      usedBytes,
      usedGB: Number((usedBytes / 1024 / 1024 / 1024).toFixed(3)),
    }
  }))

  res.json({
    storage: {
      type: storageType,
      bucket: bucketName,
      retainDays: integrador.storageRetainDays ?? 30,
      totalBytes: bucketStats.totalBytes,
      totalGB: Number((bucketStats.totalBytes / 1024 / 1024 / 1024).toFixed(3)),
      objectCount: bucketStats.objectCount,
    },
    breakdown: clientBreakdown.sort((a, b) => b.usedBytes - a.usedBytes),
  })
})

// GET /:id/logs — Audit logs do tenant
integradorRouter.get('/:id/logs', async (req: Request, res: Response) => {
  const integradorId = String(req.params.id)
  const { action, resource, startDate, endDate, page = '1', limit = '50' } = req.query

  const integrador = await prisma.integrador.findUnique({ where: { id: integradorId } })
  if (!integrador) throw new NotFoundError('Integrador')

  const pageNum = Math.max(1, parseInt(String(page)))
  const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))))
  const skip = (pageNum - 1) * limitNum

  const where: any = {
    OR: [
      { integradorId },
      { clienteFinal: { integradorId } },
    ],
  }

  if (action) where.action = String(action)
  if (resource) where.resource = String(resource)
  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) where.createdAt.gte = new Date(String(startDate))
    if (endDate) where.createdAt.lte = new Date(String(endDate))
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum,
      select: {
        id: true, action: true, resource: true, resourceId: true,
        metadataJson: true, ipAddress: true, result: true, createdAt: true,
        user: { select: { id: true, name: true, email: true } },
        integrador: { select: { id: true, name: true } },
        clienteFinal: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ])

  res.json({
    logs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  })
})

// GET /:id/modules — Módulos do integrador
integradorRouter.get('/:id/modules', async (req: Request, res: Response) => {
  const integradorId = String(req.params.id)

  const integrador = await prisma.integrador.findUnique({ where: { id: integradorId } })
  if (!integrador) throw new NotFoundError('Integrador')

  const modules = await prisma.integradorModule.findMany({
    where: { integradorId },
    select: {
      id: true, module: true, enabled: true, grantedAt: true, grantedBy: true,
    },
    orderBy: { module: 'asc' },
  })

  // Todos os módulos possíveis
  const allModules = [
    'FACE_ANNOTATION', 'LABEL_DETECTION', 'LOGO_DETECTION', 'OBJECT_LOCALIZATION',
    'SAFE_SEARCH', 'OCCUPANCY_ANALYTICS', 'PPE_DETECTION', 'PEOPLE_COUNTING',
    'VEHICLE_DETECTION', 'CROWD_DENSITY', 'QUEUE_LENGTH',
  ]

  const moduleStatus = allModules.map(m => {
    const granted = modules.find(mod => mod.module === m)
    return {
      module: m,
      enabled: granted?.enabled ?? false,
      grantedAt: granted?.grantedAt ?? null,
    }
  })

  res.json({
    modules: moduleStatus,
    enabledCount: moduleStatus.filter(m => m.enabled).length,
    totalAvailable: allModules.length,
  })
})

// POST /:id/suspend — Suspender/reativar integrador
integradorRouter.post('/:id/suspend', async (req: Request, res: Response) => {
  const integradorId = String(req.params.id)
  const { suspend, reason } = req.body as { suspend: boolean; reason?: string }

  const integrador = await prisma.integrador.findUnique({ where: { id: integradorId } })
  if (!integrador) throw new NotFoundError('Integrador')

  await prisma.integrador.update({
    where: { id: integradorId },
    data: { active: !suspend },
  })

  await prisma.auditLog.create({
    data: {
      superAdminId: req.jwtPayload!.sub,
      action: suspend ? 'INTEGRADOR_SUSPENDED' : 'INTEGRADOR_REACTIVATED',
      resource: 'Integrador',
      resourceId: integradorId,
      metadataJson: reason ? { reason } : undefined,
    },
  })

  res.json({
    success: true,
    integrador: { id: integradorId, active: !suspend },
    message: suspend ? 'Integrador suspenso' : 'Integrador reativado',
  })
})
