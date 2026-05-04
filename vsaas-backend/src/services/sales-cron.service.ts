/**
 * sales-cron.service.ts
 *
 * Cron diário (02:00 BRT) que mantém o Hub Comercial sincronizado:
 *   - Recompute LeadScores de todos os leads ativos
 *   - Auto-detect oportunidades cross-sell/upsell na base instalada
 *   - Recalcula SalesGoal.actual a partir de SalesActivity + SalesOpportunity do mês
 *
 * Implementação simples sem dependência de cron lib: setInterval que checa de
 * hora em hora se já passou das 02:00 e ainda não rodou hoje.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { computeLeadScore } from './sales-hooks.service'

const STATE = { lastRunDate: '' }
const CHECK_INTERVAL_MS = 60 * 60 * 1000  // 1h
let timer: NodeJS.Timeout | null = null

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function shouldRun(): boolean {
  const now = new Date()
  if (now.getHours() < 2) return false
  return STATE.lastRunDate !== todayKey()
}

async function runDailyJob(): Promise<void> {
  STATE.lastRunDate = todayKey()
  logger.info('sales_cron_starting')
  const startedAt = Date.now()

  // 1. Recompute LeadScore de todos os leads ativos (NEW/CONTACTED/DEMO_SENT)
  let scoresUpdated = 0
  try {
    const leads = await prisma.lead.findMany({
      where: { status: { in: ['NEW', 'CONTACTED', 'DEMO_SENT'] } },
    })
    for (const l of leads) {
      const { score, reasons } = computeLeadScore(l)
      await prisma.leadScore.upsert({
        where: { leadId: l.id },
        create: { leadId: l.id, score, reasonsJson: reasons as any },
        update: { score, reasonsJson: reasons as any, computedAt: new Date() },
      })
      scoresUpdated++
    }
  } catch (err: any) { logger.warn({ err: err.message }, 'cron_scores_failed') }

  // 2. Auto-detect oportunidades cross-sell/upsell
  let oppsCreated = 0
  try {
    oppsCreated = await detectOpportunities()
  } catch (err: any) { logger.warn({ err: err.message }, 'cron_detect_failed') }

  // 3. Recalcula goals.actual a partir das atividades/opps do mês
  let goalsUpdated = 0
  try {
    goalsUpdated = await recalcGoals()
  } catch (err: any) { logger.warn({ err: err.message }, 'cron_goals_failed') }

  const elapsed = Date.now() - startedAt
  logger.info({ scoresUpdated, oppsCreated, goalsUpdated, elapsedMs: elapsed }, 'sales_cron_finished')
}

// Reuso da lógica de detecção em sales.ts (simplificada)
async function detectOpportunities(): Promise<number> {
  let created = 0
  const integradores = await prisma.integrador.findMany({
    where: { active: true },
    select: {
      id: true, name: true, maxEdgeNodes: true,
      clienteFinais: { select: { id: true, vertical: true, sites: { select: { _count: { select: { cameras: true } } } } } },
      apiQuotas: { where: { periodEnd: { gte: new Date() } }, take: 1 },
    },
  })

  const allModules = await prisma.integradorModule.findMany({
    where: { enabled: true },
    select: { integradorId: true, module: true },
  })
  const modulesByInteg: Record<string, Set<string>> = {}
  for (const m of allModules) {
    if (!modulesByInteg[m.integradorId]) modulesByInteg[m.integradorId] = new Set()
    modulesByInteg[m.integradorId].add(m.module)
  }

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

    if (integ.clienteFinais.some(c => c.vertical === 'PARKING') &&
        !contracted.has('LICENSE_PLATE_RECOGNITION') &&
        !hasOpenOpp(integ.id, ['LICENSE_PLATE_RECOGNITION'])) {
      await prisma.salesOpportunity.create({
        data: {
          type: 'CROSS_SELL', integradorId: integ.id,
          title: `${integ.name} — Adicionar módulo Placas (LPR)`,
          description: 'Cliente em vertical Estacionamento sem LPR.',
          modulesProposed: ['LICENSE_PLATE_RECOGNITION'],
          estimatedMrr: cameraCount * 50, probability: 65,
          reasonAi: `${cameraCount} câmeras em PARKING sem LPR. Match natural.`,
        },
      })
      created++
    }

    if (integ.clienteFinais.some(c => c.vertical === 'INDUSTRIAL') &&
        !contracted.has('PPE_DETECTION') &&
        !hasOpenOpp(integ.id, ['PPE_DETECTION'])) {
      await prisma.salesOpportunity.create({
        data: {
          type: 'CROSS_SELL', integradorId: integ.id,
          title: `${integ.name} — Adicionar módulo PPE (EPI)`,
          description: 'Cliente em vertical Indústria sem detecção de EPI.',
          modulesProposed: ['PPE_DETECTION'],
          estimatedMrr: cameraCount * 80, probability: 70,
          reasonAi: 'Compliance NR-6 obrigatório em indústrias.',
        },
      })
      created++
    }

    if (integ.clienteFinais.some(c => ['RETAIL', 'SHOPPING_MALL'].includes(c.vertical as string)) &&
        !contracted.has('DEMOGRAPHICS') &&
        !hasOpenOpp(integ.id, ['DEMOGRAPHICS'])) {
      await prisma.salesOpportunity.create({
        data: {
          type: 'CROSS_SELL', integradorId: integ.id,
          title: `${integ.name} — Demografia + Heatmap`,
          description: 'Cliente em varejo/shopping sem analytics.',
          modulesProposed: ['DEMOGRAPHICS', 'HEATMAP'],
          estimatedMrr: cameraCount * 60, probability: 55,
          reasonAi: 'Varejo monetiza analytics de fluxo.',
        },
      })
      created++
    }

    const quota = integ.apiQuotas[0]
    if (quota) {
      const visionPct = quota.staticVisionMonthlyLimit > 0
        ? (quota.staticVisionUsedThisMonth / quota.staticVisionMonthlyLimit) * 100 : 0
      if (visionPct > 80 && !hasOpenOpp(integ.id, ['QUOTA_UPGRADE'])) {
        await prisma.salesOpportunity.create({
          data: {
            type: 'UPSELL', integradorId: integ.id,
            title: `${integ.name} — Upgrade quota Vertex (${visionPct.toFixed(0)}%)`,
            description: 'Quota próxima do limite.',
            modulesProposed: ['QUOTA_UPGRADE'],
            estimatedMrr: 500, probability: 80,
            reasonAi: `Quota em ${visionPct.toFixed(0)}%. Upsell preventivo.`,
          },
        })
        created++
      }
    }

    if (integ.clienteFinais.length >= 5 && !contracted.has('WHITE_LABEL') &&
        !hasOpenOpp(integ.id, ['WHITE_LABEL'])) {
      await prisma.salesOpportunity.create({
        data: {
          type: 'UPSELL', integradorId: integ.id,
          title: `${integ.name} — Upgrade Enterprise (White-label)`,
          description: `${integ.clienteFinais.length} clientes finais.`,
          modulesProposed: ['WHITE_LABEL'],
          estimatedMrr: 2000, probability: 60,
          reasonAi: 'Escala suficiente para domínio próprio.',
        },
      })
      created++
    }
  }

  return created
}

async function recalcGoals(): Promise<number> {
  const period = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const periodEnd = new Date(period.getFullYear(), period.getMonth() + 1, 1)
  const goals = await prisma.salesGoal.findMany({ where: { period } })
  let updated = 0

  for (const g of goals) {
    let actual = 0
    if (g.metric === 'CALLS') {
      actual = await prisma.salesActivity.count({
        where: { salesUserId: g.salesUserId, type: 'CALL', createdAt: { gte: period, lt: periodEnd } },
      })
    } else if (g.metric === 'DEMOS_SENT') {
      actual = await prisma.salesActivity.count({
        where: { salesUserId: g.salesUserId, type: 'DEMO_DONE', createdAt: { gte: period, lt: periodEnd } },
      })
    } else if (g.metric === 'DEALS_CLOSED') {
      actual = await prisma.salesOpportunity.count({
        where: { ownerId: g.salesUserId, status: 'WON', closedAt: { gte: period, lt: periodEnd } },
      })
    } else if (g.metric === 'CLOSED_MRR' || g.metric === 'REVENUE') {
      const agg = await prisma.salesOpportunity.aggregate({
        where: { ownerId: g.salesUserId, status: 'WON', closedAt: { gte: period, lt: periodEnd } },
        _sum: { estimatedMrr: true },
      })
      actual = agg._sum.estimatedMrr ?? 0
    } else if (g.metric === 'QUALIFIED_LEADS') {
      actual = await prisma.salesActivity.count({
        where: { salesUserId: g.salesUserId, type: 'NOTE',
          notes: { contains: 'CONTACTED', mode: 'insensitive' },
          createdAt: { gte: period, lt: periodEnd } },
      })
    }
    if (actual !== g.actual) {
      await prisma.salesGoal.update({ where: { id: g.id }, data: { actual } })
      updated++
    }
  }
  return updated
}

export function startSalesCron(): void {
  if (timer) return
  // Roda a primeira checagem após 60s (deixa app subir)
  setTimeout(() => {
    if (shouldRun()) runDailyJob().catch(err => logger.error({ err }, 'sales_cron_initial_failed'))
  }, 60_000)
  timer = setInterval(() => {
    if (shouldRun()) runDailyJob().catch(err => logger.error({ err }, 'sales_cron_failed'))
  }, CHECK_INTERVAL_MS)
  logger.info('sales_cron_started (checks hourly, runs once after 02:00)')
}

/** Permite trigger manual via endpoint (debug) */
export async function runSalesCronNow(): Promise<void> {
  STATE.lastRunDate = ''
  await runDailyJob()
}
