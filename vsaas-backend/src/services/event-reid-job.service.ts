/**
 * EventReIDJob — cross-camera re-identification de events.
 *
 * Estratégia conservadora: quando um DetectionEvent (objectType=person) acaba
 * em cam A, procura events de mesma objectType em outras câmeras do mesmo
 * cliente final dentro de [endTime, endTime + REID_WINDOW_SEC].
 *
 * Pra cada candidato: Gemini Flash compara as 2 thumbnails atuais (proxy —
 * v2 puxa do R2 quando snapshot persistido).
 *
 * Se Gemini retorna same_subject=yes ou maybe com confidence > 0.6, marca
 * correlatedEventId em ambos.
 *
 * Custo: ~R$0,003 por comparação. Roda só quando há candidatos (não polling).
 */

import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { compareSubjects, genaiAvailable } from './genai.service'

const REID_WINDOW_SEC = Number(process.env.EVENT_REID_WINDOW_SEC ?? 30)
const REID_OBJECT_TYPES = (process.env.EVENT_REID_OBJECT_TYPES ?? 'person').split(',')
const REID_CONFIDENCE_MIN = Number(process.env.EVENT_REID_CONFIDENCE_MIN ?? 0.6)
const TICK_MS = Number(process.env.EVENT_REID_TICK_MS ?? 60_000)
const GO2RTC_URL = process.env.EMBEDDED_GO2RTC_URL ?? 'http://go2rtc:1984'

let timer: NodeJS.Timeout | null = null
let running = false

async function fetchFrame(streamId: string): Promise<Buffer | null> {
  try {
    const r = await fetch(
      `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(streamId)}`,
      { signal: AbortSignal.timeout(3000) },
    )
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.length > 1024 ? buf : null
  } catch { return null }
}

async function processOneEvent(eventId: string): Promise<void> {
  const evt = await prisma.detectionEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true, objectType: true, endTime: true,
      correlatedEventId: true,
      camera: {
        select: {
          id: true, go2rtcStreamId: true,
          site: { select: { clienteFinalId: true } },
        },
      },
    },
  })
  if (!evt || evt.correlatedEventId || !evt.endTime) return
  if (!evt.camera.site?.clienteFinalId) return

  // Candidatos: events de mesma objectType em OUTRAS câmeras do mesmo cliente final
  // dentro de [endTime, endTime + REID_WINDOW_SEC]
  const candidates = await prisma.detectionEvent.findMany({
    where: {
      objectType: evt.objectType,
      cameraId: { not: evt.camera.id },
      correlatedEventId: null,
      camera: {
        site: { clienteFinalId: evt.camera.site.clienteFinalId },
      },
      startTime: {
        gte: evt.endTime,
        lte: new Date(evt.endTime.getTime() + REID_WINDOW_SEC * 1000),
      },
    },
    orderBy: { startTime: 'asc' },
    take: 3,  // limita custo
    select: {
      id: true,
      camera: { select: { id: true, go2rtcStreamId: true } },
    },
  })

  if (candidates.length === 0) return

  const frameA = await fetchFrame(evt.camera.go2rtcStreamId ?? `cam-${evt.camera.id}`)
  if (!frameA) return

  for (const cand of candidates) {
    const frameB = await fetchFrame(cand.camera.go2rtcStreamId ?? `cam-${cand.camera.id}`)
    if (!frameB) continue

    const result = await compareSubjects(frameA, frameB, evt.objectType)
    if (!result) continue

    const matched =
      (result.same_subject === 'yes' && result.confidence >= REID_CONFIDENCE_MIN) ||
      (result.same_subject === 'maybe' && result.confidence >= REID_CONFIDENCE_MIN + 0.1)

    if (matched) {
      // Correlaciona ambos os events
      await prisma.$transaction([
        prisma.detectionEvent.update({
          where: { id: evt.id },
          data: {
            correlatedEventId: cand.id,
            correlatedConfidence: result.confidence,
            correlatedReason: result.reason.slice(0, 500),
          },
        }),
        prisma.detectionEvent.update({
          where: { id: cand.id },
          data: {
            correlatedEventId: evt.id,
            correlatedConfidence: result.confidence,
            correlatedReason: result.reason.slice(0, 500),
          },
        }),
      ])
      logger.info({
        eventA: evt.id, eventB: cand.id,
        objectType: evt.objectType,
        confidence: result.confidence,
      }, 'event_reid_matched')
      return  // já correlacionou, para
    }
  }
}

async function tick(): Promise<void> {
  if (running) return
  if (!genaiAvailable()) return
  running = true
  try {
    // Pega events recentes (últimos 5min), com objectType de interesse,
    // já fechados e ainda não correlacionados.
    const fromTime = new Date(Date.now() - 5 * 60 * 1000)
    const pending = await prisma.detectionEvent.findMany({
      where: {
        objectType: { in: REID_OBJECT_TYPES },
        endTime: { gte: fromTime, not: null },
        correlatedEventId: null,
        falsePositive: false,
      },
      orderBy: { endTime: 'desc' },
      take: 10,
      select: { id: true },
    })

    if (pending.length === 0) return

    logger.debug({ count: pending.length }, 'event_reid_tick_start')
    for (const { id } of pending) {
      try { await processOneEvent(id) }
      catch (e: any) {
        logger.warn({ eventId: id, err: e.message }, 'event_reid_failed')
      }
    }
  } finally {
    running = false
  }
}

export const eventReIDJob = {
  start(): void {
    if (timer) return
    if (!genaiAvailable()) {
      logger.warn('event_reid_job_disabled — no Gemini credentials')
      return
    }
    timer = setInterval(() => {
      tick().catch(err => logger.warn({ err: err.message }, 'event_reid_tick_failed'))
    }, TICK_MS)
    logger.info({
      tickMs: TICK_MS, windowSec: REID_WINDOW_SEC,
      objectTypes: REID_OBJECT_TYPES,
    }, 'event_reid_job_started')
  },
  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },
}
