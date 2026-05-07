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
import { auditAction, auditUpdate } from '../lib/audit-helpers'

export const salesRouter = Router()
salesRouter.use(requireAuth)
// Acessível à equipe comercial inteira (gestão), além de SUPER_ADMIN.
// Filtros server-side ("meus") são aplicados em endpoints específicos via JWT.
salesRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL', 'SDR', 'HUNTER', 'CLOSER', 'AE', 'CS', 'MANAGER', 'DIRECTOR'))

// ════════════════════════════════════════════════════════════════════════════
// TEAM (SalesUser)
// ════════════════════════════════════════════════════════════════════════════
const CreateSalesUserSchema = z.object({
  userId:   z.string().uuid(),
  name:     z.string().min(2),
  email:    z.string().email(),
  role:     z.enum(['SDR', 'HUNTER', 'CLOSER', 'AE', 'CS', 'MANAGER', 'DIRECTOR']),
  hireDate: z.string().datetime().optional(),
})

salesRouter.get('/team', asyncHandler(async (_req, res) => {
  const team = await prisma.salesUser.findMany({
    orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
  })
  res.json({ team, total: team.length })
}))

// Helper: dado o JWT, retorna se é gestor (vê tudo) ou se deve filtrar pelos próprios leads
function isManagerRole(role: string | undefined): boolean {
  return ['SUPER_ADMIN', 'ADMIN_GLOBAL', 'MANAGER', 'DIRECTOR'].includes(role ?? '')
}

// Lista Users que podem virar SalesUser (não estão em SalesUser e role compatível)
salesRouter.get('/team/eligible-users', asyncHandler(async (_req, res) => {
  const existing = await prisma.salesUser.findMany({ select: { userId: true } })
  const existingIds = existing.map(s => s.userId)
  const users = await prisma.user.findMany({
    where: {
      active: true,
      id: { notIn: existingIds.length ? existingIds : ['__none__'] },
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
    take: 200,
  })
  res.json({ users })
}))

salesRouter.post('/team', asyncHandler(async (req, res) => {
  const parse = CreateSalesUserSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')
  const created = await prisma.salesUser.create({ data: parse.data as any })

  // Auditoria semântica — entrada de membro no time comercial
  await auditAction(prisma, {
    req,
    action: 'SALES_USER_CREATED',
    resource: 'SalesUser',
    resourceId: created.id,
    result: 'SUCCESS',
    metadata: {
      userId: parse.data.userId,
      email: parse.data.email,
      role: parse.data.role,
    },
  })

  res.status(201).json(created)
}))

salesRouter.patch('/team/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const before = await prisma.salesUser.findUnique({ where: { id: String(id) } })
  if (!before) throw new NotFoundError('SalesUser')
  const updated = await prisma.salesUser.update({
    where: { id: String(id) },
    data: req.body,
  })

  // Auditoria semântica — mudanças no time (ex: ativar/desativar, mudar role/quota)
  // SALES_USER_DEACTIVATED é destacada por ser audit-relevant para billing/comissões.
  const wasDeactivated = before.active && !updated.active
  const wasReactivated = !before.active && updated.active
  const action = wasDeactivated ? 'SALES_USER_DEACTIVATED'
              : wasReactivated ? 'SALES_USER_REACTIVATED'
              : 'SALES_USER_UPDATED'

  await auditUpdate(prisma, {
    req,
    action,
    resource: 'SalesUser',
    resourceId: updated.id,
    result: 'SUCCESS',
    before,
    after: updated,
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

  // RBAC: vendedor não-gestor só vê suas próprias atividades
  const role = req.jwtPayload?.role
  if (!isManagerRole(role)) {
    const su = await prisma.salesUser.findFirst({ where: { userId: req.jwtPayload!.sub } })
    if (su) where.salesUserId = su.id
    else where.salesUserId = '__none__' // sem SalesUser, sem dados
  }

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

  // Auditoria semântica — atividade comercial (CALL, DEMO_DONE, EMAIL, MEETING)
  // Necessário para reconciliar metas e detectar fraudes (ex: forjar atividades).
  await auditAction(prisma, {
    req,
    action: 'SALES_ACTIVITY_LOGGED',
    resource: 'SalesActivity',
    resourceId: created.id,
    result: 'SUCCESS',
    metadata: {
      type: created.type,
      salesUserId: created.salesUserId,
      leadId: created.leadId,
      hasNotes: !!created.notes,
    },
  })

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

  // RBAC: vendedor vê só as próprias oportunidades; gestor vê tudo
  const role = req.jwtPayload?.role
  if (!isManagerRole(role)) {
    const su = await prisma.salesUser.findFirst({ where: { userId: req.jwtPayload!.sub } })
    if (su) where.ownerId = su.id
    else where.ownerId = '__none__'
  }

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

  // Auditoria semântica — abertura de oportunidade no funil
  await auditAction(prisma, {
    req,
    action: 'SALES_OPPORTUNITY_CREATED',
    resource: 'SalesOpportunity',
    resourceId: created.id,
    result: 'SUCCESS',
    metadata: {
      type: created.type,
      title: created.title,
      leadId: created.leadId,
      integradorId: created.integradorId,
      ownerId: created.ownerId,
      estimatedMrr: created.estimatedMrr,
      probability: created.probability,
    },
  })

  res.status(201).json(created)
}))

salesRouter.patch('/opportunities/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const before = await prisma.salesOpportunity.findUnique({ where: { id: String(id) } })
  if (!before) throw new NotFoundError('SalesOpportunity')
  const data: any = { ...req.body }
  if (data.closeDate) data.closeDate = new Date(data.closeDate)
  if (req.body.status === 'WON') data.closedAt = new Date()
  if (req.body.status === 'LOST') data.closedAt = new Date()
  const updated = await prisma.salesOpportunity.update({ where: { id: String(id) }, data })

  // Auditoria semântica — mudança de status é evento de revenue tracking.
  // SALES_OPPORTUNITY_WON e _LOST são destacadas para forensics e métrica.
  const statusChanged = req.body.status && req.body.status !== before.status
  const action = statusChanged
    ? (req.body.status === 'WON'  ? 'SALES_OPPORTUNITY_WON'
    :  req.body.status === 'LOST' ? 'SALES_OPPORTUNITY_LOST'
    :  'SALES_OPPORTUNITY_STATUS_CHANGED')
    : 'SALES_OPPORTUNITY_UPDATED'

  await auditUpdate(prisma, {
    req,
    action,
    resource: 'SalesOpportunity',
    resourceId: updated.id,
    result: 'SUCCESS',
    before,
    after: updated,
    metadata: statusChanged ? { from: before.status, to: updated.status } : {},
  })

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

  // Auditoria semântica — distribuição de lead pra SDR/vendedor.
  // Ação operacional crítica: define quem ganha comissão.
  await auditAction(prisma, {
    req,
    action: 'LEAD_ASSIGNED',
    resource: 'Lead',
    resourceId: leadId,
    result: 'SUCCESS',
    metadata: {
      assignmentId: assignment.id,
      salesUserId,
      reason,
      method: parse.data.salesUserId ? 'manual' : 'round_robin',
    },
  })

  res.json(assignment)
}))

