/**
 * face-embedding-purge — cron semanal que apaga FaceEmbedding expirados.
 *
 * Contexto LGPD Art. 11: biometria é categoria especial e exige retenção
 * mínima necessária. Embeddings com `expiresAt < now()` são apagados
 * automaticamente (cascade R2 se sourceImageUrl não-null).
 *
 * Tick: a cada 24h (default). Configurável via FACE_EMBEDDING_PURGE_TICK_MS.
 * Disable: FACE_EMBEDDING_PURGE_ENABLED=false.
 *
 * Métricas logadas a cada tick: quantos foram apagados, quantos R2 keys
 * scheduled pra cleanup (cleanup R2 fica pro storage-orphan-sweeper).
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const TICK_MS = Number(process.env.FACE_EMBEDDING_PURGE_TICK_MS ?? 24 * 60 * 60 * 1000)
const BATCH_SIZE = Number(process.env.FACE_EMBEDDING_PURGE_BATCH ?? 1000)
const ENABLED = process.env.FACE_EMBEDDING_PURGE_ENABLED !== 'false'

let timer: NodeJS.Timeout | null = null

async function tick(): Promise<void> {
  const now = new Date()

  // Busca em batches pra evitar lock longo
  const expired = await prisma.faceEmbedding.findMany({
    where: { expiresAt: { not: null, lt: now } },
    select: { id: true, sourceImageUrl: true },
    take: BATCH_SIZE,
  })

  if (expired.length === 0) return

  const ids = expired.map(e => e.id)
  const r2Keys = expired
    .map(e => e.sourceImageUrl)
    .filter((u): u is string => !!u && (u.startsWith('s3://') || u.startsWith('https://')))

  const result = await prisma.faceEmbedding.deleteMany({
    where: { id: { in: ids } },
  })

  logger.info({
    deleted: result.count,
    r2KeysPendingCleanup: r2Keys.length,
  }, 'face_embedding_purge_tick')

  // R2 cleanup é responsabilidade do storage-orphan-sweeper (job dedicado);
  // aqui só logamos os keys que ficaram sem dono. Lifecycle policy do bucket
  // pode pegar também (depende da config).
  if (r2Keys.length > 0) {
    logger.debug({ sample: r2Keys.slice(0, 5) }, 'face_embedding_r2_orphan_sample')
  }
}

export const faceEmbeddingPurge = {
  start(): void {
    if (!ENABLED) {
      logger.info('face_embedding_purge_disabled (FACE_EMBEDDING_PURGE_ENABLED=false)')
      return
    }
    if (timer) return
    logger.info({ tickMs: TICK_MS, batchSize: BATCH_SIZE }, 'face_embedding_purge_starting')
    tick().catch(err => logger.error({ err }, 'face_embedding_purge_failed'))
    timer = setInterval(() => {
      tick().catch(err => logger.error({ err }, 'face_embedding_purge_failed'))
    }, TICK_MS)
  },

  stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  },
}
