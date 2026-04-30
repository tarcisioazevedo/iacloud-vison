/**
 * Semantic Search Router — busca natural language sobre eventos.
 *
 * Inspirado no Semantic Search do Frigate 0.14+ (usa Jina CLIP).
 * Aqui usamos Vertex AI multimodalembedding@001 (1408 dims) → cosine similarity
 * contra SemanticEmbedding persistidos (gerados no ingest de ReviewItem/Event).
 *
 * Endpoints:
 *   POST /semantic-search/query       — texto → top-K eventos
 *   POST /semantic-search/image       — imagem → top-K eventos semelhantes
 *   POST /semantic-search/index       — indexa manualmente (dev/bootstrap)
 *   GET  /semantic-search/stats       — total indexado por câmera
 *   DELETE /semantic-search/:id       — remove do índice
 */
import { Router, Request } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { vertexFaceService } from '../services/vertex-face.service'
import { triggerExecutor } from '../services/trigger-executor.service'
import { logger } from '../lib/logger'

export const semanticSearchRouter = Router()
semanticSearchRouter.use(requireAuth)

function scopedCameraFilter(req: Request): Prisma.CameraWhereInput | null {
  const p = req.jwtPayload!
  if (p.role === 'SUPER_ADMIN') return {}
  if (p.clienteFinalId) return { clienteFinalId: p.clienteFinalId }
  if (p.integradorId) return { clienteFinal: { integradorId: p.integradorId } }
  return null
}

const QuerySchema = z.object({
  query:          z.string().min(1).max(500),
  clienteFinalId: z.string().uuid().optional(),
  cameraId:       z.string().uuid().optional(),
  topK:           z.coerce.number().int().min(1).max(50).default(20),
  minScore:       z.coerce.number().min(0).max(1).default(0.2),
  since:          z.string().datetime().optional(),
  until:          z.string().datetime().optional(),
  tags:           z.string().optional(), // csv
})

const ImageSchema = z.object({
  imageBase64:    z.string().min(100),
  clienteFinalId: z.string().uuid().optional(),
  topK:           z.coerce.number().int().min(1).max(50).default(20),
  minScore:       z.coerce.number().min(0).max(1).default(0.2),
})

const IndexSchema = z.object({
  cameraId:     z.string().uuid(),
  eventId:      z.string().uuid().nullish(),
  reviewItemId: z.string().uuid().nullish(),
  thumbnailGcsKey: z.string().nullish(),
  caption:      z.string().max(2000).nullish(),
  tags:         z.array(z.string()).default([]),
  capturedAt:   z.string().datetime(),
  // uma destas três para gerar embedding:
  imageBase64:  z.string().min(100).optional(),
  gcsUri:       z.string().optional(),
  text:         z.string().max(2000).optional(),
}).refine(d => d.imageBase64 || d.gcsUri || d.text, {
  message: 'É preciso imageBase64, gcsUri ou text',
})

// ── POST /semantic-search/query ──
semanticSearchRouter.post('/query', async (req, res) => {
  const parsed = QuerySchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const q = parsed.data
  const scope = scopedCameraFilter(req)
  if (!scope) { res.json({ items: [], total: 0 }); return }

  try {
    const queryEmb = await vertexFaceService.embed({ text: q.query })

    const where: Prisma.SemanticEmbeddingWhereInput = {}
    const camWhere: Prisma.CameraWhereInput = { ...scope }
    if (q.clienteFinalId) camWhere.clienteFinalId = q.clienteFinalId
    if (Object.keys(camWhere).length) where.camera = camWhere
    if (q.cameraId) where.cameraId = q.cameraId
    if (q.since || q.until) where.capturedAt = {
      ...(q.since ? { gte: new Date(q.since) } : {}),
      ...(q.until ? { lte: new Date(q.until) } : {}),
    }
    const tagsList = q.tags?.split(',').map(s => s.trim()).filter(Boolean)
    if (tagsList?.length) where.tags = { hasSome: tagsList }

    const candidates = await prisma.semanticEmbedding.findMany({
      where, take: 2000,
      orderBy: { capturedAt: 'desc' },
      select: {
        id: true, cameraId: true, eventId: true, reviewItemId: true,
        thumbnailGcsKey: true, caption: true, tags: true,
        capturedAt: true, vectorJson: true, vectorDim: true,
        camera: { select: { id: true, name: true } },
      },
    })

    const scored = candidates
      .map(c => ({
        ...c,
        score: vertexFaceService.cosineSim(queryEmb.vector, c.vectorJson as unknown as number[]),
      }))
      .filter(c => c.score >= q.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, q.topK)
      .map(({ vectorJson, ...rest }) => rest)

    res.json({
      query:              q.query,
      topK:               q.topK,
      totalCandidates:    candidates.length,
      matches:            scored,
      queryDurationMs:    queryEmb.durationMs,
    })
  } catch (err: any) {
    logger.error({ err }, 'semantic_query_failed')
    res.status(500).json({ error: 'query_failed', message: err.message })
  }
})

