/**
 * sales-hooks.service.ts
 *
 * Hooks de integração que conectam o ciclo de vida de Leads/Integradores/Módulos
 * ao Hub Comercial (SalesActivity, SalesOpportunity, SalesGoal, LeadAssignment).
 *
 * Filosofia: chamadas síncronas mas com try/catch absorvido — falha aqui NUNCA
 * deve quebrar a operação principal (criar lead, converter, etc).
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function monthStart(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** Computa LeadScore (mesma lógica do sales.ts — duplicada aqui para evitar dep circular) */
export function computeLeadScore(lead: any): { score: number; reasons: any[] } {
  const reasons: any[] = []
  let score = 30

  if (lead.companyName) { score += 10; reasons.push({ factor: 'company', points: 10, label: 'Empresa identificada' }) }
  if (lead.cnpj) { score += 10; reasons.push({ factor: 'cnpj', points: 10, label: 'CNPJ válido' }) }
  if (lead.contactPhone) { score += 5; reasons.push({ factor: 'phone', points: 5, label: 'Telefone fornecido' }) }
  if (lead.contactRole && /diret|gerent|ceo|cto|coo|cfo/i.test(lead.contactRole)) {
    score += 15; reasons.push({ factor: 'role_decision', points: 15, label: 'Decisor identificado' })
  }
  const volMap: Record<string, number> = { 'LT_50': 5, '50_500': 15, '500_2000': 25, 'GT_2000': 30 }
  const volPts = volMap[lead.cameraVolume ?? ''] ?? 0
  if (volPts > 0) {
    score += volPts; reasons.push({ factor: 'camera_volume', points: volPts, label: `Volume: ${lead.cameraVolume}` })
  }
  if (lead.kind === 'INTEGRADOR') {
    score += 10; reasons.push({ factor: 'kind_integrador', points: 10, label: 'Integrador (B2B reseller)' })
  }
  if (lead.status === 'CONTACTED') { score += 5; reasons.push({ factor: 'contacted', points: 5, label: 'Já contatado' }) }
  if (lead.status === 'DEMO_SENT')  { score += 10; reasons.push({ factor: 'demo_sent', points: 10, label: 'Demo já enviada' }) }
  if (lead.message && lead.message.length > 50) {
    score += 5; reasons.push({ factor: 'detailed_message', points: 5, label: 'Mensagem detalhada' })
  }
  return { score: Math.min(100, score), reasons }
}

/** Round-robin: pega SDR ativo com menor carga atual de leads abertos */
async function pickSdrRoundRobin(): Promise<string | null> {
  const sdrs = await prisma.salesUser.findMany({ where: { role: 'SDR', active: true } })
  if (sdrs.length === 0) return null
  const counts = await Promise.all(sdrs.map(async (s) => ({
    id: s.id,
    count: await prisma.leadAssignment.count({ where: { salesUserId: s.id, active: true } }),
  })))
  counts.sort((a, b) => a.count - b.count)
  return counts[0].id
}

/** Pega CS com menor carga (para atribuir tenant convertido) */
async function pickCsRoundRobin(): Promise<string | null> {
  const cs = await prisma.salesUser.findMany({ where: { role: 'CS', active: true } })
  if (cs.length === 0) return null
  // Sem métrica de "tenants atribuídos a CS" no schema; pega o primeiro ativo por hireDate
  return cs[0].id
}