// ════════════════════════════════════════════════════════════════════════════
// EXECUTIVE STATS — Dashboard CCO
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// EXECUTIVE STATS 2.0 — Dashboard CCO completo com filtros, séries temporais,
// heatmap, vendas por módulo, comparação vs período anterior.
// ════════════════════════════════════════════════════════════════════════════
const ExecQuerySchema = z.object({
  days:       z.coerce.number().int().min(1).max(365).default(30),
  vendedorId: z.string().optional(),
  team:       z.enum(['all','SDR','HUNTER','CLOSER','AE','CS','MANAGER','DIRECTOR']).optional(),
  vertical:   z.string().optional(),
  kind:       z.enum(['INTEGRADOR','CLIENTE_FINAL']).optional(),
  compare:    z.enum(['true','false']).default('true'),
})

salesRouter.get('/executive-stats', asyncHandler(async (req, res) => {
  const q = ExecQuerySchema.parse(req.query)
  const since = new Date(Date.now() - q.days * 24 * 3600 * 1000)
  const prevSince = new Date(since.getTime() - q.days * 24 * 3600 * 1000)
  const prevEnd = since
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)

  // Filtro de owner via vendedor/team
  let ownerFilter: any = {}
  if (q.vendedorId) ownerFilter = { ownerId: q.vendedorId }
  if (q.team && q.team !== 'all') {
    const ids = await prisma.salesUser.findMany({ where: { role: q.team as any, active: true }, select: { id: true } })
    ownerFilter = { ownerId: { in: ids.map(s => s.id) } }
  }
  let leadKindFilter: any = {}
  if (q.kind) leadKindFilter = { kind: q.kind }

  // ─── Janela atual ──────────────────────────────────────────────────────
  const [
    leadsTotal, leadsContacted, leadsDemo, leadsConverted, leadsLost,
    pipeline, won, lost,
    actCalls, actEmails, actWhatsapp, actMeetings, actNotes,
    integradoresAtivos,
    topOpps,
    activitiesAll,
  ] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: since }, ...leadKindFilter } }),
    prisma.lead.count({ where: { contactedAt: { gte: since }, ...leadKindFilter } }),
    prisma.lead.count({ where: { demoSentAt: { gte: since }, ...leadKindFilter } }),
    prisma.lead.count({ where: { status: 'CONVERTED', convertedAt: { gte: since }, ...leadKindFilter } }),
    prisma.lead.count({ where: { status: 'LOST', updatedAt: { gte: since }, ...leadKindFilter } }),
    prisma.salesOpportunity.aggregate({
      where: { status: 'OPEN', ...ownerFilter },
      _sum: { estimatedMrr: true }, _count: { id: true },
    }),
    prisma.salesOpportunity.aggregate({
      where: { status: 'WON', closedAt: { gte: since }, ...ownerFilter },
      _sum: { estimatedMrr: true }, _count: { id: true },
    }),
    prisma.salesOpportunity.count({ where: { status: 'LOST', closedAt: { gte: since }, ...ownerFilter } }),
    prisma.salesActivity.count({ where: { type: 'CALL',     createdAt: { gte: since } } }),
    prisma.salesActivity.count({ where: { type: 'EMAIL',    createdAt: { gte: since } } }),
    prisma.salesActivity.count({ where: { type: 'WHATSAPP', createdAt: { gte: since } } }),
    prisma.salesActivity.count({ where: { type: 'MEETING',  createdAt: { gte: since } } }),
    prisma.salesActivity.count({ where: { type: 'NOTE',     createdAt: { gte: since } } }),
    prisma.integrador.count({ where: { active: true } }),
    prisma.salesOpportunity.findMany({
      where: { status: 'OPEN', ...ownerFilter },
      orderBy: { estimatedMrr: 'desc' },
      take: 5,
      include: { owner: { select: { id: true, name: true, role: true } } },
    }),
    // Para sparkline e heatmap precisamos do timestamp; mas limitamos volume.
    prisma.salesActivity.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, type: true },
      take: 5000, // protege contra heatmap explodindo memória
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // ─── Janela anterior (para comparação) ─────────────────────────────────
  let previous: any = null
  if (q.compare === 'true') {
    const [pLeads, pConverted, pLost, pMrr, pDealsWon, pCalls] = await Promise.all([
      prisma.lead.count({ where: { createdAt: { gte: prevSince, lt: prevEnd } } }),
      prisma.lead.count({ where: { status: 'CONVERTED', convertedAt: { gte: prevSince, lt: prevEnd } } }),
      prisma.lead.count({ where: { status: 'LOST', updatedAt: { gte: prevSince, lt: prevEnd } } }),
      prisma.salesOpportunity.aggregate({
        where: { status: 'WON', closedAt: { gte: prevSince, lt: prevEnd } },
        _sum: { estimatedMrr: true },
      }),
      prisma.salesOpportunity.count({ where: { status: 'WON', closedAt: { gte: prevSince, lt: prevEnd } } }),
      prisma.salesActivity.count({ where: { type: 'CALL', createdAt: { gte: prevSince, lt: prevEnd } } }),
    ])
    previous = {
      leadsTotal: pLeads, leadsConverted: pConverted, leadsLost: pLost,
      mrrClosed: pMrr._sum.estimatedMrr ?? 0, dealsWon: pDealsWon,
      calls: pCalls,
    }
  }

  // ─── Sparklines: leads por dia + atividades por dia (últimos N dias) ───
  const sparkLeads: number[] = new Array(q.days).fill(0)
  const sparkActs:  number[] = new Array(q.days).fill(0)
  const sparkConverted: number[] = new Array(q.days).fill(0)
  const allLeads = await prisma.lead.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, convertedAt: true },
  })
  for (const l of allLeads) {
    const d = Math.floor((l.createdAt.getTime() - since.getTime()) / 86400000)
    if (d >= 0 && d < q.days) sparkLeads[d]++
    if (l.convertedAt) {
      const dc = Math.floor((l.convertedAt.getTime() - since.getTime()) / 86400000)
      if (dc >= 0 && dc < q.days) sparkConverted[dc]++
    }
  }
  for (const a of activitiesAll) {
    const d = Math.floor((a.createdAt.getTime() - since.getTime()) / 86400000)
    if (d >= 0 && d < q.days) sparkActs[d]++
  }

  // ─── Heatmap: atividades por hora × dia da semana (últimos 30d) ─────────
  const heatmap: number[][] = Array(7).fill(null).map(() => new Array(24).fill(0))
  for (const a of activitiesAll) {
    const wd = a.createdAt.getDay()
    const hr = a.createdAt.getHours()
    heatmap[wd][hr]++
  }

  // ─── Tendência semanal (12 semanas) ────────────────────────────────────
  const weeks = 12
  const weekStart = new Date(Date.now() - weeks * 7 * 86400000)
  const wonOpps = await prisma.salesOpportunity.findMany({
    where: { status: 'WON', closedAt: { gte: weekStart } },
    select: { closedAt: true, estimatedMrr: true },
  })
  const trendMrr: { week: string; mrr: number }[] = new Array(weeks).fill(null).map((_, i) => {
    const wStart = new Date(weekStart.getTime() + i * 7 * 86400000)
    return { week: wStart.toISOString().slice(0,10), mrr: 0 }
  })
  for (const o of wonOpps) {
    if (!o.closedAt) continue
    const w = Math.floor((o.closedAt.getTime() - weekStart.getTime()) / (7 * 86400000))
    if (w >= 0 && w < weeks) trendMrr[w].mrr += o.estimatedMrr ?? 0
  }

  // ─── Funil agregado com gargalos ───────────────────────────────────────
  const novos       = leadsTotal
  const contatados  = leadsContacted
  const demos       = leadsDemo
  const negociacao  = await prisma.salesOpportunity.count({ where: { status: 'OPEN', type: 'NEW_LEAD' } })
  const convertidos = leadsConverted

  const conv = (a: number, b: number) => b > 0 ? (a / b) * 100 : 0
  const funnelStages = [
    { stage: 'novos',       value: novos,       conversionFromPrev: 100 },
    { stage: 'contatados',  value: contatados,  conversionFromPrev: conv(contatados, novos) },
    { stage: 'demos',       value: demos,       conversionFromPrev: conv(demos, contatados) },
    { stage: 'negociacao',  value: negociacao,  conversionFromPrev: conv(negociacao, demos) },
    { stage: 'convertidos', value: convertidos, conversionFromPrev: conv(convertidos, negociacao) },
  ]
  // Identifica gargalo (etapa com menor conversão)
  const bottleneck = funnelStages.slice(1).reduce((min, s) => s.conversionFromPrev < min.conversionFromPrev ? s : min, funnelStages[1])

  // ─── Vendas por módulo / feature ───────────────────────────────────────
  const wonOppsWithModules = await prisma.salesOpportunity.findMany({
    where: { status: 'WON', closedAt: { gte: since } },
    select: { modulesProposed: true, estimatedMrr: true, type: true },
  })
  const moduleSales: Record<string, { count: number; mrr: number; type: string }> = {}
  for (const o of wonOppsWithModules) {
    for (const m of o.modulesProposed) {
      if (!moduleSales[m]) moduleSales[m] = { count: 0, mrr: 0, type: o.type }
      moduleSales[m].count++
      moduleSales[m].mrr += o.estimatedMrr ?? 0
    }
  }
  const featuresSold = Object.entries(moduleSales)
    .map(([module, data]) => ({ module, ...data }))
    .sort((a, b) => b.mrr - a.mrr)

  // ─── Top performers (mês) ──────────────────────────────────────────────
  const team = await prisma.salesUser.findMany({ where: { active: true } })
  const performers = await Promise.all(team.map(async (m) => {
    const [calls, demosDoneCount, dealsWon, mrrAgg] = await Promise.all([
      prisma.salesActivity.count({ where: { salesUserId: m.id, type: 'CALL', createdAt: { gte: monthStart } } }),
      prisma.salesActivity.count({ where: { salesUserId: m.id, type: 'DEMO_DONE', createdAt: { gte: monthStart } } }),
      prisma.salesOpportunity.count({ where: { ownerId: m.id, status: 'WON', closedAt: { gte: monthStart } } }),
      prisma.salesOpportunity.aggregate({
        where: { ownerId: m.id, status: 'WON', closedAt: { gte: monthStart } },
        _sum: { estimatedMrr: true },
      }),
    ])
    const goal = await prisma.salesGoal.findFirst({
      where: { salesUserId: m.id, period: monthStart, metric: 'CLOSED_MRR' },
    })
    return {
      salesUser: m, calls, demos: demosDoneCount, deals: dealsWon,
      mrr: mrrAgg._sum.estimatedMrr ?? 0,
      target: goal?.target ?? 0,
      pctTarget: goal?.target ? ((mrrAgg._sum.estimatedMrr ?? 0) / goal.target) * 100 : 0,
    }
  }))
  performers.sort((a, b) => b.mrr - a.mrr)

  // ─── Alertas operacionais ──────────────────────────────────────────────
  const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000)
  const sevenDaysAhead = new Date(Date.now() + 7 * 86400000)
  const [hotSemContato, demosVencendo, oppsBig, semAtividadeHoje] = await Promise.all([
    prisma.lead.count({
      where: { status: 'NEW', contactedAt: null, createdAt: { lt: fourHoursAgo } },
    }),
    prisma.demoInvite.count({
      where: { status: 'PENDING', expiresAt: { lt: sevenDaysAhead, gt: new Date() } },
    }).catch(() => 0),
    prisma.salesOpportunity.count({
      where: { status: 'OPEN', estimatedMrr: { gte: 10000 } },
    }),
    prisma.salesActivity.count({
      where: { createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) } },
    }),
  ])

  // ─── Conversões ────────────────────────────────────────────────────────
  const conversionRate = leadsTotal > 0 ? (leadsConverted / leadsTotal) * 100 : 0
  const winRate = (won._count.id + lost) > 0 ? (won._count.id / (won._count.id + lost)) * 100 : 0
  const avgTicket = won._count.id > 0 ? (won._sum.estimatedMrr ?? 0) / won._count.id : 0

  // Sales Velocity = (Leads × Win Rate × Ticket) ÷ Ciclo médio
  // Usa avgDaysToConvert se disponível
  const convertedLeads = await prisma.lead.findMany({
    where: { status: 'CONVERTED', convertedAt: { gte: since } },
    select: { createdAt: true, convertedAt: true },
  })
  const cycleSum = convertedLeads.reduce((s, l) => {
    if (!l.convertedAt) return s
    return s + Math.max(1, Math.floor((l.convertedAt.getTime() - l.createdAt.getTime()) / 86400000))
  }, 0)
  const avgCycleDays = convertedLeads.length > 0 ? cycleSum / convertedLeads.length : 30
  const salesVelocity = avgCycleDays > 0
    ? (leadsTotal * (winRate / 100) * avgTicket) / avgCycleDays
    : 0

  res.json({
    period: { since, days: q.days, monthStart, monthEnd, prevSince, prevEnd },
    filters: q,
    salesVelocity: { value: salesVelocity, avgCycleDays, formula: 'Leads × WinRate × Ticket ÷ CicloMédio' },
    // Bloco 1: Topo do Funil
    topOfFunnel: {
      leads: leadsTotal,
      contatos: leadsContacted,
      demos: leadsDemo,
      fechados: leadsConverted,
      perdidos: leadsLost,
      conversion: { leadToContato: conv(leadsContacted, leadsTotal), contatoToDemo: conv(leadsDemo, leadsContacted), demoToFechou: conv(leadsConverted, leadsDemo) },
      sparklines: { leads: sparkLeads, activities: sparkActs, converted: sparkConverted },
    },
    // Bloco 2: Atividades
    activities: {
      calls: actCalls, emails: actEmails, whatsapp: actWhatsapp, meetings: actMeetings, notes: actNotes,
      total: actCalls + actEmails + actWhatsapp + actMeetings + actNotes,
      heatmap, // [7][24] = atividades por dia da semana × hora
      perDay: sparkActs,
    },
    // Bloco 3: Receita
    revenue: {
      mrrClosed: won._sum.estimatedMrr ?? 0,
      dealsWon: won._count.id,
      pipelineValue: pipeline._sum.estimatedMrr ?? 0,
      pipelineCount: pipeline._count.id,
      avgTicket, winRate, conversionRate,
      trend: trendMrr,
    },
    // Bloco 4: Funil + gargalo
    funnel: {
      stages: funnelStages,
      bottleneck: { stage: bottleneck.stage, conversion: bottleneck.conversionFromPrev },
    },
    // Bloco 5: Top Performers
    topPerformers: performers.slice(0, 10),
    // Bloco 6: Features vendidas
    featuresSold,
    // Bloco 7: Alertas
    alerts: {
      hotSemContato,
      demosVencendo,
      oppsBig,
      semAtividadeHoje: semAtividadeHoje === 0,
    },
    // Top oportunidades abertas
    topOpportunities: topOpps,
    // Comparação vs anterior
    previous,
    integradoresAtivos,
  })
}))

