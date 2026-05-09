/**
 * cloud-direct-ai.service.ts — Análise IA para câmeras CLOUD_DIRECT + enriquecimento Frigate.
 *
 * Cron (a cada CLOUD_DIRECT_AI_INTERVAL_SECS, padrão 10 min):
 *   1. Busca câmeras CLOUD_DIRECT ativas com go2rtcStreamId
 *   2. Captura JPEG do go2rtc (/api/frame.jpeg?src=KEY)
 *   3. Cloud Vision API → labels + objetos
 *   4. Gemini Flash → descrição PT-BR
 *   5. Grava AnalyticsEvent no banco
 *   6. Dispara WhatsApp se pessoa/veículo detectado e canal conectado
 *
 * enrichFrigateReview(reviewId):
 *   - Chamado async pelo endpoint POST /iacv-box/review-segments para reviews ALERT/DETECTION
 *   - Captura frame atual da câmera via go2rtc
 *   - Roda Gemini e atualiza FrigateReview.genaiTitle + genaiShortSummary + genaiConfidence
 */
import { prisma }         from '../lib/prisma'
import { logger }         from '../lib/logger'
import { visionService }  from './vision.service'
import { analyzeFrame }   from './gemini.service'
import * as evolution     from './evolution.service'

const EMBEDDED_GO2RTC_URL = (process.env.EMBEDDED_GO2RTC_URL ?? 'http://172.17.0.1:1984').replace(/\/$/, '')
const INTERVAL_MS = Number(process.env.CLOUD_DIRECT_AI_INTERVAL_SECS ?? 600) * 1000
const MAX_BATCH   = Number(process.env.CLOUD_DIRECT_AI_MAX_BATCH ?? 10)
const ENABLED     = process.env.CLOUD_DIRECT_AI_ENABLED !== 'false'

let timer: NodeJS.Timeout | null = null

export function startCloudDirectAICron(): void {
  if (!ENABLED) {
    logger.info('cloud_direct_ai_disabled')
    return
  }
  logger.info({ intervalSecs: INTERVAL_MS / 1000 }, 'cloud_direct_ai_cron_started')
  timer = setInterval(runBatch, INTERVAL_MS)
  // Primeira rodada com delay de 30s para não sobrecarregar o startup
  setTimeout(runBatch, 30_000)
}

export function stopCloudDirectAICron(): void {
  if (timer) { clearInterval(timer); timer = null }
}

async function runBatch(): Promise<void> {
  try {
    // Câmeras CLOUD_DIRECT ativas com stream registrado
    const cameras = await prisma.camera.findMany({
      where: {
        deploymentMode: 'CLOUD_DIRECT',
        active:         true,
        go2rtcStreamId: { not: null },
      },
      take: MAX_BATCH,
      select: {
        id: true, name: true, go2rtcStreamId: true,
        site: {
          select: {
            id: true, name: true, clienteFinalId: true,
            clienteFinal: {
              select: {
                id: true, name: true,
                notificationChannel: {
                  select: { instanceName: true, connectionState: true, recipients: true },
                },
              },
            },
          },
        },
      },
    })

    if (cameras.length === 0) return
    logger.debug({ count: cameras.length }, 'cloud_direct_ai_batch')

    for (const cam of cameras) {
      await analyzeCamera(cam).catch(err =>
        logger.warn({ cameraId: cam.id, err: err.message }, 'cloud_direct_ai_camera_error'),
      )
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'cloud_direct_ai_batch_error')
  }
}

async function analyzeCamera(cam: any): Promise<void> {
  const streamKey = cam.go2rtcStreamId as string
  const frameUrl  = `${EMBEDDED_GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(streamKey)}`

  // Captura JPEG
  let jpegBuf: Buffer
  try {
    const resp = await fetch(frameUrl, { signal: AbortSignal.timeout(8_000) })
    if (!resp.ok) {
      logger.debug({ cameraId: cam.id, status: resp.status }, 'cloud_direct_ai_no_frame')
      return
    }
    jpegBuf = Buffer.from(await resp.arrayBuffer())
  } catch {
    logger.debug({ cameraId: cam.id }, 'cloud_direct_ai_frame_timeout')
    return
  }

  if (jpegBuf.length < 1000) {
    logger.debug({ cameraId: cam.id, size: jpegBuf.length }, 'cloud_direct_ai_frame_too_small')
    return
  }

  const jpegB64 = jpegBuf.toString('base64')

  // Cloud Vision + Gemini em paralelo
  const [visionResult, geminiResult] = await Promise.allSettled([
    visionService.annotate(jpegB64, ['LABEL', 'OBJECT', 'SAFE_SEARCH']),
    analyzeFrame(jpegB64),
  ])

  const vision = visionResult.status === 'fulfilled' ? visionResult.value : null
  const gemini = geminiResult.status === 'fulfilled' ? geminiResult.value : null

  const visionLabels  = vision?.labels.map(l => l.description) ?? []
  const visionObjects = vision?.objects.map(o => o.name) ?? []
  const allLabels     = [...new Set([...visionLabels, ...visionObjects, ...(gemini?.labels ?? [])])]

  const hasPerson  = gemini?.hasPerson  ?? allLabels.some(l => ['person', 'people', 'man', 'woman'].includes(l.toLowerCase()))
  const hasVehicle = gemini?.hasVehicle ?? allLabels.some(l => ['car', 'vehicle', 'truck', 'motorcycle'].includes(l.toLowerCase()))

  const description = gemini?.description || (allLabels.length > 0 ? `Detectado: ${allLabels.slice(0, 3).join(', ')}` : 'Cena analisada')
  const eventType   = hasPerson ? 'PERSON_DETECTED' : hasVehicle ? 'VEHICLE_DETECTED' : 'SCENE_ANALYZED'
  const severity    = (hasPerson || hasVehicle) ? 'WARNING' : 'INFO'

  // Grava AnalyticsEvent
  const now = new Date()
  try {
    await prisma.analyticsEvent.create({
      data: {
        cameraId:      cam.id,
        model:         'GENAI_DESCRIPTION',
        pipeline:      'EDGE_HYBRID',
        eventType,
        severity,
        capturedAt:    now,
        personCount:   gemini?.personCount ?? (hasPerson ? 1 : 0),
        vehicleCount:  gemini?.vehicleCount ?? (hasVehicle ? 1 : 0),
        labelsJson:    allLabels,
        detectedObjectsJson: vision?.objects.map(o => ({ label: o.name, score: o.score, bbox: o.bbox })) ?? [],
        rawAnnotationsJson: {
          geminiDescription: gemini?.description,
          geminiLabels:      gemini?.labels,
          visionLabels:      vision?.labels.map(l => ({ description: l.description, score: l.score })),
          visionObjects:     vision?.objects.map(o => ({ name: o.name, score: o.score })),
        },
      },
    })
  } catch (err: any) {
    logger.warn({ err: err.message, cameraId: cam.id }, 'cloud_direct_ai_event_persist_error')
  }

  logger.info({
    cameraId: cam.id, eventType, description,
    personCount: gemini?.personCount, labels: allLabels.slice(0, 5),
  }, 'cloud_direct_ai_analyzed')

  // Dispara WhatsApp se evento relevante e canal conectado
  if ((hasPerson || hasVehicle) && cam.site?.clienteFinal?.notificationChannel) {
    await dispatchWhatsApp(cam, description, allLabels, now).catch(err =>
      logger.warn({ err: err.message, cameraId: cam.id }, 'cloud_direct_ai_whatsapp_error'),
    )
  }
}