/** Atualiza SalesGoal.actual de uma métrica para todos os usuários do mês */
async function bumpGoal(salesUserId: string, metric: string, increment: number): Promise<void> {
  const period = monthStart()
  try {
    await prisma.salesGoal.upsert({
      where: { salesUserId_period_metric: { salesUserId, period, metric: metric as any } },
      create: { salesUserId, period, metric: metric as any, target: 0, actual: increment },
      update: { actual: { increment } },
    })
  } catch (err: any) {
    logger.warn({ err: err.message, salesUserId, metric }, 'goal_bump_failed')
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// H1 — Lead criado
// Cria: LeadScore + Opportunity NEW_LEAD + Activity inicial + LeadAssignment (round-robin)
// ═════════════════════════════════════════════════════════════════════════════
export async function onLeadCreated(lead: any): Promise<void> {
  // 1. LeadScore
  try {
    const { score, reasons } = computeLeadScore(lead)
    await prisma.leadScore.upsert({
      where: { leadId: lead.id },
      create: { leadId: lead.id, score, reasonsJson: reasons as any },
      update: { score, reasonsJson: reasons as any, computedAt: new Date() },
    })
  } catch (err: any) { logger.warn({ err: err.message }, 'h1_score_failed') }

  // 2. Round-robin assign SDR
  let salesUserId: string | null = null
  try {
    salesUserId = await pickSdrRoundRobin()
    if (salesUserId) {
      await prisma.leadAssignment.create({
        data: { leadId: lead.id, salesUserId, reason: 'round-robin (auto on create)', active: true },
      })
      await prisma.lead.update({ where: { id: lead.id }, data: { assignedToUserId: salesUserId } })
    }
  } catch (err: any) { logger.warn({ err: err.message }, 'h1_assign_failed') }

  // 3. Opportunity NEW_LEAD
  try {
    const ticketEstimate: Record<string, number> = { 'LT_50': 2500, '50_500': 8000, '500_2000': 25000, 'GT_2000': 60000 }
    const estimatedMrr = ticketEstimate[lead.cameraVolume ?? ''] ?? 1000
    await prisma.salesOpportunity.create({
      data: {
        type: 'NEW_LEAD',
        status: 'OPEN',
        leadId: lead.id,
        ownerId: salesUserId ?? undefined,
        title: `${lead.contactName} · ${lead.companyName ?? lead.contactEmail}`,
        description: lead.message ?? null,
        modulesProposed: [],
        estimatedMrr,
        probability: 20,
        reasonAi: 'Oportunidade criada automaticamente quando lead se cadastrou.',
      },
    })
  } catch (err: any) { logger.warn({ err: err.message }, 'h1_opp_failed') }

  // 4. SalesActivity inicial
  if (salesUserId) {
    try {
      await prisma.salesActivity.create({
        data: {
          salesUserId,
          leadId: lead.id,
          type: 'NOTE',
          notes: `Lead recebido via ${lead.source}. Auto-atribuído por round-robin.`,
        },
      })
    } catch (err: any) { logger.warn({ err: err.message }, 'h1_activity_failed') }
  }

  logger.info({ leadId: lead.id, salesUserId }, 'h1_lead_created_processed')
}

// ═════════════════════════════════════════════════════════════════════════════
// H2 — Demo aprovada (DemoInvite criado para o lead)
// Atualiza: Activity DEMO_DONE + Goal DEMOS_SENT + Opp probability=50
// ═════════════════════════════════════════════════════════════════════════════
export async function onDemoApproved(lead: any): Promise<void> {
  const ownerId = lead.assignedToUserId ?? null

  // Encontra SalesUser correspondente (assignedToUserId pode ser User normal OU SalesUser.id)
  let salesUserId: string | null = null
  if (ownerId) {
    const su = await prisma.salesUser.findFirst({ where: { OR: [{ id: ownerId }, { userId: ownerId }] } })
    salesUserId = su?.id ?? null
  }

  // Activity
  if (salesUserId) {
    try {
      await prisma.salesActivity.create({
        data: {
          salesUserId, leadId: lead.id, type: 'DEMO_DONE',
          notes: 'Demo aprovada e link enviado ao lead.',
          outcome: 'positivo',
        },
      })
      await bumpGoal(salesUserId, 'DEMOS_SENT', 1)
    } catch (err: any) { logger.warn({ err: err.message }, 'h2_activity_failed') }
  }

  // Atualiza Opportunity
  try {
    await prisma.salesOpportunity.updateMany({
      where: { leadId: lead.id, status: 'OPEN' },
      data: { probability: 50 },
    })
  } catch (err: any) { logger.warn({ err: err.message }, 'h2_opp_update_failed') }

  logger.info({ leadId: lead.id, salesUserId }, 'h2_demo_approved_processed')
}

// ═════════════════════════════════════════════════════════════════════════════
// H3 — Lead status alterado
// Cria: Activity NOTE descrevendo a transição
// ═════════════════════════════════════════════════════════════════════════════
export async function onLeadStatusChanged(
  leadId: string,
  fromStatus: string,
  toStatus: string,
  actorUserId?: string,
  reason?: string,
): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) return

  const ownerId = lead.assignedToUserId ?? actorUserId ?? null
  let salesUserId: string | null = null
  if (ownerId) {
    const su = await prisma.salesUser.findFirst({ where: { OR: [{ id: ownerId }, { userId: ownerId }] } })
    salesUserId = su?.id ?? null
  }

  if (salesUserId) {
    try {
      await prisma.salesActivity.create({
        data: {
          salesUserId, leadId,
          type: 'NOTE',
          notes: `Status alterado: ${fromStatus} → ${toStatus}${reason ? ` · motivo: ${reason}` : ''}`,
        },
      })
    } catch (err: any) { logger.warn({ err: err.message }, 'h3_activity_failed') }
  }

  // Bump CONTACTED goal se aplicável
  if (toStatus === 'CONTACTED' && salesUserId) {
    await bumpGoal(salesUserId, 'QUALIFIED_LEADS', 1)
  }

  logger.info({ leadId, fromStatus, toStatus }, 'h3_status_changed_processed')
}