// ════════════════════════════════════════════════════════════════════════════
// PRIORITY ACTIONS — painel sticky no Pipeline com ações urgentes do dia
// ════════════════════════════════════════════════════════════════════════════
salesRouter.get('/priority-actions', asyncHandler(async (req, res) => {
  const salesUserId = req.query.salesUserId ? String(req.query.salesUserId) : undefined
  const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000)
  const todayStart = new Date(new Date().setHours(0,0,0,0))
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

  // Hot leads sem contato (com ou sem atribuição)
  const hotLeadsWhere: any = { status: 'NEW', contactedAt: null, createdAt: { lt: fourHoursAgo } }
  if (salesUserId) {
    const su = await prisma.salesUser.findUnique({ where: { id: salesUserId } })
    if (su) hotLeadsWhere.assignedToUserId = su.userId
  }
  const hotLeads = await prisma.lead.findMany({
    where: hotLeadsWhere,
    take: 20,
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { followUps: true, demoInvites: true } } },
  })
  // Anexa score se disponível
  const hotWithScore = await Promise.all(hotLeads.map(async (l) => {
    const sc = await prisma.leadScore.findUnique({ where: { leadId: l.id } })
    return { ...l, score: sc?.score ?? 50 }
  }))
  hotWithScore.sort((a, b) => b.score - a.score)

  // Follow-ups vencidos
  const overdueFollowUps = await prisma.leadFollowUp.findMany({
    where: { completed: false, dueDate: { lt: new Date() } },
    take: 20,
    orderBy: { dueDate: 'asc' },
    include: { lead: { select: { id: true, contactName: true, companyName: true, contactPhone: true, contactEmail: true } } },
  })

  // Progresso do dia (do vendedor ou time)
  let progressGoals: any = null
  if (salesUserId) {
    const goals = await prisma.salesGoal.findMany({
      where: { salesUserId, period: monthStart },
    })
    progressGoals = goals.map(g => ({
      metric: g.metric,
      target: g.target,
      actual: g.actual,
      pct: g.target > 0 ? (g.actual / g.target) * 100 : 0,
    }))
  }

  // Atividades do vendedor hoje
  const activitiesToday = salesUserId
    ? await prisma.salesActivity.count({ where: { salesUserId, createdAt: { gte: todayStart } } })
    : await prisma.salesActivity.count({ where: { createdAt: { gte: todayStart } } })

  res.json({
    hotLeadsSemContato: hotWithScore.slice(0, 10),
    overdueFollowUps,
    progressGoals,
    activitiesToday,
  })
}))

