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
import { ValidationError, ForbiddenError } from '../lib/errors'
import { chatTurn } from '../services/ai-agent.service'
import { genaiStats, describeLiveScene, readPlate, pointToObject, summarizePeriod } from '../services/genai.service'
import { prisma } from '../lib/prisma'
import { assertCameraBelongsToUser } from '../lib/tenant-scope'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { getAISystemConfig, setAISystemConfig } from '../services/ai-system-config.service'

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

// =============================================================================
// GET /ai-agent/settings — lê configurações IA do integrador
// =============================================================================
const GEMINI_MODELS = [
  { id: 'gemini-1.5-flash',       label: 'Gemini 1.5 Flash',       tier: 'fast'     },
  { id: 'gemini-1.5-flash-8b',    label: 'Gemini 1.5 Flash 8B',    tier: 'fast'     },
  { id: 'gemini-1.5-pro',         label: 'Gemini 1.5 Pro',         tier: 'balanced' },
  { id: 'gemini-2.0-flash',       label: 'Gemini 2.0 Flash',       tier: 'fast'     },
  { id: 'gemini-2.0-flash-lite',  label: 'Gemini 2.0 Flash Lite',  tier: 'fast'     },
  { id: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash Preview', tier: 'balanced' },
  { id: 'gemini-2.5-pro-preview-03-25',   label: 'Gemini 2.5 Pro Preview',   tier: 'powerful' },
]

aiAgentRouter.get(
  '/settings',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = req.jwtPayload
    const integradorId = jwt?.integradorId
    const isSuperAdmin = jwt?.role === 'SUPER_ADMIN'

    // SUPER_ADMIN → gerencia config GLOBAL do sistema (SystemConfig DB)
    if (isSuperAdmin && !integradorId) {
      const sys = await getAISystemConfig()
      const rawKey = sys.geminiApiKey
        ?? process.env.GEMINI_API_KEY
        ?? null
      const keyMasked = rawKey
        ? `${rawKey.slice(0, 8)}••••••••${rawKey.slice(-4)}`
        : null
      const keySource = sys.geminiApiKey ? 'system' : (process.env.GEMINI_API_KEY ? 'env' : 'secret_or_none')
      const stats = genaiStats()

      return res.json({
        scope: 'system',
        keyMasked,
        keySource,  // 'system' | 'env' | 'secret_or_none'
        keyConfigured: !!rawKey,
        geminiDefaultModel:       sys.geminiDefaultModel ?? 'gemini-2.5-flash',
        genaiPromptDefault:       sys.genaiPromptDefault ?? '',
        briefingGlobalKillswitch: sys.briefingGlobalKillswitch,
        availableModels: GEMINI_MODELS,
        stats,
      })
    }

    if (!integradorId) throw new ForbiddenError('Somente integradores podem acessar as configurações de IA')

    const integrador = await prisma.integrador.findUniqueOrThrow({
      where: { id: integradorId },
      select: {
        geminiApiKeyEnc: true,
        geminiDefaultModel: true,
        briefingEnabled: true,
        briefingHourBRT: true,
        genaiPromptDefault: true,
      },
    })

    // Cascata da chave para o integrador: própria → sistema → env → secret
    const sys = await getAISystemConfig()
    const tenantKey = integrador.geminiApiKeyEnc ? decryptSecret(integrador.geminiApiKeyEnc) : null
    const rawKey = tenantKey ?? sys.geminiApiKey ?? process.env.GEMINI_API_KEY ?? null
    const keyMasked = rawKey
      ? `${rawKey.slice(0, 8)}••••••••${rawKey.slice(-4)}`
      : null
    const keySource = tenantKey
      ? 'tenant'
      : sys.geminiApiKey
        ? 'system'
        : (process.env.GEMINI_API_KEY ? 'env' : 'secret_or_none')

    const stats = genaiStats()

    res.json({
      scope: 'tenant',
      keyMasked,
      keySource,  // 'tenant' | 'system' | 'env' | 'secret_or_none'
      keyConfigured: !!rawKey,
      geminiDefaultModel: integrador.geminiDefaultModel ?? sys.geminiDefaultModel ?? 'gemini-2.5-flash',
      briefingEnabled: integrador.briefingEnabled && !sys.briefingGlobalKillswitch,
      briefingGlobalKillswitch: sys.briefingGlobalKillswitch,
      briefingHourBRT: integrador.briefingHourBRT,
      genaiPromptDefault: integrador.genaiPromptDefault ?? '',
      availableModels: GEMINI_MODELS,
      stats,
    })
  }),
)

