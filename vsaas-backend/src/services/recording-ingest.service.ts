/**
 * Recording Ingest Service — recebe segmentos de gravação enviados pelo
 * edge box (deploymentMode=EDGE_BOX) ou por simulator/dev tool.
 *
 * Fluxo:
 *   1. Box grava localmente .ts a cada 6s (configurável no edge)
 *   2. Box faz POST /iacv-box/segments/upload com arquivo + metadados
 *   3. Esta camada de service:
 *      a. Verifica idempotência (cameraId + startedAt ± tolerance)
 *      b. Gera segmentId UUID, monta storagePath
 *      c. Persiste arquivo no recordingStorage (local + sobe R2 async)
 *      d. Cria RecordingSegment no DB
 *      e. Cria CameraLog (source=RECORDER) — alimenta UI de monitoramento
 *   4. Retorna { segmentId, persisted | deduplicated, storagePath }
 *
 * Idempotência:
 *   Box pode reenviar segmento por timeout/retry de rede. Usamos
 *   (cameraId, startedAt ± 500ms) como chave lógica. Match → reusa
 *   segmentId existente sem sobrescrever arquivo.
 *
 * Anti-IDOR:
 *   Esta camada NÃO valida ownership da câmera — quem chama (rota
 *   POST /iacv-box/segments/upload) já validou via assertBoxOwnership +
 *   checagem `camera.edgeNodeId === boxLicense.edgeNodeId`.
 */
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { recordingStorage } from './recording-storage.service'
import { getCameraContext } from './camera-context.service'

const DEDUP_TOLERANCE_MS = 500

export type IngestSource = 'BOX' | 'CLOUD_FFMPEG' | 'SIMULATOR' | 'PRESIGNED'

export interface IngestSegmentInput {
  cameraId:    string
  /** Início do segmento em UTC. */
  startedAt:   Date
  /** Duração real em segundos (pode ser < SEGMENT_SECONDS no último segmento). */
  durationSec: number
  /** Buffer do arquivo .ts. Null quando uploaded é true (presigned URL flow). */
  fileBuffer:  Buffer | null
  /** True quando arquivo já foi PUT direto no R2 (presigned). Skipa save local. */
  uploaded?:   boolean
  /** storagePath relativo, gerado externamente quando uploaded=true. */
  storagePathOverride?: string
  /** Tamanho do arquivo em bytes. Necessário quando uploaded=true. */
  sizeBytesOverride?:   number
  /** Origem do segmento — define a tag no CameraLog. */
  source:      IngestSource
  /** Resolved no caller: integradorId da câmera, pra path R2 multi-tenant. */
  integradorId: string
  /** Metadados opcionais — repassados pro RecordingSegment. */
  meta?: {
    codec?:    string
    fps?:      number
    width?:    number
    height?:   number
    hasMotion?: boolean
    hasEvent?: boolean
  }
}

export interface IngestSegmentResult {
  segmentId:    string
  storagePath:  string
  persisted:    'created' | 'deduplicated'
  endedAt:      Date
  sizeBytes:    number
}