// ════════════════════════════════════════════════════════════════════════════
// CONFIG + RBAC GRANULAR (Sprint S1)
// ════════════════════════════════════════════════════════════════════════════
import { canAccessScreen, getMyPermissionsMap, resolveLevel, SCREENS } from '../services/sales-rbac.service'

// Helper de gate: exige nível mínimo (VIEW|EDIT|ADMIN) no screen indicado.
// Para SUPER_ADMIN/ADMIN_GLOBAL passa direto via resolveLevel.
function requireSalesScreen(screen: string, required: 'VIEW'|'EDIT'|'ADMIN' = 'VIEW') {
  return asyncHandler(async (req: Request, _res: Response, next: any) => {
    const ok = await canAccessScreen(req.jwtPayload!.sub, screen, required)
    if (!ok) throw new ValidationError(`Sem permissão (${required}) em ${screen}`)
    next()
  })
}

// GET /sales/me/permissions — mapa { screen: level } do usuário logado
salesRouter.get('/me/permissions', asyncHandler(async (req: Request, res: Response) => {
  const map = await getMyPermissionsMap(req.jwtPayload!.sub)
  res.json({ screens: SCREENS, permissions: map })
}))

// GET /sales/config — singleton
salesRouter.get('/config', requireSalesScreen('config', 'VIEW'), asyncHandler(async (_req, res) => {
  let cfg = await prisma.salesConfig.findUnique({ where: { id: 'singleton' } })
  if (!cfg) cfg = await prisma.salesConfig.create({ data: { id: 'singleton' } })
  res.json(cfg)
}))

