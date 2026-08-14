/**
 * Logs Router — consulta unificada de CameraLog + SystemLog, estilo Frigate.
 *
 * Endpoints:
 *   GET  /logs                 — busca paginada com filtros avançados
 *   GET  /logs/export.csv      — download CSV (streaming) dos resultados filtrados
 *   GET  /logs/stream          — Server-Sent Events (live-tail)
 *   GET  /logs/stats           — agregação por level/source/hora para dashboards
 *   GET  /logs/sources         — catálogo dos enums (level + source) p/ dropdowns
 *   DELETE /logs/purge         — purga de logs antigos (somente SUPER_ADMIN)
 *
 * Escopo multi-tenant:
 *   - SUPER_ADMIN         → vê TUDO
 *   - INTEGRADOR_ADMIN    → só logs das câmeras dos seus clienteFinais + seu SystemLog
 *   - INTEGRADOR_TECNICO  → idem integrador_admin (mas somente leitura)
 *   - CLIENTE_VIEWER      → só logs do seu clienteFinalId
 */
import { Router, Request, Response } from 'express'
import { publicRoute } from '../middleware/require-capability'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { logger } from '../lib/logger'
import { Prisma } from '@prisma/client'

export const logsRouter = Router()
logsRouter.use(requireAuth)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const LOG_LEVELS  = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const
const LOG_SOURCES = [
  'FFMPEG','DETECTOR','MOTION','RECORDER','SNAPSHOT','ZONE','ONVIF','PTZ',
  'AUDIO','FACE','LPR','GENAI','SEMANTIC','SYSTEM','EDGE_AGENT','VERTEX',
  'CLOUD_VISION','GCS','AUTH','API',
] as const

const SCOPE_KINDS = ['camera', 'system', 'all'] as const

const QuerySchema = z.object({
  kind:          z.enum(SCOPE_KINDS).default('all'),
  level:         z.enum(LOG_LEVELS).optional(),
  levels:        z.string().optional(), // "ERROR,WARN"
  source:        z.enum(LOG_SOURCES).optional(),
  sources:       z.string().optional(),
  cameraId:      z.string().uuid().optional(),
  siteId:        z.string().uuid().optional(),
  clienteFinalId:z.string().uuid().optional(),
  integradorId:  z.string().uuid().optional(),
  edgeNodeId:    z.string().uuid().optional(),
  eventId:       z.string().uuid().optional(),
  correlationId: z.string().optional(),
  errorCode:     z.string().optional(),
  userId:        z.string().uuid().optional(),
  since:         z.string().datetime().optional(),
  until:         z.string().datetime().optional(),
  q:             z.string().max(200).optional(),        // full-text no message
  hasError:      z.enum(['true', 'false']).optional(),
  minDurationMs: z.coerce.number().int().nonnegative().optional(),
  statusCode:    z.coerce.number().int().min(100).max(599).optional(),
  page:          z.coerce.number().int().min(1).default(1),
  pageSize:      z.coerce.number().int().min(1).max(500).default(100),
  order:         z.enum(['asc', 'desc']).default('desc'),
})

type Scope = {
  role: string
  integradorId?: string
  clienteFinalId?: string
  userId?: string
}

function getScope(req: Request): Scope {
  const p = req.jwtPayload!
  return {
    role: p.role,
    integradorId:   p.integradorId,
    clienteFinalId: p.clienteFinalId,
    userId:         p.sub,
  }
}

/**
 * Resolve o conjunto de cameraIds visíveis para o escopo (usado p/ filtrar CameraLog).
 * Retorna undefined quando o escopo é irrestrito (SUPER_ADMIN).
 */