async function dispatchWhatsApp(cam: any, description: string, labels: string[], capturedAt: Date): Promise<void> {
  const channel = cam.site?.clienteFinal?.notificationChannel
  if (!channel || channel.connectionState !== 'open') return

  const phones: string[] = channel.recipients ?? []
  if (phones.length === 0) return

  const hora = capturedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const data = capturedAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  const lines = [
    `🔔 *IA Cloud Vision — Detecção*`,
    `📷 ${cam.name}`,
    cam.site?.name ? `📍 ${cam.site.name}` : '',
    ``,
    `🤖 ${description}`,
    labels.length > 0 ? `🏷️ ${labels.slice(0, 5).join(', ')}` : '',
    ``,
    `🕐 ${data} às ${hora}`,
  ].filter(l => l !== undefined && l !== null)

  const message = lines.join('\n')

  for (const phone of phones.slice(0, 5)) {
    try {
      await evolution.sendText(channel.instanceName, phone, message)
    } catch (err: any) {
      logger.warn({ err: err.message, phone }, 'cloud_direct_ai_whatsapp_send_failed')
    }
  }

  logger.info({ cameraId: cam.id, phones: phones.length }, 'cloud_direct_ai_whatsapp_sent')
}

// ─────────────────────────────────────────────────────────────────────────────
// enrichFrigateReview — chamado async quando Box envia review via
// POST /iacv-box/review-segments. Captura frame atual da câmera e roda
// Gemini para preencher genaiTitle + genaiShortSummary + genaiConfidence.
// Fire-and-forget: erros são logados, nunca propagados ao caller.
// ─────────────────────────────────────────────────────────────────────────────
export async function enrichFrigateReview(reviewId: string): Promise<void> {
  try {
    const review = await prisma.frigateReview.findUnique({
      where:  { id: reviewId },
      select: {
        id: true, cameraId: true,
        camera: { select: { go2rtcStreamId: true, name: true } },
      },
    })
    if (!review?.camera?.go2rtcStreamId) {
      logger.debug({ reviewId }, 'frigate_genai_skip_no_stream')
      return
    }

    const streamKey = review.camera.go2rtcStreamId
    const frameUrl  = `${EMBEDDED_GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(streamKey)}`

    let jpegBuf: Buffer
    try {
      const resp = await fetch(frameUrl, { signal: AbortSignal.timeout(8_000) })
      if (!resp.ok) {
        logger.debug({ reviewId, status: resp.status }, 'frigate_genai_no_frame')
        return
      }
      jpegBuf = Buffer.from(await resp.arrayBuffer())
    } catch {
      logger.debug({ reviewId }, 'frigate_genai_frame_timeout')
      return
    }

    if (jpegBuf.length < 1000) return

    const gemini = await analyzeFrame(jpegBuf.toString('base64')).catch(() => null)
    if (!gemini || !gemini.description) return

    await prisma.frigateReview.update({
      where: { id: reviewId },
      data: {
        genaiTitle:              gemini.description.slice(0, 80),
        genaiShortSummary:       gemini.rawText.slice(0, 500),
        genaiConfidence:         gemini.hasPerson || gemini.hasVehicle ? 0.85 : 0.60,
        genaiPotentialThreatLevel: gemini.hasPerson ? (gemini.personCount > 2 ? 2 : 1) : 0,
      },
    })

    logger.info(
      { reviewId, cameraName: review.camera?.name, description: gemini.description },
      'frigate_genai_enriched',
    )
  } catch (err: any) {
    logger.warn({ err: err.message, reviewId }, 'frigate_genai_enrich_error')
  }
}
