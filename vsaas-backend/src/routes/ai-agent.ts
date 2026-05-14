/**
 * AI Agent Routes — chat conversacional sobre os events da câmera.
 *
 * POST /ai-agent/chat
 *   { history: [...], message: string }
 *   → { reply: string, toolsCalled: string[], newHistory: [...] }
 *
 * GET /ai-agent/stats
 *   → estado do GenAI (available, calls today, cap)
 */

import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError } from '../lib/errors'
import { chatTurn } from '../services/ai-agent.service'
import { genaiStats, describeLiveScene, readPlate, pointToObject, summarizePeriod } from '../services/genai.service'
import { prisma } from '../lib/prisma'
import { assertCameraBelongsToUser } from '../lib/tenant-scope'

export const aiAgentRouter = Router()

const GO2RTC_URL = process.env.EMBEDDED_GO2RTC_URL ?? 'http://go2rtc:1984'

async function fetchLiveFrame(streamId: string): Promise<Buffer | null> {
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

const HistoryMessageSchema = z.object({
  role: z.enum(['user', 'model']),
  parts: z.array(z.object({
    text: z.string().optional(),
    functionCall: z.any().optional(),
    functionResponse: z.any().optional(),
  })),
})

const ChatBody = z.object({
  history: z.array(HistoryMessageSchema).max(20).default([]),
  message: z.string().min(1).max(2000),
})

aiAgentRouter.post(
  '/chat',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = ChatBody.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const { history, message } = parse.data
    const jwt = req.jwtPayload

    const result = await chatTurn(
      history as any,
      message,
      {
        integradorId:   jwt?.integradorId ?? null,
        clienteFinalId: jwt?.clienteFinalId ?? null,
      },
    )

    const newHistory = [
      ...history,
      { role: 'user' as const, parts: [{ text: message }] },
      { role: 'model' as const, parts: [{ text: result.text ?? '' }] },
    ]

    res.json({
      reply: result.text,
      toolsCalled: result.toolsCalled,
      finishReason: result.finishReason,
      newHistory,
    })
  }),
)

aiAgentRouter.get(
  '/stats',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(genaiStats())
  }),
)

// =============================================================================
// GET /ai-agent/briefings — lista briefings diários do integrador do user logado
// =============================================================================

// =============================================================================
// POST /ai-agent/describe-live — Gemini descreve frame atual da câmera
// "O que está acontecendo agora na câmera X?"
// =============================================================================

const DescribeLiveBody = z.object({
  cameraId: z.string().uuid(),
  mode:     z.enum(['scene', 'plate']).default('scene'),
})

aiAgentRouter.post(
  '/describe-live',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = DescribeLiveBody.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const { cameraId, mode } = parse.data

    await assertCameraBelongsToUser(cameraId, req.jwtPayload)

    const cam = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { go2rtcStreamId: true },
    })
    const streamId = cam?.go2rtcStreamId ?? `cam-${cameraId}`
    const frame = await fetchLiveFrame(streamId)
    if (!frame) {
      throw new ValidationError('Câmera sem stream ativo — não foi possível capturar frame')
    }

    if (mode === 'scene') {
      const description = await describeLiveScene(frame)
      if (!description) {
        return res.status(503).json({ error: 'genai_unavailable' })
      }
      return res.json({ mode, description, frameSize: frame.length })
    } else {
      const result = await readPlate(frame)
      if (!result) {
        return res.status(503).json({ error: 'genai_unavailable' })
      }
      return res.json({ mode, ...result, frameSize: frame.length })
    }
  }),
)

// =============================================================================
// POST /ai-agent/point — Robotics-ER aponta objetos descritos no frame
// "Encontre o homem de moletom vermelho" → retorna [y,x] e bbox
// =============================================================================

const PointBody = z.object({
  cameraId: z.string().uuid(),
  query:    z.string().min(2).max(200),
})

aiAgentRouter.post(
  '/point',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = PointBody.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const { cameraId, query } = parse.data

    await assertCameraBelongsToUser(cameraId, req.jwtPayload)

    const cam = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { go2rtcStreamId: true },
    })
    const streamId = cam?.go2rtcStreamId ?? `cam-${cameraId}`
    const frame = await fetchLiveFrame(streamId)
    if (!frame) {
      throw new ValidationError('Câmera sem stream ativo — não foi possível capturar frame')
    }

    const result = await pointToObject(frame, query)
    if (!result) {
      return res.status(503).json({ error: 'genai_unavailable' })
    }

    // Robotics-ER retorna coords 0-1000. Normalizamos pra 0-1 (mesmo formato
    // dos zone/bbox no resto do sistema).
    const items = result.items.map(it => ({
      label: it.label,
      point: { y: it.point[0] / 1000, x: it.point[1] / 1000 },
      bbox: it.bbox ? {
        y: it.bbox[0] / 1000,
        x: it.bbox[1] / 1000,
        h: (it.bbox[2] - it.bbox[0]) / 1000,
        w: (it.bbox[3] - it.bbox[1]) / 1000,
      } : null,
      confidence: it.confidence ?? null,
    }))

    res.json({ query, count: items.length, items })
  }),
)

