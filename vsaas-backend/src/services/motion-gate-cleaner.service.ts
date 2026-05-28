/**
 * Motion-Gate Cleaner — apaga segments de câmeras em modo MOTION/EVENT
 * que ficaram com `deleteAfterReviewAt < now()` sem nenhuma detecção (sem
 * hasMotion=true E sem hasEvent=true E sem hasAlert=true).
 *
 * Pipeline:
 *   1. Câmera em modo MOTION grava 24/7 (impossível parar/iniciar ffmpeg em
 *      bordas exatas de movimento sem perder frames de pré-evento).
 *   2. Cada segment criado pelo recording.service / cloud-direct-recorder em
 *      câmera motion-gated nasce com deleteAfterReviewAt = now + grace (5min).
 *   3. Se markSegmentMotion(camera, from, to) for chamado dentro da janela
 *      grace + pre/post-buffer, deleteAfterReviewAt é zerado → segment fica.
 *   4. Senão, este cleaner apaga segment + arquivo (local/R2/S3).
 *
 * Tick interval: a cada 60s.
 *
 * Apaga em batch de 200 — evita lock SQL longo. Se uma câmera tem muitos
 * segments expirados, próximo tick continua.
 *
 * Por que 5min de grace:
 *   - Detecção via Vertex/Edge tem latência típica < 30s.
 *   - 5min cobre folgas de pipeline + pre/post-buffer (5+10s).
 *   - Aumentar via env MOTION_GATE_GRACE_MS se câmera crítica precisar
 *     de margem maior (custa storage temporário).
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { recordingStorage } from './recording-storage.service'

const TICK_MS    = Number(process.env.MOTION_GATE_TICK_MS ?? 60_000)
const BATCH_SIZE = Number(process.env.MOTION_GATE_BATCH_SIZE ?? 200)
const ENABLED    = process.env.RECORDING_ENABLED !== 'false'
                && process.env.MOTION_GATE_ENABLED !== 'false'

let timer: NodeJS.Timeout | null = null

async function tick(): Promise<void> {
  const now = new Date()

  // Busca segments expirados sem motion/event/alert. Inclui apenas UPLOADED ou
  // LOCAL_ONLY — segments PENDING ainda podem virar UPLOADED e ter detecção
  // tardia anexada. FAILED pesados são tratados pelo retention (G7).
  // 2026-05-27: respeita EvidenceVault via raw query com NOT EXISTS.
  const expiredRaw = await prisma.$queryRaw<Array<{
    id: string
    storagePath: string
    cameraId: string
    integradorId: string | null
  }>>`
    SELECT rs."id", rs."storagePath", rs."cameraId", i."id" AS "integradorId"
    FROM "RecordingSegment" rs
    JOIN "Camera" c                ON c."id"  = rs."cameraId"
    LEFT JOIN "Site" s             ON s."id"  = c."siteId"
    LEFT JOIN "ClienteFinal" cf    ON cf."id" = s."clienteFinalId"
    LEFT JOIN "Integrador" i       ON i."id"  = cf."integradorId"
    WHERE rs."deleteAfterReviewAt" < ${now}
      AND rs."hasMotion" = false
      AND rs."hasEvent"  = false
      AND rs."hasAlert"  = false
      AND rs."uploadStatus" IN ('UPLOADED', 'LOCAL_ONLY')
      AND NOT EXISTS (
        SELECT 1 FROM "EvidenceVault" ev
        WHERE ev."cameraId" = rs."cameraId"
          AND ev."startAt" <= rs."endedAt"
          AND ev."endAt"   >= rs."startedAt"
          AND (ev."expiresAt" IS NULL OR ev."expiresAt" > NOW())
      )
    LIMIT ${BATCH_SIZE}
  `
  // Adapta pro shape esperado pelo resto do código (camera.site...)
  const expired = expiredRaw.map(r => ({
    id: r.id,
    storagePath: r.storagePath,
    cameraId: r.cameraId,
    camera: { site: { clienteFinal: { integradorId: r.integradorId } } },
  }))

  if (expired.length === 0) return

  // Agrupa por integradorId pra batch delete eficiente.
  const byTenant = new Map<string, string[]>()
  for (const s of expired) {
    const integradorId = s.camera?.site?.clienteFinal?.integradorId
    if (!integradorId) continue
    const arr = byTenant.get(integradorId) ?? []
    arr.push(s.storagePath)
    byTenant.set(integradorId, arr)
  }

  // Apaga arquivos (local + cloud)
  for (const [integradorId, paths] of byTenant) {
    await recordingStorage.removeMany(integradorId, paths).catch(err =>
      logger.warn({ err, integradorId, count: paths.length }, 'motion_gate_remove_failed'),
    )
  }

  // Apaga registros
  const ids = expired.map(s => s.id)
  const result = await prisma.recordingSegment.deleteMany({
    where: { id: { in: ids } },
  })

  logger.info({
    deleted: result.count,
    tenants: byTenant.size,
  }, 'motion_gate_cleaner_tick')
}

export const motionGateCleaner = {
  start(): void {
    if (!ENABLED) {
      logger.info('motion_gate_cleaner_disabled')
      return
    }
    if (timer) return
    logger.info({ tickMs: TICK_MS, batchSize: BATCH_SIZE }, 'motion_gate_cleaner_starting')
    // Tick imediato pra processar pendências do boot
    tick().catch(err => logger.error({ err }, 'motion_gate_tick_failed'))
    timer = setInterval(() => {
      tick().catch(err => logger.error({ err }, 'motion_gate_tick_failed'))
    }, TICK_MS)
  },
  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },
}
