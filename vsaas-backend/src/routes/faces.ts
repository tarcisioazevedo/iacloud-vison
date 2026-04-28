/**
 * Faces Router — biblioteca de identidades + enrollment + reconhecimento.
 *
 * Endpoints:
 *   GET    /faces/identities             — lista paginada com filtros
 *   POST   /faces/identities             — cria identidade
 *   GET    /faces/identities/:id         — detalhe (inclui embeddings + eventos recentes)
 *   PATCH  /faces/identities/:id         — edita metadados
 *   DELETE /faces/identities/:id         — remove (cascade embeddings)
 *
 *   POST   /faces/identities/:id/enroll  — envia imagem → detect → embed → persiste
 *   POST   /faces/identities/:id/embeddings   — adiciona embedding manual (vetor)
 *   DELETE /faces/embeddings/:embeddingId     — remove embedding específico
 *
 *   POST   /faces/match                  — envia imagem → top-K matches
 *   GET    /faces/events                 — lista de FaceRecognitionEvent
 *   POST   /faces/events/ingest          — edge-agent reporta detecção (interno)
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { vertexFaceService } from '../services/vertex-face.service'
import { cameraLogService } from '../services/camera-log.service'
import { logger } from '../lib/logger'

export const facesRouter = Router()
facesRouter.use(requireAuth)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function tenantFilter(req: Request): Prisma.FaceIdentityWhereInput {
  const p = req.jwtPayload!
  if (p.role === 'SUPER_ADMIN') return {}
  if (p.clienteFinalId) return { clienteFinalId: p.clienteFinalId }
  if (p.integradorId) {
    return { clienteFinal: { integradorId: p.integradorId } }
  }
  return { id: '00000000-0000-0000-0000-000000000000' }
}

async function canAccessCliente(req: Request, clienteFinalId: string): Promise<boolean> {
  const p = req.jwtPayload!
  if (p.role === 'SUPER_ADMIN') return true
  if (p.clienteFinalId === clienteFinalId) return true
  if (p.integradorId) {
    const cf = await prisma.clienteFinal.findUnique({
      where: { id: clienteFinalId },
      select: { integradorId: true },
    })
    return cf?.integradorId === p.integradorId
  }
  return false
}

const IdentitySchema = z.object({
  clienteFinalId: z.string().uuid(),
  name:           z.string().min(1).max(120),
  externalId:     z.string().max(64).nullish(),
  role:           z.enum(['employee', 'visitor', 'vip', 'blacklist', 'other']).nullish(),
  department:     z.string().max(80).nullish(),
  email:          z.string().email().nullish(),
  phone:          z.string().max(32).nullish(),
  notes:          z.string().max(2000).nullish(),
  thumbnailUrl:   z.string().url().nullish(),
  active:         z.boolean().optional(),
  alertOnMatch:   z.boolean().optional(),
  alertOnMissing: z.boolean().optional(),
})

const IdentityPatchSchema = IdentitySchema.partial().omit({ clienteFinalId: true })

const EnrollSchema = z.object({
  imageBase64:    z.string().min(100), // data URI sem prefixo ou raw base64
  autoCrop:       z.boolean().default(true),
  sourceImageUrl: z.string().url().nullish(),
})

const ManualEmbeddingSchema = z.object({
  vector:         z.array(z.number()).min(128).max(4096),
  provider:       z.string().default('vertex_ai'),
  modelVersion:   z.string().default('multimodalembedding@001'),
  sourceImageUrl: z.string().url().nullish(),
  quality:        z.number().min(0).max(1).nullish(),
})

const MatchSchema = z.object({
  imageBase64:    z.string().min(100),
  clienteFinalId: z.string().uuid(),
  topK:           z.coerce.number().int().min(1).max(20).default(5),
  minScore:       z.coerce.number().min(0).max(1).default(0.6),
  autoCrop:       z.boolean().default(true),
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /faces/identities
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.get('/identities', async (req, res) => {
  const schema = z.object({
    clienteFinalId: z.string().uuid().optional(),
    role:           z.string().optional(),
    active:         z.enum(['true', 'false']).optional(),
    q:              z.string().max(100).optional(),
    page:           z.coerce.number().int().min(1).default(1),
    pageSize:       z.coerce.number().int().min(1).max(200).default(50),
  })
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues })
    return
  }
  const q = parsed.data

  const where: Prisma.FaceIdentityWhereInput = { ...tenantFilter(req) }
  if (q.clienteFinalId) where.clienteFinalId = q.clienteFinalId
  if (q.role)           where.role = q.role
  if (q.active)         where.active = q.active === 'true'
  if (q.q) {
    where.OR = [
      { name:       { contains: q.q, mode: 'insensitive' } },
      { externalId: { contains: q.q, mode: 'insensitive' } },
      { department: { contains: q.q, mode: 'insensitive' } },
      { email:      { contains: q.q, mode: 'insensitive' } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.faceIdentity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        _count: { select: { embeddings: true, events: true } },
      },
    }),
    prisma.faceIdentity.count({ where }),
  ])
  res.json({
    items: rows,
    page: q.page, pageSize: q.pageSize, total,
    totalPages: Math.ceil(total / q.pageSize),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /faces/identities
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.post('/identities', async (req, res) => {
  const parsed = IdentitySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
    return
  }
  if (!(await canAccessCliente(req, parsed.data.clienteFinalId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const created = await prisma.faceIdentity.create({ data: parsed.data })
  logger.info({ id: created.id, name: created.name }, 'face_identity_created')
  res.status(201).json(created)
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /faces/identities/:id
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.get('/identities/:id', async (req, res) => {
  const id = req.params.id
  const identity = await prisma.faceIdentity.findFirst({
    where: { id, ...tenantFilter(req) },
    include: {
      embeddings: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, provider: true, modelVersion: true, vectorDim: true,
                  sourceImageUrl: true, quality: true, createdAt: true },
      },
      events: {
        orderBy: { capturedAt: 'desc' },
        take: 20,
        include: { camera: { select: { id: true, name: true } } },
      },
      _count: { select: { embeddings: true, events: true } },
    },
  })
  if (!identity) { res.status(404).json({ error: 'not_found' }); return }
  res.json(identity)
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /faces/identities/:id
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.patch('/identities/:id', async (req, res) => {
  const parsed = IdentityPatchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
    return
  }
  const existing = await prisma.faceIdentity.findFirst({
    where: { id: req.params.id, ...tenantFilter(req) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  const updated = await prisma.faceIdentity.update({
    where: { id: existing.id },
    data:  parsed.data,
  })
  res.json(updated)
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /faces/identities/:id
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.delete('/identities/:id', async (req, res) => {
  const existing = await prisma.faceIdentity.findFirst({
    where: { id: req.params.id, ...tenantFilter(req) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  await prisma.faceIdentity.delete({ where: { id: existing.id } })
  logger.info({ id: existing.id }, 'face_identity_deleted')
  res.status(204).end()
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /faces/identities/:id/enroll — detecta, embeda, persiste
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.post('/identities/:id/enroll', async (req, res) => {
  const parsed = EnrollSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
    return
  }
  const identity = await prisma.faceIdentity.findFirst({
    where: { id: req.params.id, ...tenantFilter(req) },
  })
  if (!identity) { res.status(404).json({ error: 'not_found' }); return }

  const b64 = parsed.data.imageBase64.replace(/^data:image\/\w+;base64,/, '')
  let detectionQuality: number | undefined

  try {
    // 1. Detecta rostos (para extrair qualidade)
    if (parsed.data.autoCrop) {
      const faces = await vertexFaceService.detectFaces(b64)
      if (!faces.length) {
        res.status(422).json({ error: 'no_face_detected' })
        return
      }
      detectionQuality = faces[0].confidence
    }
    // 2. Gera embedding
    const emb = await vertexFaceService.embed({ imageBase64: b64 })
    // 3. Persiste
    const saved = await prisma.faceEmbedding.create({
      data: {
        faceIdentityId: identity.id,
        provider:       'vertex_ai',
        modelVersion:   emb.modelUsed,
        vectorJson:     emb.vector as any,
        vectorDim:      emb.dimension,
        sourceImageUrl: parsed.data.sourceImageUrl ?? null,
        quality:        detectionQuality ?? null,
      },
    })
    res.status(201).json({
      embedding: {
        id: saved.id, provider: saved.provider, modelVersion: saved.modelVersion,
        vectorDim: saved.vectorDim, quality: saved.quality, createdAt: saved.createdAt,
      },
      durationMs: emb.durationMs,
    })
  } catch (err: any) {
    logger.error({ err, identityId: identity.id }, 'face_enroll_failed')
    res.status(500).json({ error: 'enroll_failed', message: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /faces/identities/:id/embeddings — manual (vetor já computado)
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.post('/identities/:id/embeddings', async (req, res) => {
  const parsed = ManualEmbeddingSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
    return
  }
  const identity = await prisma.faceIdentity.findFirst({
    where: { id: req.params.id, ...tenantFilter(req) },
  })
  if (!identity) { res.status(404).json({ error: 'not_found' }); return }
  const saved = await prisma.faceEmbedding.create({
    data: {
      faceIdentityId: identity.id,
      provider:       parsed.data.provider,
      modelVersion:   parsed.data.modelVersion,
      vectorJson:     parsed.data.vector as any,
      vectorDim:      parsed.data.vector.length,
      sourceImageUrl: parsed.data.sourceImageUrl ?? null,
      quality:        parsed.data.quality ?? null,
    },
  })
  res.status(201).json(saved)
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /faces/embeddings/:embeddingId
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.delete('/embeddings/:embeddingId', async (req, res) => {
  const emb = await prisma.faceEmbedding.findUnique({
    where: { id: req.params.embeddingId },
    include: { faceIdentity: true },
  })
  if (!emb || !(await canAccessCliente(req, emb.faceIdentity.clienteFinalId))) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  await prisma.faceEmbedding.delete({ where: { id: emb.id } })
  res.status(204).end()
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /faces/match — detect + embed + top-K similarity
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.post('/match', async (req, res) => {
  const parsed = MatchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
    return
  }
  if (!(await canAccessCliente(req, parsed.data.clienteFinalId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const b64 = parsed.data.imageBase64.replace(/^data:image\/\w+;base64,/, '')

  try {
    let faces: Awaited<ReturnType<typeof vertexFaceService.detectFaces>> = []
    if (parsed.data.autoCrop) {
      faces = await vertexFaceService.detectFaces(b64)
      if (!faces.length) {
        res.status(422).json({ error: 'no_face_detected' })
        return
      }
    }
    const query = await vertexFaceService.embed({ imageBase64: b64 })

    // Carrega embeddings do cliente final
    const candidates = await prisma.faceEmbedding.findMany({
      where: {
        faceIdentity: {
          clienteFinalId: parsed.data.clienteFinalId,
          active: true,
        },
      },
      select: {
        id: true, faceIdentityId: true, vectorJson: true,
        faceIdentity: { select: { id: true, name: true, role: true, externalId: true, thumbnailUrl: true, alertOnMatch: true } },
      },
    })

    const scored = candidates
      .map(c => ({
        embeddingId: c.id,
        identity:    c.faceIdentity,
        score:       vertexFaceService.cosineSim(query.vector, c.vectorJson as unknown as number[]),
      }))
      .filter(s => s.score >= parsed.data.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, parsed.data.topK)

    res.json({
      matches:        scored,
      queryDurationMs: query.durationMs,
      candidatesSearched: candidates.length,
      detection:       faces[0] ?? null,
    })
  } catch (err: any) {
    logger.error({ err }, 'face_match_failed')
    res.status(500).json({ error: 'match_failed', message: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /faces/events — histórico
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.get('/events', async (req, res) => {
  const schema = z.object({
    cameraId:      z.string().uuid().optional(),
    faceIdentityId:z.string().uuid().optional(),
    status:        z.enum(['MATCH', 'UNKNOWN', 'UNCERTAIN', 'SPOOF_SUSPECTED']).optional(),
    clienteFinalId:z.string().uuid().optional(),
    since:         z.string().datetime().optional(),
    until:         z.string().datetime().optional(),
    page:          z.coerce.number().int().min(1).default(1),
    pageSize:      z.coerce.number().int().min(1).max(200).default(50),
  })
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues })
    return
  }
  const q = parsed.data
  const where: Prisma.FaceRecognitionEventWhereInput = {}
  const p = req.jwtPayload!

  // Multi-tenant scope
  const cameraFilter: Prisma.CameraWhereInput = {}
  if (p.role !== 'SUPER_ADMIN') {
    if (p.clienteFinalId) cameraFilter.clienteFinalId = p.clienteFinalId
    else if (p.integradorId) cameraFilter.clienteFinal = { integradorId: p.integradorId }
    else { res.json({ items: [], total: 0, page: 1, pageSize: q.pageSize }); return }
  }
  if (q.clienteFinalId) cameraFilter.clienteFinalId = q.clienteFinalId
  if (Object.keys(cameraFilter).length) where.camera = cameraFilter

  if (q.cameraId)       where.cameraId = q.cameraId
  if (q.faceIdentityId) where.faceIdentityId = q.faceIdentityId
  if (q.status)         where.status = q.status as any
  if (q.since || q.until) {
    where.capturedAt = {
      ...(q.since ? { gte: new Date(q.since) } : {}),
      ...(q.until ? { lte: new Date(q.until) } : {}),
    }
  }

  const [rows, total] = await Promise.all([
    prisma.faceRecognitionEvent.findMany({
      where, orderBy: { capturedAt: 'desc' },
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: {
        camera:       { select: { id: true, name: true } },
        faceIdentity: { select: { id: true, name: true, role: true, thumbnailUrl: true } },
      },
    }),
    prisma.faceRecognitionEvent.count({ where }),
  ])
  res.json({
    items: rows,
    page: q.page, pageSize: q.pageSize, total,
    totalPages: Math.ceil(total / q.pageSize),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /faces/events/ingest — edge-agent reporta reconhecimento
// ─────────────────────────────────────────────────────────────────────────────
facesRouter.post('/events/ingest', async (req, res) => {
  const schema = z.object({
    cameraId:       z.string().uuid(),
    faceIdentityId: z.string().uuid().nullish(),
    status:         z.enum(['MATCH', 'UNKNOWN', 'UNCERTAIN', 'SPOOF_SUSPECTED']),
    matchScore:     z.number().min(0).max(1).nullish(),
    unknownScore:   z.number().min(0).max(1).nullish(),
    capturedAt:     z.string().datetime(),
    bbox:           z.record(z.number()).nullish(),
    cropGcsKey:     z.string().nullish(),
    frameGcsKey:    z.string().nullish(),
    gender:         z.string().nullish(),
    ageRange:       z.string().nullish(),
    emotion:        z.string().nullish(),
    quality:        z.number().min(0).max(1).nullish(),
    pose:           z.record(z.number()).nullish(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
    return
  }
  const ev = await prisma.faceRecognitionEvent.create({
    data: {
      cameraId:       parsed.data.cameraId,
      faceIdentityId: parsed.data.faceIdentityId ?? null,
      status:         parsed.data.status,
      matchScore:     parsed.data.matchScore ?? null,
      unknownScore:   parsed.data.unknownScore ?? null,
      capturedAt:     new Date(parsed.data.capturedAt),
      bboxJson:       parsed.data.bbox as any ?? undefined,
      cropGcsKey:     parsed.data.cropGcsKey ?? null,
      frameGcsKey:    parsed.data.frameGcsKey ?? null,
      gender:         parsed.data.gender ?? null,
      ageRange:       parsed.data.ageRange ?? null,
      emotion:        parsed.data.emotion ?? null,
      quality:        parsed.data.quality ?? null,
      pose:           parsed.data.pose as any ?? undefined,
    },
  })
  await cameraLogService.logCamera({
    cameraId: parsed.data.cameraId,
    level:    parsed.data.status === 'MATCH' ? 'INFO' : 'WARN',
    source:   'FACE',
    message:  `Face ${parsed.data.status}${parsed.data.matchScore ? ` score=${parsed.data.matchScore.toFixed(2)}` : ''}`,
    details:  { identityId: parsed.data.faceIdentityId, emotion: parsed.data.emotion },
    eventId:  ev.id,
  })
  res.status(201).json(ev)
})
