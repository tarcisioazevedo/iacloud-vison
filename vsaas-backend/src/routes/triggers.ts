/**
 * Sprint S — Semantic Triggers routes.
 *
 *   GET    /triggers                       → lista do tenant
 *   POST   /triggers                       → cria (text/image)
 *   GET    /triggers/:id                   → detalhe + últimos hits
 *   PATCH  /triggers/:id                   → toggle / threshold / actions
 *   DELETE /triggers/:id                   → remove
 *   POST   /triggers/:id/test              → simula match com snapshot atual
 *
 * Multi-tenant: triggers vivem no clienteFinal. INTEGRADOR_ADMIN vê triggers
 * de todos seus clientes finais. SUPER_ADMIN vê tudo.
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { blockReadOnly } from '../middleware/block-read-only'
import { asyncHandler } from '../middleware/async-handler'
import { NotFoundError, ValidationError, ForbiddenError } from '../lib/errors'
import { embedText, embedImage, cosineSimilarity } from '../lib/embedding'
import { logger } from '../lib/logger'
import { requires } from '../middleware/require-capability'
import { CAPABILITIES } from '../lib/capabilities'

export const triggersRouter = Router()
triggersRouter.use(requireAuth)
triggersRouter.use(blockReadOnly)

const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('WEBHOOK'),     url: z.string().url(), secret: z.string().min(8).max(200).optional() }),
  z.object({ type: z.literal('NOTIFY') }),
  z.object({ type: z.literal('RECORD') }),
  z.object({ type: z.literal('SIREN'),       sirenId: z.string().optional() }),
  z.object({ type: z.literal('REVIEW_FLAG') }),
])

const CreateSchema = z.object({
  clienteFinalId: z.string().uuid(),
  name:           z.string().min(2).max(120),
  description:    z.string().max(500).optional(),
  sourceType:     z.enum(['IMAGE', 'TEXT', 'THUMBNAIL_REF']),
  sourceText:     z.string().max(2000).optional(),
  sourceImageBase64: z.string().max(5_000_000).optional(),  // ~5MB base64
  sourceImageUrl: z.string().url().optional(),
  cameraIds:      z.array(z.string().uuid()).optional(),
  threshold:      z.number().min(0.5).max(0.99).optional(),
  cooldownSec:    z.number().int().min(0).max(86400).optional(),
  actions:        z.array(ActionSchema).min(1).max(10),
  scheduleJson:   z.any().optional(),
})

async function tenantScope(payload: { sub: string; role: string; integradorId?: string }) {
  if (payload.role === 'SUPER_ADMIN') return {} as Record<string, never>
  if (payload.role === 'INTEGRADOR_ADMIN') {
    return { clienteFinal: { integradorId: payload.sub } }
  }
  // CLIENTE_*: filtra pelo próprio clienteFinalId no JWT (se houver)
  if (payload.integradorId == null) {
    // user vinculado a clienteFinal — pegar do payload
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { clienteFinalId: true },
    })
    if (!user?.clienteFinalId) throw new ForbiddenError('usuário sem cliente final vinculado')
    return { clienteFinalId: user.clienteFinalId }
  }
  return { clienteFinal: { integradorId: payload.integradorId } }
}

triggersRouter.get('/',
  requires(CAPABILITIES.AI_TRIGGERS_VISION),
  asyncHandler(async (req, res) => {
  const where = await tenantScope(req.jwtPayload!)
  const items = await prisma.semanticTrigger.findMany({
    where: where as any,
    select: {
      id: true, name: true, description: true, enabled: true,
      sourceType: true, threshold: true, cooldownSec: true,
      hitsCount: true, lastHitAt: true, createdAt: true,
      clienteFinalId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  res.json({ items })
}))

triggersRouter.post('/',
  requires(CAPABILITIES.AI_TRIGGERS_VISION),
  asyncHandler(async (req, res) => {
  const parse = CreateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'payload inválido')
  const data = parse.data

  // Valida pertencimento do clienteFinalId ao tenant.
  if (req.jwtPayload!.role === 'INTEGRADOR_ADMIN') {
    const cf = await prisma.clienteFinal.findFirst({
      where: { id: data.clienteFinalId, integradorId: req.jwtPayload!.sub },
      select: { id: true },
    })
    if (!cf) throw new ForbiddenError('clienteFinal não pertence a este integrador')
  }

  // Gera embedding
  let emb
  if (data.sourceType === 'TEXT' && data.sourceText) {
    emb = await embedText(data.sourceText)
  } else if (data.sourceType === 'IMAGE' && (data.sourceImageBase64 || data.sourceImageUrl)) {
    emb = await embedImage(data.sourceImageBase64 ?? data.sourceImageUrl!)
  } else if (data.sourceType === 'THUMBNAIL_REF' && data.sourceImageUrl) {
    emb = await embedImage(data.sourceImageUrl)
  } else {
    throw new ValidationError('sourceType requer sourceText ou sourceImage*')
  }

  const created = await prisma.semanticTrigger.create({
    data: {
      clienteFinalId:   data.clienteFinalId,
      name:             data.name,
      description:      data.description,
      sourceType:       data.sourceType,
      sourceText:       data.sourceText,
      sourceImageUrl:   data.sourceImageUrl,
      cameraIdsJson:    (data.cameraIds ?? null) as any,
      embeddingProvider: emb.provider,
      embeddingModel:    emb.model,
      embeddingVector:   emb.vector,
      embeddingDim:      emb.dim,
      threshold:        data.threshold ?? 0.78,
      cooldownSec:      data.cooldownSec ?? 120,
      actionsJson:      data.actions as any,
      scheduleJson:     (data.scheduleJson ?? null) as any,
      createdById:      req.jwtPayload!.sub,
    },
    select: { id: true, name: true, threshold: true, embeddingDim: true, embeddingProvider: true },
  })

  logger.info({ triggerId: created.id, provider: emb.provider }, 'trigger_created')
  res.status(201).json(created)
}))

triggersRouter.get('/:id',
  requires(CAPABILITIES.AI_TRIGGERS_VISION),
  asyncHandler(async (req, res) => {
  const where = await tenantScope(req.jwtPayload!)
  const t = await prisma.semanticTrigger.findFirst({
    where: { id: req.params.id, ...(where as any) },
    include: {
      hits: { orderBy: { capturedAt: 'desc' }, take: 50 },
    },
  })
  if (!t) throw new NotFoundError('trigger')
  // Não vaza o vetor inteiro — é grande
  const { embeddingVector: _vec, ...rest } = t as any
  res.json({ ...rest, embeddingDim: t.embeddingDim })
}))

const PatchSchema = z.object({
  enabled:     z.boolean().optional(),
  name:        z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional(),
  threshold:   z.number().min(0.5).max(0.99).optional(),
  cooldownSec: z.number().int().min(0).max(86400).optional(),
  actions:     z.array(ActionSchema).optional(),
  cameraIds:   z.array(z.string().uuid()).nullable().optional(),
})

triggersRouter.patch('/:id',
  requires(CAPABILITIES.AI_TRIGGERS_VISION),
  asyncHandler(async (req, res) => {
  const parse = PatchSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'payload inválido')
  const where = await tenantScope(req.jwtPayload!)
  const exists = await prisma.semanticTrigger.findFirst({
    where: { id: req.params.id, ...(where as any) },
    select: { id: true },
  })
  if (!exists) throw new NotFoundError('trigger')

  const updated = await prisma.semanticTrigger.update({
    where: { id: String(req.params.id) },
    data: {
      ...(parse.data.enabled     !== undefined ? { enabled:     parse.data.enabled     } : {}),
      ...(parse.data.name        !== undefined ? { name:        parse.data.name        } : {}),
      ...(parse.data.description !== undefined ? { description: parse.data.description } : {}),
      ...(parse.data.threshold   !== undefined ? { threshold:   parse.data.threshold   } : {}),
      ...(parse.data.cooldownSec !== undefined ? { cooldownSec: parse.data.cooldownSec } : {}),
      ...(parse.data.actions     !== undefined ? { actionsJson: parse.data.actions as any } : {}),
      ...(parse.data.cameraIds   !== undefined ? { cameraIdsJson: parse.data.cameraIds as any } : {}),
    } as any,
  })
  res.json({ id: updated.id, enabled: updated.enabled })
}))

triggersRouter.delete('/:id',
  requires(CAPABILITIES.AI_TRIGGERS_VISION),
  asyncHandler(async (req, res) => {
  const where = await tenantScope(req.jwtPayload!)
  const exists = await prisma.semanticTrigger.findFirst({
    where: { id: req.params.id, ...(where as any) },
    select: { id: true },
  })
  if (!exists) throw new NotFoundError('trigger')
  await prisma.semanticTrigger.delete({ where: { id: String(req.params.id) } })
  res.status(204).end()
}))

const TestSchema = z.object({
  text:        z.string().max(2000).optional(),
  imageBase64: z.string().max(5_000_000).optional(),
})

/**
 * Simula um match. Útil pro wizard "ver score que vai dar".
 * Não dispara ações nem grava SemanticTriggerHit.
 */
triggersRouter.post('/:id/test',
  requires(CAPABILITIES.AI_TRIGGERS_VISION),
  asyncHandler(async (req, res) => {
  const parse = TestSchema.safeParse(req.body ?? {})
  if (!parse.success) throw new ValidationError('payload inválido')

  const where = await tenantScope(req.jwtPayload!)
  const t = await prisma.semanticTrigger.findFirst({
    where: { id: req.params.id, ...(where as any) },
    select: { id: true, threshold: true, embeddingVector: true },
  })
  if (!t) throw new NotFoundError('trigger')

  const candidate = parse.data.text
    ? await embedText(parse.data.text)
    : parse.data.imageBase64
      ? await embedImage(parse.data.imageBase64)
      : null
  if (!candidate) throw new ValidationError('forneça text ou imageBase64')

  const sim = cosineSimilarity(t.embeddingVector as number[], candidate.vector)
  res.json({
    score: sim,
    threshold: t.threshold,
    wouldMatch: sim >= t.threshold,
    provider: candidate.provider,
  })
}))
