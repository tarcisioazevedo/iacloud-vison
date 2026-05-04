/**
 * Audit Routes — Sprint Gap 6.
 *
 * Transparência LGPD: o integrador (e cliente final) precisa enxergar quando
 * a plataforma (SUPER_ADMIN) tomou ações sobre o seu tenant — alterou quotas,
 * desativou módulo, abriu ticket técnico, exportou dados, etc.
 *
 * Sem essa transparência o integrador não tem como saber o que a Anthropic
 * (ops da plataforma) fez no ambiente dele, o que viola o princípio de
 * accountability do art. 6º LGPD.
 *
 * Endpoints:
 *   GET /audit/platform-actions  → ações de SUPER_ADMIN sobre o próprio tenant.
 *                                  Visível para INTEGRADOR_ADMIN/CLIENTE_ADMIN/SUPER_ADMIN.
 *   GET /audit/timeline          → todas as ações no tenant (próprias + plataforma).
 *                                  Útil para correlação operacional.
 *
 * Filtros (query):
 *   - days   (1-90, default 30): janela de tempo.
 *   - action (string contains): filtra por código de ação.
 *   - limit  (1-500, default 100).
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { UnauthorizedError, ForbiddenError } from '../lib/errors'

export const auditRouter = Router()
auditRouter.use(requireAuth)

const QuerySchema = z.object({
  days:   z.coerce.number().int().min(1).max(90).default(30),
  action: z.string().max(80).optional(),
  limit:  z.coerce.number().int().min(1).max(500).default(100),
})

/**
 * Constrói filtro de tenant do AuditLog conforme JWT do consultante.
 * - SUPER_ADMIN          → sem filtro de tenant (vê todas).
 * - INTEGRADOR_*         → próprio integradorId OU clientes finais filhos.
 * - CLIENTE_*            → próprio clienteFinalId.
 *
 * Retorna a cláusula `OR` apropriada para o `where`.
 */
function tenantScopeFilter(jwt: any) {
  if (jwt.role === 'SUPER_ADMIN') return {}

  if (jwt.role?.startsWith('INTEGRADOR_')) {
    if (!jwt.integradorId) throw new UnauthorizedError('JWT sem integradorId')
    return {
      OR: [
        { integradorId: jwt.integradorId },
        // ações sobre clientes finais do próprio integrador
        { clienteFinal: { integradorId: jwt.integradorId } },
      ],
    }
  }

  if (jwt.role?.startsWith('CLIENTE_')) {
    if (!jwt.clienteFinalId) throw new UnauthorizedError('JWT sem clienteFinalId')
    return { clienteFinalId: jwt.clienteFinalId }
  }

  throw new ForbiddenError('Role sem permissão de auditoria')
}

// =============================================================================
// GET /audit/platform-actions  — ações de SUPER_ADMIN sobre o tenant
// =============================================================================
auditRouter.get('/platform-actions', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const q   = QuerySchema.parse(req.query)
  const since = new Date(Date.now() - q.days * 24 * 3600 * 1000)

  const tenantWhere = tenantScopeFilter(jwt)

  const where: any = {
    AND: [
      // Apenas ações executadas por SUPER_ADMIN (transparência da plataforma)
      { superAdminId: { not: null } },
      { createdAt: { gte: since } },
      tenantWhere,
      ...(q.action ? [{ action: { contains: q.action, mode: 'insensitive' } }] : []),
    ],
  }

  const logs = await prisma.auditLog.findMany({
    where,
    select: {
      id: true, action: true, resource: true, resourceId: true,
      result: true, ipAddress: true, createdAt: true, metadataJson: true,
      superAdmin:   { select: { id: true, name: true, email: true } },
      integrador:   { select: { id: true, name: true } },
      clienteFinal: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  })

  // Agregação por ação para a UI montar destaques.
  const counts = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.action] = (acc[l.action] ?? 0) + 1
    return acc
  }, {})

  res.json({
    logs,
    total: logs.length,
    window: { sinceIso: since.toISOString(), days: q.days },
    counts,
  })
}))