// =============================================================================
// POST /ai-agent/analyze-timeline — Gemini interpreta heatmap de events do dia
// "Resuma o que aconteceu nesta câmera neste dia"
// =============================================================================

const AnalyzeTimelineBody = z.object({
  cameraId: z.string().uuid(),
  day:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

aiAgentRouter.post(
  '/analyze-timeline',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = AnalyzeTimelineBody.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const { cameraId, day } = parse.data

    await assertCameraBelongsToUser(cameraId, req.jwtPayload)

    const from = new Date(`${day}T00:00:00Z`)
    const to   = new Date(`${day}T23:59:59Z`)

    // Stats por hora — tenta DetectionEvent primeiro, fallback DetectionFrame
    // (Event = track-grouped; Frame = raw 1fps). Sistema antigo tem só Frame.
    type Row = { hour: number; total: number; alerts: number }
    let rows = await prisma.$queryRaw<Row[]>`
      SELECT
        EXTRACT(HOUR FROM "startTime")::int AS hour,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "objectType" IN ('person','car','truck','motorcycle','bus'))::int AS alerts
      FROM "DetectionEvent"
      WHERE "cameraId" = ${cameraId}
        AND "startTime" >= ${from}
        AND "startTime" <= ${to}
        AND "falsePositive" = false
      GROUP BY 1
      ORDER BY 1
    `

    let usingFallback = false
    if (rows.length === 0) {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          EXTRACT(HOUR FROM "timestamp")::int AS hour,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE "objectType" IN ('person','car','truck','motorcycle','bus'))::int AS alerts
        FROM "DetectionFrame"
        WHERE "cameraId" = ${cameraId}
          AND "timestamp" >= ${from}
          AND "timestamp" <= ${to}
        GROUP BY 1
        ORDER BY 1
      `
      usingFallback = true
    }

    const byType = usingFallback
      ? await prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
          SELECT "objectType" AS type, COUNT(*)::bigint AS count
          FROM "DetectionFrame"
          WHERE "cameraId" = ${cameraId}
            AND "timestamp" >= ${from}
            AND "timestamp" <= ${to}
          GROUP BY 1 ORDER BY count DESC LIMIT 5
        `.then(r => r.map(x => ({ objectType: x.type, _count: Number(x.count) })))
      : await prisma.detectionEvent.groupBy({
          by: ['objectType'],
          where: { cameraId, startTime: { gte: from, lte: to }, falsePositive: false },
          _count: true,
          orderBy: { _count: { id: 'desc' } },
          take: 5,
        })

    const reviewSegmentsCount = await prisma.reviewSegment.count({
      where: { cameraId, startTime: { gte: from, lte: to } },
    })

    const totalEvents = rows.reduce((a, r) => a + r.total, 0)
    if (totalEvents === 0) {
      return res.json({
        analysis: 'Nenhum evento detectado neste dia. A câmera pode estar inativa, sem motion ou com IA desligada.',
        stats: { totalEvents: 0, reviewSegmentsCount: 0, hours: rows, byType: [] },
      })
    }

    const prompt = `
Você é um analista de CFTV. Analise a timeline de events deste dia e gere uma análise
factual em PT-BR, 4-6 frases, sobre PADRÕES e ANOMALIAS.

DADOS (dia: ${day}):
  • Total de events: ${totalEvents}
  • Review segments: ${reviewSegmentsCount}

  Distribuição por hora:
${rows.map(r => `    ${String(r.hour).padStart(2,'0')}:00 → ${r.total} events (${r.alerts} alerts)`).join('\n')}

  Top objetos detectados:
${byType.map(t => `    ${t.objectType}: ${t._count}`).join('\n')}

INSTRUÇÕES:
- Identifique horários de pico
- Aponte intervalos vazios suspeitos (ex: silêncio noturno em câmera comercial pode ser normal)
- Compare com expectativa de uso normal
- Se houver concentração anômala de "person" fora do horário comercial, destaque
- Termine com 1 recomendação acionável se aplicável
- Linguagem direta, sem floreios. Apenas fatos extraídos dos dados.
`.trim()

    const analysis = await summarizePeriod(prompt)
    if (!analysis) {
      return res.status(503).json({ error: 'genai_unavailable' })
    }

    res.json({
      analysis,
      stats: {
        totalEvents,
        reviewSegmentsCount,
        hours: rows,
        byType: byType.map(t => ({ type: t.objectType, count: t._count })),
      },
    })
  }),
)

aiAgentRouter.get(
  '/briefings',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { prisma } = await import('../lib/prisma')
    const jwt = req.jwtPayload
    const integradorId = jwt?.integradorId
    if (!integradorId) {
      return res.json({ briefings: [] })
    }

    const limit = Math.min(parseInt(String(req.query.limit ?? '14')), 30)
    const briefings = await prisma.detectionDailyBriefing.findMany({
      where: { integradorId },
      orderBy: { date: 'desc' },
      take: limit,
    })
    res.json({ briefings })
  }),
)
