/**
 * License Plates Router — cadastro de placas conhecidas + eventos LPR.
 *
 * Endpoints:
 *   GET    /plates                    — lista placas cadastradas com filtros
 *   POST   /plates                    — cadastra nova placa
 *   GET    /plates/:id                — detalhe
 *   PATCH  /plates/:id                — edita
 *   DELETE /plates/:id                — remove
 *
 *   GET    /plates/events             — eventos LPR (captures)
 *   POST   /plates/events/ingest      — edge-agent reporta detecção OCR
 *   GET    /plates/stats              — agregações (top placas, in/out, desconhecidas)
 */
import { Router, Request } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth, requireSudo } from '../middleware/auth'
import { cameraTenantWhere } from '../lib/tenant-scope'
import { cameraLogService } from '../services/camera-log.service'
import { dispatchAlert } from '../lib/notification-dispatcher'
import { logger } from '../lib/logger'

export const platesRouter = Router()
platesRouter.use(requireAuth)
// LGPD: placas = identificável (associável a proprietário). Integrador eleva.
platesRouter.use(requireSudo)

// Normaliza placa BR: remove separadores e uppercase
function normalizePlate(p: string): string {
  return p.replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

// Levenshtein simples p/ match aproximado
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[m][n]
}

function tenantFilter(req: Request): Prisma.LicensePlateWhereInput {
  const p = req.jwtPayload!
  if (p.role === 'SUPER_ADMIN') return {}
  if (p.clienteFinalId) return { clienteFinalId: p.clienteFinalId }
  if (p.integradorId) {
    return { clienteFinal: { integradorId: p.integradorId } }
  }
  return { id: '00000000-0000-0000-0000-000000000000' }
}

async function canAccessCliente(req: Request, cfId: string): Promise<boolean> {
  const p = req.jwtPayload!
  if (p.role === 'SUPER_ADMIN') return true
  if (p.clienteFinalId === cfId) return true
  if (p.integradorId) {
    const cf = await prisma.clienteFinal.findUnique({
      where: { id: cfId }, select: { integradorId: true },
    })
    return cf?.integradorId === p.integradorId
  }
  return false
}

const PlateSchema = z.object({
  clienteFinalId: z.string().uuid(),
  plate:          z.string().min(4).max(12),
  label:          z.string().max(120).nullish(),
  category:       z.enum(['AUTHORIZED', 'VISITOR', 'RESIDENT', 'DELIVERY', 'BLACKLIST', 'UNKNOWN']).default('AUTHORIZED'),
  vehicleModel:   z.string().max(80).nullish(),
  vehicleColor:   z.string().max(30).nullish(),
  vehicleType:    z.enum(['car', 'motorcycle', 'truck', 'bus', 'van', 'other']).nullish(),
  ownerName:      z.string().max(120).nullish(),
  ownerDocument:  z.string().max(30).nullish(),
  validFrom:      z.string().datetime().nullish(),
  validUntil:     z.string().datetime().nullish(),
  active:         z.boolean().optional(),
  alertOnMatch:   z.boolean().optional(),
})
const PlatePatch = PlateSchema.partial().omit({ clienteFinalId: true })

// ── GET /plates ──
platesRouter.get('/', async (req, res) => {
  const schema = z.object({
    clienteFinalId: z.string().uuid().optional(),
    category:       z.string().optional(),
    active:         z.enum(['true', 'false']).optional(),
    q:              z.string().max(50).optional(),
    page:           z.coerce.number().int().min(1).default(1),
    pageSize:       z.coerce.number().int().min(1).max(200).default(50),
  })
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues }); return
  }
  const q = parsed.data
  const where: Prisma.LicensePlateWhereInput = { ...tenantFilter(req) }
  if (q.clienteFinalId) where.clienteFinalId = q.clienteFinalId
  if (q.category)       where.category = q.category as any
  if (q.active)         where.active = q.active === 'true'
  if (q.q) {
    where.OR = [
      { plate:     { contains: normalizePlate(q.q) } },
      { label:     { contains: q.q, mode: 'insensitive' } },
      { ownerName: { contains: q.q, mode: 'insensitive' } },
    ]
  }
  const [rows, total] = await Promise.all([
    prisma.licensePlate.findMany({
      where, orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { _count: { select: { events: true } } },
    }),
    prisma.licensePlate.count({ where }),
  ])
  res.json({ items: rows, page: q.page, pageSize: q.pageSize, total,
    totalPages: Math.ceil(total / q.pageSize) })
})

// ── POST /plates ──
platesRouter.post('/', async (req, res) => {
  const parsed = PlateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  if (!(await canAccessCliente(req, parsed.data.clienteFinalId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const plate = normalizePlate(parsed.data.plate)
  try {
    const created = await prisma.licensePlate.create({
      data: {
        ...parsed.data,
        plate,
        validFrom:  parsed.data.validFrom  ? new Date(parsed.data.validFrom)  : null,
        validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      },
    })
    res.status(201).json(created)
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'plate_already_exists' })
      return
    }
    throw err
  }
})