// ═════════════════════════════════════════════════════════════════════════════
// H4 — Lead convertido em Integrador
// Marca: Opportunity WON + Goal CLOSED_MRR/DEALS_CLOSED + assign CS ao novo tenant
// ═════════════════════════════════════════════════════════════════════════════
export async function onLeadConverted(leadId: string, integradorId: string, mrr?: number): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) return

  const ownerId = lead.assignedToUserId ?? null
  let salesUserId: string | null = null
  if (ownerId) {
    const su = await prisma.salesUser.findFirst({ where: { OR: [{ id: ownerId }, { userId: ownerId }] } })
    salesUserId = su?.id ?? null
  }

  // Marca Opportunity NEW_LEAD aberta como WON
  let actualMrr = mrr ?? 0
  try {
    const openOpp = await prisma.salesOpportunity.findFirst({
      where: { leadId, status: 'OPEN', type: 'NEW_LEAD' },
    })
    if (openOpp) {
      actualMrr = mrr ?? openOpp.estimatedMrr ?? 0
      await prisma.salesOpportunity.update({
        where: { id: openOpp.id },
        data: {
          status: 'WON',
          closedAt: new Date(),
          integradorId,
          estimatedMrr: actualMrr,
          probability: 100,
        },
      })
    }
  } catch (err: any) { logger.warn({ err: err.message }, 'h4_opp_won_failed') }

  // Bump goals
  if (salesUserId) {
    try {
      await bumpGoal(salesUserId, 'DEALS_CLOSED', 1)
      if (actualMrr > 0) await bumpGoal(salesUserId, 'CLOSED_MRR', actualMrr)
      // Activity
      await prisma.salesActivity.create({
        data: {
          salesUserId, leadId, integradorId,
          type: 'NOTE',
          notes: `🎉 Lead convertido em Integrador! MRR estimado: R$ ${actualMrr.toLocaleString('pt-BR')}`,
          outcome: 'positivo',
        },
      })
    } catch (err: any) { logger.warn({ err: err.message }, 'h4_goal_bump_failed') }
  }

  // Atribui CS ao novo tenant (round-robin)
  try {
    const csId = await pickCsRoundRobin()
    if (csId) {
      await prisma.salesActivity.create({
        data: {
          salesUserId: csId,
          integradorId,
          type: 'TASK',
          notes: 'Novo tenant atribuído. Iniciar onboarding.',
        },
      })
    }
  } catch (err: any) { logger.warn({ err: err.message }, 'h4_cs_assign_failed') }

  logger.info({ leadId, integradorId, salesUserId, mrr: actualMrr }, 'h4_lead_converted_processed')
}

// ═════════════════════════════════════════════════════════════════════════════
// H5 — Módulo adicionado a Integrador (cross-sell)
// Marca: SalesOpportunity CROSS_SELL/UPSELL matching como WON
// ═════════════════════════════════════════════════════════════════════════════
export async function onIntegradorModulesUpdated(
  integradorId: string,
  modulesAdded: string[],
): Promise<void> {
  if (modulesAdded.length === 0) return

  const openOpps = await prisma.salesOpportunity.findMany({
    where: {
      integradorId,
      status: 'OPEN',
      type: { in: ['CROSS_SELL', 'UPSELL'] },
    },
  })

  for (const opp of openOpps) {
    // Match: se TODOS os módulos propostos foram adicionados, marca WON
    const allMatched = opp.modulesProposed.every(m => modulesAdded.includes(m))
    if (allMatched && opp.modulesProposed.length > 0) {
      try {
        await prisma.salesOpportunity.update({
          where: { id: opp.id },
          data: { status: 'WON', closedAt: new Date(), probability: 100 },
        })
        if (opp.ownerId && opp.estimatedMrr) {
          await bumpGoal(opp.ownerId, 'CLOSED_MRR', opp.estimatedMrr)
          await bumpGoal(opp.ownerId, 'DEALS_CLOSED', 1)
          await prisma.salesActivity.create({
            data: {
              salesUserId: opp.ownerId, integradorId,
              opportunityId: opp.id,
              type: 'NOTE',
              notes: `🎉 Cross-sell fechado: módulo(s) ${modulesAdded.join(', ')} contratado(s). MRR +R$ ${opp.estimatedMrr.toLocaleString('pt-BR')}`,
              outcome: 'positivo',
            },
          })
        }
        logger.info({ oppId: opp.id, modulesAdded }, 'h5_cross_sell_won')
      } catch (err: any) { logger.warn({ err: err.message, oppId: opp.id }, 'h5_won_failed') }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// H6 — SalesActivity criada → bump goal correspondente
// ═════════════════════════════════════════════════════════════════════════════
export async function onActivityCreated(activity: any): Promise<void> {
  if (!activity.salesUserId) return
  try {
    if (activity.type === 'CALL')          await bumpGoal(activity.salesUserId, 'CALLS', 1)
    if (activity.type === 'DEMO_DONE')     await bumpGoal(activity.salesUserId, 'DEMOS_SENT', 1)
  } catch (err: any) { logger.warn({ err: err.message }, 'h6_goal_bump_failed') }
}