// PUT /sales/config
const ConfigSchema = z.object({
  slaDemoBusinessDays: z.number().int().min(0).max(30).optional(),
  roundRobinEnabled: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  customLostReasons: z.array(z.string()).optional(),
  defaultGoalsJson: z.any().optional(),
})
salesRouter.put('/config', requireSalesScreen('config', 'ADMIN'), asyncHandler(async (req, res) => {
  const parse = ConfigSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError('Payload inválido: ' + JSON.stringify(parse.error.flatten()))
  const updated = await prisma.salesConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...parse.data, updatedBy: req.jwtPayload!.sub },
    update: { ...parse.data, updatedBy: req.jwtPayload!.sub },
  })
  res.json(updated)
}))

// GET /sales/permissions — matriz inteira (defaults por role + overrides individuais)
salesRouter.get('/permissions', requireSalesScreen('config', 'VIEW'), asyncHandler(async (_req, res) => {
  const all = await prisma.salesPermission.findMany({ orderBy: [{ role: 'asc' }, { screen: 'asc' }] })
  const defaults = all.filter(p => p.role && !p.salesUserId)
  const overrides = all.filter(p => p.salesUserId)
  res.json({ screens: SCREENS, defaults, overrides })
}))

// PUT /sales/permissions/role/:role — set defaults da role (batch)
const RolePermsSchema = z.object({
  perms: z.array(z.object({
    screen: z.string(),
    level: z.enum(['NONE', 'VIEW', 'EDIT', 'ADMIN']),
  })),
})
salesRouter.put('/permissions/role/:role', requireSalesScreen('config', 'ADMIN'), asyncHandler(async (req, res) => {
  const role = String(req.params.role)
  const parse = RolePermsSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError('Payload inválido: ' + JSON.stringify(parse.error.flatten()))
  const userId = req.jwtPayload!.sub
  for (const p of parse.data.perms) {
    if (p.level === 'NONE') {
      await prisma.salesPermission.deleteMany({ where: { role: role as any, screen: p.screen, salesUserId: null } })
    } else {
      await prisma.salesPermission.upsert({
        where: { role_screen: { role: role as any, screen: p.screen } },
        create: { role: role as any, screen: p.screen, level: p.level, changedBy: userId },
        update: { level: p.level, changedBy: userId },
      })
    }
  }
  res.json({ ok: true })
}))

