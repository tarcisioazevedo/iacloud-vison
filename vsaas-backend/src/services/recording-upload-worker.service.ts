/**
 * Recording Upload Worker — re-tenta uploads R2/S3 falhos ou pendentes.
 *
 * Por que existe:
 *   recording-ingest.service tenta upload async logo após receber o
 *   segment. Se a tentativa inicial falhar (rede instável, R2 throttle,
 *   credenciais expiradas), o segment fica PENDING com uploadAttempts=1
 *   e nunca é reprocessado. Sem este worker, gravações ficam órfãs no
 *   disco local e morrem na retention.
 *
 * Estratégia:
 *   - Tick a cada RETRY_INTERVAL_MS (default 60s)
 *   - Busca segments PENDING com uploadAttempts < MAX_ATTEMPTS
 *   - Para cada um: tenta upload, atualiza status conforme resultado
 *   - Se atingir MAX_ATTEMPTS: marca FAILED (não tenta mais — operador
 *     precisa investigar via /admin/storage/health)
 *   - Backoff implícito: tick a cada 60s + um segment por vez evita
 *     hammering em R2 que pode estar com throttle temporário.
 *
 * Observabilidade:
 *   - Log estruturado (pino) por segment processado
 *   - Métrica via CameraLog source=RECORDER (já alimenta UI)
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { recordingStorage } from './recording-storage.service'

const RETRY_INTERVAL_MS = Number(process.env.RECORDING_RETRY_MS ?? 60_000)
const MAX_ATTEMPTS      = Number(process.env.RECORDING_MAX_UPLOAD_ATTEMPTS ?? 5)
const BATCH_SIZE        = Number(process.env.RECORDING_RETRY_BATCH ?? 20)
const ENABLED           = process.env.RECORDING_ENABLED !== 'false'

let timer: NodeJS.Timeout | null = null

async function tickRetry(): Promise<void> {
  if (!recordingStorage.isCloudEnabled()) return

  // Busca PENDING ou FAILED-recuperáveis com attempts abaixo do limite.
  // G1 fix (2026-05-09): incluir FAILED — quando worker errou em tick passado
  // e marcou FAILED prematuramente. A própria nova máquina de estado não
  // produz FAILED até esgotar attempts; isso cobre legado + edge cases.
  const pending = await prisma.recordingSegment.findMany({
    where: {
      uploadStatus: { in: ['PENDING', 'FAILED'] },
      uploadAttempts: { lt: MAX_ATTEMPTS },
    },
    select: {
      id: true, storagePath: true, uploadAttempts: true,
      camera: { select: { site: { select: { clienteFinal: { select: { integradorId: true } } } } } },
    },
    orderBy: [{ uploadAttempts: 'asc' }, { startedAt: 'asc' }],
    take: BATCH_SIZE,
  })

  if (pending.length === 0) return

  logger.info({ count: pending.length }, 'recording_retry_batch_start')

  for (const seg of pending) {
    const integradorId = seg.camera?.site?.clienteFinal?.integradorId
    if (!integradorId) {
      // G12 fix: não usar bucket "default" — sinaliza erro de tenancy
      // e abandona o segmento (admin precisa corrigir Site/ClienteFinal).
      await prisma.recordingSegment.update({
        where: { id: seg.id },
        data: {
          uploadAttempts: { increment: 1 },
          uploadError:    'integradorId not resolvable (tenancy misconfigured)',
          uploadStatus:   seg.uploadAttempts + 1 >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
        },
      }).catch(() => {})
      logger.error({ segmentId: seg.id }, 'recording_retry_no_integrador')
      continue
    }

    try {
      const ok = await recordingStorage.uploadToCloud(integradorId, seg.storagePath)
      if (ok) {
        await prisma.recordingSegment.update({
          where: { id: seg.id },
          data: {
            uploadStatus:   'UPLOADED',
            uploadedAt:     new Date(),
            uploadBucket:   `icv-${integradorId}`,
            uploadAttempts: { increment: 1 },
            uploadError:    null,
          },
        })
        logger.debug({ segmentId: seg.id, attempts: seg.uploadAttempts + 1 },
          'recording_retry_uploaded')
      } else {
        const newAttempts = seg.uploadAttempts + 1
        await prisma.recordingSegment.update({
          where: { id: seg.id },
          data: {
            uploadAttempts: { increment: 1 },
            uploadError: 'uploadToCloud returned false',
            // Atinge limite → marca FAILED pra worker parar de re-tentar
            uploadStatus: newAttempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          },
        })
        if (newAttempts >= MAX_ATTEMPTS) {
          logger.error({ segmentId: seg.id, attempts: newAttempts },
            'recording_upload_abandoned')
        }
      }
    } catch (err: any) {
      const newAttempts = seg.uploadAttempts + 1
      await prisma.recordingSegment.update({
        where: { id: seg.id },
        data: {
          uploadAttempts: { increment: 1 },
          uploadError: String(err?.message ?? err).slice(0, 500),
          uploadStatus: newAttempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
        },
      }).catch(() => {})
      logger.warn({ err, segmentId: seg.id }, 'recording_retry_failed')
    }
  }

  logger.info({ processed: pending.length }, 'recording_retry_batch_done')
}

export const recordingUploadWorker = {
  start(): void {
    if (!ENABLED) {
      logger.info('recording_upload_worker_disabled (RECORDING_ENABLED=false)')
      return
    }
    if (timer) return

    logger.info({
      retryMs: RETRY_INTERVAL_MS,
      maxAttempts: MAX_ATTEMPTS,
      batchSize: BATCH_SIZE,
    }, 'recording_upload_worker_starting')

    // Tick imediato pra processar pendências do boot anterior
    tickRetry().catch(err => logger.error({ err }, 'recording_retry_failed_top'))
    timer = setInterval(() => {
      tickRetry().catch(err => logger.error({ err }, 'recording_retry_failed_top'))
    }, RETRY_INTERVAL_MS)
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },

  /** Pra debug/admin: dispara um ciclo de retry sob demanda. */
  async tickNow(): Promise<{ processed: number }> {
    const before = await prisma.recordingSegment.count({
      where: { uploadStatus: 'PENDING' },
    })
    await tickRetry()
    const after = await prisma.recordingSegment.count({
      where: { uploadStatus: 'PENDING' },
    })
    return { processed: Math.max(0, before - after) }
  },
}
