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
import rateLimit from 'express-rate-limit'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { vertexFaceService } from '../services/vertex-face.service'
import {
  getActiveEmbeddingService,
  getActiveEmbeddingProviderName,
} from '../services/llm-provider'
import { triggerExecutor } from '../services/trigger-executor.service'
import { logger } from '../lib/logger'
import { requires } from '../middleware/require-capability'
import { CAPABILITIES } from '../lib/capabilities'
import { gcsService } from '../services/gcs.service'
import { r2Storage } from '../services/r2-storage.service'

/**
 * Cosine similarity entre dois vetores.
 *
 * IMPORTANTE: chamadores devem garantir `a.length === b.length` — comparar
 * vetores de dimensões diferentes (Gemini-text 768 vs Vertex-multimodal 1408)
 * produz lixo silencioso. Pre-filtrar por `vectorDim` no findMany antes.
 */
function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Resolve signed URL para uma thumbnail.
 *
 * Aceita 2 formatos legados na coluna `thumbnailGcsKey`:
 *   - `<integradorId>::<objectPath>` → R2 (storage primário, bucket por integrador)
 *   - `<gcsKey>` (sem `::`)          → GCS legado (uploadEvidence histórico)
 *
 * Falhas individuais viram null — não derrubam a resposta inteira.
 */
async function resolveThumbUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null
  try {
    if (key.includes('::')) {
      const [integradorId, ...rest] = key.split('::')
      const objectPath = rest.join('::')
      return await r2Storage.getPresignedUrl(integradorId, objectPath, 3600)
    }
    return await gcsService.getSignedUrl(key, 3600_000)
  } catch { return null }
}

/**
 * Rate limit pra endpoints "caros" — cada query do /query gera 1 embed Vertex/Gemini
 * + findMany de até 2000 rows. Sem limit, um único user mal-comportado dispara bill
 * explosion + DoS de DB.
 *
 * 60 buscas/min por user é mais que generoso pra uso interativo (1/s sustentado).
 */
const searchRateLimit = rateLimit({
  windowMs: 60_000,
  limit:    60,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  keyGenerator: (req: Request) => req.jwtPayload?.sub ?? req.ip ?? 'anon',
  message: { error: 'rate_limited', message: 'Muitas buscas — aguarde 1 minuto' },
})

export const semanticSearchRouter = Router()
semanticSearchRouter.use(requireAuth)

function scopedCameraFilter(req: Request): Prisma.CameraWhereInput | null {
  const p = req.jwtPayload!
  if (p.role === 'SUPER_ADMIN') return {}
  if (p.clienteFinalId) return { site: { clienteFinalId: p.clienteFinalId } }
  if (p.integradorId) return { site: { clienteFinal: { integradorId: p.integradorId } } }
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
semanticSearchRouter.post('/query',
  searchRateLimit,
  requires(CAPABILITIES.AI_SEMANTIC_SEARCH_QUERY),
  async (req, res) => {
  const parsed = QuerySchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const q = parsed.data
  const scope = scopedCameraFilter(req)
  if (!scope) { res.json({ items: [], total: 0 }); return }

  try {
    const t0 = Date.now()
    const embSvc = getActiveEmbeddingService()
    const queryVec = await embSvc.embed(q.query)
    const queryArr = Array.from(queryVec)
    const queryDim = queryArr.length
    const queryProvider = getActiveEmbeddingProviderName()
    const queryDurationMs = Date.now() - t0

    const where: Prisma.SemanticEmbeddingWhereInput = {
      // crítico: cosineSim só faz sentido entre vetores do MESMO espaço.
      // Filtramos por dim E provider — Gemini-768 e OpenAI-768 são ambos 768D
      // mas em espaços diferentes; comparar entre eles dá lixo silencioso.
      vectorDim: queryDim,
      provider:  queryProvider,
    }
    const camWhere: Prisma.CameraWhereInput = { ...scope }
    if (q.clienteFinalId) camWhere.site = { ...(camWhere.site as object ?? {}), clienteFinalId: q.clienteFinalId }
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
        score: cosineSim(queryArr, c.vectorJson as unknown as number[]),
      }))
      .filter(c => c.score >= q.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, q.topK)
      .map(({ vectorJson, ...rest }) => rest)

    // Resolve signed URLs em paralelo (mantém latência baixa mesmo com topK=50).
    // Falhas individuais viram null — não derrubam a resposta inteira.
    const matches = await Promise.all(scored.map(async m => ({
      ...m,
      thumbnailUrl: await resolveThumbUrl(m.thumbnailGcsKey),
    })))

    res.json({
      query:           q.query,
      topK:            q.topK,
      totalCandidates: candidates.length,
      matches,
      queryDurationMs,
    })
  } catch (err: any) {
    logger.error({ err }, 'semantic_query_failed')
    res.status(500).json({ error: 'query_failed', message: err.message })
  }
})

