/**
 * Exports Routes — fila assíncrona de exportações de mídia.
 *
 *   POST /exports/snapshot    → enqueue snapshot job
 *   POST /exports/recording   → enqueue recording clip job
 *   POST /exports/mosaic      → enqueue mosaic stitched job
 *   GET  /exports/:jobId/status
 *   GET  /exports             → lista jobs do tenant
 *   DELETE /exports/:jobId    → cancela job queued/running
 *
 * Tenant isolation:
 *   - Cada cameraId é validado via requireCameraForUser antes do enqueue.
 *   - Listagem filtra por tenantId.
 *   - Status/cancel exigem que o job pertença ao mesmo tenant.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'
import { requireCameraForUser } from '../lib/tenant-scope'
import { exportService } from '../services/export.service'
import type { JwtPayload } from '../middleware/auth'

export const exportsRouter = Router()
exportsRouter.use(requireAuth)

function resolveTenantIdForWrite(jwt: JwtPayload): string {
  return jwt.clienteFinalId ?? jwt.integradorId ?? jwt.sub ?? 'SUPER_ADMIN'
}

// ─── POST /exports/snapshot ──────────────────────────────────────────────────

const SnapshotBody = z.object({
  cameraId:           z.string().uuid(),
  at:                 z.string().datetime(),
  format:             z.enum(['jpg', 'png']).optional().default('jpg'),
  includeCertificate: z.boolean().optional().default(true),
})

exportsRouter.post('/snapshot', asyncHandler(async (req: Request, res: Response) => {
  const parse = SnapshotBody.safeParse(req.body)
  if (!parse.success) {
    const e = parse.error.errors[0]
    throw new ValidationError(`${e.path.join('.') || 'body'}: ${e.message}`)
  }
  const b = parse.data
  const jwt = req.jwtPayload!

  await requireCameraForUser(b.cameraId, jwt, { select: { id: true } })

  const tenantId = resolveTenantIdForWrite(jwt)
  const jobId = exportService.enqueueSnapshot({
    tenantId,
    userId: jwt.sub,
    cameraId: b.cameraId,
    at: new Date(b.at),
    format: b.format,
    includeCertificate: b.includeCertificate,
  })

  res.status(202).json({ jobId })
}))

// ─── POST /exports/recording ─────────────────────────────────────────────────

const RecordingBody = z.object({
  cameraId:           z.string().uuid(),
  from:               z.string().datetime(),
  to:                 z.string().datetime(),
  includeCertificate: z.boolean().optional().default(true),
}).refine(b => new Date(b.to) > new Date(b.from), {
  message: 'to deve ser depois de from',
})

exportsRouter.post('/recording', asyncHandler(async (req: Request, res: Response) => {
  const parse = RecordingBody.safeParse(req.body)
  if (!parse.success) {
    const e = parse.error.errors[0]
    throw new ValidationError(`${e.path.join('.') || 'body'}: ${e.message}`)
  }
  const b = parse.data
  const jwt = req.jwtPayload!

  await requireCameraForUser(b.cameraId, jwt, { select: { id: true } })

  const from = new Date(b.from)
  const to = new Date(b.to)
  const MAX_RANGE_MS = 6 * 60 * 60 * 1000  // 6h máx por export
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new ValidationError('Range máximo de exportação: 6 horas')
  }

  const tenantId = resolveTenantIdForWrite(jwt)
  const jobId = exportService.enqueueRecording({
    tenantId,
    userId: jwt.sub,
    cameraId: b.cameraId,
    from, to,
    includeCertificate: b.includeCertificate,
  })

  res.status(202).json({ jobId })
}))

// ─── POST /exports/mosaic ────────────────────────────────────────────────────

const MosaicBody = z.object({
  cameraIds:          z.array(z.string().uuid()).min(2).max(4),
  from:               z.string().datetime(),
  to:                 z.string().datetime(),
  layout:             z.enum(['2x2', '1x4', '4x1']).optional().default('2x2'),
  includeCertificate: z.boolean().optional().default(true),
}).refine(b => new Date(b.to) > new Date(b.from), {
  message: 'to deve ser depois de from',
})

exportsRouter.post('/mosaic', asyncHandler(async (req: Request, res: Response) => {
  const parse = MosaicBody.safeParse(req.body)
  if (!parse.success) {
    const e = parse.error.errors[0]
    throw new ValidationError(`${e.path.join('.') || 'body'}: ${e.message}`)
  }
  const b = parse.data
  const jwt = req.jwtPayload!

  // Valida ownership de cada câmera (tenant isolation crítico aqui).
  for (const cid of b.cameraIds) {
    await requireCameraForUser(cid, jwt, { select: { id: true } })
  }

  const from = new Date(b.from)
  const to = new Date(b.to)
  const MAX_RANGE_MS = 2 * 60 * 60 * 1000  // 2h pra mosaic (mais pesado)
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new ValidationError('Range máximo de mosaic: 2 horas')
  }

  const tenantId = resolveTenantIdForWrite(jwt)
  const jobId = exportService.enqueueMosaic({
    tenantId,
    userId: jwt.sub,
    cameraIds: b.cameraIds,
    from, to,
    layout: b.layout,
    includeCertificate: b.includeCertificate,
  })

  res.status(202).json({ jobId })
}))

// ─── GET /exports/:jobId/status ──────────────────────────────────────────────

exportsRouter.get('/:jobId/status', asyncHandler(async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  const jobId = String(req.params.jobId)
  const job = exportService.getStatus(jobId)
  if (!job) throw new NotFoundError('Export job')

  const tenantId = resolveTenantIdForWrite(jwt)
  if (job.tenantId !== tenantId && jwt.role !== 'SUPER_ADMIN') {
    throw new NotFoundError('Export job')  // 404 — não vaza existência
  }

  res.json({
    id:        job.id,
    type:      job.type,
    status:    job.status,
    progress:  job.progress,
    etaMs:     job.etaMs,
    result:    job.result ?? null,
    error:     job.error ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
  })
}))

// ─── GET /exports ────────────────────────────────────────────────────────────

exportsRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  const tenantId = resolveTenantIdForWrite(jwt)

  const jobs = exportService.list(tenantId).map(j => ({
    id:        j.id,
    type:      j.type,
    cameraIds: j.cameraIds,
    status:    j.status,
    progress:  j.progress,
    etaMs:     j.etaMs,
    result:    j.result ?? null,
    error:     j.error ?? null,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt ?? null,
  }))

  res.json({ jobs, total: jobs.length })
}))

// ─── DELETE /exports/:jobId ──────────────────────────────────────────────────

exportsRouter.delete('/:jobId', asyncHandler(async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  const jobId = String(req.params.jobId)
  const job = exportService.getStatus(jobId)
  if (!job) throw new NotFoundError('Export job')

  const tenantId = resolveTenantIdForWrite(jwt)
  if (job.tenantId !== tenantId && jwt.role !== 'SUPER_ADMIN') {
    throw new NotFoundError('Export job')
  }
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    throw new ForbiddenError('Job já finalizado — não pode ser cancelado')
  }

  const ok = exportService.cancel(jobId)
  res.json({ ok, status: exportService.getStatus(jobId)?.status ?? 'unknown' })
}))
