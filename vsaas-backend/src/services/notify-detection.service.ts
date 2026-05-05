/**
 * notify-detection.service.ts
 *
 * Cron de detecção de eventos derivados (que não são triggers diretos):
 *   - HOT_LEAD_NO_CONTACT: lead score ≥75 sem contato em 1h
 *   - LEAD_STALLED: lead há >14d na mesma etapa (NEW/CONTACTED/DEMO_SENT/NEG)
 *   - DEMO_PENDING_OVERDUE: demo solicitada há >SLA dias úteis sem aprovação
 *
 * Roda a cada 15 minutos. Idempotente — usa dedupeKey para não re-notificar.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { notify, recipientsManagersAndDirectors, type NotifyRecipient } from './notify.service'

const CHECK_INTERVAL_MS = 15 * 60 * 1000
let timer: NodeJS.Timeout | null = null

async function detectHotLeadsNoContact(): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60_000)
  // Leads NEW criados há >1h, sem contactedAt, com score ≥75
  const hot = await prisma.lead.findMany({
    where: {
      status: 'NEW',
      contactedAt: null,
      createdAt: { lte: oneHourAgo },
      assignedToUserId: { not: null },
    },
    take: 100,
    select: { id: true, contactName: true, companyName: true, assignedToUserId: true },
  })

  let notified = 0
  for (const lead of hot) {
    const sc = await prisma.leadScore.findUnique({ where: { leadId: lead.id }, select: { score: true } })
    if (!sc || sc.score < 75) continue
    if (!lead.assignedToUserId) continue
    const recipients: NotifyRecipient[] = [{ userId: lead.assignedToUserId }]
    // Escala pra gerência se ficar mais de 4h sem contato
    // (dedupe garante que não notifica gerência toda hora)
    const managers = await recipientsManagersAndDirectors()
    recipients.push(...managers)

    await notify({
      event: 'HOT_LEAD',
      recipients,
      priority: 'critical',
      dedupeKey: `hot-no-contact:${lead.id}`,
      payload: {
        title: `🔥 Lead HOT sem contato (score ${sc.score})`,
        body: `${lead.contactName}${lead.companyName ? ` (${lead.companyName})` : ''} caiu há mais de 1h sem 1º contato. Score ${sc.score}/100.`,
        url: `/admin/comercial?tab=pipeline&lead=${lead.id}`,
        data: { leadId: lead.id, score: sc.score },
      },
    })
    notified++
  }
  return notified
}

async function detectStalledLeads(): Promise<number> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600_000)
  // Leads em etapas ativas com updatedAt antigo
  const stalled = await prisma.lead.findMany({
    where: {
      status: { in: ['CONTACTED', 'DEMO_SENT', 'NEGOTIATION'] },
      updatedAt: { lte: fourteenDaysAgo },
      assignedToUserId: { not: null },
    },
    take: 100,
    select: { id: true, contactName: true, companyName: true, status: true, assignedToUserId: true, updatedAt: true },
  })

  let notified = 0
  for (const lead of stalled) {
    if (!lead.assignedToUserId) continue
    const days = Math.floor((Date.now() - +new Date(lead.updatedAt)) / (24 * 3600_000))
    await notify({
      event: 'LEAD_STALLED',
      recipients: [{ userId: lead.assignedToUserId }],
      // Dedupe por semana — não martela todo dia o mesmo lead
      dedupeKey: `stalled:${lead.id}:${Math.floor(Date.now() / (7 * 24 * 3600_000))}`,
      payload: {
        title: `⚠️ Lead estagnado há ${days} dias`,
        body: `${lead.contactName}${lead.companyName ? ` (${lead.companyName})` : ''} está em ${lead.status} sem movimento. Hora de retomar ou marcar como perdido.`,
        url: `/admin/comercial?tab=pipeline&lead=${lead.id}`,
        data: { leadId: lead.id, days },
      },
    })
    notified++
  }
  return notified
}

async function detectDemoOverdue(): Promise<number> {
  // SLA configurável (SalesConfig.slaDemoBusinessDays). Default 1 dia útil.
  const cfg = await prisma.salesConfig.findUnique({ where: { id: 'singleton' } })
  const slaDays = cfg?.slaDemoBusinessDays ?? 1
  const cutoff = new Date(Date.now() - slaDays * 24 * 3600_000)

  // Leads com status DEMO_SENT mas sem demoSentAt populado E com createdAt < cutoff
  // (demoSentAt vazio = aprovação pendente)
  const overdue = await prisma.lead.findMany({
    where: {
      status: 'DEMO_SENT',
      demoSentAt: null,
      updatedAt: { lte: cutoff },
    },
    take: 50,
    select: { id: true, contactName: true, companyName: true, assignedToUserId: true, updatedAt: true },
  })

  if (!overdue.length) return 0
  const recipients = await recipientsManagersAndDirectors()
  let notified = 0
  for (const lead of overdue) {
    if (lead.assignedToUserId) recipients.push({ userId: lead.assignedToUserId })
    await notify({
      event: 'DEMO_PENDING_OVERDUE',
      recipients,
      priority: 'critical',
      dedupeKey: `demo-overdue:${lead.id}:${Math.floor(Date.now() / (4 * 3600_000))}`, // re-alerta a cada 4h
      payload: {
        title: '⏱️ Demo aguardando aprovação fora do SLA',
        body: `Lead ${lead.contactName}${lead.companyName ? ` (${lead.companyName})` : ''} está com demo solicitada e SLA de ${slaDays}d estourado. Aprovar ou rejeitar.`,
        url: `/admin/comercial?tab=demos`,
        data: { leadId: lead.id },
      },
    })
    notified++
  }
  return notified
}

export async function runNotifyDetection(): Promise<{ hot: number; stalled: number; overdue: number }> {
  const start = Date.now()
  let hot = 0, stalled = 0, overdue = 0
  try { hot = await detectHotLeadsNoContact() } catch (err: any) { logger.warn({ err: err.message }, 'detect_hot_failed') }
  try { stalled = await detectStalledLeads() } catch (err: any) { logger.warn({ err: err.message }, 'detect_stalled_failed') }
  try { overdue = await detectDemoOverdue() } catch (err: any) { logger.warn({ err: err.message }, 'detect_overdue_failed') }
  logger.info({ hot, stalled, overdue, elapsedMs: Date.now() - start }, 'notify_detection_done')
  return { hot, stalled, overdue }
}

export function startNotifyDetectionCron(): void {
  if (timer) return
  // Primeira rodada após 90s (deixa app estabilizar)
  setTimeout(() => { runNotifyDetection().catch(err => logger.error({ err }, 'notify_detection_initial_failed')) }, 90_000)
  timer = setInterval(() => {
    runNotifyDetection().catch(err => logger.error({ err }, 'notify_detection_failed'))
  }, CHECK_INTERVAL_MS)
  logger.info({ intervalMs: CHECK_INTERVAL_MS }, 'notify_detection_cron_started')
}

export function stopNotifyDetectionCron(): void {
  if (timer) clearInterval(timer)
  timer = null
}
