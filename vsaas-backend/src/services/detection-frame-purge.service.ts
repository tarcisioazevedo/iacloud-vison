/**
 * detection-frame-purge.service.ts
 *
 * Cron diário (03:30 UTC) que apaga entradas da DetectionFrame mais velhas que
 * DETECTION_FRAME_RETENTION_DAYS (default 30). 30 dias é folga suficiente pra
 * BI/análise e mantém a tabela em ~3M linhas em vez de crescer indefinidamente
 * (observado: ~95k linhas/dia em piloto com 2 câmeras).
 *
 * Mesmo padrão de audit-purge.service.ts: setInterval, idempotência via
 * lastRunDate, batches de 5k com respiro de 100ms, cap de 200k por execução.
 *
 * Configuração via env:
 *   DETECTION_FRAME_RETENTION_DAYS=30   (default 30)
 *   DETECTION_FRAME_PURGE_HOUR_UTC=3    (default 03:00 UTC; offset interno +30min)
 *
 * Para desabilitar: DETECTION_FRAME_RETENTION_DAYS=0 → service não inicia.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const RETENTION_DAYS = parseInt(process.env.DETECTION_FRAME_RETENTION_DAYS ?? '30', 10)
const PURGE_HOUR_UTC = parseInt(process.env.DETECTION_FRAME_PURGE_HOUR_UTC ?? '3', 10)
const CHECK_INTERVAL_MS = 60 * 60 * 1000
const MAX_DELETE_PER_RUN = 200_000
const BATCH_SIZE = 5_000

const STATE = { lastRunDate: '' }
let timer: NodeJS.Timeout | null = null

function todayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function shouldRun(): boolean {
  if (RETENTION_DAYS <= 0) return false
  const nowUtc = new Date()
  // Roda às HH:30 para não colidir com o audit-purge que roda às HH:00
  if (nowUtc.getUTCHours() < PURGE_HOUR_UTC) return false
  if (nowUtc.getUTCHours() === PURGE_HOUR_UTC && nowUtc.getUTCMinutes() < 30) return false
  return STATE.lastRunDate !== todayKeyUtc()
}

async function runPurge(): Promise<void> {
  STATE.lastRunDate = todayKeyUtc()
  const startedAt = Date.now()
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  try {
    let totalDeleted = 0
    let batchCount = 0
    while (totalDeleted < MAX_DELETE_PER_RUN) {
      const old = await prisma.detectionFrame.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: Math.min(BATCH_SIZE, MAX_DELETE_PER_RUN - totalDeleted),
      })
      if (old.length === 0) break
      const result = await prisma.detectionFrame.deleteMany({
        where: { id: { in: old.map(o => o.id) } },
      })
      totalDeleted += result.count
      batchCount++
      await new Promise(r => setTimeout(r, 100))
    }

    const durationMs = Date.now() - startedAt
    logger.info(
      { deleted: totalDeleted, batches: batchCount, retentionDays: RETENTION_DAYS, cutoff: cutoff.toISOString(), durationMs },
      'detection_frame_purge.completed',
    )
  } catch (err) {
    logger.error({ err }, 'detection_frame_purge.failed')
  }
}

export function startDetectionFramePurgeService(): void {
  if (timer) return
  if (RETENTION_DAYS <= 0) {
    logger.info('detection_frame_purge.disabled (DETECTION_FRAME_RETENTION_DAYS=0)')
    return
  }
  logger.info({ retentionDays: RETENTION_DAYS, purgeHourUtc: PURGE_HOUR_UTC }, 'detection_frame_purge.scheduled')
  timer = setInterval(() => {
    if (shouldRun()) runPurge().catch(err => logger.error({ err }, 'detection_frame_purge.tick_failed'))
  }, CHECK_INTERVAL_MS)
  if (timer.unref) timer.unref()
}

export function stopDetectionFramePurgeService(): void {
  if (timer) { clearInterval(timer); timer = null }
}