// ── POST /semantic-search/image ──
//
// Status atual: aceita imagem mas faz busca por SIMILARIDADE VISUAL DIRETA.
// Vertex multimodal embed = 1408 dims. Quase ninguém no banco tem esse dim
// hoje (job real grava 768 via gemini-embedding-001). O filtro vectorDim:1408
// abaixo garante que só comparamos vetores compatíveis — sem isso, scores
// virariam ~0 silenciosamente. UI esconde essa aba enquanto o pipeline
// multimodal não estiver alinhado.
semanticSearchRouter.post('/image',
  searchRateLimit,
  requires(CAPABILITIES.AI_SEMANTIC_SEARCH_QUERY),
  async (req, res) => {
  const parsed = ImageSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const q = parsed.data
  const scope = scopedCameraFilter(req)
  if (!scope) { res.json({ items: [] }); return }

  try {
    const b64 = q.imageBase64.replace(/^data:image\/\w+;base64,/, '')
    const queryEmb = await vertexFaceService.embed({ imageBase64: b64 })
    const queryDim = queryEmb.vector.length
    const camWhere: Prisma.CameraWhereInput = { ...scope }
    if (q.clienteFinalId) camWhere.site = { ...(camWhere.site as object ?? {}), clienteFinalId: q.clienteFinalId }
    const candidates = await prisma.semanticEmbedding.findMany({
      where: {
        vectorDim: queryDim,
        ...(Object.keys(camWhere).length ? { camera: camWhere } : {}),
      },
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

    const matches = await Promise.all(scored.map(async m => ({
      ...m,
      thumbnailUrl: await resolveThumbUrl(m.thumbnailGcsKey),
    })))

    res.json({ matches, queryDurationMs: queryEmb.durationMs, totalCandidates: candidates.length })
  } catch (err: any) {
    logger.error({ err }, 'semantic_image_failed')
    res.status(500).json({ error: 'query_failed', message: err.message })
  }
})

// ── POST /semantic-search/index ──
//
// Endpoint de bootstrap/manutenção — escreve direto no índice com cameraId
// arbitrário. Restrito a SUPER_ADMIN / INTEGRADOR_ADMIN pra impedir que
// qualquer user com capability AI_SEMANTIC_SEARCH_QUERY (read) consiga
// poluir o índice de outro tenant (escalation via tenant impersonation).
semanticSearchRouter.post('/index',
  requires(CAPABILITIES.AI_SEMANTIC_SEARCH_QUERY),
  (req, res, next) => {
    const role = req.jwtPayload?.role
    if (role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL' || role === 'INTEGRADOR_ADMIN') return next()
    res.status(403).json({ error: 'forbidden', message: 'Indexação manual restrita a admin' })
  },
  async (req, res) => {
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
//
// Retorna métricas resumidas do índice semântico para popular KPIs da UI.
// Schema casado com SemanticSearchPage.tsx (KpiCard × 4):
//   - totalEmbeddings  — count global do tenant
//   - camerasIndexed   — count distinct cameraId
//   - last24h          — count com capturedAt > now()-24h
//   - vectorDim        — dimensão padrão do índice (derivada do primeiro row)
//   - byCamera         — ranking pra debug interno (mantido por retrocompat)
semanticSearchRouter.get('/stats',
  requires(CAPABILITIES.AI_SEMANTIC_SEARCH_QUERY),
  async (req, res) => {
  const scope = scopedCameraFilter(req)
  if (!scope) {
    res.json({
      totalEmbeddings: 0, camerasIndexed: 0, last24h: 0, vectorDim: 768,
      total: 0, byCamera: [],
    })
    return
  }
  const where: Prisma.SemanticEmbeddingWhereInput = Object.keys(scope).length ? { camera: scope } : {}
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [total, byCamera, last24h, sample] = await Promise.all([
    prisma.semanticEmbedding.count({ where }),
    prisma.semanticEmbedding.groupBy({
      by: ['cameraId'], where, _count: true,
      orderBy: { _count: { cameraId: 'desc' } }, take: 20,
    }),
    prisma.semanticEmbedding.count({ where: { ...where, capturedAt: { gte: yesterday } } }),
    prisma.semanticEmbedding.findFirst({
      where, select: { vectorDim: true }, orderBy: { createdAt: 'desc' },
    }),
  ])
  res.json({
    // novo schema (consumido pelos KpiCard)
    totalEmbeddings: total,
    camerasIndexed:  byCamera.length,
    last24h,
    vectorDim:       sample?.vectorDim ?? 768,
    // legacy (mantém compat com qualquer caller que ainda lê /stats antigo)
    total,
    byCamera: byCamera.map(b => ({ cameraId: b.cameraId, count: b._count })),
  })
})

// ── DELETE /semantic-search/:id ──
semanticSearchRouter.delete('/:id',
  requires(CAPABILITIES.AI_SEMANTIC_SEARCH_QUERY),
  async (req, res) => {
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const found = await prisma.semanticEmbedding.findFirst({
    where: { id: req.params.id, ...(Object.keys(scope).length ? { camera: scope } : {}) },
  })
  if (!found) { res.status(404).json({ error: 'not_found' }); return }
  await prisma.semanticEmbedding.delete({ where: { id: found.id } })
  res.status(204).end()
})
