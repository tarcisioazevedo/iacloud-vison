/**
 * EventMaintainer — consome eventos do vsaas-ai-worker e gerencia o ciclo
 * de vida de DetectionEvent + ReviewSegment.
 *
 * Inspirado em frigate/events/maintainer.py + frigate/review/maintainer.py.
 *
 * Pipeline:
 *   worker → POST /detections/event { phase: "start" | "end", ...track }
 *   ↓
 *   handleStart()  → cria DetectionEvent (confirmed=true). Anexa/cria
 *                    ReviewSegment com severity baseada no label.
 *   ↓
 *   handleEnd()    → atualiza endTime, durationSec, frameCount, topScore,
 *                    medianScore, bestBbox, pathData. Fecha ReviewSegment
 *                    se não há outros tracks ativos.
 *
 * Regras de Review Segment (Frigate-style):
 *   - Severity "alert" se label in REVIEW_ALERT_LABELS (default: person, car,
 *     truck, motorcycle, bus). Severity escala mas nunca desce.
 *   - Tracks sobrepostos no tempo (mesma câmera, em janela de
 *     SEGMENT_GAP_SEC) vão pro MESMO ReviewSegment.
 *   - Se gap > SEGMENT_GAP_SEC desde o último event, cria novo Segment.
 */

import { prisma } from '../lib/prisma'
import { ReviewSeverity } from '@prisma/client'
import { logger } from '../lib/logger'

// Labels que disparam severity=alert (Frigate default: person, car)
const REVIEW_ALERT_LABELS = new Set([
  'person', 'car', 'truck', 'motorcycle', 'bus',
])

// Labels que disparam severity=detection (qualquer outro objectType COCO)
// Vazio = TODOS os labels não-alert. Pode ser restrito via Camera.reviewDetectionLabels (futuro).

// Gap máximo entre tracks pra serem agrupados no mesmo ReviewSegment.
const SEGMENT_GAP_SEC = 30

export interface WorkerEventPayload {
  cameraId:     string
  phase:        'start' | 'update' | 'end'
  trackId:      string
  objectType:   string
  startedAt:    string  // ISO Z
  lastSeenAt:   string
  endedAt:      string | null
  frames:       number
  topScore:     number
  medianScore:  number
  bestBbox:     { x: number; y: number; w: number; h: number }
  pathData:     Array<{ t: string; b: [number, number, number, number] }>
}

function severityForLabel(label: string): ReviewSeverity {
  return REVIEW_ALERT_LABELS.has(label) ? 'ALERT' : 'DETECTION'
}

/**
 * Acha um ReviewSegment "aberto" (endTime null OU endTime > startedAt - GAP)
 * pra essa câmera, ou cria um novo. Severity = max(existente, novo).
 */
async function attachOrCreateReviewSegment(
  cameraId: string,
  label: string,
  startedAt: Date,
): Promise<string> {
  const sev = severityForLabel(label)
  const gapDate = new Date(startedAt.getTime() - SEGMENT_GAP_SEC * 1000)

  // Procura segment ainda aberto ou recém-fechado (overlap dentro do gap).
  const existing = await prisma.reviewSegment.findFirst({
    where: {
      cameraId,
      OR: [
        { endTime: null },
        { endTime: { gte: gapDate } },
      ],
    },
    orderBy: { startTime: 'desc' },
  })

  if (existing) {
    // Update severity se subiu (ALERT > DETECTION > SIGNIFICANT)
    const newSeverity: ReviewSeverity =
      existing.severity === 'ALERT' || sev === 'ALERT' ? 'ALERT' : 'DETECTION'
    const newLabels = Array.from(new Set([...existing.labels, label]))
    await prisma.reviewSegment.update({
      where: { id: existing.id },
      data: {
        severity: newSeverity,
        labels: newLabels,
        // Reabre se estava fechado
        endTime: null,
      },
    })
    return existing.id
  }

  const created = await prisma.reviewSegment.create({
    data: {
      cameraId,
      severity: sev,
      startTime: startedAt,
      labels: [label],
    },
  })
  return created.id
}