async function visibleCameraIds(scope: Scope): Promise<string[] | undefined> {
  if (scope.role === 'SUPER_ADMIN') return undefined

  // Camera só tem siteId direto. clienteFinal e integrador vêm via Site.
  // (era um bug: `where.clienteFinalId` e `where.clienteFinal.integradorId`
  // não existem em CameraWhereInput → 500 PrismaClientValidationError.)
  const where: Prisma.CameraWhereInput = {}
  if (scope.clienteFinalId) {
    where.site = { clienteFinalId: scope.clienteFinalId }
  } else if (scope.integradorId) {
    where.site = { clienteFinal: { integradorId: scope.integradorId } }
  } else {
    // sem tenant → nada visível
    return []
  }
  const rows = await prisma.camera.findMany({ where, select: { id: true } })
  return rows.map(r => r.id)
}

function parseCsv<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!raw) return undefined
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean) as T[]
  const valid = parts.filter(p => (allowed as readonly string[]).includes(p))
  return valid.length ? valid : undefined
}

function buildCameraWhere(q: z.infer<typeof QuerySchema>, camIds: string[] | undefined): Prisma.CameraLogWhereInput {
  const where: Prisma.CameraLogWhereInput = {}
  if (camIds !== undefined) where.cameraId = { in: camIds }
  if (q.cameraId)       where.cameraId = q.cameraId
  if (q.eventId)        where.eventId = q.eventId
  if (q.correlationId)  where.correlationId = q.correlationId
  if (q.errorCode)      where.errorCode = { contains: q.errorCode, mode: 'insensitive' }
  if (q.level)          where.level = q.level
  const lvls = parseCsv(q.levels, LOG_LEVELS)
  if (lvls) where.level = { in: lvls }
  if (q.source)         where.source = q.source
  const srcs = parseCsv(q.sources, LOG_SOURCES)
  if (srcs) where.source = { in: srcs }
  if (q.since || q.until) {
    where.recordedAt = {
      ...(q.since ? { gte: new Date(q.since) } : {}),
      ...(q.until ? { lte: new Date(q.until) } : {}),
    }
  }
  if (q.q) where.message = { contains: q.q, mode: 'insensitive' }
  if (q.hasError === 'true')  where.errorCode = { not: null }
  if (q.hasError === 'false') where.errorCode = null
  if (q.minDurationMs !== undefined) where.durationMs = { gte: q.minDurationMs }
  return where
}