// POST /sales/permissions/override — override individual
const OverrideSchema = z.object({
  salesUserId: z.string(),
  screen: z.string(),
  level: z.enum(['NONE', 'VIEW', 'EDIT', 'ADMIN']),
})
salesRouter.post('/permissions/override', requireSalesScreen('config', 'ADMIN'), asyncHandler(async (req, res) => {
  const parse = OverrideSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError('Payload inválido: ' + JSON.stringify(parse.error.flatten()))
  const { salesUserId, screen, level } = parse.data
  const userId = req.jwtPayload!.sub
  if (level === 'NONE') {
    await prisma.salesPermission.deleteMany({ where: { salesUserId, screen } })
    return res.json({ ok: true, removed: true })
  }
  const up = await prisma.salesPermission.upsert({
    where: { salesUserId_screen: { salesUserId, screen } },
    create: { salesUserId, screen, level, changedBy: userId },
    update: { level, changedBy: userId },
  })
  res.json(up)
}))

// DELETE /sales/permissions/override/:id
salesRouter.delete('/permissions/override/:id', requireSalesScreen('config', 'ADMIN'), asyncHandler(async (req, res) => {
  await prisma.salesPermission.delete({ where: { id: String(req.params.id) } })
  res.json({ ok: true })
}))

// GET /sales/permissions/user/:salesUserId — efetivo (override OR default)
salesRouter.get('/permissions/user/:salesUserId', requireSalesScreen('config', 'VIEW'), asyncHandler(async (req, res) => {
  const su = await prisma.salesUser.findUnique({ where: { id: String(req.params.salesUserId) } })
  if (!su) throw new NotFoundError('SalesUser')
  const out: Record<string, { level: string, source: 'override'|'default'|'none' }> = {}
  for (const s of SCREENS) {
    const ov = await prisma.salesPermission.findFirst({ where: { salesUserId: su.id, screen: s } })
    if (ov) { out[s] = { level: ov.level, source: 'override' }; continue }
    const def = await prisma.salesPermission.findFirst({ where: { role: su.role as any, screen: s } })
    if (def) { out[s] = { level: def.level, source: 'default' }; continue }
    out[s] = { level: 'NONE', source: 'none' }
  }
  res.json({ salesUserId: su.id, role: su.role, screens: SCREENS, effective: out })
}))

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS — preferências, test, histórico
// ════════════════════════════════════════════════════════════════════════════
import { notify, type NotifyEvent, type NotifyChannel } from '../services/notify.service'
import { runNotifyDetection } from '../services/notify-detection.service'