// ── POST /semantic-search/image ──
semanticSearchRouter.post('/image', async (req, res) => {
  const parsed = ImageSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const q = parsed.data
  const scope = scopedCameraFilter(req)
  if (!scope) { res.json({ items: [] }); return }

  try {
    const b64 = q.imageBase64.replace(/^data:image\/\w+;base64,/, '')
    const queryEmb = await vertexFaceService.embed({ imageBase64: b64 })
    const camWhere: Prisma.CameraWhereInput = { ...scope }
    if (q.clienteFinalId) camWhere.clienteFinalId = q.clienteFinalId
    const candidates = await prisma.semanticEmbedding.findMany({
      where: Object.keys(camWhere).length ? { camera: camWhere } : {},
      take: 2000,
      orderBy: { capturedAt: 'desc' },
      select: {
        id: true, cameraId: true, eventId: true, reviewItemId: true,
        thumbnailGcsKey: true, caption: true, tags: true,
        capturedAt: true, vectorJson: true,
        camera: { select: { id: true, name: true } },
      },
    })
    const scored = candidates
      .map(c => ({
        ...c,
        score: vertexFaceService.cosineSim(queryEmb.vector, c.vectorJson as unknown as number[]),
      }))
      .filter(c => c.score >= q.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, q.topK)
      .map(({ vectorJson, ...rest }) => rest)
    res.json({ matches: scored, queryDurationMs: queryEmb.durationMs, totalCandidates: candidates.length })
  } catch (err: any) {
    logger.error({ err }, 'semantic_image_failed')
    res.status(500).json({ error: 'query_failed', message: err.message })
  }
})

// ── POST /semantic-search/index ──
semanticSearchRouter.post('/index', async (req, res) => {
  const parsed = IndexSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const d = parsed.data
  try {
    const emb = await vertexFaceService.embed({
      imageBase64: d.imageBase64,
      gcsUri:      d.gcsUri,
      text:        d.text,
    })
    const capturedAt = new Date(d.capturedAt)
    const created = await prisma.semanticEmbedding.create({
      data: {
        cameraId:        d.cameraId,
        eventId:         d.eventId ?? null,
        reviewItemId:    d.reviewItemId ?? null,
        thumbnailGcsKey: d.thumbnailGcsKey ?? null,
        caption:         d.caption ?? null,
        tags:            d.tags,
        provider:        'vertex_multimodal',
        modelVersion:    emb.modelUsed,
        vectorJson:      emb.vector as any,
        vectorDim:       emb.dimension,
        capturedAt,
      },
      select: { id: true, cameraId: true, vectorDim: true, createdAt: true },
    })

    // Avalia triggers ativos sem bloquear a resposta HTTP.
    triggerExecutor.check({
      semanticEmbeddingId: created.id,
      cameraId:            d.cameraId,
      vector:              emb.vector,
      capturedAt,
      reviewItemId:        d.reviewItemId ?? undefined,
      snapshotKey:         d.thumbnailGcsKey ?? undefined,
    }).catch(err => logger.warn({ err: err?.message }, 'trigger_check_error'))

    res.status(201).json(created)
  } catch (err: any) {
    logger.error({ err }, 'semantic_index_failed')
    res.status(500).json({ error: 'index_failed', message: err.message })
  }
})

// ── GET /semantic-search/stats ──
semanticSearchRouter.get('/stats', async (req, res) => {
  const scope = scopedCameraFilter(req)
  if (!scope) { res.json({ total: 0, byCamera: [] }); return }
  const where: Prisma.SemanticEmbeddingWhereInput = Object.keys(scope).length ? { camera: scope } : {}
  const [total, byCamera] = await Promise.all([
    prisma.semanticEmbedding.count({ where }),
    prisma.semanticEmbedding.groupBy({
      by: ['cameraId'], where, _count: true,
      orderBy: { _count: { cameraId: 'desc' } }, take: 20,
    }),
  ])
  res.json({
    total,
    byCamera: byCamera.map(b => ({ cameraId: b.cameraId, count: b._count })),
  })
})

// ── DELETE /semantic-search/:id ──
semanticSearchRouter.delete('/:id', async (req, res) => {
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const found = await prisma.semanticEmbedding.findFirst({
    where: { id: req.params.id, ...(Object.keys(scope).length ? { camera: scope } : {}) },
  })
  if (!found) { res.status(404).json({ error: 'not_found' }); return }
  await prisma.semanticEmbedding.delete({ where: { id: found.id } })
  res.status(204).end()
})
