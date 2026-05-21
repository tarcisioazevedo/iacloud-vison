/**
 * Detections Routes — bounding boxes para motion search por zona (Alt 3).
 *
 * POST /detections/ingest              → bulk insert (edge node OU ai-worker)
 * GET  /detections/ai-cameras          → lista câmeras com aiEnabled=true (ai-worker auth)
 * POST /detections/zone-search         → busca por interseção bbox × zonas (operador)
 *
 * Para zone-search, a interseção é computada via Prisma com AND/OR (em vez
 * de raw SQL para manter portabilidade e parametrização segura).
 *
 *   bbox intersecta zona quando:
 *     bboxX < zoneX + zoneW   (bbox começa antes do fim da zona)
 *     bboxX + bboxW > zoneX   (bbox termina depois do início da zona)
 *     bboxY < zoneY + zoneH
 *     bboxY + bboxH > zoneY
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { requireEdgeOrAiWorkerAuth, requireAiWorkerAuth } from '../middleware/ai-worker-auth'
import { asyncHandler } from '../middleware/async-handler'
import { cameraTenantWhere, assertCameraBelongsToUser } from '../lib/tenant-scope'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'
import { markSegmentMotion } from '../services/recording.service'
import { logger } from '../lib/logger'
import {
  handleEventStart,
  handleEventEnd,
  type WorkerEventPayload,
} from '../services/event-maintainer.service'
import { buildEventM3u8 } from '../services/event-clip.service'

export const detectionsRouter = Router()

// =============================================================================
// POST /detections/ingest — chamado pelo edge node, NÃO pelo operador.
// Auth: requireEdgeAuth (Bearer apiToken do EdgeNode).
// =============================================================================

const FrameSchema = z.object({
  timestamp:  z.string().datetime(),
  objectType: z.string().min(1).max(64),
  bboxX:      z.number().min(0).max(1),
  bboxY:      z.number().min(0).max(1),
  bboxW:      z.number().min(0).max(1),
  bboxH:      z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional().nullable(),
  trackId:    z.string().max(64).optional().nullable(),
  segmentId:  z.string().uuid().optional().nullable(),
})

const IngestSchema = z.object({
  cameraId: z.string().uuid(),
  frames:   z.array(FrameSchema).min(1).max(1000),
})

detectionsRouter.post(
  '/ingest',
  requireEdgeOrAiWorkerAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = IngestSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const { cameraId, frames } = parse.data

    // AI worker não tem siteId — apenas valida que a câmera existe e tem aiEnabled.
    // Edge node: valida que a câmera pertence ao site do node (defense in depth).
    if (req.aiWorkerAuthenticated) {
      const cam = await prisma.camera.findFirst({
        where: { id: cameraId, active: true },
        select: { id: true, aiEnabled: true },
      })
      if (!cam) throw new ForbiddenError('Câmera não encontrada')
      if (!cam.aiEnabled) throw new ForbiddenError('IA não habilitada para esta câmera')
    } else {
      const edge = req.edgeNode
      if (!edge) throw new ForbiddenError('Edge auth ausente')
      const cam = await prisma.camera.findFirst({
        where: { id: cameraId, siteId: edge.siteId },
        select: { id: true },
      })
      if (!cam) throw new ForbiddenError('Câmera não pertence ao site do edge node')
    }

    const result = await prisma.detectionFrame.createMany({
      data: frames.map(f => ({
        cameraId,
        segmentId:  f.segmentId ?? null,
        timestamp:  new Date(f.timestamp),
        objectType: f.objectType,
        bboxX:      f.bboxX,
        bboxY:      f.bboxY,
        bboxW:      f.bboxW,
        bboxH:      f.bboxH,
        confidence: f.confidence ?? null,
        trackId:    f.trackId ?? null,
      })),
    })

    // Marca segmentos sobrepostos como tendo motion. Usa min/max do batch.
    if (frames.length > 0) {
      const minTs = new Date(Math.min(...frames.map(f => +new Date(f.timestamp))))
      const maxTs = new Date(Math.max(...frames.map(f => +new Date(f.timestamp))))
      markSegmentMotion(cameraId, minTs, maxTs, 'motion')
        .catch(() => {})
    }

    res.status(201).json({ ok: true, inserted: result.count })
  }),
)

// =============================================================================
// POST /detections/zone-search — busca por interseção bbox × zonas
// =============================================================================

const ZoneSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
})

const ZoneSearchSchema = z.object({
  cameraId:    z.string().uuid(),
  from:        z.string().datetime(),
  to:          z.string().datetime(),
  zones:       z.array(ZoneSchema).min(1).max(10),
  objectTypes: z.array(z.string().min(1).max(64)).max(20).optional(),
  limit:       z.number().int().min(1).max(500).optional().default(50),
  offset:      z.number().int().min(0).max(50_000).optional().default(0),
}).refine(b => new Date(b.to) > new Date(b.from), {
  message: 'to deve ser depois de from',
})

detectionsRouter.post(
  '/zone-search',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = ZoneSearchSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const b = parse.data

    // Tenant scope: a câmera tem que pertencer ao usuário.
    await assertCameraBelongsToUser(b.cameraId, req.jwtPayload)
    const tenantWhere = cameraTenantWhere(req.jwtPayload)

    // OR de interseções (1 entrada por zona). Use AND lógico explícito para
    // o Prisma — a sintaxe { lt, gt } em colunas distintas exige objetos
    // separados via composição.
    //
    // Para "bboxX + bboxW > zone.x" usamos raw via $queryRaw — o Prisma não
    // expressa expressões aritméticas em filtros padrão.
    //
    // Estratégia: usamos $queryRawUnsafe NÃO — só $queryRaw com Prisma.sql
    // para ficar parametrizado e seguro.
    const fromDate = new Date(b.from)
    const toDate   = new Date(b.to)

    // Constrói clausula OR com placeholders parametrizados.
    // Usamos prisma.$queryRaw com tagged template e Prisma.sql para juntar.
    const { Prisma } = await import('@prisma/client')

    const orClauses = b.zones.map(z =>
      Prisma.sql`(
        "bboxX" < ${z.x + z.w}
        AND "bboxX" + "bboxW" > ${z.x}
        AND "bboxY" < ${z.y + z.h}
        AND "bboxY" + "bboxH" > ${z.y}
      )`,
    )

    const zoneOr = orClauses.length === 1
      ? orClauses[0]
      : Prisma.sql`(${Prisma.join(orClauses, ' OR ')})`

    const objectTypeClause = b.objectTypes && b.objectTypes.length > 0
      ? Prisma.sql`AND "objectType" IN (${Prisma.join(b.objectTypes)})`
      : Prisma.sql``

    type Row = {
      timestamp:  Date
      objectType: string
      confidence: number | null
      bboxX:      number
      bboxY:      number
      bboxW:      number
      bboxH:      number
      segmentId:  string | null
    }

    // Conta total antes da paginação (necessário pra UI saber quantas páginas)
    const totalRow = await prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "DetectionFrame"
      WHERE "cameraId" = ${b.cameraId}
        AND "timestamp" >= ${fromDate}
        AND "timestamp" <= ${toDate}
        AND ${zoneOr}
        ${objectTypeClause}
    `)
    const totalCount = Number(totalRow[0]?.count ?? 0)

    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "timestamp", "objectType", "confidence",
             "bboxX", "bboxY", "bboxW", "bboxH", "segmentId"
      FROM "DetectionFrame"
      WHERE "cameraId" = ${b.cameraId}
        AND "timestamp" >= ${fromDate}
        AND "timestamp" <= ${toDate}
        AND ${zoneOr}
        ${objectTypeClause}
      ORDER BY "timestamp" DESC
      LIMIT ${b.limit}
      OFFSET ${b.offset}
    `)

    // Defense-in-depth: confirma que a câmera ainda passa o filtro tenant
    // (o assertCameraBelongsToUser acima já cobre, mas mantém o where
    // disponível para futuras expansões).
    void tenantWhere

    res.json({
      cameraId: b.cameraId,
      from:     fromDate.toISOString(),
      to:       toDate.toISOString(),
      zones:    b.zones,
      total:    totalCount,        // ← total real (não só desta página)
      pageSize: b.limit,
      offset:   b.offset,
      detections: rows.map(r => ({
        timestamp:  r.timestamp.toISOString(),
        objectType: r.objectType,
        confidence: r.confidence,   // ← agora vem do banco
        bboxX:      r.bboxX,
        bboxY:      r.bboxY,
        bboxW:      r.bboxW,
        bboxH:      r.bboxH,
        segmentId:  r.segmentId,
      })),
    })
  }),
)

// =============================================================================
// GET /detections/ai-cameras — lista câmeras com aiEnabled=true para o worker
// Auth: requireAiWorkerAuth (Bearer AI_WORKER_SECRET)
// Retorna: [{id, go2rtcStreamId, rtspMainUrl, rtspSubUrl, aiConfidenceMin, integradorId}]
// O worker usa go2rtcStreamId para montar rtsp://go2rtc:8554/{streamId}
// =============================================================================
detectionsRouter.get(
  '/ai-cameras',
  requireAiWorkerAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const cameras = await prisma.camera.findMany({
      where: { aiEnabled: true, active: true },
      select: {
        id:                  true,
        name:                true,
        go2rtcStreamId:      true,
        rtspMainUrl:         true,
        rtspSubUrl:          true,
        aiConfidenceMin:     true,
        // Sprint 1-6: configuração de modelos especialistas por câmera
        aiSpecialistModels:  true,
        lprWatchlist:        true,
        ppeZoneJson:         true,
        site: {
          select: {
            clienteFinal: {
              select: { integrador: { select: { id: true } } },
            },
          },
        },
      },
    })
    res.json({
      cameras: cameras.map(c => ({
        id:              c.id,
        name:            c.name,
        streamId:        c.go2rtcStreamId ?? c.id,
        rtspMainUrl:     c.rtspMainUrl ?? null,
        rtspSubUrl:      c.rtspSubUrl ?? null,
        aiConfidenceMin: c.aiConfidenceMin,
        aiSpecialistModels: c.aiSpecialistModels ?? [],
        lprWatchlist:    c.lprWatchlist ?? [],
        ppeZoneJson:     c.ppeZoneJson ?? null,
        integradorId:    c.site?.clienteFinal?.integrador?.id ?? null,
      })),
    })
  }),
)

// =============================================================================
// POST /detections/event — recebe track start/update/end do vsaas-ai-worker.
// Auth: requireAiWorkerAuth. Cria DetectionEvent + atualiza ReviewSegment.
// =============================================================================

const BboxSchema = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
})

const PathPointSchema = z.object({
  t: z.string().datetime(),
  b: z.array(z.number()).length(4),
})

const EventPayloadSchema = z.object({
  cameraId:      z.string().uuid(),
  phase:         z.enum(['start', 'update', 'end']),
  trackId:       z.string().uuid(),
  objectType:    z.string().min(1).max(64),
  startedAt:     z.string().datetime(),
  lastSeenAt:    z.string().datetime(),
  endedAt:       z.string().datetime().nullable().optional(),
  frames:        z.number().int().nonnegative(),
  topScore:      z.number().min(0).max(1),
  medianScore:   z.number().min(0).max(1),
  bestBbox:      BboxSchema,
  pathData:      z.array(PathPointSchema).max(500),
})

detectionsRouter.post(
  '/event',
  requireAiWorkerAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = EventPayloadSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const p = parse.data as WorkerEventPayload

    // Valida que a câmera existe e tem aiEnabled (defesa em profundidade)
    const cam = await prisma.camera.findFirst({
      where: { id: p.cameraId, active: true },
      select: { id: true, aiEnabled: true },
    })
    if (!cam) throw new ForbiddenError('Câmera não encontrada')
    if (!cam.aiEnabled) throw new ForbiddenError('IA não habilitada para esta câmera')

    if (p.phase === 'start') {
      await handleEventStart(p)
    } else if (p.phase === 'end') {
      await handleEventEnd(p)
    }
    // phase=update fica como noop por enquanto — worker só manda end.

    res.json({ ok: true })
  }),
)

// =============================================================================
// POST /detections/specialist-event — eventos de modelos especialistas Roboflow.
// Sprint 1-6 plano 25 (Weapon, LPR, PPE, Helmet, Fall, Crowd).
// =============================================================================

const SpecialistEventSchema = z.object({
  cameraId:   z.string().uuid(),
  modelType:  z.enum(['weapon', 'lpr', 'ppe', 'helmet', 'fall', 'crowd']),
  confidence: z.number().min(0).max(1),
  payload:    z.record(z.string(), z.any()),
  trackId:    z.string().nullable().optional(),
  bbox:       z.array(z.number()).length(4).nullable().optional(),
  /// JPEG crop em base64 (sem prefixo data:), opcional. Quando presente E
  /// modelType='lpr', dispara OCR via genai.readPlate + processPlateRead.
  cropB64:    z.string().nullable().optional(),
})

detectionsRouter.post(
  '/specialist-event',
  requireAiWorkerAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = SpecialistEventSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const p = parse.data

    const cam = await prisma.camera.findFirst({
      where: { id: p.cameraId, active: true, aiEnabled: true },
      select: { id: true },
    })
    if (!cam) throw new ForbiddenError('Câmera não encontrada ou IA desabilitada')

    const ev = await prisma.specialistDetection.create({
      data: {
        cameraId:   p.cameraId,
        modelType:  p.modelType,
        confidence: p.confidence,
        payload:    {
          ...p.payload,
          trackId: p.trackId ?? null,
          bbox:    p.bbox ?? null,
        },
      },
      select: { id: true, modelType: true, detectedAt: true },
    })

    // ── LPR pipeline integrada (Sprint Onda 1 IA) ──────────────────────────
    // Quando worker detecta placa via Roboflow specialist E envia crop,
    // chama Gemini readPlate -> processPlateRead (reusa /plates/events/ingest
    // logic: match aproximado + dispatch alerta multi-canal).
    let lprResult: { plate: string; matched: boolean } | null = null
    if (p.modelType === 'lpr' && p.cropB64) {
      try {
        const { readPlate } = await import('../services/genai.service')
        const { processPlateRead } = await import('../services/lpr.service')
        const buf = Buffer.from(p.cropB64, 'base64')
        const plateResult = await readPlate(buf)
        if (plateResult?.plate_text) {
          const ingest = await processPlateRead({
            cameraId:      p.cameraId,
            detectedPlate: plateResult.plate_text,
            ocrScore:      plateResult.confidence ?? p.confidence,
            vehicleType:   plateResult.vehicle_type ?? (p.payload?.vehicleType as string) ?? null,
            vehicleColor:  plateResult.vehicle_color ?? null,
            capturedAt:    new Date(),
            bbox:          p.bbox ? { x: p.bbox[0], y: p.bbox[1], w: p.bbox[2], h: p.bbox[3] } : null,
          })
          if (ingest) {
            lprResult = { plate: ingest.event.detectedPlate, matched: !!ingest.matched }
          }
        }
      } catch (err: any) {
        // não bloqueia ack do specialist-event
        logger.warn({ err: err?.message, cameraId: p.cameraId }, 'lpr_ocr_pipeline_failed')
      }
    }

    res.json({ ok: true, id: ev.id, detectedAt: ev.detectedAt, lpr: lprResult })
  }),
)

// =============================================================================
// GET /detections/events — lista DetectionEvents filtrados (UI da motion-search).
// Auth: requireAuth. Filtros: cameraId, from, to, objectType, severity (via segment).
// =============================================================================

const EventsListQuery = z.object({
  cameraId:    z.string().uuid().optional(),
  from:        z.string().datetime().optional(),
  to:          z.string().datetime().optional(),
  objectType:  z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(500).optional().default(100),
  cursor:      z.string().uuid().optional(),
})

detectionsRouter.get(
  '/events',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = EventsListQuery.safeParse(req.query)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'query'}: ${first.message}`)
    }
    const q = parse.data

    if (q.cameraId) {
      await assertCameraBelongsToUser(q.cameraId, req.jwtPayload)
    }
    const tenantWhere = cameraTenantWhere(req.jwtPayload)

    const events = await prisma.detectionEvent.findMany({
      where: {
        ...(q.cameraId ? { cameraId: q.cameraId } : {}),
        ...(q.objectType ? { objectType: q.objectType } : {}),
        ...(q.from || q.to ? {
          startTime: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to   ? { lte: new Date(q.to)   } : {}),
          },
        } : {}),
        camera: tenantWhere,
        falsePositive: false,
      },
      orderBy: { startTime: 'desc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true, cameraId: true, objectType: true, subLabel: true,
        startTime: true, endTime: true, durationSec: true,
        frameCount: true, topScore: true, medianScore: true,
        bestBboxX: true, bestBboxY: true, bestBboxW: true, bestBboxH: true,
        enteredZones: true, thumbnailKey: true, hasClip: true,
        reviewSegmentId: true,
      },
    })

    const hasMore = events.length > q.limit
    const items = hasMore ? events.slice(0, q.limit) : events
    res.json({
      events: items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    })
  }),
)

// =============================================================================
// GET /detections/event/:id/clip.m3u8 — playlist HLS pro player do cockpit.
// Auth: requireAuth + tenant scope via cameraId do event.
// =============================================================================

detectionsRouter.get(
  '/event/:id/clip.m3u8',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id
    const evt = await prisma.detectionEvent.findUnique({
      where: { id },
      select: { cameraId: true },
    })
    if (!evt) throw new NotFoundError('DetectionEvent')
    await assertCameraBelongsToUser(evt.cameraId, req.jwtPayload)

    const built = await buildEventM3u8(id)
    res.set('Content-Type', 'application/vnd.apple.mpegurl')
    res.set('Cache-Control', 'private, max-age=10')
    res.send(built.m3u8)
  }),
)

// =============================================================================
// GET /detections/timeline-heatmap — densidade de events por hora num dia.
// Usado pela timeline 24h do cockpit (heatmap colorido + bookmarks).
// =============================================================================

const HeatmapQuery = z.object({
  cameraId: z.string().uuid(),
  day:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

detectionsRouter.get(
  '/timeline-heatmap',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = HeatmapQuery.safeParse(req.query)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'query'}: ${first.message}`)
    }
    const { cameraId, day } = parse.data

    await assertCameraBelongsToUser(cameraId, req.jwtPayload)

    const from = new Date(`${day}T00:00:00Z`)
    const to   = new Date(`${day}T23:59:59Z`)

    // Agrupa por hora (UTC). Tenta DetectionEvent (track-grouped) primeiro.
    // Fallback DetectionFrame (raw 1fps) quando Event ainda não foi populado
    // — comum no início do uso enquanto o EventMaintainer não rodou.
    type Row = { hour: number; total: number; alerts: number }
    let rows = await prisma.$queryRaw<Row[]>`
      SELECT
        EXTRACT(HOUR FROM "startTime")::int AS hour,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "objectType" IN ('person', 'car', 'truck', 'motorcycle', 'bus'))::int AS alerts
      FROM "DetectionEvent"
      WHERE "cameraId" = ${cameraId}
        AND "startTime" >= ${from}
        AND "startTime" <= ${to}
        AND "falsePositive" = false
      GROUP BY 1
      ORDER BY 1
    `

    let source: 'event' | 'frame' = 'event'
    if (rows.length === 0) {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          EXTRACT(HOUR FROM "timestamp")::int AS hour,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE "objectType" IN ('person', 'car', 'truck', 'motorcycle', 'bus'))::int AS alerts
        FROM "DetectionFrame"
        WHERE "cameraId" = ${cameraId}
          AND "timestamp" >= ${from}
          AND "timestamp" <= ${to}
        GROUP BY 1
        ORDER BY 1
      `
      source = 'frame'
    }

    // Preenche 24 horas com zeros pra UI não precisar fazer
    const hours: Array<{ hour: number; total: number; alerts: number }> = []
    for (let h = 0; h < 24; h++) {
      const r = rows.find(x => x.hour === h)
      hours.push({ hour: h, total: r?.total ?? 0, alerts: r?.alerts ?? 0 })
    }

    res.json({ day, cameraId, hours, source })
  }),
)

// =============================================================================
// GET /detections/search-description — full-text PT-BR sobre descrições GenAI.
// Usado pela aba "Por descrição" do cockpit.
// =============================================================================

const DescSearchQuery = z.object({
  cameraId: z.string().uuid().optional(),
  query:    z.string().min(2).max(200),
  from:     z.string().datetime().optional(),
  to:       z.string().datetime().optional(),
  limit:    z.coerce.number().int().min(1).max(100).optional().default(30),
})

detectionsRouter.get(
  '/search-description',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = DescSearchQuery.safeParse(req.query)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'query'}: ${first.message}`)
    }
    const q = parse.data

    if (q.cameraId) {
      await assertCameraBelongsToUser(q.cameraId, req.jwtPayload)
    }
    // Tenant scope na query raw
    const jwt = req.jwtPayload
    const integradorId = jwt?.integradorId ?? null
    const clienteFinalId = jwt?.clienteFinalId ?? null

    type Row = {
      id: string; cameraId: string; objectType: string;
      startTime: Date; endTime: Date | null; durationSec: number | null;
      topScore: number; description: string; cameraName: string;
      rank: number;
    }

    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        de.id, de."cameraId", de."objectType",
        de."startTime", de."endTime", de."durationSec",
        de."topScore", de.description,
        c.name as "cameraName",
        ts_rank(de."descriptionTsv", plainto_tsquery('portuguese', ${q.query})) as rank
      FROM "DetectionEvent" de
      JOIN "Camera" c ON c.id = de."cameraId"
      LEFT JOIN "Site" s ON s.id = c."siteId"
      LEFT JOIN "ClienteFinal" cf ON cf.id = s."clienteFinalId"
      WHERE de."descriptionTsv" @@ plainto_tsquery('portuguese', ${q.query})
        AND de."falsePositive" = false
        ${q.cameraId ? Prisma.sql`AND de."cameraId" = ${q.cameraId}` : Prisma.empty}
        ${q.from ? Prisma.sql`AND de."startTime" >= ${new Date(q.from)}` : Prisma.empty}
        ${q.to   ? Prisma.sql`AND de."startTime" <= ${new Date(q.to)}` : Prisma.empty}
        ${integradorId ? Prisma.sql`AND cf."integradorId" = ${integradorId}` : Prisma.empty}
        ${clienteFinalId ? Prisma.sql`AND s."clienteFinalId" = ${clienteFinalId}` : Prisma.empty}
      ORDER BY rank DESC, de."startTime" DESC
      LIMIT ${q.limit}
    `

    res.json({
      query: q.query,
      total: rows.length,
      results: rows.map(r => ({
        id: r.id,
        cameraId: r.cameraId,
        cameraName: r.cameraName,
        objectType: r.objectType,
        startTime: r.startTime.toISOString(),
        endTime: r.endTime?.toISOString() ?? null,
        durationSec: r.durationSec,
        topScore: r.topScore,
        description: r.description,
        relevance: r.rank,
      })),
    })
  }),
)

// =============================================================================
// GET /detections/review-segments — lista cards de ReviewSegment para o cockpit.
// Operador navega por estes (~10-50/dia/cam) em vez de events crus (~500/dia).
// =============================================================================

const ReviewListQuery = z.object({
  cameraId:   z.string().uuid().optional(),
  from:       z.string().datetime().optional(),
  to:         z.string().datetime().optional(),
  severity:   z.enum(['ALERT', 'DETECTION', 'SIGNIFICANT']).optional(),
  reviewed:   z.coerce.boolean().optional(),
  limit:      z.coerce.number().int().min(1).max(200).optional().default(50),
})

detectionsRouter.get(
  '/review-segments',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = ReviewListQuery.safeParse(req.query)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'query'}: ${first.message}`)
    }
    const q = parse.data

    if (q.cameraId) {
      await assertCameraBelongsToUser(q.cameraId, req.jwtPayload)
    }
    const tenantWhere = cameraTenantWhere(req.jwtPayload)

    const segments = await prisma.reviewSegment.findMany({
      where: {
        ...(q.cameraId ? { cameraId: q.cameraId } : {}),
        ...(q.severity ? { severity: q.severity } : {}),
        ...(q.reviewed != null ? { reviewed: q.reviewed } : {}),
        ...(q.from || q.to ? {
          startTime: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to   ? { lte: new Date(q.to)   } : {}),
          },
        } : {}),
        camera: tenantWhere,
      },
      orderBy: { startTime: 'desc' },
      take: q.limit,
      select: {
        id: true, cameraId: true, severity: true,
        startTime: true, endTime: true,
        labels: true, zones: true, thumbnailKey: true,
        reviewed: true, reviewedAt: true,
        events: {
          select: { id: true, objectType: true, topScore: true, startTime: true, durationSec: true },
          orderBy: { startTime: 'asc' },
        },
      },
    })

    res.json({ segments })
  }),
)