// ── GET /plates/:id ──
platesRouter.get('/:id', async (req, res) => {
  const row = await prisma.licensePlate.findFirst({
    where: { id: req.params.id, ...tenantFilter(req) },
    include: {
      events: {
        orderBy: { capturedAt: 'desc' }, take: 30,
        include: { camera: { select: { id: true, name: true } } },
      },
      _count: { select: { events: true } },
    },
  })
  if (!row) { res.status(404).json({ error: 'not_found' }); return }
  res.json(row)
})

// ── PATCH /plates/:id ──
platesRouter.patch('/:id', async (req, res) => {
  const parsed = PlatePatch.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const existing = await prisma.licensePlate.findFirst({
    where: { id: req.params.id, ...tenantFilter(req) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  const data: Prisma.LicensePlateUpdateInput = { ...parsed.data }
  if (parsed.data.plate) data.plate = normalizePlate(parsed.data.plate)
  if (parsed.data.validFrom !== undefined)  data.validFrom  = parsed.data.validFrom ? new Date(parsed.data.validFrom) : null
  if (parsed.data.validUntil !== undefined) data.validUntil = parsed.data.validUntil ? new Date(parsed.data.validUntil) : null
  const updated = await prisma.licensePlate.update({ where: { id: existing.id }, data })
  res.json(updated)
})

// ── DELETE /plates/:id ──
platesRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.licensePlate.findFirst({
    where: { id: req.params.id, ...tenantFilter(req) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  await prisma.licensePlate.delete({ where: { id: existing.id } })
  res.status(204).end()
})

// ── GET /plates/events ──
platesRouter.get('/events/list', async (req, res) => {
  const schema = z.object({
    cameraId:       z.string().uuid().optional(),
    licensePlateId: z.string().uuid().optional(),
    category:       z.string().optional(),
    plate:          z.string().optional(),
    direction:      z.enum(['IN', 'OUT']).optional(),
    clienteFinalId: z.string().uuid().optional(),
    since:          z.string().datetime().optional(),
    until:          z.string().datetime().optional(),
    page:           z.coerce.number().int().min(1).default(1),
    pageSize:       z.coerce.number().int().min(1).max(200).default(50),
  })
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues }); return }
  const q = parsed.data
  const p = req.jwtPayload!
  const where: Prisma.LicensePlateEventWhereInput = {}

  // Tenant scope via helper (Camera não tem clienteFinalId direto, é via Site).
  const camWhere: Prisma.CameraWhereInput = { ...cameraTenantWhere(p) }
  if (q.clienteFinalId) camWhere.site = { clienteFinalId: q.clienteFinalId }
  if (Object.keys(camWhere).length) where.camera = camWhere

  if (q.cameraId)       where.cameraId = q.cameraId
  if (q.licensePlateId) where.licensePlateId = q.licensePlateId
  if (q.direction)      where.direction = q.direction
  if (q.plate)          where.detectedPlate = { contains: normalizePlate(q.plate) }
  if (q.since || q.until) where.capturedAt = {
    ...(q.since ? { gte: new Date(q.since) } : {}),
    ...(q.until ? { lte: new Date(q.until) } : {}),
  }
  if (q.category) where.licensePlate = { category: q.category as any }

  const [rows, total] = await Promise.all([
    prisma.licensePlateEvent.findMany({
      where, orderBy: { capturedAt: 'desc' },
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: {
        camera:       { select: { id: true, name: true } },
        licensePlate: { select: { id: true, plate: true, label: true, category: true, alertOnMatch: true } },
      },
    }),
    prisma.licensePlateEvent.count({ where }),
  ])
  res.json({ items: rows, page: q.page, pageSize: q.pageSize, total,
    totalPages: Math.ceil(total / q.pageSize) })
})

// ── POST /plates/events/ingest — edge reporta ──
platesRouter.post('/events/ingest', async (req, res) => {
  const schema = z.object({
    cameraId:      z.string().uuid(),
    detectedPlate: z.string().min(4).max(12),
    ocrScore:      z.number().min(0).max(1),
    vehicleType:   z.string().max(30).nullish(),
    vehicleColor:  z.string().max(30).nullish(),
    direction:     z.enum(['IN', 'OUT']).nullish(),
    capturedAt:    z.string().datetime(),
    bbox:          z.record(z.number()).nullish(),
    cropGcsKey:    z.string().nullish(),
    frameGcsKey:   z.string().nullish(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }

  const plate = normalizePlate(parsed.data.detectedPlate)

  // Busca câmera → cliente final (via Site) p/ match aproximado.
  // Camera não tem clienteFinalId direto; obtemos via site.clienteFinalId.
  const camera = await prisma.camera.findUnique({
    where: { id: parsed.data.cameraId },
    select: {
      lprMatchDistance: true,
      site: { select: { clienteFinalId: true } },
    },
  })
  if (!camera) { res.status(404).json({ error: 'camera_not_found' }); return }

  // Match aproximado contra placas cadastradas do cliente
  const maxDist = camera.lprMatchDistance ?? 1
  const known = await prisma.licensePlate.findMany({
    where: { clienteFinalId: camera.site.clienteFinalId, active: true },
    select: { id: true, plate: true, alertOnMatch: true, category: true, label: true },
  })
  let best: { id: string; distance: number; category: string } | null = null
  for (const kp of known) {
    const d = levenshtein(kp.plate, plate)
    if (d <= maxDist && (!best || d < best.distance)) {
      best = { id: kp.id, distance: d, category: kp.category }
    }
  }

  const ev = await prisma.licensePlateEvent.create({
    data: {
      cameraId:       parsed.data.cameraId,
      licensePlateId: best?.id ?? null,
      detectedPlate:  plate,
      matchDistance:  best?.distance ?? null,
      ocrScore:       parsed.data.ocrScore,
      vehicleType:    parsed.data.vehicleType ?? null,
      vehicleColor:   parsed.data.vehicleColor ?? null,
      direction:      parsed.data.direction ?? null,
      capturedAt:     new Date(parsed.data.capturedAt),
      bboxJson:       parsed.data.bbox as any ?? undefined,
      cropGcsKey:     parsed.data.cropGcsKey ?? null,
      frameGcsKey:    parsed.data.frameGcsKey ?? null,
    },
  })

  await cameraLogService.logCamera({
    cameraId: parsed.data.cameraId,
    level:    best?.category === 'BLACKLIST' ? 'ERROR' : 'INFO',
    source:   'LPR',
    message:  best
      ? `LPR match: ${plate} → ${best.category} (dist=${best.distance})`
      : `LPR unknown plate: ${plate} (ocr=${parsed.data.ocrScore.toFixed(2)})`,
    details:  { plate, direction: parsed.data.direction, ocrScore: parsed.data.ocrScore },
    eventId:  ev.id,
  })

  // ── Disparar alerta se a placa cadastrada exigir notificação ──────────────
  // Hoje fan-out: WebPush + Telegram + WhatsApp + Email + Popup (SSE)
  if (best) {
    const matched = known.find(k => k.id === best!.id)
    if (matched?.alertOnMatch) {
      const cameraInfo = await prisma.camera.findUnique({
        where: { id: parsed.data.cameraId },
        select: {
          name: true,
          site: { select: { clienteFinal: { select: { id: true, integradorId: true, name: true } } } },
        },
      })

      const isBlacklist = best.category === 'BLACKLIST'
      const severity: 'INFO' | 'WARNING' | 'CRITICAL' = isBlacklist ? 'CRITICAL' : 'INFO'
      const titlePrefix = isBlacklist ? '🚨 PLACA SUSPEITA DETECTADA' : '🚗 Placa reconhecida'

      dispatchAlert({
        integradorId:   cameraInfo!.site.clienteFinal.integradorId,
        clienteFinalId: cameraInfo!.site.clienteFinal.id,
        title:          `${titlePrefix} — ${plate}`,
        body:           `${matched.label ?? plate} (${best.category})${parsed.data.direction ? ` • ${parsed.data.direction}` : ''}`,
        cameraName:     cameraInfo!.name,
        severity,
        eventId:        ev.id,
      }).catch(err => logger.warn({ err: err.message }, 'plate_dispatch_alert_failed'))
    }
  }

  res.status(201).json({ event: ev, matched: best })
})

// ── GET /plates/stats ──
platesRouter.get('/stats/overview', async (req, res) => {
  const schema = z.object({
    clienteFinalId: z.string().uuid().optional(),
    days:           z.coerce.number().int().min(1).max(365).default(7),
  })
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues }); return }
  const since = new Date(Date.now() - parsed.data.days * 24 * 60 * 60 * 1000)

  const p = req.jwtPayload!
  const camWhere: Prisma.CameraWhereInput = { ...cameraTenantWhere(p) }
  if (parsed.data.clienteFinalId) camWhere.site = { clienteFinalId: parsed.data.clienteFinalId }

  const where: Prisma.LicensePlateEventWhereInput = {
    capturedAt: { gte: since },
    ...(Object.keys(camWhere).length ? { camera: camWhere } : {}),
  }

  const [total, unknown, byCategory, byDirection, topPlates] = await Promise.all([
    prisma.licensePlateEvent.count({ where }),
    prisma.licensePlateEvent.count({ where: { ...where, licensePlateId: null } }),
    prisma.licensePlateEvent.groupBy({
      by: ['licensePlateId'], where, _count: true,
      orderBy: { _count: { licensePlateId: 'desc' } }, take: 10,
    }),
    prisma.licensePlateEvent.groupBy({ by: ['direction'], where, _count: true }),
    prisma.licensePlateEvent.groupBy({
      by: ['detectedPlate'], where, _count: true,
      orderBy: { _count: { detectedPlate: 'desc' } }, take: 10,
    }),
  ])

  res.json({
    since, totalEvents: total, unknownCount: unknown,
    byCategory:  byCategory.map(b => ({ licensePlateId: b.licensePlateId, count: b._count })),
    byDirection: byDirection.map(b => ({ direction: b.direction, count: b._count })),
    topPlates:   topPlates.map(t => ({ plate: t.detectedPlate, count: t._count })),
  })
})
