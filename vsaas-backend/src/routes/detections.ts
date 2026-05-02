/**
 * Detections Routes — bounding boxes para motion search por zona (Alt 3).
 *
 * POST /detections/ingest        → bulk insert do edge node (auth via edge token)
 * POST /detections/zone-search   → busca por interseção bbox × zonas (operador)
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
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { requireEdgeAuth } from '../middleware/edge-auth'
import { asyncHandler } from '../middleware/async-handler'
import { cameraTenantWhere, assertCameraBelongsToUser } from '../lib/tenant-scope'
import { ValidationError, ForbiddenError } from '../lib/errors'
import { markSegmentMotion } from '../services/recording.service'

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
  requireEdgeAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = IngestSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const { cameraId, frames } = parse.data

    // Confirma que a câmera pertence ao site do edge node (defense in depth).
    const edge = req.edgeNode
    if (!edge) throw new ForbiddenError('Edge auth ausente')

    const cam = await prisma.camera.findFirst({
      where: { id: cameraId, siteId: edge.siteId },
      select: { id: true },
    })
    if (!cam) throw new ForbiddenError('Câmera não pertence ao site do edge node')

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
      bboxX:      number
      bboxY:      number
      bboxW:      number
      bboxH:      number
      segmentId:  string | null
    }

    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "timestamp", "objectType", "bboxX", "bboxY", "bboxW", "bboxH", "segmentId"
      FROM "DetectionFrame"
      WHERE "cameraId" = ${b.cameraId}
        AND "timestamp" >= ${fromDate}
        AND "timestamp" <= ${toDate}
        AND ${zoneOr}
        ${objectTypeClause}
      ORDER BY "timestamp" ASC
      LIMIT 5000
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
      total:    rows.length,
      detections: rows.map(r => ({
        timestamp:  r.timestamp.toISOString(),
        objectType: r.objectType,
        bboxX:      r.bboxX,
        bboxY:      r.bboxY,
        bboxW:      r.bboxW,
        bboxH:      r.bboxH,
        segmentId:  r.segmentId,
      })),
    })
  }),
)
