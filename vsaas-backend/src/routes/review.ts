/**
 * Review Router — fila de Alerts vs Detections estilo Frigate 0.14+.
 *
 * Endpoints:
 *   GET    /review                     — lista paginada com filtros
 *   GET    /review/:id                 — detalhe (inclui faceEvents, plateEvents, audio)
 *   POST   /review                     — cria manualmente (edge-agent)
 *   PATCH  /review/:id                 — edita status/resolve
 *   POST   /review/:id/acknowledge     — acknowledge do usuário
 *   POST   /review/:id/resolve         — resolução + nota
 *   POST   /review/bulk-ack            — acknowledge em lote
 *   DELETE /review/:id                 — remove (soft = status=DISMISSED)
 *   GET    /review/stats/overview      — contagens por severidade/status
 *
 * Camera Alert Rules:
 *   GET    /review/rules               — lista regras
 *   POST   /review/rules               — cria
 *   PATCH  /review/rules/:id           — edita
 *   DELETE /review/rules/:id           — remove
 */
import { Router, Request } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { cameraTenantWhere, assertCameraBelongsToUser } from '../lib/tenant-scope'
import { cameraLogService } from '../services/camera-log.service'

export const reviewRouter = Router()
reviewRouter.use(requireAuth)

/**
 * Filtro de Camera via tenant. ATENÇÃO: a versão anterior aplicava
 * `{ clienteFinalId }` direto em Camera — campo que não existe (Camera só
 * tem siteId). Isso fazia o isolamento falhar em silêncio. Agora usamos a
 * fonte única de verdade (cameraTenantWhere) que filtra corretamente via
 * site.clienteFinal.
 */
function scopedCameraFilter(req: Request): Prisma.CameraWhereInput {
  return cameraTenantWhere(req.jwtPayload)
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW ITEMS
// ─────────────────────────────────────────────────────────────────────────────

const ListSchema = z.object({
  cameraId:       z.string().uuid().optional(),
  clienteFinalId: z.string().uuid().optional(),
  severity:       z.enum(['DETECTION', 'ALERT', 'CRITICAL']).optional(),
  status:         z.enum(['PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']).optional(),
  since:          z.string().datetime().optional(),
  until:          z.string().datetime().optional(),
  q:              z.string().max(200).optional(),
  page:           z.coerce.number().int().min(1).default(1),
  pageSize:       z.coerce.number().int().min(1).max(200).default(50),
})

reviewRouter.get('/', async (req, res) => {
  const parsed = ListSchema.safeParse(req.query)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues }); return }
  const q = parsed.data
  const scope = scopedCameraFilter(req)
  if (!scope) { res.json({ items: [], total: 0, page: 1, pageSize: q.pageSize }); return }

  const where: Prisma.ReviewItemWhereInput = {}
  const camWhere: Prisma.CameraWhereInput = { ...scope }
  // q.clienteFinalId é filtro adicional opcional; aplicado via Site (onde o
  // campo realmente existe). Combinado com tenant scope = AND.
  if (q.clienteFinalId) camWhere.site = { clienteFinalId: q.clienteFinalId }
  if (Object.keys(camWhere).length) where.camera = camWhere

  if (q.cameraId) where.cameraId = q.cameraId
  if (q.severity) where.severity = q.severity as any
  if (q.status)   where.status   = q.status as any
  if (q.since || q.until) where.startAt = {
    ...(q.since ? { gte: new Date(q.since) } : {}),
    ...(q.until ? { lte: new Date(q.until) } : {}),
  }
  if (q.q) where.OR = [
    { title:       { contains: q.q, mode: 'insensitive' } },
    { description: { contains: q.q, mode: 'insensitive' } },
    { genaiSummary:{ contains: q.q, mode: 'insensitive' } },
  ]

  const [rows, total] = await Promise.all([
    prisma.reviewItem.findMany({
      where, orderBy: { startAt: 'desc' },
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: {
        camera: { select: { id: true, name: true } },
        _count: { select: { faceEvents: true, plateEvents: true, audioEvents: true } },
      },
    }),
    prisma.reviewItem.count({ where }),
  ])
  res.json({ items: rows, page: q.page, pageSize: q.pageSize, total,
    totalPages: Math.ceil(total / q.pageSize) })
})

