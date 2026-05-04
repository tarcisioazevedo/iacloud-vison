/**
 * Sales — Rotas do Comercial Hub.
 *
 * Concentra:
 *   - /sales/team               (CRUD básico de SalesUser + ranking)
 *   - /sales/goals              (CRUD de SalesGoal)
 *   - /sales/activities         (feed unificado)
 *   - /sales/opportunities      (CRUD + auto-detect cross-sell/upsell)
 *   - /sales/score/:leadId      (recomputar score)
 *   - /sales/assets             (materiais comerciais)
 *   - /sales/executive-stats    (dashboard CCO/diretor)
 *   - /sales/leads/assign       (atribuição manual ou auto round-robin)
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { ValidationError, NotFoundError } from '../lib/errors'
import { logger } from '../lib/logger'

export const salesRouter = Router()
salesRouter.use(requireAuth)
salesRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

// ════════════════════════════════════════════════════════════════════════════
// TEAM (SalesUser)
// ════════════════════════════════════════════════════════════════════════════
const CreateSalesUserSchema = z.object({
  userId:   z.string().uuid(),
  name:     z.string().min(2),
  email:    z.string().email(),
  role:     z.enum(['SDR', 'AE', 'CS', 'MANAGER', 'DIRECTOR']),
  hireDate: z.string().datetime().optional(),
})

salesRouter.get('/team', asyncHandler(async (_req, res) => {
  const team = await prisma.salesUser.findMany({
    orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
  })
  res.json({ team, total: team.length })
}))

salesRouter.post('/team', asyncHandler(async (req, res) => {
  const parse = CreateSalesUserSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')
  const created = await prisma.salesUser.create({ data: parse.data as any })
  res.status(201).json(created)
}))

salesRouter.patch('/team/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const updated = await prisma.salesUser.update({
    where: { id: String(id) },
    data: req.body,
  })
  res.json(updated)
}))

// Ranking do time por mês
salesRouter.get('/team/ranking', asyncHandler(async (req, res) => {
  const month = req.query.month
    ? new Date(String(req.query.month))
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1)
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1)

  const team = await prisma.salesUser.findMany({ where: { active: true } })

  const rankings = await Promise.all(team.map(async (m) => {
    const [calls, demos, deals] = await Promise.all([
      prisma.salesActivity.count({ where: { salesUserId: m.id, type: 'CALL', createdAt: { gte: monthStart, lt: monthEnd } } }),
      prisma.salesActivity.count({ where: { salesUserId: m.id, type: 'DEMO_DONE', createdAt: { gte: monthStart, lt: monthEnd } } }),
      prisma.salesOpportunity.count({ where: { ownerId: m.id, status: 'WON', closedAt: { gte: monthStart, lt: monthEnd } } }),
    ])
    const wonRevenue = await prisma.salesOpportunity.aggregate({
      where: { ownerId: m.id, status: 'WON', closedAt: { gte: monthStart, lt: monthEnd } },
      _sum: { estimatedMrr: true },
    })
    return {
      salesUser: m,
      calls,
      demos,
      deals,
      mrr: wonRevenue._sum.estimatedMrr ?? 0,
    }
  }))

  rankings.sort((a, b) => b.mrr - a.mrr)
  res.json({ rankings, period: { start: monthStart, end: monthEnd } })
}))

// ════════════════════════════════════════════════════════════════════════════
// GOALS
// ════════════════════════════════════════════════════════════════════════════
const GoalSchema = z.object({
  salesUserId: z.string().uuid(),
  period:      z.string().datetime(),
  metric:      z.enum(['CALLS', 'QUALIFIED_LEADS', 'DEMOS_SENT', 'DEALS_CLOSED', 'CLOSED_MRR', 'REVENUE']),
  target:      z.number().positive(),
})

salesRouter.get('/goals', asyncHandler(async (req, res) => {
  const where: any = {}
  if (req.query.salesUserId) where.salesUserId = String(req.query.salesUserId)
  if (req.query.period) where.period = new Date(String(req.query.period))
  const goals = await prisma.salesGoal.findMany({
    where,
    include: { salesUser: { select: { id: true, name: true, role: true } } },
    orderBy: { period: 'desc' },
  })
  res.json({ goals })
}))

salesRouter.post('/goals', asyncHandler(async (req, res) => {
  const parse = GoalSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')
  const created = await prisma.salesGoal.upsert({
    where: { salesUserId_period_metric: {
      salesUserId: parse.data.salesUserId,
      period: new Date(parse.data.period),
      metric: parse.data.metric,
    }},
    create: { ...parse.data, period: new Date(parse.data.period) } as any,
    update: { target: parse.data.target },
  })
  res.json(created)
}))

// ════════════════════════════════════════════════════════════════════════════
// ACTIVITIES
// ════════════════════════════════════════════════════════════════════════════
const ActivitySchema = z.object({
  salesUserId:  z.string().uuid(),
  leadId:       z.string().uuid().optional(),
  integradorId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  type:         z.enum(['CALL', 'EMAIL', 'WHATSAPP', 'MEETING', 'NOTE', 'TASK', 'PROPOSAL_SENT', 'DEMO_DONE']),
  durationSec:  z.number().int().nonnegative().optional(),
  outcome:      z.string().max(100).optional(),
  notes:        z.string().max(2000).optional(),
})

salesRouter.get('/activities', asyncHandler(async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit ?? 50))
  const where: any = {}
  if (req.query.salesUserId) where.salesUserId = String(req.query.salesUserId)
  if (req.query.leadId)      where.leadId = String(req.query.leadId)
  if (req.query.integradorId) where.integradorId = String(req.query.integradorId)
  if (req.query.type)        where.type = String(req.query.type)
  if (req.query.since) where.createdAt = { gte: new Date(String(req.query.since)) }

  const activities = await prisma.salesActivity.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { salesUser: { select: { id: true, name: true, role: true, avatar: true } } },
  })
  res.json({ activities, total: activities.length })
}))

salesRouter.post('/activities', asyncHandler(async (req, res) => {
  const parse = ActivitySchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')
  const created = await prisma.salesActivity.create({ data: parse.data as any })

  // H6 — Hook activity criada → bump goal CALLS/DEMOS_SENT
  import('../services/sales-hooks.service').then(m => m.onActivityCreated(created))
    .catch(err => logger.warn({ err: err.message }, 'h6_failed'))

  res.status(201).json(created)
}))

// ════════════════════════════════════════════════════════════════════════════
// OPPORTUNITIES
// ════════════════════════════════════════════════════════════════════════════
const OpportunitySchema = z.object({
  type:            z.enum(['NEW_LEAD', 'CROSS_SELL', 'UPSELL', 'RENEWAL']),
  status:          z.enum(['OPEN', 'WON', 'LOST', 'STALLED']).optional(),
  leadId:          z.string().uuid().optional(),
  integradorId:    z.string().uuid().optional(),
  ownerId:         z.string().uuid().optional(),
  title:           z.string().min(2),
  description:     z.string().optional(),
  modulesProposed: z.array(z.string()).optional(),
  estimatedMrr:    z.number().optional(),
  probability:     z.number().int().min(0).max(100).optional(),
  closeDate:       z.string().datetime().optional(),
})

salesRouter.get('/opportunities', asyncHandler(async (req, res) => {
  const where: any = {}
  if (req.query.status) where.status = String(req.query.status)
  if (req.query.type)   where.type = String(req.query.type)
  if (req.query.ownerId) where.ownerId = String(req.query.ownerId)
  if (req.query.integradorId) where.integradorId = String(req.query.integradorId)

  const opps = await prisma.salesOpportunity.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { owner: { select: { id: true, name: true, role: true } } },
    take: 200,
  })

  // Enriquece com nome do tenant/lead
  const enriched = await Promise.all(opps.map(async (o) => {
    let tenantName: string | null = null
    let leadName: string | null = null
    if (o.integradorId) {
      const t = await prisma.integrador.findUnique({ where: { id: o.integradorId }, select: { name: true } })
      tenantName = t?.name ?? null
    }
    if (o.leadId) {
      const l = await prisma.lead.findUnique({ where: { id: o.leadId }, select: { contactName: true, companyName: true } })
      leadName = l?.companyName ?? l?.contactName ?? null
    }
    return { ...o, tenantName, leadName }
  }))

  // Aggregations
  const totalValue = opps.filter(o => o.status === 'OPEN').reduce((s, o) => s + (o.estimatedMrr ?? 0), 0)
  const counts = {
    open: opps.filter(o => o.status === 'OPEN').length,
    won: opps.filter(o => o.status === 'WON').length,
    lost: opps.filter(o => o.status === 'LOST').length,
    stalled: opps.filter(o => o.status === 'STALLED').length,
  }

  res.json({ opportunities: enriched, total: enriched.length, totalValue, counts })
}))

salesRouter.post('/opportunities', asyncHandler(async (req, res) => {
  const parse = OpportunitySchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')
  const data: any = { ...parse.data, modulesProposed: parse.data.modulesProposed ?? [] }
  if (parse.data.closeDate) data.closeDate = new Date(parse.data.closeDate)
  const created = await prisma.salesOpportunity.create({ data })
  res.status(201).json(created)
}))

salesRouter.patch('/opportunities/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data: any = { ...req.body }
  if (data.closeDate) data.closeDate = new Date(data.closeDate)
  if (req.body.status === 'WON') data.closedAt = new Date()
  if (req.body.status === 'LOST') data.closedAt = new Date()
  const updated = await prisma.salesOpportunity.update({ where: { id: String(id) }, data })
  res.json(updated)
}))

// Auto-detect oportunidades cross-sell/upsell
salesRouter.post('/opportunities/auto-detect', asyncHandler(async (_req, res) => {
  const created: any[] = []

  // Lista todos os integradores ativos
  const integradores = await prisma.integrador.findMany({
    where: { active: true },
    select: {
      id: true, name: true, maxEdgeNodes: true,
      clienteFinais: { select: { id: true, vertical: true, sites: { select: { _count: { select: { cameras: true } } } } } },
      apiQuotas: { where: { periodEnd: { gte: new Date() } }, take: 1 },
    },
  })

  // Módulos contratados por integrador
  const allModules = await prisma.integradorModule.findMany({
    where: { enabled: true },
    select: { integradorId: true, module: true },
  })
  const modulesByInteg: Record<string, Set<string>> = {}
  for (const m of allModules) {
    if (!modulesByInteg[m.integradorId]) modulesByInteg[m.integradorId] = new Set()
    modulesByInteg[m.integradorId].add(m.module)
  }

  // Existing OPEN opportunities — não duplicar
  const existing = await prisma.salesOpportunity.findMany({
    where: { status: 'OPEN', integradorId: { in: integradores.map(i => i.id) } },
    select: { integradorId: true, modulesProposed: true, type: true },
  })
  const hasOpenOpp = (integradorId: string, modules: string[]) =>
    existing.some(e => e.integradorId === integradorId &&
      modules.every(m => e.modulesProposed.includes(m)))

  for (const integ of integradores) {
    const contracted = modulesByInteg[integ.id] ?? new Set()
    const cameraCount = integ.clienteFinais.reduce((s, c) =>
      s + c.sites.reduce((ss, st) => ss + st._count.cameras, 0), 0)

    // Heurística 1: Vertical PARKING sem módulo Placas
    const hasParkingClient = integ.clienteFinais.some(c => c.vertical === 'PARKING')
    if (hasParkingClient && !contracted.has('LICENSE_PLATE_RECOGNITION') &&
        !hasOpenOpp(integ.id, ['LICENSE_PLATE_RECOGNITION'])) {
      const opp = await prisma.salesOpportunity.create({
        data: {
          type: 'CROSS_SELL',
          integradorId: integ.id,
          title: `${integ.name} — Adicionar módulo Placas (LPR)`,
          description: 'Tenant tem cliente em vertical Estacionamento sem módulo de leitura de placas.',
          modulesProposed: ['LICENSE_PLATE_RECOGNITION'],
          estimatedMrr: cameraCount * 50,
          probability: 65,
          reasonAi: `Identificado cliente em vertical PARKING (${cameraCount} câmeras). LPR é módulo natural para este caso de uso.`,
        },
      })
      created.push(opp)
    }

    // Heurística 2: Vertical INDUSTRIAL sem PPE
    const hasIndustryClient = integ.clienteFinais.some(c => c.vertical === 'INDUSTRIAL')
    if (hasIndustryClient && !contracted.has('PPE_DETECTION') &&
        !hasOpenOpp(integ.id, ['PPE_DETECTION'])) {
      const opp = await prisma.salesOpportunity.create({
        data: {
          type: 'CROSS_SELL',
          integradorId: integ.id,
          title: `${integ.name} — Adicionar módulo PPE (EPI)`,
          description: 'Tenant tem cliente em vertical Indústria sem detecção de EPI.',
          modulesProposed: ['PPE_DETECTION'],
          estimatedMrr: cameraCount * 80,
          probability: 70,
          reasonAi: 'Compliance NR-6 obrigatório em indústrias. Alto valor agregado.',
        },
      })
      created.push(opp)
    }

    // Heurística 3: Vertical RETAIL/SHOPPING sem Demografia
    const hasRetailClient = integ.clienteFinais.some(c => ['RETAIL','SHOPPING_MALL'].includes(c.vertical as string))
    if (hasRetailClient && !contracted.has('DEMOGRAPHICS') &&
        !hasOpenOpp(integ.id, ['DEMOGRAPHICS'])) {
      const opp = await prisma.salesOpportunity.create({
        data: {
          type: 'CROSS_SELL',
          integradorId: integ.id,
          title: `${integ.name} — Adicionar módulo Demografia + Heatmap`,
          description: 'Cliente em varejo/shopping sem analytics de comportamento.',
          modulesProposed: ['DEMOGRAPHICS', 'HEATMAP'],
          estimatedMrr: cameraCount * 60,
          probability: 55,
          reasonAi: 'Varejo monetiza analytics de fluxo de pessoas. Excelente upsell.',
        },
      })
      created.push(opp)
    }

    // Heurística 4: Quota Vertex > 80% — upsell de plano
    const quota = integ.apiQuotas[0]
    if (quota) {
      const visionPct = quota.staticVisionMonthlyLimit > 0
        ? (quota.staticVisionUsedThisMonth / quota.staticVisionMonthlyLimit) * 100
        : 0
      if (visionPct > 80 && !hasOpenOpp(integ.id, ['QUOTA_UPGRADE'])) {
        const opp = await prisma.salesOpportunity.create({
          data: {
            type: 'UPSELL',
            integradorId: integ.id,
            title: `${integ.name} — Upgrade de quota Vertex (${visionPct.toFixed(0)}% usado)`,
            description: `Quota mensal próxima do limite. Sugerir plano superior antes de bloquear.`,
            modulesProposed: ['QUOTA_UPGRADE'],
            estimatedMrr: 500,
            probability: 80,
            reasonAi: `Quota em ${visionPct.toFixed(0)}%. Upsell preventivo evita bloqueio + insatisfação.`,
          },
        })
        created.push(opp)
      }
    }

    // Heurística 5: integrador sem White-label e tem >5 clientes — upgrade Enterprise
    if (integ.clienteFinais.length >= 5 && !contracted.has('WHITE_LABEL') &&
        !hasOpenOpp(integ.id, ['WHITE_LABEL'])) {
      const opp = await prisma.salesOpportunity.create({
        data: {
          type: 'UPSELL',
          integradorId: integ.id,
          title: `${integ.name} — Upgrade para Enterprise (White-label)`,
          description: `${integ.clienteFinais.length} clientes finais — escala suficiente para white-label próprio.`,
          modulesProposed: ['WHITE_LABEL'],
          estimatedMrr: 2000,
          probability: 60,
          reasonAi: 'Integrador com 5+ clientes ganharia margem com domínio e marca próprios.',
        },
      })
      created.push(opp)
    }
  }

  logger.info({ created: created.length }, 'opportunities_auto_detected')
  res.json({ created: created.length, opportunities: created })
}))

// ════════════════════════════════════════════════════════════════════════════
// LEAD SCORE — recompute manual ou bulk
// ════════════════════════════════════════════════════════════════════════════
function computeLeadScore(lead: any): { score: number; reasons: any[] } {
  const reasons: any[] = []
  let score = 30 // baseline

  // Empresa preenchida
  if (lead.companyName) { score += 10; reasons.push({ factor: 'company', points: 10, label: 'Empresa identificada' }) }
  // CNPJ
  if (lead.cnpj) { score += 10; reasons.push({ factor: 'cnpj', points: 10, label: 'CNPJ válido' }) }
  // Telefone
  if (lead.contactPhone) { score += 5; reasons.push({ factor: 'phone', points: 5, label: 'Telefone fornecido' }) }
  // Cargo (decisor)
  if (lead.contactRole && /diret|gerent|ceo|cto|coo|cfo/i.test(lead.contactRole)) {
    score += 15; reasons.push({ factor: 'role_decision', points: 15, label: 'Decisor identificado' })
  }
  // Volume de câmeras
  const volMap: Record<string, number> = { 'LT_50': 5, '50_500': 15, '500_2000': 25, 'GT_2000': 30 }
  const volPts = volMap[lead.cameraVolume ?? ''] ?? 0
  if (volPts > 0) {
    score += volPts; reasons.push({ factor: 'camera_volume', points: volPts, label: `Volume: ${lead.cameraVolume}` })
  }
  // Tipo (integrador é mais valioso para B2B2B)
  if (lead.kind === 'INTEGRADOR') {
    score += 10; reasons.push({ factor: 'kind_integrador', points: 10, label: 'Integrador (B2B reseller)' })
  }
  // Já contatado
  if (lead.status === 'CONTACTED') { score += 5; reasons.push({ factor: 'contacted', points: 5, label: 'Já contatado' }) }
  if (lead.status === 'DEMO_SENT')  { score += 10; reasons.push({ factor: 'demo_sent', points: 10, label: 'Demo já enviada' }) }
  // Mensagem detalhada
  if (lead.message && lead.message.length > 50) {
    score += 5; reasons.push({ factor: 'detailed_message', points: 5, label: 'Mensagem detalhada' })
  }
  return { score: Math.min(100, score), reasons }
}

salesRouter.post('/score/recompute-all', asyncHandler(async (_req, res) => {
  const leads = await prisma.lead.findMany({ where: { status: { not: 'LOST' } } })
  let updated = 0
  for (const l of leads) {
    const { score, reasons } = computeLeadScore(l)
    await prisma.leadScore.upsert({
      where: { leadId: l.id },
      create: { leadId: l.id, score, reasonsJson: reasons as any },
      update: { score, reasonsJson: reasons as any, computedAt: new Date() },
    })
    updated++
  }
  res.json({ updated })
}))

salesRouter.get('/score/:leadId', asyncHandler(async (req, res) => {
  const score = await prisma.leadScore.findUnique({ where: { leadId: String(req.params.leadId) } })
  if (!score) {
    const lead = await prisma.lead.findUnique({ where: { id: String(req.params.leadId) } })
    if (!lead) throw new NotFoundError('Lead')
    const computed = computeLeadScore(lead)
    const created = await prisma.leadScore.create({
      data: { leadId: lead.id, score: computed.score, reasonsJson: computed.reasons as any },
    })
    return res.json(created)
  }
  res.json(score)
}))

// ════════════════════════════════════════════════════════════════════════════
// ASSETS (Materiais comerciais)
// ════════════════════════════════════════════════════════════════════════════
salesRouter.get('/assets', asyncHandler(async (_req, res) => {
  const assets = await prisma.salesAsset.findMany({
    where: { active: true },
    orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
  })
  res.json({ assets, total: assets.length })
}))

salesRouter.post('/assets', asyncHandler(async (req, res) => {
  const created = await prisma.salesAsset.create({ data: req.body })
  res.status(201).json(created)
}))

// ════════════════════════════════════════════════════════════════════════════
// LEAD ASSIGNMENT (manual + auto round-robin)
// ════════════════════════════════════════════════════════════════════════════
const AssignSchema = z.object({
  leadId:      z.string().uuid(),
  salesUserId: z.string().uuid().optional(),  // se omitido, faz round-robin
  reason:      z.string().optional(),
})

salesRouter.post('/leads/assign', asyncHandler(async (req, res) => {
  const parse = AssignSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')
  let { leadId, salesUserId, reason } = parse.data

  // Round-robin se não especificou salesUserId
  if (!salesUserId) {
    const sdrs = await prisma.salesUser.findMany({ where: { role: 'SDR', active: true } })
    if (sdrs.length === 0) throw new ValidationError('Nenhum SDR ativo para round-robin')
    // Conta atribuições ativas por SDR e pega o com menor carga
    const counts = await Promise.all(sdrs.map(async (s) => ({
      id: s.id,
      count: await prisma.leadAssignment.count({ where: { salesUserId: s.id, active: true } }),
    })))
    counts.sort((a, b) => a.count - b.count)
    salesUserId = counts[0].id
    reason = reason ?? 'round-robin (menor carga)'
  } else {
    reason = reason ?? 'manual'
  }

  // Desativa atribuições anteriores
  await prisma.leadAssignment.updateMany({
    where: { leadId, active: true },
    data:  { active: false },
  })
  const assignment = await prisma.leadAssignment.create({
    data: { leadId, salesUserId, reason, active: true },
  })
  // Atualiza Lead.assignedToUserId para compatibilidade
  await prisma.lead.update({ where: { id: leadId }, data: { assignedToUserId: salesUserId } })
  res.json(assignment)
}))

// ════════════════════════════════════════════════════════════════════════════
// EXECUTIVE STATS — Dashboard CCO
// ════════════════════════════════════════════════════════════════════════════
salesRouter.get('/executive-stats', asyncHandler(async (req, res) => {
  const days = Math.min(365, Number(req.query.days ?? 30))
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)

  const [
    leadsTotal, leadsConverted, leadsLost,
    pipeline, won, lost,
    activitiesCount, demosCount,
    integradoresAtivos,
    topOppsAgg,
  ] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: since } } }),
    prisma.lead.count({ where: { status: 'CONVERTED', convertedAt: { gte: since } } }),
    prisma.lead.count({ where: { status: 'LOST', updatedAt: { gte: since } } }),
    prisma.salesOpportunity.aggregate({
      where: { status: 'OPEN' },
      _sum: { estimatedMrr: true }, _count: { id: true },
    }),
    prisma.salesOpportunity.aggregate({
      where: { status: 'WON', closedAt: { gte: monthStart, lt: monthEnd } },
      _sum: { estimatedMrr: true }, _count: { id: true },
    }),
    prisma.salesOpportunity.count({ where: { status: 'LOST', closedAt: { gte: monthStart } } }),
    prisma.salesActivity.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.salesActivity.count({ where: { type: 'DEMO_DONE', createdAt: { gte: monthStart } } }),
    prisma.integrador.count({ where: { active: true } }),
    prisma.salesOpportunity.findMany({
      where: { status: 'OPEN' },
      orderBy: { estimatedMrr: 'desc' },
      take: 5,
    }),
  ])

  const conversionRate = leadsTotal > 0 ? (leadsConverted / leadsTotal) * 100 : 0
  const winRate = (won._count.id + lost) > 0 ? (won._count.id / (won._count.id + lost)) * 100 : 0
  const avgTicket = won._count.id > 0 ? (won._sum.estimatedMrr ?? 0) / won._count.id : 0

  // Funil deste mês
  const monthlyFunnel = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.lead.count({ where: { contactedAt: { gte: monthStart } } }),
    prisma.lead.count({ where: { demoSentAt: { gte: monthStart } } }),
    prisma.salesOpportunity.count({ where: { status: 'OPEN', type: 'NEW_LEAD' } }),
    prisma.lead.count({ where: { convertedAt: { gte: monthStart } } }),
  ])

  res.json({
    period: { since, days, monthStart, monthEnd },
    kpis: {
      leadsTotal, leadsConverted, leadsLost, conversionRate,
      pipelineValue: pipeline._sum.estimatedMrr ?? 0,
      pipelineCount: pipeline._count.id,
      mrrClosed: won._sum.estimatedMrr ?? 0,
      dealsWon: won._count.id,
      winRate,
      avgTicket,
      activities: activitiesCount,
      demosDone: demosCount,
      integradoresAtivos,
    },
    funnel: {
      novos:       monthlyFunnel[0],
      contatados:  monthlyFunnel[1],
      demosEnv:    monthlyFunnel[2],
      negociacao:  monthlyFunnel[3],
      convertidos: monthlyFunnel[4],
    },
    topOpportunities: topOppsAgg,
  })
}))
