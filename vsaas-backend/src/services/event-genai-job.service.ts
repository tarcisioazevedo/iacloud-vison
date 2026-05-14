/**
 * EventGenAIJob — processa DetectionEvents pendentes em background.
 *
 * Para cada event sem `descriptionGeneratedAt`:
 *  1. Pega 1-3 frames representativos do go2rtc snapshot (best frame primeiro)
 *  2. Chama gemini.describeEvent() → { description, attributes }
 *  3. Persiste em DetectionEvent (tsvector regenera automático via STORED)
 *
 * Para events com `medianScore < FP_THRESHOLD`:
 *  4. Chama gemini.classifyFalsePositive() → marca falsePositive=true se nao é real
 *
 * Roda como interval simples (30s). Em prod, considerar BullMQ/queue dedicado.
 */

import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import {
  describeEvent,
  classifyFalsePositive,
  readPlate,
  genaiAvailable,
} from './genai.service'

// Objetos que disparam tentativa de leitura de placa via Gemini Pro
const PLATE_OBJECT_TYPES = new Set(['car', 'truck', 'motorcycle', 'bus'])

const TICK_MS = Number(process.env.EVENT_GENAI_TICK_MS ?? 30_000)
const MAX_BATCH = Number(process.env.EVENT_GENAI_BATCH ?? 5)
const FP_THRESHOLD = Number(process.env.EVENT_FP_THRESHOLD ?? 0.7)
const GO2RTC_URL = process.env.EMBEDDED_GO2RTC_URL ?? 'http://go2rtc:1984'

let timer: NodeJS.Timeout | null = null
let running = false

async function fetchFrameFromGo2rtc(streamId: string): Promise<Buffer | null> {
  try {
    const r = await fetch(
      `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(streamId)}`,
      { signal: AbortSignal.timeout(3000) },
    )
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 1024) return null
    return buf
  } catch { return null }
}

async function describeOne(eventId: string): Promise<void> {
  const evt = await prisma.detectionEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true, objectType: true, medianScore: true,
      camera: { select: { go2rtcStreamId: true, id: true } },
    },
  })
  if (!evt) return

  const streamId = evt.camera.go2rtcStreamId ?? `cam-${evt.camera.id}`
  // Pega 1 frame atual — é uma aproximação (event já acabou). Versão completa
  // exigiria snapshot persistido em R2 antes deste job rodar.
  const frame = await fetchFrameFromGo2rtc(streamId)
  if (!frame) {
    // Marca como tentado pra não ficar em loop. Description vazia mas tsv válido.
    await prisma.detectionEvent.update({
      where: { id: eventId },
      data: {
        description: '',
        descriptionGeneratedAt: new Date(),
      },
    })
    return
  }

  // v1: 1 frame (live atual do go2rtc). v2 quando snapshot R2 estiver pronto:
  // pega start + mid + end frames pra entender AÇÃO ao longo do tempo.
  const result = await describeEvent([frame], evt.objectType)
  if (!result) {
    // Genai indisponível ou falhou — marca como tentado com timestamp pra não retry imediato
    await prisma.detectionEvent.update({
      where: { id: eventId },
      data: { descriptionGeneratedAt: new Date() },
    })
    return
  }

  // Atributos enriquecidos. Se Gemini detectou veículos, tenta OCR de placa.
  const attributes: any = { ...result.attributes }
  if (PLATE_OBJECT_TYPES.has(evt.objectType) && !attributes.plate_recognized) {
    const plate = await readPlate(frame)
    if (plate && plate.plate_text && plate.confidence > 0.5) {
      attributes.plate_recognized = {
        text: plate.plate_text,
        confidence: plate.confidence,
        vehicle_type: plate.vehicle_type,
        vehicle_color: plate.vehicle_color,
      }
      logger.info({
        eventId, plate: plate.plate_text, conf: plate.confidence,
      }, 'event_plate_recognized')
    }
  }

  await prisma.detectionEvent.update({
    where: { id: eventId },
    data: {
      description: result.description,
      descriptionAttributes: attributes,
      descriptionGeneratedAt: new Date(),
      // Se Gemini reconheceu placa, popula subLabel pra busca rápida
      subLabel: attributes.plate_recognized?.text ?? undefined,
      subLabelScore: attributes.plate_recognized?.confidence ?? undefined,
    },
  })

  logger.info({
    eventId, objectType: evt.objectType,
    descSnippet: result.description.slice(0, 80),
    plate: attributes.plate_recognized?.text ?? null,
  }, 'event_described')

  // Se medianScore baixo, dispara false-positive check em paralelo
  if (evt.medianScore < FP_THRESHOLD) {
    const fp = await classifyFalsePositive(frame, evt.objectType)
    if (fp) {
      await prisma.detectionEvent.update({
        where: { id: eventId },
        data: {
          falsePositive: !fp.is_real,
          fpCheckedAt: new Date(),
          fpReason: fp.is_real ? null : `${fp.what_it_is_really}: ${fp.reason}`,
        },
      })
      if (!fp.is_real) {
        logger.info({
          eventId, claimedLabel: evt.objectType,
          actuallyIs: fp.what_it_is_really,
        }, 'event_false_positive_filtered')
      }
    }
  }
}

async function tick(): Promise<void> {
  if (running) return
  if (!genaiAvailable()) return
  running = true
  try {
    const pending = await prisma.detectionEvent.findMany({
      where: {
        descriptionGeneratedAt: null,
        endTime: { not: null },           // só processa events fechados
        falsePositive: false,
      },
      orderBy: { endTime: 'desc' },
      take: MAX_BATCH,
      select: { id: true },
    })

    if (pending.length === 0) return

    logger.info({ count: pending.length }, 'event_genai_tick_start')
    // Processa em série (rate-friendly). Em paralelo se quiser e billing aguenta.
    for (const { id } of pending) {
      try { await describeOne(id) }
      catch (e: any) {
        logger.warn({ eventId: id, err: e.message }, 'event_describe_failed')
      }
    }
  } finally {
    running = false
  }
}

export const eventGenAIJob = {
  start(): void {
    if (timer) return
    if (!genaiAvailable()) {
      logger.warn('event_genai_job_disabled — no Gemini credentials')
      return
    }
    timer = setInterval(() => {
      tick().catch(err => logger.warn({ err: err.message }, 'event_genai_tick_failed'))
    }, TICK_MS)
    logger.info({ tickMs: TICK_MS, batch: MAX_BATCH }, 'event_genai_job_started')
  },
  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },
}