reviewRouter.get('/:id', async (req, res) => {
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const row = await prisma.reviewItem.findFirst({
    where: { id: req.params.id, ...(Object.keys(scope).length ? { camera: scope } : {}) },
    include: {
      camera: { select: { id: true, name: true, clienteFinalId: true } },
      faceEvents:  { include: { faceIdentity: { select: { id: true, name: true, role: true, thumbnailUrl: true } } } },
      plateEvents: { include: { licensePlate: { select: { id: true, plate: true, label: true, category: true } } } },
      audioEvents: true,
    },
  })
  if (!row) { res.status(404).json({ error: 'not_found' }); return }
  res.json(row)
})

const CreateSchema = z.object({
  cameraId:     z.string().uuid(),
  severity:     z.enum(['DETECTION', 'ALERT', 'CRITICAL']).default('DETECTION'),
  title:        z.string().min(1).max(200),
  description:  z.string().max(2000).nullish(),
  startAt:      z.string().datetime(),
  endAt:        z.string().datetime().nullish(),
  durationSec:  z.number().int().min(0).nullish(),
  objects:      z.array(z.string()).optional(),
  zones:        z.array(z.string()).optional(),
  thumbnailGcsKey: z.string().nullish(),
  clipGcsKey:   z.string().nullish(),
  genaiSummary: z.string().max(4000).nullish(),
  genaiProvider:z.string().nullish(),
  genaiModel:   z.string().nullish(),
})

reviewRouter.post('/', async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const d = parsed.data
  // Isolation: cameraId precisa pertencer ao tenant do JWT.
  await assertCameraBelongsToUser(d.cameraId, req.jwtPayload)
  const item = await prisma.reviewItem.create({
    data: {
      cameraId:        d.cameraId,
      severity:        d.severity,
      title:           d.title,
      description:     d.description ?? null,
      startAt:         new Date(d.startAt),
      endAt:           d.endAt ? new Date(d.endAt) : null,
      durationSec:     d.durationSec ?? null,
      objectsJson:     d.objects as any ?? undefined,
      zonesJson:       d.zones as any ?? undefined,
      thumbnailGcsKey: d.thumbnailGcsKey ?? null,
      clipGcsKey:      d.clipGcsKey ?? null,
      genaiSummary:    d.genaiSummary ?? null,
      genaiProvider:   d.genaiProvider ?? null,
      genaiModel:      d.genaiModel ?? null,
    },
  })
  await cameraLogService.logCamera({
    cameraId: d.cameraId,
    level:    d.severity === 'CRITICAL' ? 'ERROR' : d.severity === 'ALERT' ? 'WARN' : 'INFO',
    source:   'SYSTEM',
    message:  `Review ${d.severity}: ${d.title}`,
    details:  { reviewItemId: item.id, zones: d.zones, objects: d.objects },
    eventId:  item.id,
  })
  res.status(201).json(item)
})

const PatchSchema = z.object({
  severity:    z.enum(['DETECTION', 'ALERT', 'CRITICAL']).optional(),
  status:      z.enum(['PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']).optional(),
  title:       z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  genaiSummary:z.string().max(4000).nullish(),
  resolution:  z.string().max(1000).nullish(),
})

