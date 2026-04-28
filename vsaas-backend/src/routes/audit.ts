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
