/**
 * Job: reset de quota mensal + geração de Invoice.
 * Executar no dia 1 de cada mês às 00:01.
 * Cron: "1 0 1 * *"
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export async function runMonthlyQuotaReset(): Promise<void> {
  logger.info('quota_reset_job_start')

  const now          = new Date()
  const prevStart    = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevEnd      = new Date(now.getFullYear(), now.getMonth(), 0)
  const newPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const newPeriodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const integradores = await prisma.integrador.findMany({
    where: { active: true },
    select: { id: true, name: true },
  })

  for (const integrador of integradores) {
    try {
      // Buscar quota do mês anterior para fechar invoice
      const oldQuota = await prisma.apiQuota.findFirst({
        where: {
          integradorId: integrador.id,
          periodStart:  prevStart,
        },
      })

      if (oldQuota) {
        // Contar câmeras ativas no mês anterior
        const cameras = await prisma.camera.findMany({
          where: { site: { clienteFinal: { integradorId: integrador.id } }, active: true },
          include: { subscription: true },
        })

        const staticCams    = cameras.filter(c => c.tier === 'STATIC_VISION').length
        const streamingCams = cameras.filter(c => c.tier === 'STREAMING_ANALYTICS').length

        // Preço simples: static R$89.90/cam, streaming R$299.90/cam
        const total = (staticCams * 89.90) + (streamingCams * 299.90)

        await prisma.invoice.create({
          data: {
            integradorId:         integrador.id,
            periodStart:          prevStart,
            periodEnd:            prevEnd,
            totalCamerasStatic:   staticCams,
            totalCamerasStreaming: streamingCams,
            visionApiCalls:       oldQuota.staticVisionUsedThisMonth,
            vertexStreamMinutes:  oldQuota.streamingMinutesUsed,
            totalAmountBrl:       total,
            gcpCostUsd:           0, // calculado pela Billing API
            dueDate:              new Date(now.getFullYear(), now.getMonth(), 10),
          },
        })
      }

      // Criar nova quota (resetada) para o mês atual
      await prisma.apiQuota.upsert({
        where: {
          integradorId_periodStart: {
            integradorId: integrador.id,
            periodStart:  newPeriodStart,
          },
        },
        update: {
          staticVisionUsedThisMonth: 0,
          streamingMinutesUsed:      0,
          periodEnd:                 newPeriodEnd,
        },
        create: {
          integradorId:             integrador.id,
          staticVisionMonthlyLimit: oldQuota?.staticVisionMonthlyLimit ?? 50000,
          streamingMinutesLimit:    oldQuota?.streamingMinutesLimit    ?? 6000,
          staticVisionUsedThisMonth:0,
          streamingMinutesUsed:     0,
          periodStart:              newPeriodStart,
          periodEnd:                newPeriodEnd,
        },
      })

      logger.info({ integradorId: integrador.id, name: integrador.name }, 'quota_reset_done')
    } catch (err) {
      logger.error({ err, integradorId: integrador.id }, 'quota_reset_failed')
    }
  }

  logger.info('quota_reset_job_done')
}