reviewRouter.patch('/:id', async (req, res) => {
  const parsed = PatchSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const existing = await prisma.reviewItem.findFirst({
    where: { id: req.params.id, ...(Object.keys(scope).length ? { camera: scope } : {}) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  const updated = await prisma.reviewItem.update({ where: { id: existing.id }, data: parsed.data })
  res.json(updated)
})

reviewRouter.post('/:id/acknowledge', async (req, res) => {
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const existing = await prisma.reviewItem.findFirst({
    where: { id: req.params.id, ...(Object.keys(scope).length ? { camera: scope } : {}) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  const updated = await prisma.reviewItem.update({
    where: { id: existing.id },
    data: {
      status:         'ACKNOWLEDGED',
      acknowledgedAt: new Date(),
      acknowledgedBy: req.jwtPayload!.sub,
    },
  })
  res.json(updated)
})

reviewRouter.post('/:id/resolve', async (req, res) => {
  const parsed = z.object({ resolution: z.string().max(1000).optional() }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const existing = await prisma.reviewItem.findFirst({
    where: { id: req.params.id, ...(Object.keys(scope).length ? { camera: scope } : {}) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  const updated = await prisma.reviewItem.update({
    where: { id: existing.id },
    data: {
      status:     'RESOLVED',
      resolvedAt: new Date(),
      resolvedBy: req.jwtPayload!.sub,
      resolution: parsed.data.resolution ?? null,
    },
  })
  res.json(updated)
})

reviewRouter.post('/bulk-ack', async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const visible = await prisma.reviewItem.findMany({
    where: { id: { in: parsed.data.ids }, ...(Object.keys(scope).length ? { camera: scope } : {}) },
    select: { id: true },
  })
  const ids = visible.map(r => r.id)
  const result = await prisma.reviewItem.updateMany({
    where: { id: { in: ids } },
    data: {
      status:         'ACKNOWLEDGED',
      acknowledgedAt: new Date(),
      acknowledgedBy: req.jwtPayload!.sub,
    },
  })
  res.json({ acknowledged: result.count })
})

reviewRouter.delete('/:id', async (req, res) => {
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const existing = await prisma.reviewItem.findFirst({
    where: { id: req.params.id, ...(Object.keys(scope).length ? { camera: scope } : {}) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  await prisma.reviewItem.update({ where: { id: existing.id }, data: { status: 'DISMISSED' } })
  res.status(204).end()
})

reviewRouter.get('/stats/overview', async (req, res) => {
  const schema = z.object({
    days:           z.coerce.number().int().min(1).max(365).default(7),
    clienteFinalId: z.string().uuid().optional(),
  })
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_query' }); return }
  const since = new Date(Date.now() - parsed.data.days * 24 * 60 * 60 * 1000)
  const scope = scopedCameraFilter(req)
  if (!scope) { res.json({}); return }
  const camWhere: Prisma.CameraWhereInput = { ...scope }
  if (parsed.data.clienteFinalId) camWhere.site = { clienteFinalId: parsed.data.clienteFinalId }
  const where: Prisma.ReviewItemWhereInput = {
    startAt: { gte: since },
    ...(Object.keys(camWhere).length ? { camera: camWhere } : {}),
  }
  const [total, bySeverity, byStatus, pendingAlerts, avgResolve] = await Promise.all([
    prisma.reviewItem.count({ where }),
    prisma.reviewItem.groupBy({ by: ['severity'], where, _count: true }),
    prisma.reviewItem.groupBy({ by: ['status'],   where, _count: true }),
    prisma.reviewItem.count({ where: { ...where, severity: { in: ['ALERT'] }, status: 'PENDING' } }),
    prisma.$queryRaw<Array<{ avg: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "startAt")))::double precision AS avg
      FROM "ReviewItem"
      WHERE "startAt" >= ${since} AND "resolvedAt" IS NOT NULL
    `,
  ])
  res.json({
    since, total, pendingAlerts,
    avgResolveSec: avgResolve[0]?.avg ?? null,
    bySeverity: bySeverity.map(b => ({ severity: b.severity, count: b._count })),
    byStatus:   byStatus.map(b => ({ status: b.status, count: b._count })),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ALERT RULES
// ─────────────────────────────────────────────────────────────────────────────

const RuleSchema = z.object({
  cameraId:    z.string().uuid(),
  name:        z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  enabled:     z.boolean().optional(),
  triggerType: z.enum([
    'ZONE_OCCUPANCY', 'LOITERING', 'TRIPWIRE', 'PPE_VIOLATION',
    'FACE_MATCH', 'FACE_UNKNOWN', 'LPR_BLACKLIST', 'AUDIO_DETECT',
    'MOTION_AREA', 'OBJECT_CLASS', 'QUEUE_OVERFLOW',
  ]),
  conditions:  z.record(z.any()),
  schedule:    z.record(z.any()).optional(),
  cooldownSec: z.number().int().min(0).max(3600).optional(),
  severity:    z.enum(['DETECTION', 'ALERT', 'CRITICAL']).default('ALERT'),
  notifyEmail: z.string().email().nullish(),
  notifyWebhookUrl: z.string().url().nullish(),
  notifyPushEnabled: z.boolean().optional(),
  notifyMqttTopic: z.string().nullish(),
})

reviewRouter.get('/rules/list', async (req, res) => {
  const scope = scopedCameraFilter(req)
  if (!scope) { res.json({ items: [] }); return }
  const cameraId = typeof req.query.cameraId === 'string' ? req.query.cameraId : undefined
  const rules = await prisma.cameraAlertRule.findMany({
    where: {
      ...(cameraId ? { cameraId } : {}),
      ...(Object.keys(scope).length ? { camera: scope } : {}),
    },
    include: { camera: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ items: rules })
})

reviewRouter.post('/rules', async (req, res) => {
  const parsed = RuleSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const d = parsed.data
  // Isolation: cameraId da regra precisa pertencer ao tenant.
  await assertCameraBelongsToUser(d.cameraId, req.jwtPayload)
  const created = await prisma.cameraAlertRule.create({
    data: {
      cameraId:      d.cameraId,
      name:          d.name,
      description:   d.description ?? null,
      enabled:       d.enabled ?? true,
      triggerType:   d.triggerType,
      conditionsJson:d.conditions as any,
      scheduleJson:  d.schedule as any ?? undefined,
      cooldownSec:   d.cooldownSec ?? 60,
      severity:      d.severity,
      notifyEmail:      d.notifyEmail ?? null,
      notifyWebhookUrl: d.notifyWebhookUrl ?? null,
      notifyPushEnabled:d.notifyPushEnabled ?? false,
      notifyMqttTopic:  d.notifyMqttTopic ?? null,
    },
  })
  res.status(201).json(created)
})

reviewRouter.patch('/rules/:id', async (req, res) => {
  const parsed = RuleSchema.partial().omit({ cameraId: true }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues }); return }
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const existing = await prisma.cameraAlertRule.findFirst({
    where: { id: req.params.id, ...(Object.keys(scope).length ? { camera: scope } : {}) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  const d = parsed.data
  const updated = await prisma.cameraAlertRule.update({
    where: { id: existing.id },
    data: {
      ...(d.name        !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.enabled     !== undefined ? { enabled: d.enabled } : {}),
      ...(d.triggerType !== undefined ? { triggerType: d.triggerType } : {}),
      ...(d.conditions  !== undefined ? { conditionsJson: d.conditions as any } : {}),
      ...(d.schedule    !== undefined ? { scheduleJson: d.schedule as any } : {}),
      ...(d.cooldownSec !== undefined ? { cooldownSec: d.cooldownSec } : {}),
      ...(d.severity    !== undefined ? { severity: d.severity } : {}),
      ...(d.notifyEmail      !== undefined ? { notifyEmail: d.notifyEmail } : {}),
      ...(d.notifyWebhookUrl !== undefined ? { notifyWebhookUrl: d.notifyWebhookUrl } : {}),
      ...(d.notifyPushEnabled!== undefined ? { notifyPushEnabled: d.notifyPushEnabled } : {}),
      ...(d.notifyMqttTopic  !== undefined ? { notifyMqttTopic: d.notifyMqttTopic } : {}),
    },
  })
  res.json(updated)
})

reviewRouter.delete('/rules/:id', async (req, res) => {
  const scope = scopedCameraFilter(req)
  if (!scope) { res.status(403).json({ error: 'forbidden' }); return }
  const existing = await prisma.cameraAlertRule.findFirst({
    where: { id: req.params.id, ...(Object.keys(scope).length ? { camera: scope } : {}) },
  })
  if (!existing) { res.status(404).json({ error: 'not_found' }); return }
  await prisma.cameraAlertRule.delete({ where: { id: existing.id } })
  res.status(204).end()
})
