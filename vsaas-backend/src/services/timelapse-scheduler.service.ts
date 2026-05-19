/**
 * Timelapse Scheduler — agenda TimelapseJobs diariamente.
 * Roda todo dia às 04:00 BRT (07:00 UTC) para cada assinatura TIMELAPSE ativa.
 *
 * Idempotente: não cria job duplicado para o mesmo cameraId + subscriptionId +
 * periodStart + type.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // verifica a cada hora

let timer: NodeJS.Timeout | null = null

async function scheduleDaily(): Promise<void> {
  const nowUtc = new Date()
  const hourUtc = nowUtc.getUTCHours()
  if (hourUtc !== 7) return // só roda às 07:00 UTC = 04:00 BRT

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

  // Busca assinaturas de timelapse ativas
  const subs = await prisma.clienteSubscription.findMany({
    where: {
      status: 'ACTIVE',
      product: { category: 'TIMELAPSE', slug: { contains: 'timelapse' } },
    },
    include: { product: true },
  })

  let created = 0
  for (const sub of subs) {
    const meta = (sub.productConfig as any) ?? (sub.product.metadata as any) ?? {}
    const type: string = meta.type ?? 'DAILY'

    // Só agenda se for o dia certo
    if (type === 'WEEKLY' && today.getUTCDay() !== 1) continue   // segunda-feira
    if (type === 'MONTHLY' && today.getUTCDate() !== 1) continue // primeiro do mês

    for (const cameraId of sub.cameraIds) {
      // Idempotente: não cria se já existe job para este período
      const existing = await prisma.timelapseJob.findFirst({
        where: {
          cameraId,
          subscriptionId: sub.id,
          periodStart: yesterday,
          type: type as any,
        },
      })
      if (existing) continue

      await prisma.timelapseJob.create({
        data: {
          cameraId,
          subscriptionId: sub.id,
          clienteFinalId: sub.clienteFinalId,
          type: type as any,
          status: 'PENDING',
          periodStart: yesterday,
          periodEnd: today,
          speedFactor: type === 'DAILY' ? 20 : type === 'WEEKLY' ? 80 : 360,
        },
      })
      created++
    }
  }

  if (created > 0) logger.info({ created }, 'timelapse_jobs_scheduled')
}

export const timelapseScheduler = {
  start(): void {
    if (timer) return
    scheduleDaily().catch(err => logger.warn({ err }, 'timelapse_scheduler_tick_failed'))
    timer = setInterval(() => {
      scheduleDaily().catch(err => logger.warn({ err }, 'timelapse_scheduler_tick_failed'))
    }, CHECK_INTERVAL_MS)
    logger.info({ checkIntervalMs: CHECK_INTERVAL_MS }, 'timelapse_scheduler_started')
  },

  stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  },
}
