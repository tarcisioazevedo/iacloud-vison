/**
 * admin-sprites — endpoints SUPER_ADMIN pra:
 *   - Disparar backfill de sprite-sheets retroativo (camera1 dia X)
 *   - Listar quantas horas estão sem sprite (visibilidade)
 *
 * Backfill é ON-DEMAND aqui. Worker automático roda em paralelo
 * (ver sprite-backfill-worker.ts).
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async-handler'
import { requireAuth, requireRole } from '../middleware/auth'
import { ValidationError } from '../lib/errors'
import { spriteGenerator } from '../services/sprite-generator.service'
import { logger } from '../lib/logger'

export const adminSpritesRouter = Router()

adminSpritesRouter.use(requireAuth)
adminSpritesRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

// ── GET /admin/sprites/missing ──────────────────────────────────────────
// Lista (cam, day, hour) com segments mas sem sprite. Útil pra dashboard.
const MissingQuerySchema = z.object({
  cameraId:  z.string().uuid().optional(),
  sinceDays: z.coerce.number().int().min(1).max(60).default(7),
  limit:     z.coerce.number().int().min(1).max(500).default(50),
})

adminSpritesRouter.get('/missing', asyncHandler(async (req: Request, res: Response) => {
  const q = MissingQuerySchema.parse(req.query)
  const rows = await spriteGenerator.findHoursMissingSprite(q)
  res.json({ count: rows.length, items: rows })
}))

// ── POST /admin/sprites/backfill ────────────────────────────────────────
// Dispara backfill. Pode ser:
//   - { cameraId, day, hour }: 1 sprite específico
//   - { cameraId?, sinceDays?, limit?: number }: pega N pendentes
//
// Síncrono pra MVP — bloqueia request até processar (max ~25s/hora * limit).
// Vire async (queue) quando passar de ~10 itens por chamada.
const BackfillSchema = z.union([
  z.object({
    cameraId: z.string().uuid(),
    day:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day deve ser YYYY-MM-DD'),
    hour:     z.number().int().min(0).max(23),
    force:    z.boolean().optional(),
  }),
  z.object({
    cameraId:  z.string().uuid().optional(),
    sinceDays: z.number().int().min(1).max(60).default(7),
    limit:     z.number().int().min(1).max(50).default(10),
    force:     z.boolean().optional(),
  }),
])

adminSpritesRouter.post('/backfill', asyncHandler(async (req: Request, res: Response) => {
  const parsed = BackfillSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors[0]?.message ?? 'invalid body')
  }
  const body = parsed.data

  // Caso 1: alvo específico
  if ('day' in body && 'hour' in body) {
    const t0 = Date.now()
    const result = await spriteGenerator.generateForHour(
      body.cameraId, body.day, body.hour, { force: body.force ?? false },
    )
    res.json({
      mode: 'single',
      result,
      elapsedMs: Date.now() - t0,
    })
    return
  }

  // Caso 2: batch — pega N pendentes
  const pending = await spriteGenerator.findHoursMissingSprite({
    cameraId:  body.cameraId,
    sinceDays: body.sinceDays,
    limit:     body.limit,
  })
  if (pending.length === 0) {
    res.json({ mode: 'batch', total: 0, processed: 0, results: [] })
    return
  }

  const results: any[] = []
  let okCount = 0
  for (const p of pending) {
    const t0 = Date.now()
    try {
      const r = await spriteGenerator.generateForHour(
        p.cameraId, p.day, p.hour, { force: body.force ?? false },
      )
      results.push({
        cameraId: p.cameraId, day: p.day, hour: p.hour,
        segCount: p.segCount,
        ok: r.ok, reason: r.reason,
        sizeBytes: r.sizeBytes, frameCount: r.frameCount,
        elapsedMs: Date.now() - t0,
      })
      if (r.ok) okCount++
    } catch (err: any) {
      results.push({
        cameraId: p.cameraId, day: p.day, hour: p.hour,
        ok: false, reason: err?.message ?? String(err),
        elapsedMs: Date.now() - t0,
      })
    }
  }

  logger.info({
    total: pending.length, ok: okCount, fail: pending.length - okCount,
  }, 'sprite_backfill_batch_done')

  res.json({ mode: 'batch', total: pending.length, processed: okCount, results })
}))