export const recordingIngest = {
  async ingestSegment(input: IngestSegmentInput): Promise<IngestSegmentResult> {
    const {
      cameraId, startedAt, durationSec, fileBuffer, uploaded,
      storagePathOverride, sizeBytesOverride, source, integradorId, meta,
    } = input

    // ── 1. Idempotência ─────────────────────────────────────────────
    // Box pode reenviar mesmo segmento (network retry). Match por
    // (cameraId, startedAt ± tolerance) → reusa registro existente.
    const tolFrom = new Date(startedAt.getTime() - DEDUP_TOLERANCE_MS)
    const tolTo   = new Date(startedAt.getTime() + DEDUP_TOLERANCE_MS)
    const existing = await prisma.recordingSegment.findFirst({
      where: {
        cameraId,
        startedAt: { gte: tolFrom, lte: tolTo },
      },
      select: { id: true, storagePath: true, endedAt: true, sizeBytes: true },
    })
    if (existing) {
      // Log dedup pra UI mostrar "ignorado por já existir"
      logCameraIngest(cameraId, 'WARN', 'segment_deduplicated', {
        segmentId: existing.id, source, startedAt: startedAt.toISOString(),
      }).catch(() => {})
      return {
        segmentId:   existing.id,
        storagePath: existing.storagePath,
        persisted:   'deduplicated',
        endedAt:     existing.endedAt,
        sizeBytes:   Number(existing.sizeBytes),
      }
    }

    // ── 2. Gera identidade do novo segmento ─────────────────────────
    const segmentId = randomUUID()
    const datePart  = startedAt.toISOString().slice(0, 10)
    const timePart  = startedAt.toISOString().slice(11, 19).replace(/:/g, '-')
    const relativePath = storagePathOverride
      ?? `${cameraId}/${datePart}/${timePart}_${segmentId}.ts`

    // ── 3. Persiste arquivo (a menos que já tenha sido PUT no R2) ──
    let sizeBytes = sizeBytesOverride ?? 0
    if (!uploaded) {
      if (!fileBuffer) {
        throw new Error('fileBuffer required when uploaded=false')
      }
      await recordingStorage.ensureDir(relativePath)
      const localAbs = recordingStorage.absolutePath(relativePath)
      await fs.writeFile(localAbs, fileBuffer)
      sizeBytes = fileBuffer.byteLength
    }

    const endedAt = new Date(startedAt.getTime() + durationSec * 1000)

    // ── 4. Cria RecordingSegment ────────────────────────────────────
    // uploadStatus depende do estado do storage:
    //   - uploaded=true (presigned flow): cliente já fez PUT no R2 → UPLOADED
    //   - cloud habilitado: PENDING (worker async vai subir)
    //   - cloud desabilitado: LOCAL_ONLY (sem cloud configurado nesta instalação)
    const initialStatus = uploaded
      ? 'UPLOADED' as const
      : recordingStorage.isCloudEnabled()
        ? 'PENDING' as const
        : 'LOCAL_ONLY' as const

    await prisma.recordingSegment.create({
      data: {
        id:          segmentId,
        cameraId,
        startedAt,
        endedAt,
        durationSec,
        sizeBytes:   BigInt(sizeBytes),
        storagePath: relativePath,
        codec:       meta?.codec ?? 'h264',
        fps:         meta?.fps ?? null,
        width:       meta?.width ?? null,
        height:      meta?.height ?? null,
        hasMotion:   meta?.hasMotion ?? false,
        hasEvent:    meta?.hasEvent ?? false,
        uploadStatus: initialStatus,
        uploadedAt:   uploaded ? new Date() : null,
        uploadBucket: uploaded ? `icv-${integradorId}` : null,
      },
    })

    // ── 5. Upload async pra R2 (não bloqueia a resposta) ───────────
    // Em caso de sucesso: marca UPLOADED + uploadedAt + uploadBucket.
    // Em caso de falha: deixa PENDING + incrementa attempts + grava error.
    // Worker de retry (recording-upload-worker) re-tenta pendentes/falhos.
    if (!uploaded && recordingStorage.isCloudEnabled()) {
      recordingStorage.uploadToCloud(integradorId, relativePath)
        .then(async (ok) => {
          if (ok) {
            await prisma.recordingSegment.update({
              where: { id: segmentId },
              data: {
                uploadStatus:   'UPLOADED',
                uploadedAt:     new Date(),
                uploadBucket:   `icv-${integradorId}`,
                uploadAttempts: 1,
              },
            }).catch(() => {})
          } else {
            await prisma.recordingSegment.update({
              where: { id: segmentId },
              data: {
                uploadAttempts: { increment: 1 },
                uploadError:    'uploadToCloud returned false',
              },
            }).catch(() => {})
          }
        })
        .catch(async (err) => {
          logger.warn({ err, segmentId, relativePath }, 'recording_cloud_upload_async_failed')
          await prisma.recordingSegment.update({
            where: { id: segmentId },
            data: {
              uploadAttempts: { increment: 1 },
              uploadError:    String(err?.message ?? err).slice(0, 500),
            },
          }).catch(() => {})
        })
    }

    // ── 6. Log de ingest pra UI de monitoramento ───────────────────
    logCameraIngest(cameraId, 'INFO', 'segment_ingested', {
      segmentId, source, startedAt: startedAt.toISOString(),
      durationSec, sizeBytes, codec: meta?.codec ?? 'h264',
    }).catch(() => {})

    return {
      segmentId, storagePath: relativePath, persisted: 'created', endedAt, sizeBytes,
    }
  },

  /**
   * Falha de ingest — log explícito pra UI mostrar o motivo.
   */
  async logFailure(
    cameraId: string,
    source: IngestSource,
    reason: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await logCameraIngest(cameraId, 'ERROR', `segment_rejected: ${reason}`, {
      source, ...details,
    }).catch(() => {})
  },
}

/**
 * Log de ingest com contexto humano enriquecido. Os logs persistidos
 * carregam `cameraName + siteName + clienteFinalName + integradorName`
 * em `detailsJson` — abre query/dashboard sem JOIN e sobrevive a
 * renomeação posterior das entidades (denormalizado deliberadamente).
 */
async function logCameraIngest(
  cameraId: string,
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  details: Record<string, unknown>,
): Promise<void> {
  // Resolve contexto (cacheado 5min). Se falhar, log mesmo assim sem contexto.
  let context: Record<string, unknown> = {}
  try {
    const ctx = await getCameraContext(cameraId)
    if (ctx) {
      context = {
        cameraName:       ctx.cameraName,
        siteId:           ctx.siteId,
        siteName:         ctx.siteName,
        clienteFinalId:   ctx.clienteFinalId,
        clienteFinalName: ctx.clienteFinalName,
        integradorId:     ctx.integradorId,
        integradorName:   ctx.integradorName,
        edgeNodeId:       ctx.edgeNodeId,
        edgeNodeSerial:   ctx.edgeNodeSerial,
      }
    }
  } catch { /* não bloqueia ingest */ }

  await prisma.cameraLog.create({
    data: {
      cameraId,
      level,
      source:      'RECORDER',
      message,
      detailsJson: { ...context, ...details } as any,
      correlationId: typeof details.segmentId === 'string' ? details.segmentId : undefined,
    },
  })
}