/**
 * Handle event start — track foi confirmado pelo worker.
 * Cria DetectionEvent + atualiza ReviewSegment.
 */
export async function handleEventStart(
  p: WorkerEventPayload,
  modelInfo?: { hash?: string; type?: string },
): Promise<void> {
  const startedAt = new Date(p.startedAt)
  const segmentId = await attachOrCreateReviewSegment(p.cameraId, p.objectType, startedAt)

  await prisma.detectionEvent.upsert({
    where: { id: p.trackId },
    create: {
      id:             p.trackId,
      cameraId:       p.cameraId,
      trackId:        p.trackId,
      objectType:     p.objectType,
      startTime:      startedAt,
      frameCount:     p.frames,
      topScore:       p.topScore,
      medianScore:    p.medianScore,
      bestFrameIdx:   0,
      bestBboxX:      p.bestBbox.x,
      bestBboxY:      p.bestBbox.y,
      bestBboxW:      p.bestBbox.w,
      bestBboxH:      p.bestBbox.h,
      pathData:       p.pathData as any,
      modelHash:      modelInfo?.hash,
      modelType:      modelInfo?.type ?? 'yolov8n',
      detectorType:   'cloud-yolo',
      reviewSegmentId: segmentId,
    },
    // Idempotência: se o worker reenviar start (ex.: retry), atualiza fields voláteis.
    update: {
      frameCount:    p.frames,
      topScore:      p.topScore,
      medianScore:   p.medianScore,
      bestBboxX:     p.bestBbox.x,
      bestBboxY:     p.bestBbox.y,
      bestBboxW:     p.bestBbox.w,
      bestBboxH:     p.bestBbox.h,
      pathData:      p.pathData as any,
    },
  })

  logger.info({
    cameraId: p.cameraId, trackId: p.trackId, label: p.objectType,
    score: p.topScore, segmentId,
  }, 'event_start')
}

/**
 * Handle event end — track encerrou no worker.
 * Atualiza endTime, durationSec, e fecha o ReviewSegment se for o último.
 */
export async function handleEventEnd(
  p: WorkerEventPayload,
): Promise<void> {
  if (!p.endedAt) return

  const endedAt = new Date(p.endedAt)
  const startedAt = new Date(p.startedAt)
  const durationSec = (endedAt.getTime() - startedAt.getTime()) / 1000

  await prisma.detectionEvent.update({
    where: { id: p.trackId },
    data: {
      endTime:     endedAt,
      durationSec,
      frameCount:  p.frames,
      topScore:    p.topScore,
      medianScore: p.medianScore,
      bestBboxX:   p.bestBbox.x,
      bestBboxY:   p.bestBbox.y,
      bestBboxW:   p.bestBbox.w,
      bestBboxH:   p.bestBbox.h,
      pathData:    p.pathData as any,
    },
  }).catch(err => {
    // Pode acontecer se o worker disser "end" sem ter mandado "start" (race).
    logger.warn({ trackId: p.trackId, err: err.message }, 'event_end_no_start')
  })

  // Atualiza zonas acumuladas no segment (se houver) — TODO quando tivermos
  // zone intersection no worker
  const evt = await prisma.detectionEvent.findUnique({
    where: { id: p.trackId },
    select: { reviewSegmentId: true },
  })
  if (evt?.reviewSegmentId) {
    // Fecha segment se não há outros events ativos
    const stillOpen = await prisma.detectionEvent.count({
      where: { reviewSegmentId: evt.reviewSegmentId, endTime: null },
    })
    if (stillOpen === 0) {
      await prisma.reviewSegment.update({
        where: { id: evt.reviewSegmentId },
        data: { endTime: endedAt },
      })
    }
  }

  logger.info({
    cameraId: p.cameraId, trackId: p.trackId, label: p.objectType,
    durationSec, topScore: p.topScore, frames: p.frames,
  }, 'event_end')
}