function notifyKey(req: Request): { userId?: string; superAdminId?: string } {
  const role = req.jwtPayload?.role
  const sub = req.jwtPayload!.sub
  if (role === 'SUPER_ADMIN') return { superAdminId: sub }
  return { userId: sub }
}

// GET /sales/notify/prefs — preferências do user logado (cria default se não existir)
salesRouter.get('/notify/prefs', asyncHandler(async (req, res) => {
  const k = notifyKey(req)
  let prefs = await prisma.notificationPreference.findFirst({ where: k as any })
  if (!prefs) {
    prefs = await prisma.notificationPreference.create({ data: k as any })
  }
  res.json(prefs)
}))

// PUT /sales/notify/prefs
const PrefsSchema = z.object({
  pushEnabled:     z.boolean().optional(),
  emailEnabled:    z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappPhone:   z.string().min(8).max(20).nullable().optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd:   z.number().int().min(0).max(23).optional(),
  eventChannels:   z.record(z.array(z.enum(['push','email','whatsapp','sse']))).optional(),
  dailyDigest:     z.boolean().optional(),
})
salesRouter.put('/notify/prefs', asyncHandler(async (req, res) => {
  const parse = PrefsSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError('Payload inválido: ' + JSON.stringify(parse.error.flatten()))
  const k = notifyKey(req)
  const prefs = await prisma.notificationPreference.upsert({
    where: k.superAdminId ? { superAdminId: k.superAdminId } : { userId: k.userId! },
    create: { ...k, ...parse.data } as any,
    update: parse.data as any,
  })
  res.json(prefs)
}))

// POST /sales/notify/test — dispara notificação de teste pro próprio user
const TestNotifySchema = z.object({
  channels: z.array(z.enum(['push','email','whatsapp','sse'])).optional(),
})
salesRouter.post('/notify/test', asyncHandler(async (req, res) => {
  const parse = TestNotifySchema.safeParse(req.body ?? {})
  if (!parse.success) throw new ValidationError('Payload inválido')
  const k = notifyKey(req)
  const result = await notify({
    event: 'TEST',
    recipients: [k as any],
    channels: parse.data.channels,
    payload: {
      title: '🧪 Teste de notificação',
      body: 'Se você está lendo isto, sua configuração está funcionando. Hora de fechar negócio!',
      url: '/admin/comercial',
    },
  })
  res.json(result)
}))