// =============================================================================
// PATCH /ai-agent/settings — atualiza configurações IA
//   SUPER_ADMIN → grava em SystemConfig (chave global, killswitch global)
//   INTEGRADOR  → grava em Integrador (chave própria, briefing do tenant)
// =============================================================================
const AISettingsPatchSchema = z.object({
  geminiApiKey:       z.string().min(20).max(200).optional(),  // nova chave em claro
  clearGeminiApiKey:  z.boolean().optional(),                   // remove chave tenant → usa global
  geminiDefaultModel: z.string().max(80).optional(),
  briefingEnabled:    z.boolean().optional(),
  briefingHourBRT:    z.number().int().min(0).max(23).optional(),
  genaiPromptDefault: z.string().max(2000).nullable().optional(),
  // Apenas SUPER_ADMIN — kill switch global de briefings.
  briefingGlobalKillswitch: z.boolean().optional(),
})

aiAgentRouter.patch(
  '/settings',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = req.jwtPayload
    const integradorId = jwt?.integradorId
    const isSuperAdmin = jwt?.role === 'SUPER_ADMIN'

    const parse = AISettingsPatchSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.issues[0].message)
    const body = parse.data

    // SUPER_ADMIN → branch SystemConfig (chave global do sistema)
    if (isSuperAdmin && !integradorId) {
      const result = await setAISystemConfig({
        geminiApiKey:             body.geminiApiKey,
        clearGeminiApiKey:        body.clearGeminiApiKey,
        geminiDefaultModel:       body.geminiDefaultModel,
        genaiPromptDefault:       body.genaiPromptDefault,
        briefingGlobalKillswitch: body.briefingGlobalKillswitch,
      })
      return res.json({ ok: true, changed: result.changed, scope: 'system' })
    }

    if (!integradorId) throw new ForbiddenError('Somente integradores podem editar configurações de IA')

    const data: Record<string, unknown> = {}

    if (body.clearGeminiApiKey) {
      data.geminiApiKeyEnc = null
    } else if (body.geminiApiKey) {
      data.geminiApiKeyEnc = encryptSecret(body.geminiApiKey)
    }

    if (body.geminiDefaultModel !== undefined) data.geminiDefaultModel = body.geminiDefaultModel
    if (body.briefingEnabled    !== undefined) data.briefingEnabled    = body.briefingEnabled
    if (body.briefingHourBRT    !== undefined) data.briefingHourBRT    = body.briefingHourBRT
    if (body.genaiPromptDefault !== undefined) data.genaiPromptDefault = body.genaiPromptDefault

    if (Object.keys(data).length === 0) {
      return res.json({ ok: true, changed: 0, scope: 'tenant' })
    }

    await prisma.integrador.update({ where: { id: integradorId }, data })
    res.json({ ok: true, changed: Object.keys(data).length, scope: 'tenant' })
  }),
)

// =============================================================================
// POST /ai-agent/briefing/generate — força geração imediata do briefing
// =============================================================================
aiAgentRouter.post(
  '/briefing/generate',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = req.jwtPayload
    const integradorId = jwt?.integradorId
    if (!integradorId) throw new ForbiddenError('Somente integradores podem gerar briefings')

    const { generateBriefingForIntegrador } = await import('../services/daily-briefing.service')
    const result = await generateBriefingForIntegrador(integradorId)
    res.json({ ok: true, briefing: result })
  }),
)
