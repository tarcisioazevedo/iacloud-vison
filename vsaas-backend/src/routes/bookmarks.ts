/**
 * Bookmarks Routes — marcações de eventos no vídeo (manual + automática).
 *
 * GET    /bookmarks?cameraId=X&from=ISO&to=ISO   → lista filtrada
 * POST   /bookmarks                              → cria bookmark manual
 * GET    /bookmarks/:id
 * PATCH  /bookmarks/:id                          → edita title/color/notes/datas
 * DELETE /bookmarks/:id
 *
 * POST   /bookmarks/auto                         → uso interno (recording.service / webhooks)
 *                                                  body: { cameraId, autoType, startAt, endAt?, title?, segmentId? }
 *
 * Multi-tenant: tenantId resolvido pela câmera (site→clienteFinal ou integradorId).
 * Reusa cameraTenantWhere / requireCameraForUser / assertCameraBelongsToUser de tenant-scope.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { blockReadOnly } from '../middleware/block-read-only'
import { asyncHandler } from '../middleware/async-handler'
import {
  cameraTenantWhere,
  requireCameraForUser,
  assertCameraBelongsToUser,
} from '../lib/tenant-scope'
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'
import type { JwtPayload } from '../middleware/auth'

export const bookmarksRouter = Router()
bookmarksRouter.use(requireAuth)

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolve o tenantId que deve ser gravado no Bookmark, com base no JWT.
 * Convencionado: clienteFinalId > integradorId > sub.
 */
function resolveTenantId(jwt: JwtPayload): string {
  return jwt.clienteFinalId ?? jwt.integradorId ?? jwt.sub ?? 'SUPER_ADMIN'
}

/**
 * Verifica que o bookmark pertence ao tenant do usuário.
 * 404 anti-vazamento se não pertence.
 */
async function requireBookmarkForUser(id: string, jwt: JwtPayload | undefined) {
  if (!jwt) throw new ForbiddenError('Não autenticado')
  const tenantWhere = cameraTenantWhere(jwt)
  const bm = await prisma.bookmark.findFirst({
    where: {
      id,
      camera: tenantWhere as any,
    },
  })
  if (!bm) throw new NotFoundError('Bookmark')
  return bm
}

// =============================================================================
// Schemas (Zod)
// =============================================================================

const ListBookmarksQuery = z.object({
  cameraId: z.string().uuid().optional(),
  from:     z.string().datetime().optional(),
  to:       z.string().datetime().optional(),
  autoType: z.enum(['MANUAL', 'MOTION', 'EVENT', 'DOWNLOAD', 'EXPORT']).optional(),
})

const CreateBookmarkSchema = z.object({
  cameraId:  z.string().uuid(),
  segmentId: z.string().uuid().optional().nullable(),
  title:     z.string().min(1).max(200),
  color:     z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  startAt:   z.string().datetime(),
  endAt:     z.string().datetime().optional().nullable(),
  notes:     z.string().max(2000).optional().nullable(),
})

const UpdateBookmarkSchema = z.object({
  title:   z.string().min(1).max(200).optional(),
  color:   z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  notes:   z.string().max(2000).optional().nullable(),
  startAt: z.string().datetime().optional(),
  endAt:   z.string().datetime().optional().nullable(),
}).strict()

const AutoBookmarkSchema = z.object({
  cameraId:  z.string().uuid(),
  autoType:  z.enum(['MANUAL', 'MOTION', 'EVENT', 'DOWNLOAD', 'EXPORT']),
  startAt:   z.string().datetime(),
  endAt:     z.string().datetime().optional().nullable(),
  title:     z.string().min(1).max(200).optional(),
  segmentId: z.string().uuid().optional().nullable(),
  notes:     z.string().max(2000).optional().nullable(),
  color:     z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
})

// =============================================================================
// GET /bookmarks
// =============================================================================

bookmarksRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  const parse = ListBookmarksQuery.safeParse(req.query)
  if (!parse.success) {
    const first = parse.error.errors[0]
    throw new ValidationError(`${first.path.join('.') || 'query'}: ${first.message}`)
  }
  const q = parse.data

  const tenantWhere = cameraTenantWhere(jwt)

  const where: Record<string, unknown> = {
    camera: tenantWhere,
    ...(q.cameraId ? { cameraId: q.cameraId } : {}),
    ...(q.autoType ? { autoType: q.autoType } : {}),
  }

  if (q.from || q.to) {
    where.startAt = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to   ? { lte: new Date(q.to) }   : {}),
    }
  }

  const bookmarks = await prisma.bookmark.findMany({
    where: where as any,
    orderBy: { startAt: 'desc' },
    take: 500,
  })

  res.json({ bookmarks, total: bookmarks.length })
}))

// =============================================================================
// POST /bookmarks — manual
// =============================================================================

