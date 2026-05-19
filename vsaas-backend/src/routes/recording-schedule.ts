/**
 * Recording Schedule Routes — agendamento de gravação por dia/hora/modo.
 *
 * GET    /cameras/:cameraId/recording-schedule
 * PUT    /cameras/:cameraId/recording-schedule           → bulk replace (transação)
 * DELETE /cameras/:cameraId/recording-schedule           → limpa todas as entradas
 * GET    /cameras/:cameraId/recording-schedule/effective?at=ISO
 *
 * Multi-tenant: câmera tem que pertencer ao usuário (requireCameraForUser).
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { blockReadOnly } from '../middleware/block-read-only'
import { asyncHandler } from '../middleware/async-handler'
import { requireCameraForUser } from '../lib/tenant-scope'
import { ValidationError } from '../lib/errors'

function scheduleLocalHourDow(date: Date, timezone: string): { hour: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(date)
  const hour   = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
  const dowStr = parts.find(p => p.type === 'weekday')?.value ?? 'Sun'
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { hour, dow: DOW[dowStr] ?? 0 }
}

export const recordingScheduleRouter = Router()
recordingScheduleRouter.use(requireAuth)

const SCHEDULE_MODES = ['ALWAYS', 'MOTION', 'EVENT', 'MOTION_AND_EVENT', 'DISABLED'] as const

const ScheduleEntrySchema = z.object({
  /// 0=Sun, 1=Mon, ..., 6=Sat, 7=every day
  dayOfWeek: z.number().int().min(0).max(7),
  hourStart: z.number().int().min(0).max(23),
  hourEnd:   z.number().int().min(1).max(24),
  mode:      z.enum(SCHEDULE_MODES).default('ALWAYS'),
}).refine(e => e.hourEnd > e.hourStart, {
  message: 'hourEnd deve ser maior que hourStart',
})

const PutScheduleSchema = z.object({
  entries: z.array(ScheduleEntrySchema).max(7 * 24),
})

// =============================================================================
// GET /cameras/:cameraId/recording-schedule
// =============================================================================

recordingScheduleRouter.get(
  '/:cameraId/recording-schedule',
  asyncHandler(async (req: Request, res: Response) => {
    await requireCameraForUser(String(req.params.cameraId), req.jwtPayload, { select: { id: true } })

    const entries = await prisma.recordingSchedule.findMany({
      where: { cameraId: String(req.params.cameraId) },
      orderBy: [{ dayOfWeek: 'asc' }, { hourStart: 'asc' }],
    })

    res.json({
      cameraId: String(req.params.cameraId),
      entries,
      total: entries.length,
    })
  }),
)

// =============================================================================
// PUT /cameras/:cameraId/recording-schedule — bulk replace
// =============================================================================

recordingScheduleRouter.put(
  '/:cameraId/recording-schedule',
  blockReadOnly,
  asyncHandler(async (req: Request, res: Response) => {
    await requireCameraForUser(String(req.params.cameraId), req.jwtPayload, { select: { id: true } })

    const parse = PutScheduleSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const { entries } = parse.data

    // Detecta colisões de chave única (cameraId, dayOfWeek, hourStart) já no body —
    // evita 500 do Prisma com mensagem mais útil.
    const seen = new Set<string>()
    for (const e of entries) {
      const k = `${e.dayOfWeek}|${e.hourStart}`
      if (seen.has(k)) {
        throw new ValidationError(`Entrada duplicada: dayOfWeek=${e.dayOfWeek}, hourStart=${e.hourStart}`)
      }
      seen.add(k)
    }

    const cameraId = String(req.params.cameraId)

    const inserted = await prisma.$transaction(async (tx) => {
      await tx.recordingSchedule.deleteMany({ where: { cameraId } })
      if (entries.length > 0) {
        await tx.recordingSchedule.createMany({
          data: entries.map(e => ({
            cameraId,
            dayOfWeek: e.dayOfWeek,
            hourStart: e.hourStart,
            hourEnd:   e.hourEnd,
            mode:      e.mode,
          })),
        })
      }
      return tx.recordingSchedule.findMany({
        where: { cameraId },
        orderBy: [{ dayOfWeek: 'asc' }, { hourStart: 'asc' }],
      })
    })

    res.json({
      cameraId,
      entries: inserted,
      total: inserted.length,
    })
  }),
)

// =============================================================================
// DELETE /cameras/:cameraId/recording-schedule — limpa tudo
// =============================================================================

recordingScheduleRouter.delete(
  '/:cameraId/recording-schedule',
  blockReadOnly,
  asyncHandler(async (req: Request, res: Response) => {
    await requireCameraForUser(String(req.params.cameraId), req.jwtPayload, { select: { id: true } })
    const result = await prisma.recordingSchedule.deleteMany({
      where: { cameraId: String(req.params.cameraId) },
    })
    res.json({ ok: true, deleted: result.count })
  }),
)

// =============================================================================
// GET /cameras/:cameraId/recording-schedule/effective?at=ISO
//   Resolve o modo efetivo de gravação para um timestamp dado. Usado pelo edge
//   config endpoint pra saber se a câmera deve estar gravando agora mesmo.
// =============================================================================

recordingScheduleRouter.get(
  '/:cameraId/recording-schedule/effective',
  asyncHandler(async (req: Request, res: Response) => {
    await requireCameraForUser(String(req.params.cameraId), req.jwtPayload, { select: { id: true } })

    const atRaw = req.query.at
    const at = typeof atRaw === 'string' && atRaw ? new Date(atRaw) : new Date()
    if (isNaN(at.getTime())) {
      throw new ValidationError('at inválido (esperado ISO datetime)')
    }

    // Resolve timezone da câmera para comparar horas em horário local do operador.
    const tzRow = await prisma.camera.findUnique({
      where:  { id: String(req.params.cameraId) },
      select: { site: { select: { clienteFinal: { select: { timezone: true } } } } },
    })
    const timezone = tzRow?.site?.clienteFinal?.timezone ?? 'America/Sao_Paulo'
    const { dow, hour } = scheduleLocalHourDow(at, timezone)

    // Procura por entrada específica do dia OU "todos os dias" (7) que cubra a hora atual.
    const entries = await prisma.recordingSchedule.findMany({
      where: {
        cameraId: String(req.params.cameraId),
        dayOfWeek: { in: [dow, 7] },
        hourStart: { lte: hour },
        hourEnd:   { gt: hour },
      },
      orderBy: [
        // Preferência: dia específico antes de "todos"
        { dayOfWeek: 'desc' },
        { hourStart: 'desc' },
      ],
      take: 1,
    })

    const effective = entries[0]
    res.json({
      cameraId: String(req.params.cameraId),
      at:       at.toISOString(),
      dayOfWeek: dow,
      hour,
      // Se nenhuma entrada cobre o momento → não há gravação programada → DISABLED
      mode: effective ? effective.mode : 'DISABLED',
      matched: effective ?? null,
    })
  }),
)
