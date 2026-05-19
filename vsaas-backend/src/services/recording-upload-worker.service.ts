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
 * Estratégia de scheduling dinâmico (2026-05-17):
 *   - Em condições normais: tick a cada RETRY_INTERVAL_MS (default 60s), batch 20
 *   - tmpfs ≥ WARN_PCT (70%): tick a cada 10s, batch 50 + limpeza de órfãos
 *   - tmpfs ≥ PAUSE_PCT (85%): tick a cada 5s, batch 100 + limpeza de órfãos
 *
 *   O scheduling usa setTimeout auto-renovado (não setInterval) para poder
 *   ajustar o próximo delay DEPOIS de cada tick, baseado na pressão atual.
 *
 * Limpeza de órfãos:
 *   Arquivos .ts com status UPLOADED ou FAILED-esgotado ainda presentes
 *   no tmpfs (bug de cleanup no ingest ou crash entre upload e delete)
 *   são removidos quando pct ≥ WARN_PCT. Apenas arquivos com mais de
 *   ORPHAN_MIN_AGE_MS (60s) são candidatos — evita conflito com ffmpeg
 *   que ainda está escrevendo.
 *
 * Observabilidade:
 *   - Log estruturado (pino) por segment processado
 *   - Métrica via CameraLog source=RECORDER (já alimenta UI)
 */
import { existsSync, readdirSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { recordingStorage } from './recording-storage.service'
import { tmpfsWatchdog } from './recording-tmpfs-watchdog.service'

const RETRY_INTERVAL_MS  = Number(process.env.RECORDING_RETRY_MS ?? 60_000)
const MAX_ATTEMPTS       = Number(process.env.RECORDING_MAX_UPLOAD_ATTEMPTS ?? 5)
const BATCH_SIZE         = Number(process.env.RECORDING_RETRY_BATCH ?? 20)
const ENABLED            = process.env.RECORDING_ENABLED !== 'false'
const BASE_PATH          = process.env.RECORDINGS_BASE_PATH ?? '/recordings'
const ORPHAN_MIN_AGE_MS  = 60_000  // só limpa arquivos com mais de 60s
const WARN_PCT           = Number(process.env.TMPFS_WARN_PCT ?? 70)
const PAUSE_PCT          = Number(process.env.TMPFS_PAUSE_PCT ?? 85)

// Scheduling dinâmico: retorna { batchSize, nextMs } baseado na pressão atual.
function pressureConfig(): { batchSize: number; nextMs: number } {
  const snap = tmpfsWatchdog.snapshot()
  if (snap && snap.pct >= PAUSE_PCT) return { batchSize: 100, nextMs: 5_000 }
  if (snap && snap.pct >= WARN_PCT)  return { batchSize: 50,  nextMs: 10_000 }
  return { batchSize: BATCH_SIZE, nextMs: RETRY_INTERVAL_MS }
}

/** Limpa arquivos .ts órfãos: UPLOADED ou FAILED-esgotados ainda em disco. */
async function cleanOrphans(): Promise<void> {
  const now = Date.now()
  let freedBytes = 0
  let deletedCount = 0

  function collectTsFiles(dir: string): string[] {
    const result: string[] = []
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) result.push(...collectTsFiles(full))
        else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(full)
      }
    } catch { /* dir pode sumir entre ticks */ }
    return result
  }

  const files = collectTsFiles(BASE_PATH)
  for (const filePath of files) {
    try {
      const st = statSync(filePath)
      if (now - st.mtimeMs < ORPHAN_MIN_AGE_MS) continue  // ainda fresco

      const storagePath = filePath.slice(BASE_PATH.length + 1) // remove leading /

      const seg = await prisma.recordingSegment.findFirst({
        where: { storagePath },
        select: { id: true, uploadStatus: true, uploadAttempts: true },
      })

      // Candidatos à remoção:
      //  - Sem registro no BD (ex: ffmpeg morreu antes de criar o segment)
      //  - Status UPLOADED (ingest não deletou por crash entre upload e rm)
      //  - Status FAILED com attempts esgotados (desistimos do upload)
      const shouldDelete = !seg
        || seg.uploadStatus === 'UPLOADED'
        || (seg.uploadStatus === 'FAILED' && seg.uploadAttempts >= MAX_ATTEMPTS)

      if (shouldDelete) {
        rmSync(filePath, { force: true })
        freedBytes += st.size
        deletedCount++
        logger.debug({
          filePath, storagePath, reason: seg?.uploadStatus ?? 'no_record',
        }, 'tmpfs_orphan_deleted')
      }
    } catch { /* arquivo pode sumir entre stat e rm */ }
  }

  if (deletedCount > 0) {
    logger.info({
      deletedCount,
      freedMb: Math.round(freedBytes / 1024 / 1024),
    }, 'tmpfs_orphan_cleanup_done')
  }
}

