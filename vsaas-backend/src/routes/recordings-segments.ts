/**
 * Recording Segments Routes — listagem para o componente Timeline.
 *
 * GET /recordings/segments?cameraId=X&from=ISO&to=ISO[&hasMotion=true][&hasEvent=true]
 *   Retorna os segmentos do range, com flags de motion/event e sprite URL para
 *   o scrubber. Tenant-isolado via cameraTenantWhere.
 *
 * BigInt (sizeBytes) é convertido para string nas respostas — convenção do projeto.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { cameraTenantWhere, assertCameraBelongsToUser } from '../lib/tenant-scope'
import { ValidationError } from '../lib/errors'

export const recordingsSegmentsRouter = Router()
recordingsSegmentsRouter.use(requireAuth)

const ListSegmentsQuery = z.object({
  cameraId:  z.string().uuid(),
  from:      z.string().datetime(),
  to:        z.string().datetime(),
  hasMotion: z.union([z.literal('true'), z.literal('false')]).optional(),
  hasEvent:  z.union([z.literal('true'), z.literal('false')]).optional(),
}).refine(q => new Date(q.to) > new Date(q.from), {
  message: 'to deve ser depois de from',
})

recordingsSegmentsRouter.get(
  '/segments',
  asyncHandler(async (req: Request, res: Response) => {
    const parse = ListSegmentsQuery.safeParse(req.query)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'query'}: ${first.message}`)
    }
    const q = parse.data

    // Tenant scope: a câmera precisa pertencer ao usuário.
    await assertCameraBelongsToUser(q.cameraId, req.jwtPayload)

    // Garante a barreira de tenant (defense in depth caso a checagem acima
    // mude no futuro).
    const tenantWhere = cameraTenantWhere(req.jwtPayload)

    const fromDate = new Date(q.from)
    const toDate   = new Date(q.to)

    const where: Record<string, unknown> = {
      cameraId: q.cameraId,
      camera: tenantWhere,
      // Intersecta a janela: startedAt < to AND endedAt > from
      startedAt: { lt: toDate },
      endedAt:   { gt: fromDate },
      ...(q.hasMotion !== undefined ? { hasMotion: q.hasMotion === 'true' } : {}),
      ...(q.hasEvent  !== undefined ? { hasEvent:  q.hasEvent  === 'true' } : {}),
    }

    const segments = await prisma.recordingSegment.findMany({
      where: where as any,
      orderBy: { startedAt: 'asc' },
      take: 5000,
      select: {
        id:          true,
        cameraId:    true,
        startedAt:   true,
        endedAt:     true,
        durationSec: true,
        hasMotion:   true,
        hasEvent:    true,
        sizeBytes:   true,
        spriteUrl:   true,
        codec:       true,
        width:       true,
        height:      true,
        fps:         true,
      },
    })

    // BigInt → string (convenção do projeto)
    const out = segments.map(s => ({
      ...s,
      sizeBytes: s.sizeBytes !== null && s.sizeBytes !== undefined
        ? s.sizeBytes.toString()
        : null,
    }))

    res.json({
      cameraId: q.cameraId,
      from:     fromDate.toISOString(),
      to:       toDate.toISOString(),
      segments: out,
      total:    out.length,
    })
  }),
)
