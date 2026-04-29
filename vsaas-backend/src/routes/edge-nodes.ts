/**
 * Edge Nodes Routes — listagem com escopo multi-tenant (JWT do usuário).
 *
 * Diferença de routes/edge.ts:
 *   - edge.ts        autenticado por X-Edge-Token (apenas o agente edge)
 *   - edge-nodes.ts  autenticado por JWT (usuário) + isolamento de tenant
 *
 * Usado principalmente pela UI do VSaaS para popular o dropdown "Edge Node"
 * no ConfigTab da câmera. Operadores também podem usar /edge-nodes/:id pra
 * inspecionar status de saúde / configuração.
 *
 * GET /edge-nodes              → lista com tenant scope
 * GET /edge-nodes/:id          → detalhe (se for do tenant)
 */
import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { NotFoundError, UnauthorizedError } from '../lib/errors'
import type { JwtPayload } from '../middleware/auth'

export const edgeNodesRouter = Router()
edgeNodesRouter.use(requireAuth)

/**
 * Filtra edge nodes pelo tenant do JWT. Edge → Site → ClienteFinal →
 * Integrador. SUPER_ADMIN vê tudo, INTEGRADOR_ADMIN vê edges dos
 * clientes finais dele, USER vê só edges do clienteFinalId dele.
 */
function edgeTenantWhere(jwt: JwtPayload | undefined): Prisma.EdgeNodeWhereInput {
  if (!jwt) throw new UnauthorizedError()
  if (jwt.role === 'SUPER_ADMIN') return {}
  if (jwt.clienteFinalId) return { site: { clienteFinalId: jwt.clienteFinalId } }
  if (jwt.integradorId) return { site: { clienteFinal: { integradorId: jwt.integradorId } } }
  throw new UnauthorizedError('JWT sem tenant')
}

// =============================================================================
// GET /edge-nodes  (popular dropdown no ConfigTab)
// =============================================================================

edgeNodesRouter.get('/', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const tenantWhere = edgeTenantWhere(jwt)

  // Filtros opcionais — siteId restringe ao site da câmera no wizard.
  const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined
  const integradorId = typeof req.query.integradorId === 'string' ? req.query.integradorId : undefined
  const includeOffline = req.query.includeOffline === 'true'

  const where: Prisma.EdgeNodeWhereInput = {
    ...tenantWhere,
    ...(siteId ? { siteId } : {}),
    ...(integradorId ? { site: { clienteFinal: { integradorId } } } : {}),
    // Por padrão lista só edges saudáveis (ONLINE/DEGRADED) — operador
    // pode pedir todos com ?includeOffline=true.
    ...(includeOffline ? {} : { status: { in: ['ONLINE', 'DEGRADED', 'PROVISIONING'] } }),
  }

  const nodes = await prisma.edgeNode.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      serialNumber: true,
      status: true,
      model: true,
      accelerator: true,
      ipLocal: true,
      lastHeartbeat: true,
      firmwareVersion: true,
      yoloModelVersion: true,
      go2rtcEndpoint: true,    // permite UI mostrar "Live habilitado: Sim/Não"
      cpuUsage: true,
      memUsage: true,
      tempCelsius: true,
      site: {
        select: {
          id: true,
          name: true,
          clienteFinal: { select: { id: true, name: true } },
        },
      },
      // Conta câmeras ativas vinculadas a este edge (active=true exclui
      // soft-deletadas). Filtro por siteId não é prático aqui (N campos),
      // mas Bug #2 já impede novas atribuições cross-site.
      _count: { select: { cameras: { where: { active: true } } } },
    },
    take: 500,
  })

  res.json({ edgeNodes: nodes, total: nodes.length })
}))

// =============================================================================
// GET /edge-nodes/:id
// =============================================================================

edgeNodesRouter.get('/:id', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const tenantWhere = edgeTenantWhere(jwt)

  const node = await prisma.edgeNode.findFirst({
    where: { id: req.params.id, ...tenantWhere },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          clienteFinal: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!node) throw new NotFoundError('Edge node')

  // Conta câmeras do mesmo site do edge (regra de negócio — câmeras
  // cross-site atribuídas incorretamente não entram na contagem).
  const cameraCount = await prisma.camera.count({
    where: { edgeNodeId: node.id, siteId: node.siteId, active: true },
  })

  // Sanitizar — não vazamos apiToken nem go2rtcAuth pelo GET.
  const { apiToken: _t, go2rtcAuth: _a, ...safe } = node as any
  res.json({ ...safe, _count: { cameras: cameraCount } })
}))