// =============================================================================
// GET /audit/timeline  — todas as ações no tenant (próprias + plataforma)
// =============================================================================
auditRouter.get('/timeline', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const q   = QuerySchema.parse(req.query)
  const since = new Date(Date.now() - q.days * 24 * 3600 * 1000)

  const tenantWhere = tenantScopeFilter(jwt)

  const where: any = {
    AND: [
      { createdAt: { gte: since } },
      tenantWhere,
      ...(q.action ? [{ action: { contains: q.action, mode: 'insensitive' } }] : []),
    ],
  }

  const logs = await prisma.auditLog.findMany({
    where,
    select: {
      id: true, action: true, resource: true, resourceId: true,
      result: true, ipAddress: true, createdAt: true,
      superAdmin:   { select: { id: true, name: true, email: true } },
      integrador:   { select: { id: true, name: true } },
      clienteFinal: { select: { id: true, name: true } },
      user:         { select: { id: true, name: true, email: true, role: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  })

  res.json({
    logs,
    total: logs.length,
    window: { sinceIso: since.toISOString(), days: q.days },
  })
}))

// =============================================================================
// GET /audit/explorer  — log explorer com filtros completos (Sprint Logs)
// Mental model:
//   - Categoria (auth, users, tenancy, cameras, edge, storage, quota, modules, approvals)
//   - Severidade (info, warning, error, critical) — derivada de action+result
//   - Filtros: período, categoria[], severidade[], ator, resource, resourceId, IP, busca
//   - Resposta: logs paginados + agregações (counts por categoria, top atores, sparkline 24h)
// =============================================================================
const ExplorerQuery = z.object({
  startDate:  z.string().datetime().optional(),
  endDate:    z.string().datetime().optional(),
  days:       z.coerce.number().int().min(1).max(365).default(7),
  categories: z.string().optional(),  // csv: "auth,users,edge"
  severities: z.string().optional(),  // csv: "warning,error,critical"
  actorId:    z.string().optional(),
  actorEmail: z.string().optional(),
  resource:   z.string().optional(),
  resourceId: z.string().optional(),
  action:     z.string().optional(),
  ip:         z.string().optional(),
  result:     z.enum(['SUCCESS','BLOCKED','ERROR']).optional(),
  search:     z.string().optional(),  // busca textual em action + metadata
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
  sort:       z.enum(['desc','asc']).default('desc'),
})

// Map de category → resources cobertos
const CATEGORY_RESOURCES: Record<string, string[]> = {
  auth:      ['User','Session','ImpersonationSession'],
  users:     ['User'],
  tenancy:   ['Integrador','ClienteFinal','Site'],
  cameras:   ['Camera'],
  edge:      ['EdgeNode'],
  storage:   ['StorageBucket','Recording'],
  quota:    ['ApiQuota'],
  modules:   ['IntegradorModule','ClienteFinalModule'],
  approvals: ['ApprovalRequest'],
}

// Heurística de severidade derivada de action + result
function deriveSeverity(action: string, result: string | null): 'info'|'warning'|'error'|'critical' {
  const a = action.toUpperCase()
  if (result === 'ERROR' || a.includes('FAIL') || a.includes('ERROR')) return 'error'
  if (a.includes('IMPERSONATION') || a.includes('DELETE') || a.includes('SUSPEND') || a.includes('REVOK')) return 'critical'
  if (result === 'BLOCKED' || a.includes('BLOCKED') || a.includes('WARN') || a.includes('EXPIRED')) return 'warning'
  return 'info'
}

function deriveCategory(resource: string, action: string): string {
  const a = action.toUpperCase()
  if (a.startsWith('LOGIN') || a.startsWith('LOGOUT') || a.includes('PASSWORD') || a.includes('IMPERSON')) return 'auth'
  for (const [cat, resources] of Object.entries(CATEGORY_RESOURCES)) {
    if (resources.includes(resource)) return cat
  }
  return 'other'
}

auditRouter.get('/explorer', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const q = ExplorerQuery.parse(req.query)
  const tenantWhere = tenantScopeFilter(jwt)

  const since = q.startDate ? new Date(q.startDate) : new Date(Date.now() - q.days * 24 * 3600 * 1000)
  const until = q.endDate ? new Date(q.endDate) : new Date()

  const conditions: any[] = [
    { createdAt: { gte: since, lte: until } },
    tenantWhere,
  ]

  // Filtros opcionais
  if (q.action) conditions.push({ action: { contains: q.action, mode: 'insensitive' } })
  if (q.resource) conditions.push({ resource: q.resource })
  if (q.resourceId) conditions.push({ resourceId: q.resourceId })
  if (q.ip) conditions.push({ ipAddress: q.ip })
  if (q.result) conditions.push({ result: q.result })
  if (q.actorId) {
    conditions.push({ OR: [{ userId: q.actorId }, { superAdminId: q.actorId }] })
  }
  if (q.actorEmail) {
    conditions.push({
      OR: [
        { user: { email: { contains: q.actorEmail, mode: 'insensitive' } } },
        { superAdmin: { email: { contains: q.actorEmail, mode: 'insensitive' } } },
      ],
    })
  }
  if (q.categories) {
    const cats = q.categories.split(',').map(c => c.trim()).filter(Boolean)
    const resources = cats.flatMap(c => CATEGORY_RESOURCES[c] ?? [])
    if (resources.length) conditions.push({ resource: { in: resources } })
  }
  if (q.search) {
    conditions.push({
      OR: [
        { action: { contains: q.search, mode: 'insensitive' } },
        { resource: { contains: q.search, mode: 'insensitive' } },
        // metadataJson não suporta contains direto no Prisma — usa text search
      ],
    })
  }

  const where: any = { AND: conditions }
  const skip = (q.page - 1) * q.limit

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: q.sort },
      skip,
      take: q.limit,
      select: {
        id: true, action: true, resource: true, resourceId: true,
        result: true, ipAddress: true, userAgent: true,
        createdAt: true, metadataJson: true,
        superAdmin:   { select: { id: true, name: true, email: true } },
        integrador:   { select: { id: true, name: true } },
        clienteFinal: { select: { id: true, name: true } },
        user:         { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ])

  // Enriquece com category + severity + actor consolidado
  const enriched = logs.map(l => {
    const actor = l.user
      ? { id: l.user.id, name: l.user.name, email: l.user.email, role: l.user.role, kind: 'user' as const }
      : l.superAdmin
        ? { id: l.superAdmin.id, name: l.superAdmin.name, email: l.superAdmin.email, role: 'SUPER_ADMIN', kind: 'superadmin' as const }
        : null
    return {
      id: l.id,
      timestamp: l.createdAt,
      action: l.action,
      resource: l.resource,
      resourceId: l.resourceId,
      result: l.result,
      ipAddress: l.ipAddress,
      userAgent: l.userAgent,
      metadata: l.metadataJson,
      actor,
      tenant: l.integrador
        ? { kind: 'integrador', id: l.integrador.id, name: l.integrador.name }
        : l.clienteFinal
          ? { kind: 'clienteFinal', id: l.clienteFinal.id, name: l.clienteFinal.name }
          : null,
      category: deriveCategory(l.resource, l.action),
      severity: deriveSeverity(l.action, l.result),
    }
  })

  // Filtro por severidade (pós-processamento porque é derivada)
  const sevFiltered = q.severities
    ? enriched.filter(e => q.severities!.split(',').includes(e.severity))
    : enriched

  // Agregações
  const countsByCategory: Record<string, number> = {}
  const countsBySeverity: Record<string, number> = { info: 0, warning: 0, error: 0, critical: 0 }
  const actorMap: Record<string, { name: string; email: string; count: number }> = {}
  for (const l of sevFiltered) {
    countsByCategory[l.category] = (countsByCategory[l.category] ?? 0) + 1
    countsBySeverity[l.severity] = (countsBySeverity[l.severity] ?? 0) + 1
    if (l.actor) {
      const key = l.actor.email
      if (!actorMap[key]) actorMap[key] = { name: l.actor.name ?? key, email: key, count: 0 }
      actorMap[key].count++
    }
  }
  const topActors = Object.values(actorMap).sort((a, b) => b.count - a.count).slice(0, 5)

  // Sparkline: agrupa por hora nas últimas 24h
  const sparkSince = new Date(Math.max(since.getTime(), Date.now() - 24 * 3600 * 1000))
  const sparkBucket: number[] = new Array(24).fill(0)
  for (const l of sevFiltered) {
    const t = new Date(l.timestamp).getTime()
    if (t < sparkSince.getTime()) continue
    const hour = Math.floor((Date.now() - t) / 3600 / 1000)
    if (hour >= 0 && hour < 24) sparkBucket[23 - hour]++
  }

  res.json({
    logs: sevFiltered,
    total,
    page: q.page,
    pages: Math.ceil(total / q.limit),
    limit: q.limit,
    window: { sinceIso: since.toISOString(), untilIso: until.toISOString() },
    aggregations: {
      countsByCategory,
      countsBySeverity,
      topActors,
      sparkline24h: sparkBucket,
    },
  })
}))

// =============================================================================
// GET /audit/resource/:resource/:resourceId  — story view de uma entity
// Retorna timeline completa de ações sobre um recurso específico.
// =============================================================================
auditRouter.get('/resource/:resource/:resourceId', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const tenantWhere = tenantScopeFilter(jwt)
  const { resource, resourceId } = req.params

  const logs = await prisma.auditLog.findMany({
    where: {
      AND: [
        { resource: String(resource) },
        { resourceId: String(resourceId) },
        tenantWhere,
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, action: true, resource: true, resourceId: true,
      result: true, ipAddress: true, createdAt: true, metadataJson: true,
      superAdmin: { select: { id: true, name: true, email: true } },
      user:       { select: { id: true, name: true, email: true, role: true } },
    },
  })

  res.json({
    resource: { type: resource, id: resourceId },
    total: logs.length,
    logs: logs.map(l => ({
      ...l,
      severity: deriveSeverity(l.action, l.result),
      category: deriveCategory(l.resource, l.action),
    })),
  })
}))
