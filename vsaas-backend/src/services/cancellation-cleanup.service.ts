import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { sendMail } from '../lib/smtp'
import { recordingStorage } from './recording-storage.service'

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000
const GRACE_REMINDER_DAYS = 7

function nanoid5(): string {
  return Math.random().toString(36).slice(2, 7).toUpperCase()
}

function buildProtocol(): string {
  const date = new Date().toISOString().slice(0, 10)
  return `#DEL-${date}-${nanoid5()}`
}

function bytesToGb(bytes: bigint): string {
  return (Number(bytes) / 1_073_741_824).toFixed(2)
}

async function processExpiredGrace(): Promise<string[]> {
  const now = new Date()

  const expired = await prisma.clienteSubscription.findMany({
    where: {
      status: 'GRACE',
      cancelGraceUntil: { lt: now },
    },
    select: {
      id: true,
      clienteFinalId: true,
      cameraIds: true,
      cancelReason: true,
      clienteFinal: {
        select: { integradorId: true },
      },
    },
  })

  const protocols: string[] = []

  for (const sub of expired) {
    try {
      const integradorId = sub.clienteFinal.integradorId

      // Agrega ANTES de deletar
      const agg = await prisma.recordingSegment.aggregate({
        _sum: { sizeBytes: true },
        _count: true,
        where: { cameraId: { in: sub.cameraIds } },
      })

      const bytesDeleted = BigInt(agg._sum.sizeBytes ?? 0)
      const segmentsDeleted = agg._count

      // Busca storagePaths para remover do R2
      const segments = await prisma.recordingSegment.findMany({
        where: { cameraId: { in: sub.cameraIds } },
        select: { storagePath: true },
      })
      const paths = segments.map(s => s.storagePath).filter(Boolean) as string[]

      // Deleta segmentos do DB
      await prisma.recordingSegment.deleteMany({
        where: { cameraId: { in: sub.cameraIds } },
      })

      // Remove do R2 (tolerante a falha — não bloqueia o log)
      if (paths.length > 0 && integradorId) {
        await recordingStorage.removeMany(integradorId, paths).catch(err =>
          logger.warn({ err, subscriptionId: sub.id }, 'cancellation_cleanup_r2_remove_failed'),
        )
      }

      const protocol = buildProtocol()
      const reason = sub.cancelReason === 'inadimplencia' ? 'INADIMPLENCIA' : 'VOLUNTARY'
      const executedAt = new Date()

      // Cria log de deleção
      await prisma.storageDeletionLog.create({
        data: {
          clienteFinalId: sub.clienteFinalId,
          subscriptionId: sub.id,
          reason,
          executedBy: 'job:cancellation-cleanup',
          bytesDeleted,
          segmentsDeleted,
          protocol,
          notifiedAt: null,
        },
      })

      // Atualiza subscription para CANCELED
      await prisma.clienteSubscription.update({
        where: { id: sub.id },
        data: { status: 'CANCELED' },
      })

      // Desativa gravação nas câmeras
      if (sub.cameraIds.length > 0) {
        await prisma.camera.updateMany({
          where: { id: { in: sub.cameraIds } },
          data: { recordEnabled: false },
        })
      }

      // Envia e-mail comprovante para os usuários do CF
      const users = await prisma.user.findMany({
        where: { clienteFinalId: sub.clienteFinalId, active: true },
        select: { email: true },
      })

      const dateStr = executedAt.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
      const gbStr = bytesToGb(bytesDeleted)

      for (const user of users) {
        if (!user.email) continue
        await sendMail({
          to: user.email,
          subject: `[VSaaS] Seus dados foram deletados — Protocolo ${protocol}`,
          text: [
            `Seus dados de gravação foram deletados em ${dateStr}.`,
            `Bytes: ${gbStr} GB.`,
            `Protocolo: ${protocol}.`,
            'Guarde este e-mail.',
          ].join('\n'),
        }).catch(err =>
          logger.warn({ err, subscriptionId: sub.id, email: user.email }, 'cancellation_cleanup_mail_failed'),
        )
      }

      // Marca email enviado no log
      await prisma.storageDeletionLog.updateMany({
        where: { protocol },
        data: { notifiedAt: executedAt },
      })

      protocols.push(protocol)
      logger.info({ subscriptionId: sub.id, protocol, bytesDeleted: String(bytesDeleted), segmentsDeleted }, 'cancellation_cleanup_subscription_done')
    } catch (err) {
      logger.error({ err, subscriptionId: sub.id }, 'cancellation_cleanup_subscription_error')
    }
  }

  return protocols
}

async function sendGraceReminders(): Promise<void> {
  const now = new Date()
  const in7Days = new Date(now.getTime() + GRACE_REMINDER_DAYS * 24 * 60 * 60 * 1000)

  const graceActive = await prisma.clienteSubscription.findMany({
    where: {
      status: 'GRACE',
      cancelGraceUntil: { gte: now, lte: in7Days },
    },
    select: {
      id: true,
      clienteFinalId: true,
      cancelGraceUntil: true,
      productConfig: true,
    },
  })

  for (const sub of graceActive) {
    try {
      const cfg = (sub.productConfig as Record<string, unknown> | null) ?? {}
      if (cfg.graceReminderSentAt) continue

      const daysLeft = Math.ceil(
        (sub.cancelGraceUntil!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      )

      const users = await prisma.user.findMany({
        where: { clienteFinalId: sub.clienteFinalId, active: true },
        select: { email: true },
      })

      for (const user of users) {
        if (!user.email) continue
        await sendMail({
          to: user.email,
          subject: `[VSaaS] Seus dados serão deletados em ${daysLeft} dia(s)`,
          text: [
            `Atenção: seus dados de gravação serão permanentemente deletados em ${daysLeft} dia(s).`,
            'Faça o download agora ou reative sua assinatura para preservá-los.',
          ].join('\n'),
        }).catch(err =>
          logger.warn({ err, subscriptionId: sub.id }, 'grace_reminder_mail_failed'),
        )
      }

      await prisma.clienteSubscription.update({
        where: { id: sub.id },
        data: {
          productConfig: { ...cfg, graceReminderSentAt: now.toISOString() },
        },
      })
    } catch (err) {
      logger.warn({ err, subscriptionId: sub.id }, 'grace_reminder_error')
    }
  }
}

async function tickCleanup(): Promise<void> {
  try {
    const protocols = await processExpiredGrace()
    logger.info({ count: protocols.length, protocols }, 'cancellation_cleanup_done')
  } catch (err) {
    logger.error({ err }, 'cancellation_cleanup_tick_error')
  }

  try {
    await sendGraceReminders()
  } catch (err) {
    logger.error({ err }, 'cancellation_grace_reminder_tick_error')
  }
}

let timer: NodeJS.Timeout | null = null

export const cancellationCleanupService = {
  start(): void {
    if (timer) return
    // Primeiro tick imediato, depois a cada 24h
    tickCleanup().catch(err => logger.error({ err }, 'cancellation_cleanup_first_tick_error'))
    timer = setInterval(() => {
      tickCleanup().catch(err => logger.error({ err }, 'cancellation_cleanup_interval_error'))
    }, TICK_INTERVAL_MS)
    timer.unref()
    logger.info('cancellation_cleanup_service_started')
  },

  stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  },
}
