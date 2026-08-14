/**
 * Admin Gemini CallLog Routes — visão SUPER_ADMIN do uso Gemini global.
 *
 * Endereça P0 GAP #2 (rastreabilidade) e dashboards de governança.
 *
 * Endpoints:
 *   GET /admin/gemini-callogs              — lista paginada com filtros
 *   GET /admin/gemini-callogs/summary      — agregação por integrador/feature
 *   GET /admin/gemini-callogs/quota        — calls por integrador nas últimas 24h
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, requireSudo } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'

export const adminGeminiCallogsRouter = Router()
adminGeminiCallogsRouter.use(requireAuth)
adminGeminiCallogsRouter.use(requireSudo)

// ── LIST ─────────────────────────────────────────────────────────────────
adminGeminiCallogsRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const schema = z.object({
    feature:  z.string().optional(),
    paidBy:   z.enum(['fabricante', 'integrador', 'cliente']).optional(),
    payerId:  z.string().optional(),
    outcome:  z.string().optional(),
    sinceMin: z.coerce.number().int().min(1).max(10080).default(60), // default 60 min
    page:     z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(100),
  })
  const q = schema.parse(req.query)
  const since = new Date(Date.now() - q.sinceMin * 60 * 1000)
  const where: any = { ts: { gte: since } }
  if (q.feature) where.feature = q.feature
  if (q.paidBy)  where.paidBy = q.paidBy
  if (q.payerId) where.payerId = q.payerId
  if (q.outcome) where.outcome = q.outcome

  const [items, total] = await Promise.all([
    prisma.geminiCallLog.findMany({
      where,
      orderBy: { ts: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.geminiCallLog.count({ where }),
  ])
  res.json({ items, total, page: q.page, pageSize: q.pageSize })
}))

// ── SUMMARY (agg para dashboard) ─────────────────────────────────────────
adminGeminiCallogsRouter.get('/summary',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const sinceMin = Number(req.query.sinceMin ?? 1440) // default 24h
  const since = new Date(Date.now() - sinceMin * 60 * 1000)

  const [byFeature, byPaidBy, byOutcome, totals] = await Promise.all([
    prisma.geminiCallLog.groupBy({
      by: ['feature'], where: { ts: { gte: since } },
      _count: true, _sum: { estimatedCost: true, tokensIn: true, tokensOut: true },
    }),
    prisma.geminiCallLog.groupBy({
      by: ['paidBy'], where: { ts: { gte: since } },
      _count: true, _sum: { estimatedCost: true },
    }),
    prisma.geminiCallLog.groupBy({
      by: ['outcome'], where: { ts: { gte: since } },
      _count: true,
    }),
    prisma.geminiCallLog.aggregate({
      where: { ts: { gte: since } },
      _count: true,
      _sum: { estimatedCost: true, tokensIn: true, tokensOut: true },
      _avg: { latencyMs: true },
    }),
  ])

  res.json({ since, byFeature, byPaidBy, byOutcome, totals })
}))

// ── QUOTA (por integrador, últimas 24h) ──────────────────────────────────
adminGeminiCallogsRouter.get('/quota',
  publicRoute(),
  asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const usage = await prisma.geminiCallLog.groupBy({
    by: ['paidBy', 'payerId'],
    where: { ts: { gte: since }, outcome: 'success' },
    _count: true,
    _sum: { estimatedCost: true },
  })
  // Hidrata com cap de cada integrador
  const integradores = await prisma.integrador.findMany({
    select: { id: true, name: true, geminiCallCapDaily: true, geminiByokMode: true },
  })
  const integMap = new Map(integradores.map(i => [i.id, i]))
  const items = usage.map(u => {
    const integ = u.paidBy === 'integrador' ? integMap.get(u.payerId) : null
    return {
      paidBy: u.paidBy,
      payerId: u.payerId,
      payerName: integ?.name ?? u.payerId,
      calls: u._count,
      estimatedCost: u._sum.estimatedCost,
      cap: integ?.geminiCallCapDaily ?? null,
      byokMode: integ?.geminiByokMode ?? null,
      utilization: integ?.geminiCallCapDaily ? u._count / integ.geminiCallCapDaily : null,
    }
  })
  res.json({ items })
}))
