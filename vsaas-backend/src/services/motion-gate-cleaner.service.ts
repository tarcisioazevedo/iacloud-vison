/**
 * Motion-Gate Cleaner — apaga segments de câmeras em modo MOTION/ACTIVE_OBJECTS
 * que ficaram com `deleteAfterReviewAt < now()` sem nenhuma detecção (sem
 * hasMotion=true E sem hasEvent=true).
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

  // Busca segments expirados sem motion/event. Inclui apenas UPLOADED ou
  // LOCAL_ONLY — segments PENDING ainda podem virar UPLOADED e ter detecção
  // tardia anexada. FAILED pesados são tratados pelo retention (G7).
  const expired = await prisma.recordingSegment.findMany({
    where: {
      deleteAfterReviewAt: { lt: now },
      hasMotion: false,
      hasEvent:  false,
      uploadStatus: { in: ['UPLOADED', 'LOCAL_ONLY'] },
    },
    select: {
      id: true, storagePath: true, cameraId: true,
      camera: { select: { site: { select: { clienteFinal: { select: { integradorId: true } } } } } },
    },
    take: BATCH_SIZE,
  })

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