// GET /sales/notify/history — últimas N notificações enviadas pro user
salesRouter.get('/notify/history', asyncHandler(async (req, res) => {
  const k = notifyKey(req)
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200)
  const items = await prisma.notificationDeliveryLog.findMany({
    where: k.superAdminId ? { recipientSuperAdminId: k.superAdminId } : { recipientUserId: k.userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  res.json({ items })
}))

// POST /sales/notify/run-detection — gatilho manual da varredura (admin)
salesRouter.post('/notify/run-detection', asyncHandler(async (req, res) => {
  if (req.jwtPayload?.role !== 'SUPER_ADMIN' && req.jwtPayload?.role !== 'ADMIN_GLOBAL') {
    throw new ValidationError('Apenas SUPER_ADMIN/ADMIN_GLOBAL pode disparar manualmente.')
  }
  const result = await runNotifyDetection()
  res.json(result)
}))

// ════════════════════════════════════════════════════════════════════════════
// WHATSAPP INTERNO — instância dedicada à equipe IA Cloud Vision (não por cliente)
// Nome fixo: NOTIFY_WHATSAPP_INSTANCE (default: 'iacloud_internal')
// Apenas SUPER_ADMIN/ADMIN_GLOBAL operam.
// ════════════════════════════════════════════════════════════════════════════
import {
  createInstance as evCreateInstance,
  connectInstance as evConnectInstance,
  fetchInstance as evFetchInstance,
  logoutInstance as evLogoutInstance,
  deleteInstance as evDeleteInstance,
  sendText as evSendText,
  normalizePhone as evNormalizePhone,
} from '../services/evolution.service'

const INTERNAL_INSTANCE = process.env.NOTIFY_WHATSAPP_INSTANCE ?? 'iacloud_internal'

function requireFabricanteAdmin(req: Request) {
  const role = req.jwtPayload?.role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN_GLOBAL') {
    throw new ValidationError('Apenas SUPER_ADMIN/ADMIN_GLOBAL.')
  }
}

// GET /sales/notify/whatsapp/state — snapshot da instância interna
salesRouter.get('/notify/whatsapp/state', asyncHandler(async (req, res) => {
  requireFabricanteAdmin(req)
  const snapshot = await evFetchInstance(INTERNAL_INSTANCE)
  res.json({
    instanceName: INTERNAL_INSTANCE,
    exists: !!snapshot,
    snapshot: snapshot ?? null,
  })
}))

// POST /sales/notify/whatsapp/instance — cria instância e retorna primeiro QR
salesRouter.post('/notify/whatsapp/instance', asyncHandler(async (req, res) => {
  requireFabricanteAdmin(req)
  // Criar é idempotente do lado da Evolution: se existe, ela ignora.
  let snapshot = await evFetchInstance(INTERNAL_INSTANCE)
  if (!snapshot) {
    snapshot = await evCreateInstance(INTERNAL_INSTANCE)
  }
  // Sempre tenta conectar para obter QR fresco.
  const connect = await evConnectInstance(INTERNAL_INSTANCE)
  res.json({
    instanceName: INTERNAL_INSTANCE,
    snapshot,
    qrCodePayload: connect.qrCodePayload,
    pairingCode: connect.pairingCode,
  })
}))

// POST /sales/notify/whatsapp/refresh — regenera QR
salesRouter.post('/notify/whatsapp/refresh', asyncHandler(async (req, res) => {
  requireFabricanteAdmin(req)
  const connect = await evConnectInstance(INTERNAL_INSTANCE)
  const snapshot = await evFetchInstance(INTERNAL_INSTANCE)
  res.json({
    instanceName: INTERNAL_INSTANCE,
    snapshot,
    qrCodePayload: connect.qrCodePayload,
    pairingCode: connect.pairingCode,
  })
}))

// POST /sales/notify/whatsapp/logout
salesRouter.post('/notify/whatsapp/logout', asyncHandler(async (req, res) => {
  requireFabricanteAdmin(req)
  try { await evLogoutInstance(INTERNAL_INSTANCE) } catch { /* graceful */ }
  res.json({ ok: true })
}))

// POST /sales/notify/whatsapp/delete — remove instância (recomeço do zero)
salesRouter.post('/notify/whatsapp/delete', asyncHandler(async (req, res) => {
  requireFabricanteAdmin(req)
  try { await evDeleteInstance(INTERNAL_INSTANCE) } catch { /* graceful */ }
  res.json({ ok: true })
}))

// POST /sales/notify/whatsapp/send-test — envia mensagem livre para validar
const SendTestSchema = z.object({
  phone: z.string().min(8).max(20),
  message: z.string().min(1).max(1000).optional(),
})
salesRouter.post('/notify/whatsapp/send-test', asyncHandler(async (req, res) => {
  requireFabricanteAdmin(req)
  const parse = SendTestSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError('Payload inválido')
  const phone = evNormalizePhone(parse.data.phone)
  const text = parse.data.message ?? '✅ IA Cloud Vision — Teste de notificação\nCanal WhatsApp conectado com sucesso!'
  try {
    const result = await evSendText(INTERNAL_INSTANCE, phone, text)
    res.json({ ok: true, result })
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err?.message ?? String(err) })
  }
}))
