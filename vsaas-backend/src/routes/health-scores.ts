/**
 * Health Score endpoints.
 *
 * Variantes:
 *   GET /admin/health-scores                    — fabricante: todos os clientes (lista + sumário)
 *   GET /admin/health-scores/:clienteFinalId    — drill: signals detalhados
 *   GET /me/integrador/health-scores            — integrador: clientes próprios (lista + sumário)
 *   GET /me/integrador/health-scores/:id        — drill do cliente do integrador
 *
 * Cliente final NÃO acessa health scores (visão de dentro pra fora não faz sentido).
 *
 * Cache de 60s no service. Em ambientes com muitos clientes, considerar mover
 * pra Redis ou worker background com upsert numa tabela ClienteHealthSnapshot.
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { resolveIntegradorId } from '../middleware/tenant-context'
import { publicRoute } from '../middleware/require-capability'
import {
  computeHealthScore,
  computeHealthScoresBulk,
  summarizeHealthScores,
} from '../services/health-score.service'

// ── /admin/health-scores ────────────────────────────────────────────────
export const adminHealthScoresRouter = Router()
adminHealthScoresRouter.use(requireAuth)
adminHealthScoresRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

adminHealthScoresRouter.get('/',
  publicRoute(),
  async (req: Request, res: Response) => {
  // Filtro opcional por integradorId (drill)
  const integradorId = typeof req.query.integradorId === 'string' ? String(req.query.integradorId) : undefined
  const scores = await computeHealthScoresBulk(integradorId)
  res.json({
    scores,
    summary: summarizeHealthScores(scores),
  })
})

adminHealthScoresRouter.get('/:clienteFinalId',
  publicRoute(),
  async (req: Request, res: Response) => {
  const r = await computeHealthScore(String(req.params.clienteFinalId))
  if (!r) return res.status(404).json({ error: 'cliente_not_found' })
  return res.json(r)
})

// ── /me/integrador/health-scores ────────────────────────────────────────
export const meIntegradorHealthScoresRouter = Router()
meIntegradorHealthScoresRouter.use(requireAuth)
meIntegradorHealthScoresRouter.use(requireRole('INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'SUPER_ADMIN', 'ADMIN_GLOBAL'))

meIntegradorHealthScoresRouter.get('/',
  publicRoute(),
  async (req: Request, res: Response) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) {
    return res.status(400).json({ error: 'no_tenant_context' })
  }
  const scores = await computeHealthScoresBulk(integradorId)
  res.json({
    scores,
    summary: summarizeHealthScores(scores),
  })
})

meIntegradorHealthScoresRouter.get('/:clienteFinalId',
  publicRoute(),
  async (req: Request, res: Response) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) {
    return res.status(400).json({ error: 'no_tenant_context' })
  }
  // Garantir ownership: cliente tem que pertencer ao integrador autenticado
  const cliente = await prisma.clienteFinal.findUnique({
    where: { id: String(req.params.clienteFinalId) },
    select: { integradorId: true },
  })
  if (!cliente) return res.status(404).json({ error: 'cliente_not_found' })
  if (cliente.integradorId !== integradorId && req.jwtPayload?.role !== 'SUPER_ADMIN' && req.jwtPayload?.role !== 'ADMIN_GLOBAL') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const r = await computeHealthScore(String(req.params.clienteFinalId))
  if (!r) return res.status(404).json({ error: 'cliente_not_found' })
  return res.json(r)
})