let timer: NodeJS.Timeout | null = null
let running = false  // evita overlapping ticks

async function tickRetry(): Promise<void> {
  if (!recordingStorage.isCloudEnabled()) return

  const { batchSize } = pressureConfig()
  const snap = tmpfsWatchdog.snapshot()
  const underPressure = snap ? snap.pct >= WARN_PCT : false

  // Limpeza de órfãos quando o tmpfs está sob pressão
  if (underPressure) {
    await cleanOrphans().catch(err => logger.warn({ err }, 'tmpfs_orphan_cleanup_failed'))
  }

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
    take: batchSize,
  })

  if (pending.length === 0) return

  logger.info({
    count: pending.length,
    batchSize,
    tmpfsPct: snap?.pct ?? null,
    underPressure,
  }, 'recording_retry_batch_start')

  for (const seg of pending) {
    const integradorId = seg.camera?.site?.clienteFinal?.integradorId
    if (!integradorId) {
      // G12 fix: não usar bucket "default" — sinaliza erro de tenancy
      // e abandona o segmento (admin precisa corrigir Site/ClienteFinal).
      await prisma.recordingSegment.updateMany({
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

    // Opção C (2026-05-12) — fail-fast quando o arquivo local sumiu.
    // Cenário: R2 ficou offline, segments empilharam PENDING no tmpfs, backend
    // reiniciou (deploy/OOM/crash). tmpfs é volátil — arquivos sumiram. Sem
    // este guard, worker faria 5 tentativas inúteis batendo "file not found"
    // antes de marcar FAILED. Marcamos no 1º try com razão explícita pra
    // operador identificar no /admin/recording-ops + admin pode escalar
    // pra Modo A/B (S3 buffer) se virar dor recorrente.
    const absLocal = recordingStorage.absolutePath(seg.storagePath)
    if (!existsSync(absLocal)) {
      await prisma.recordingSegment.updateMany({
        where: { id: seg.id },
        data: {
          uploadAttempts: MAX_ATTEMPTS,
          uploadStatus:   'FAILED',
          uploadError:    'local_file_missing (tmpfs lost — provavelmente restart do backend durante outage R2)',
        },
      }).catch(() => {})
      logger.warn({ segmentId: seg.id, storagePath: seg.storagePath },
        'recording_retry_local_file_missing')
      continue
    }

    try {
      const ok = await recordingStorage.uploadToCloud(integradorId, seg.storagePath)
      if (ok) {
        await prisma.recordingSegment.updateMany({
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
        await prisma.recordingSegment.updateMany({
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
      await prisma.recordingSegment.updateMany({
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

/** Agenda o próximo tick usando setTimeout dinâmico. */
function scheduleNext(): void {
  if (!ENABLED) return
  const { nextMs } = pressureConfig()
  timer = setTimeout(async () => {
    if (running) { scheduleNext(); return }
    running = true
    try {
      await tickRetry()
    } catch (err) {
      logger.error({ err }, 'recording_retry_failed_top')
    } finally {
      running = false
      scheduleNext()
    }
  }, nextMs)
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
      warnPct: WARN_PCT,
      pausePct: PAUSE_PCT,
    }, 'recording_upload_worker_starting')

    // Tick imediato pra processar pendências do boot anterior
    running = true
    tickRetry()
      .catch(err => logger.error({ err }, 'recording_retry_failed_top'))
      .finally(() => { running = false; scheduleNext() })
  },

  stop(): void {
    if (timer) { clearTimeout(timer); timer = null }
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
