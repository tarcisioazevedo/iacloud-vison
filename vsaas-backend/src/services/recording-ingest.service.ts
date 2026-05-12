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

    // G15 fix (2026-05-09): trata P2002 (unique violation no
    // [cameraId, startedAt]) como deduplicação em vez de 500. Pode acontecer
    // quando duas requests concorrem com mesmo timestamp pre-tolerance.
    try {
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

      // 2026-05-12 fix: marca câmera como "online" a cada segment recebido.
      // camera-watchdog.service.ts usa Camera.lastOnlineAt para detectar
      // CAMERA_DOWN — antes desse fix, NADA atualizava o campo, fazendo
      // câmeras irem para ERROR forever (lastOnlineAt NULL → isOffline=true).
      // Fire-and-forget; falha aqui não deve quebrar o ingest do segment.
      prisma.camera.update({
        where: { id: cameraId },
        data:  { lastOnlineAt: new Date(), status: 'ACTIVE' },
      }).catch(err => logger.warn({ err, cameraId }, 'camera_lastOnline_update_failed'))

      // G19 fix: "snap" previous segment's endedAt to this segment's startedAt
      // to eliminate micro-gaps caused by edge boxes sending hardcoded durationSec=6
      // or keyframe drift. Only snap if the gap/overlap is between -5s and +15s.
      const prev = await prisma.recordingSegment.findFirst({
        where: { cameraId, startedAt: { lt: startedAt } },
        orderBy: { startedAt: 'desc' },
        select: { id: true, startedAt: true, endedAt: true, durationSec: true },
      })
      if (prev) {
        const gapMs = startedAt.getTime() - prev.endedAt.getTime()
        if (gapMs > -5000 && gapMs <= 15000) {
          const actualDurationSec = (startedAt.getTime() - prev.startedAt.getTime()) / 1000
          await prisma.recordingSegment.updateMany({
            where: { id: prev.id },
            data: { endedAt: startedAt, durationSec: actualDurationSec },
          }).catch(() => {})
          logger.debug({ segmentId: prev.id, gapMs, actualDurationSec }, 'recording_segment_gap_snapped_prev')
        }
      }

      // Snap CURRENT to NEXT (cobre casos de upload fora de ordem, onde este
      // segmento chegou atrasado e deixou um buraco com o que já estava lá na frente).
      const next = await prisma.recordingSegment.findFirst({
        where: { cameraId, startedAt: { gt: startedAt } },
        orderBy: { startedAt: 'asc' },
        select: { id: true, startedAt: true },
      })
      if (next) {
        const gapMs = next.startedAt.getTime() - endedAt.getTime()
        if (gapMs > -5000 && gapMs <= 15000) {
          const actualDurationSec = (next.startedAt.getTime() - startedAt.getTime()) / 1000
          await prisma.recordingSegment.updateMany({
            where: { id: segmentId },
            data: { endedAt: next.startedAt, durationSec: actualDurationSec },
          }).catch(() => {})
          logger.debug({ segmentId, gapMs, actualDurationSec }, 'recording_segment_gap_snapped_next')
        }
      }
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Race: outra request chegou simultânea e já criou. Busca o existente.
        const existing = await prisma.recordingSegment.findFirst({
          where: { cameraId, startedAt },
          select: { id: true, storagePath: true, endedAt: true, sizeBytes: true },
        })
        if (existing) {
          logCameraIngest(cameraId, 'WARN', 'segment_deduplicated_p2002', {
            segmentId: existing.id, source, startedAt: startedAt.toISOString(),
          }).catch(() => {})
          // Cleanup: arquivo já foi escrito acima — apaga (existente cobre).
          if (!uploaded) {
            const { promises: fsP } = await import('fs')
            await fsP.unlink(recordingStorage.absolutePath(relativePath)).catch(() => {})
          }
          return {
            segmentId:   existing.id,
            storagePath: existing.storagePath,
            persisted:   'deduplicated',
            endedAt:     existing.endedAt,
            sizeBytes:   Number(existing.sizeBytes),
          }
        }
      }
      throw err
    }

    // ── 5. Upload async pra R2 (não bloqueia a resposta) ───────────
    // Em caso de sucesso: marca UPLOADED + uploadedAt + uploadBucket.
    // Em caso de falha: deixa PENDING + incrementa attempts + grava error.
    // Worker de retry (recording-upload-worker) re-tenta pendentes/falhos.
    if (!uploaded && recordingStorage.isCloudEnabled()) {
      // Hardening 2026-05-09: status já é PENDING; em falha apenas incrementa
      // attempts (worker reprocessa). Em sucesso flip pra UPLOADED.
      // Mantém status PENDING explicitamente — não vira FAILED na 1ª falha.
      recordingStorage.uploadToCloud(integradorId, relativePath)
        .then(async (ok) => {
          if (ok) {
            await prisma.recordingSegment.updateMany({
              where: { id: segmentId },
              data: {
                uploadStatus:   'UPLOADED',
                uploadedAt:     new Date(),
                uploadBucket:   `icv-${integradorId}`,
                uploadAttempts: 1,
              },
            }).catch(() => {})
          } else {
            await prisma.recordingSegment.updateMany({
              where: { id: segmentId },
              data: {
                uploadAttempts: 1,
                uploadError:    'uploadToCloud returned false (will retry via worker)',
              },
            }).catch(() => {})
          }
        })
        .catch(async (err) => {
          logger.warn({ err, segmentId, relativePath }, 'recording_cloud_upload_async_failed')
          await prisma.recordingSegment.updateMany({
            where: { id: segmentId },
            data: {
              uploadAttempts: 1,
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