function buildSystemWhere(q: z.infer<typeof QuerySchema>, scope: Scope): Prisma.SystemLogWhereInput {
  const where: Prisma.SystemLogWhereInput = {}
  if (scope.role !== 'SUPER_ADMIN') {
    if (scope.clienteFinalId) where.clienteFinalId = scope.clienteFinalId
    else if (scope.integradorId) where.integradorId = scope.integradorId
    else return { id: '00000000-0000-0000-0000-000000000000' } // nada
  }
  // A3: integradorId/clienteFinalId só ESTREITAM. Super filtra livre; integrador
  // pode AND por clienteFinalId (logs de outro integrador não casam); cliente
  // fica preso ao próprio (ignora override). siteId/edgeNodeId são AND seguros.
  if (scope.role === 'SUPER_ADMIN') {
    if (q.integradorId)   where.integradorId   = q.integradorId
    if (q.clienteFinalId) where.clienteFinalId = q.clienteFinalId
  } else if (scope.integradorId && !scope.clienteFinalId) {
    if (q.clienteFinalId) where.clienteFinalId = q.clienteFinalId
  }
  if (q.siteId)         where.siteId         = q.siteId
  if (q.edgeNodeId)     where.edgeNodeId     = q.edgeNodeId
  if (q.userId)         where.userId         = q.userId
  if (q.correlationId)  where.correlationId  = q.correlationId
  if (q.errorCode)      where.errorCode = { contains: q.errorCode, mode: 'insensitive' }
  if (q.level)          where.level  = q.level
  const lvls = parseCsv(q.levels, LOG_LEVELS)
  if (lvls) where.level = { in: lvls }
  if (q.source)         where.source = q.source
  const srcs = parseCsv(q.sources, LOG_SOURCES)
  if (srcs) where.source = { in: srcs }
  if (q.statusCode)     where.statusCode = q.statusCode
  if (q.since || q.until) {
    where.recordedAt = {
      ...(q.since ? { gte: new Date(q.since) } : {}),
      ...(q.until ? { lte: new Date(q.until) } : {}),
    }
  }
  if (q.q) where.message = { contains: q.q, mode: 'insensitive' }
  if (q.hasError === 'true')  where.errorCode = { not: null }
  if (q.hasError === 'false') where.errorCode = null
  if (q.minDurationMs !== undefined) where.durationMs = { gte: q.minDurationMs }
  return where
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /logs/sources — catálogo p/ dropdowns
// ─────────────────────────────────────────────────────────────────────────────
logsRouter.get('/sources', publicRoute(), (_req, res) => {
  res.json({
    levels:  LOG_LEVELS,
    sources: LOG_SOURCES,
    kinds:   SCOPE_KINDS,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /logs — lista paginada unificada
// ─────────────────────────────────────────────────────────────────────────────
logsRouter.get('/', publicRoute(), async (req: Request, res: Response) => {
  const parsed = QuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues })
    return
  }
  const q = parsed.data
  const scope = getScope(req)
  const camIds = await visibleCameraIds(scope)

  const take = q.pageSize
  const skip = (q.page - 1) * take
  const orderBy = { recordedAt: q.order as 'asc' | 'desc' }

  // Executa conforme kind
  if (q.kind === 'camera') {
    const where = buildCameraWhere(q, camIds)
    const [rows, total] = await Promise.all([
      prisma.cameraLog.findMany({
        where, orderBy, skip, take,
        include: { camera: { select: { id: true, name: true, siteId: true } } },
      }),
      prisma.cameraLog.count({ where }),
    ])
    res.json({
      kind: 'camera',
      items: rows.map(r => ({
        ...r,
        details: r.detailsJson,
      })),
      page: q.page, pageSize: take, total,
      totalPages: Math.ceil(total / take),
    })
    return
  }

  if (q.kind === 'system') {
    const where = buildSystemWhere(q, scope)
    const [rows, total] = await Promise.all([
      prisma.systemLog.findMany({ where, orderBy, skip, take }),
      prisma.systemLog.count({ where }),
    ])
    res.json({
      kind: 'system',
      items: rows.map(r => ({ ...r, details: r.detailsJson })),
      page: q.page, pageSize: take, total,
      totalPages: Math.ceil(total / take),
    })
    return
  }

  // kind === 'all' → merge em memória (tomar 2*take de cada, ordenar, fatiar)
  const camWhere = buildCameraWhere(q, camIds)
  const sysWhere = buildSystemWhere(q, scope)
  const fetchLimit = skip + take
  const [camRows, sysRows, camTotal, sysTotal] = await Promise.all([
    prisma.cameraLog.findMany({
      where: camWhere, orderBy, take: fetchLimit,
      include: { camera: { select: { id: true, name: true } } },
    }),
    prisma.systemLog.findMany({ where: sysWhere, orderBy, take: fetchLimit }),
    prisma.cameraLog.count({ where: camWhere }),
    prisma.systemLog.count({ where: sysWhere }),
  ])

  const merged = [
    ...camRows.map(r => ({
      id: r.id, kind: 'camera' as const,
      recordedAt: r.recordedAt, level: r.level, source: r.source, message: r.message,
      cameraId: r.cameraId, cameraName: r.camera?.name ?? null,
      correlationId: r.correlationId, durationMs: r.durationMs,
      errorCode: r.errorCode, stackTrace: r.stackTrace,
      eventId: r.eventId, zoneId: r.zoneId,
      details: r.detailsJson,
    })),
    ...sysRows.map(r => ({
      id: r.id, kind: 'system' as const,
      recordedAt: r.recordedAt, level: r.level, source: r.source, message: r.message,
      integradorId: r.integradorId, clienteFinalId: r.clienteFinalId,
      siteId: r.siteId, edgeNodeId: r.edgeNodeId, userId: r.userId,
      correlationId: r.correlationId, requestId: r.requestId,
      method: r.method, path: r.path, statusCode: r.statusCode,
      durationMs: r.durationMs, ipAddress: r.ipAddress, userAgent: r.userAgent,
      errorCode: r.errorCode, stackTrace: r.stackTrace,
      details: r.detailsJson,
    })),
  ].sort((a, b) =>
    q.order === 'asc'
      ? a.recordedAt.getTime() - b.recordedAt.getTime()
      : b.recordedAt.getTime() - a.recordedAt.getTime(),
  )

  const page = merged.slice(skip, skip + take)
  const total = camTotal + sysTotal
  res.json({
    kind: 'all',
    items: page,
    page: q.page, pageSize: take, total,
    totalPages: Math.ceil(total / take),
    breakdown: { camera: camTotal, system: sysTotal },
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /logs/stats — agregação p/ charts
// ─────────────────────────────────────────────────────────────────────────────
logsRouter.get('/stats', publicRoute(), async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues })
    return
  }
  const q = parsed.data
  const scope = getScope(req)
  const camIds = await visibleCameraIds(scope)

  const since = q.since ? new Date(q.since) : new Date(Date.now() - 24 * 60 * 60 * 1000)
  const until = q.until ? new Date(q.until) : new Date()

  const camWhere = buildCameraWhere({ ...q, since: since.toISOString(), until: until.toISOString() }, camIds)
  const sysWhere = buildSystemWhere({ ...q, since: since.toISOString(), until: until.toISOString() }, scope)

  const [byLevelCam, bySourceCam, byLevelSys, bySourceSys] = await Promise.all([
    prisma.cameraLog.groupBy({ by: ['level'],  where: camWhere, _count: true }),
    prisma.cameraLog.groupBy({ by: ['source'], where: camWhere, _count: true }),
    prisma.systemLog.groupBy({ by: ['level'],  where: sysWhere, _count: true }),
    prisma.systemLog.groupBy({ by: ['source'], where: sysWhere, _count: true }),
  ])

  // Timeline por hora (SQL bruto p/ performance)
  const timeline = await prisma.$queryRaw<Array<{ bucket: Date; level: string; count: bigint }>>`
    SELECT
      date_trunc('hour', "recordedAt") AS bucket,
      "level",
      COUNT(*)::bigint AS count
    FROM (
      SELECT "recordedAt", "level" FROM "CameraLog"
        WHERE "recordedAt" >= ${since} AND "recordedAt" <= ${until}
      UNION ALL
      SELECT "recordedAt", "level" FROM "SystemLog"
        WHERE "recordedAt" >= ${since} AND "recordedAt" <= ${until}
    ) combined
    GROUP BY bucket, "level"
    ORDER BY bucket ASC
  `

  res.json({
    since, until,
    byLevel: {
      camera: byLevelCam.map(r => ({ level: r.level, count: r._count })),
      system: byLevelSys.map(r => ({ level: r.level, count: r._count })),
    },
    bySource: {
      camera: bySourceCam.map(r => ({ source: r.source, count: r._count })),
      system: bySourceSys.map(r => ({ source: r.source, count: r._count })),
    },
    timeline: timeline.map(r => ({
      bucket: r.bucket,
      level:  r.level,
      count:  Number(r.count),
    })),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /logs/export.csv — download streaming
// ─────────────────────────────────────────────────────────────────────────────
logsRouter.get('/export.csv', publicRoute(), async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues })
    return
  }
  const q = { ...parsed.data, pageSize: Math.min(parsed.data.pageSize, 10_000) }
  const scope = getScope(req)
  const camIds = await visibleCameraIds(scope)

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="logs_${Date.now()}.csv"`)
  const header = ['timestamp', 'kind', 'level', 'source', 'cameraId', 'message', 'errorCode', 'durationMs', 'correlationId']
  res.write(header.join(',') + '\n')

  const cursor = async function* () {
    let page = 1
    while (true) {
      const take = 500
      const skip = (page - 1) * take
      const rows: Array<Record<string, any>> = []
      if (q.kind !== 'system') {
        const camRows = await prisma.cameraLog.findMany({
          where: buildCameraWhere(q, camIds),
          orderBy: { recordedAt: q.order },
          skip, take,
        })
        for (const r of camRows) rows.push({
          timestamp: r.recordedAt.toISOString(), kind: 'camera',
          level: r.level, source: r.source,
          cameraId: r.cameraId, message: r.message,
          errorCode: r.errorCode ?? '', durationMs: r.durationMs ?? '',
          correlationId: r.correlationId ?? '',
        })
      }
      if (q.kind !== 'camera') {
        const sysRows = await prisma.systemLog.findMany({
          where: buildSystemWhere(q, scope),
          orderBy: { recordedAt: q.order },
          skip, take,
        })
        for (const r of sysRows) rows.push({
          timestamp: r.recordedAt.toISOString(), kind: 'system',
          level: r.level, source: r.source,
          cameraId: '', message: r.message,
          errorCode: r.errorCode ?? '', durationMs: r.durationMs ?? '',
          correlationId: r.correlationId ?? '',
        })
      }
      if (!rows.length) return
      for (const r of rows) yield r
      page++
      if (page * take > q.pageSize) return
    }
  }

  const escape = (v: any) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  for await (const row of cursor()) {
    res.write(header.map(h => escape(row[h])).join(',') + '\n')
  }
  res.end()
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /logs/stream — Server-Sent Events (live-tail, poll 2s)
// ─────────────────────────────────────────────────────────────────────────────
logsRouter.get('/stream', publicRoute(), async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues })
    return
  }
  const q = parsed.data
  const scope = getScope(req)
  const camIds = await visibleCameraIds(scope)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  let lastTs = new Date()
  res.write(`event: hello\ndata: ${JSON.stringify({ ts: lastTs })}\n\n`)

  const interval = setInterval(async () => {
    try {
      const baseSince = { ...q, since: lastTs.toISOString() }
      const emit: any[] = []
      if (q.kind !== 'system') {
        const camRows = await prisma.cameraLog.findMany({
          where: buildCameraWhere(baseSince, camIds),
          orderBy: { recordedAt: 'asc' }, take: 100,
        })
        for (const r of camRows) emit.push({ kind: 'camera', ...r, details: r.detailsJson })
      }
      if (q.kind !== 'camera') {
        const sysRows = await prisma.systemLog.findMany({
          where: buildSystemWhere(baseSince, scope),
          orderBy: { recordedAt: 'asc' }, take: 100,
        })
        for (const r of sysRows) emit.push({ kind: 'system', ...r, details: r.detailsJson })
      }
      if (emit.length) {
        lastTs = new Date(Math.max(...emit.map(e => new Date(e.recordedAt).getTime())) + 1)
        for (const ev of emit) {
          res.write(`event: log\ndata: ${JSON.stringify(ev)}\n\n`)
        }
      } else {
        res.write(`event: ping\ndata: ${Date.now()}\n\n`)
      }
    } catch (err) {
      logger.error({ err }, 'logs_stream_error')
    }
  }, 2_000)

  req.on('close', () => {
    clearInterval(interval)
    res.end()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /logs/purge — SUPER_ADMIN only (retenção manual)
// ─────────────────────────────────────────────────────────────────────────────
logsRouter.delete('/purge', publicRoute(), requireRole('SUPER_ADMIN'), async (req, res) => {
  const schema = z.object({
    kind: z.enum(SCOPE_KINDS).default('all'),
    olderThanDays: z.coerce.number().int().min(1).max(3650).default(30),
  })
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues })
    return
  }
  const cutoff = new Date(Date.now() - parsed.data.olderThanDays * 24 * 60 * 60 * 1000)
  const results: any = {}
  if (parsed.data.kind !== 'system') {
    const r = await prisma.cameraLog.deleteMany({ where: { recordedAt: { lt: cutoff } } })
    results.cameraDeleted = r.count
  }
  if (parsed.data.kind !== 'camera') {
    const r = await prisma.systemLog.deleteMany({ where: { recordedAt: { lt: cutoff } } })
    results.systemDeleted = r.count
  }
  logger.warn({ cutoff, ...results, by: req.jwtPayload?.sub }, 'logs_purged')
  res.json({ cutoff, ...results })
})