bookmarksRouter.post('/', blockReadOnly, asyncHandler(async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!

  const parse = CreateBookmarkSchema.safeParse(req.body)
  if (!parse.success) {
    const first = parse.error.errors[0]
    throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
  }
  const b = parse.data

  // Tenant scope: câmera tem que pertencer ao usuário.
  await assertCameraBelongsToUser(b.cameraId, jwt)

  // Se segmentId fornecido, valida que ele pertence à mesma câmera.
  if (b.segmentId) {
    const seg = await prisma.recordingSegment.findFirst({
      where: { id: b.segmentId, cameraId: b.cameraId },
      select: { id: true },
    })
    if (!seg) throw new NotFoundError('Segmento')
  }

  if (b.endAt && new Date(b.endAt) <= new Date(b.startAt)) {
    throw new ValidationError('endAt deve ser depois de startAt')
  }

  const tenantId = resolveTenantId(jwt)

  const created = await prisma.bookmark.create({
    data: {
      cameraId:    b.cameraId,
      segmentId:   b.segmentId ?? null,
      tenantId,
      title:       b.title,
      color:       b.color ?? '#F59E0B',
      startAt:     new Date(b.startAt),
      endAt:       b.endAt ? new Date(b.endAt) : null,
      notes:       b.notes ?? null,
      autoType:    'MANUAL',
      createdById: jwt.sub,
    },
  })

  res.status(201).json(created)
}))

// =============================================================================
// GET /bookmarks/:id
// =============================================================================

bookmarksRouter.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const bm = await requireBookmarkForUser(String(req.params.id), req.jwtPayload)
  res.json(bm)
}))

// =============================================================================
// PATCH /bookmarks/:id
// =============================================================================

bookmarksRouter.patch('/:id', blockReadOnly, asyncHandler(async (req: Request, res: Response) => {
  const existing = await requireBookmarkForUser(String(req.params.id), req.jwtPayload)

  const parse = UpdateBookmarkSchema.safeParse(req.body)
  if (!parse.success) {
    throw new ValidationError(parse.error.errors[0]?.message ?? 'Dados inválidos')
  }
  const patch = parse.data
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Nenhum campo para atualizar')
  }

  const newStart = patch.startAt ? new Date(patch.startAt) : existing.startAt
  const newEnd   = patch.endAt === undefined ? existing.endAt : (patch.endAt ? new Date(patch.endAt) : null)
  if (newEnd && newEnd <= newStart) {
    throw new ValidationError('endAt deve ser depois de startAt')
  }

  const updated = await prisma.bookmark.update({
    where: { id: existing.id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
      ...(patch.startAt !== undefined ? { startAt: new Date(patch.startAt) } : {}),
      ...(patch.endAt !== undefined ? { endAt: patch.endAt ? new Date(patch.endAt) : null } : {}),
    },
  })
  res.json(updated)
}))

// =============================================================================
// DELETE /bookmarks/:id
// =============================================================================

bookmarksRouter.delete('/:id', blockReadOnly, asyncHandler(async (req: Request, res: Response) => {
  const existing = await requireBookmarkForUser(String(req.params.id), req.jwtPayload)
  await prisma.bookmark.delete({ where: { id: existing.id } })
  res.json({ ok: true })
}))

// =============================================================================
// POST /bookmarks/auto — criação automatizada (recording.service / webhooks)
// =============================================================================

bookmarksRouter.post('/auto', asyncHandler(async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!

  const parse = AutoBookmarkSchema.safeParse(req.body)
  if (!parse.success) {
    const first = parse.error.errors[0]
    throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
  }
  const b = parse.data

  // Tenant scope: a câmera tem que pertencer ao usuário/processo.
  await requireCameraForUser(b.cameraId, jwt, { select: { id: true } })

  if (b.segmentId) {
    const seg = await prisma.recordingSegment.findFirst({
      where: { id: b.segmentId, cameraId: b.cameraId },
      select: { id: true },
    })
    if (!seg) throw new NotFoundError('Segmento')
  }

  const tenantId = resolveTenantId(jwt)
  const title = b.title ?? `[${b.autoType}] ${new Date(b.startAt).toISOString()}`

  // Cor padrão por tipo (UI consome)
  const defaultColorByType: Record<string, string> = {
    MANUAL:   '#F59E0B',
    MOTION:   '#10B981',
    EVENT:    '#EF4444',
    DOWNLOAD: '#6366F1',
    EXPORT:   '#8B5CF6',
  }

  const created = await prisma.bookmark.create({
    data: {
      cameraId:    b.cameraId,
      segmentId:   b.segmentId ?? null,
      tenantId,
      title,
      color:       b.color ?? defaultColorByType[b.autoType] ?? '#F59E0B',
      startAt:     new Date(b.startAt),
      endAt:       b.endAt ? new Date(b.endAt) : null,
      notes:       b.notes ?? null,
      autoType:    b.autoType,
      createdById: jwt.sub,
    },
  })

  res.status(201).json(created)
}))
