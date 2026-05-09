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
import { requireAuth, requireSudo } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { cameraTenantWhere, assertCameraBelongsToUser } from '../lib/tenant-scope'
import { ValidationError } from '../lib/errors'

export const recordingsSegmentsRouter = Router()
recordingsSegmentsRouter.use(requireAuth)
// LGPD step-up: integrador precisa elevar (senha+motivo) pra ver segmentos.
// SUPER_ADMIN/CLIENTE_* passam livre (lógica em requireSudo).
recordingsSegmentsRouter.use(requireSudo)

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

// ─────────────────────────────────────────────────────────────────────────
// GET /recordings/stats?cameraId=...&since=24h
//
// Retorna métricas pra UI de monitoramento por câmera:
//   - recordingState: LIVE (último segmento <30s) | IDLE (<1h) | STOPPED
//   - lastSegmentAt
//   - totalSegments + totalBytes na janela
//   - coverageMinutes (minutos com gravação dentro da janela `since`)
//   - uptimePct (cobertura / janela total)
// Aceita também `cameraId=*` (apenas SUPER_ADMIN) — agrega todas as câmeras.
// ─────────────────────────────────────────────────────────────────────────

const StatsQuery = z.object({
  cameraId: z.string().min(1).max(64),
  since:    z.string().regex(/^(\d+)(h|m|d)$/).default('24h'),
})

function parseSince(s: string): number {
  const m = /^(\d+)(h|m|d)$/.exec(s)!
  const n = Number(m[1])
  const unit = m[2]
  return unit === 'h' ? n * 3_600_000 : unit === 'm' ? n * 60_000 : n * 86_400_000
}

recordingsSegmentsRouter.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const parse = StatsQuery.safeParse(req.query)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'query'}: ${first.message}`)
    }
    const q = parse.data

    if (q.cameraId !== '*') {
      await assertCameraBelongsToUser(q.cameraId, req.jwtPayload)
    } else if (req.jwtPayload?.role !== 'SUPER_ADMIN') {
      throw new ValidationError('cameraId=* requer SUPER_ADMIN')
    }

    const sinceMs = parseSince(q.since)
    const fromDate = new Date(Date.now() - sinceMs)
    const tenantWhere = cameraTenantWhere(req.jwtPayload)

    const where: Record<string, unknown> = {
      camera: tenantWhere,
      endedAt: { gte: fromDate },
      ...(q.cameraId !== '*' ? { cameraId: q.cameraId } : {}),
    }

    // Agrega totals
    const agg = await prisma.recordingSegment.aggregate({
      where: where as any,
      _count: { _all: true },
      _sum:   { sizeBytes: true, durationSec: true },
      _max:   { endedAt: true },
    })

    const lastEndedAt = agg._max.endedAt
    const ageMs = lastEndedAt ? Date.now() - lastEndedAt.getTime() : Infinity
    const recordingState =
      ageMs < 30_000     ? 'LIVE' :
      ageMs < 3_600_000  ? 'IDLE' :
      /* else */           'STOPPED'

    const coverageSec = agg._sum.durationSec ?? 0
    const uptimePct = sinceMs > 0 ? Math.min(100, (coverageSec * 1000) / sinceMs * 100) : 0

    // Breakdown por status de upload (cloud) — métrica crítica de SLO.
    const byStatus = await prisma.recordingSegment.groupBy({
      by: ['uploadStatus'],
      where: where as any,
      _count: { _all: true },
    })
    const statusMap = Object.fromEntries(byStatus.map(r => [r.uploadStatus, r._count._all]))
    const total = agg._count._all
    const uploadedCount = statusMap.UPLOADED ?? 0
    const cloudUploadedPct = total > 0 ? (uploadedCount / total) * 100 : 0

    // Última ingestão real (timestamp do último UPLOAD confirmado). Diferente
    // de lastSegmentAt — se a câmera tem dados antigos mas hoje a box parou
    // de ingerir, lastUploadAt mostra exatamente quando parou.
    const lastUpload = await prisma.recordingSegment.findFirst({
      where: { ...(where as any), uploadStatus: 'UPLOADED' },
      orderBy: { uploadedAt: 'desc' },
      select: { uploadedAt: true },
    })
    const lastUploadAt = lastUpload?.uploadedAt ?? null
    const lastUploadAgeSec = lastUploadAt
      ? Math.round((Date.now() - lastUploadAt.getTime()) / 1000)
      : null

    res.json({
      cameraId:        q.cameraId,
      since:           q.since,
      sinceFrom:       fromDate.toISOString(),
      recordingState,
      lastSegmentAt:   lastEndedAt?.toISOString() ?? null,
      lastSegmentAgeSec: lastEndedAt ? Math.round(ageMs / 1000) : null,
      totalSegments:   total,
      totalBytes:      agg._sum.sizeBytes ? agg._sum.sizeBytes.toString() : '0',
      coverageMinutes: Math.round(coverageSec / 60),
      uptimePct:       Math.round(uptimePct * 1000) / 1000,
      // SLO de cloud — % de segments efetivamente subidos para R2/S3
      uploadStatus: {
        UPLOADED:   statusMap.UPLOADED   ?? 0,
        PENDING:    statusMap.PENDING    ?? 0,
        FAILED:     statusMap.FAILED     ?? 0,
        LOCAL_ONLY: statusMap.LOCAL_ONLY ?? 0,
      },
      cloudUploadedPct: Math.round(cloudUploadedPct * 1000) / 1000,
      // Quando a box ingeriu o último segment com sucesso. Se for "há
      // muito tempo" enquanto totalSegments cresce, sintoma de upload travado.
      lastUploadAt:     lastUploadAt?.toISOString() ?? null,
      lastUploadAgeSec,
    })
  }),
)

// ─────────────────────────────────────────────────────────────────────────
// GET /recordings/storage/health
//
// Diagnóstico do storage (R2/S3): retorna se cloud está configurado,
// se credenciais respondem (ListBuckets), e contadores de upload pendente
// + falho. Endpoint para SUPER_ADMIN — alimenta dashboard de operação
// e pode acionar alerta quando um operador percebe falha.
// ─────────────────────────────────────────────────────────────────────────

recordingsSegmentsRouter.get(
  '/storage/health',
  asyncHandler(async (req: Request, res: Response) => {
    if (req.jwtPayload?.role !== 'SUPER_ADMIN') {
      throw new ValidationError('Apenas SUPER_ADMIN pode acessar storage/health')
    }

    // Lazy import pra evitar ciclo
    const { r2Storage } = await import('../services/r2-storage.service')
    const { s3Storage } = await import('../services/s3-storage.service')
    const { recordingStorage } = await import('../services/recording-storage.service')

    const r2Health = r2Storage.isEnabled()
      ? await r2Storage.healthCheck()
      : { ok: false, error: 'not configured' as const }

    // S3 não tem healthCheck() ainda, só checa isEnabled
    const s3Enabled = s3Storage.isEnabled()

    // Counts globais por status
    const counts = await prisma.recordingSegment.groupBy({
      by: ['uploadStatus'],
      _count: { _all: true },
    })
    const map = Object.fromEntries(counts.map(c => [c.uploadStatus, c._count._all]))

    // Top 5 segments com mais tentativas (sintoma de problema sistêmico)
    const stuck = await prisma.recordingSegment.findMany({
      where: { uploadAttempts: { gte: 2 } },
      select: {
        id: true, storagePath: true, uploadAttempts: true,
        uploadStatus: true, uploadError: true, startedAt: true,
      },
      orderBy: { uploadAttempts: 'desc' },
      take: 5,
    })

    // G12 fix (2026-05-09): câmeras com tenancy misconfigured
    // (recordEnabled mas sem integradorId resolvível). Operador precisa
    // corrigir Site/ClienteFinal pra gravação voltar a funcionar.
    // Query raw — ORs com FK nullable no Prisma 5.22 são desconfortáveis
    // de tipar; SQL direto é mais claro.
    const tenancyMisconfigured = await prisma.$queryRaw<Array<{
      id: string; name: string;
      siteId: string | null;
      clienteFinalId: string | null;
      integradorId: string | null;
    }>>`
      SELECT
        c."id", c."name", c."siteId",
        s."clienteFinalId",
        cf."integradorId"
      FROM "Camera" c
      LEFT JOIN "Site" s          ON s."id" = c."siteId"
      LEFT JOIN "ClienteFinal" cf ON cf."id" = s."clienteFinalId"
      WHERE c."recordEnabled" = true
        AND c."recordMode" != 'DISABLED'
        AND c."active" = true
        AND (
          c."siteId" IS NULL
          OR s."clienteFinalId" IS NULL
          OR cf."integradorId" IS NULL
        )
      LIMIT 50
    `

    res.json({
      activeStorage: recordingStorage.getActiveStorage(),
      r2: { enabled: r2Storage.isEnabled(), ...r2Health },
      s3: { enabled: s3Enabled },
      segments: {
        UPLOADED:   map.UPLOADED   ?? 0,
        PENDING:    map.PENDING    ?? 0,
        FAILED:     map.FAILED     ?? 0,
        LOCAL_ONLY: map.LOCAL_ONLY ?? 0,
        TOTAL:      Object.values(map).reduce((a: number, b: any) => a + (b as number), 0),
      },
      stuck: stuck.map(s => ({
        id:           s.id,
        storagePath:  s.storagePath,
        uploadStatus: s.uploadStatus,
        attempts:     s.uploadAttempts,
        error:        s.uploadError,
        startedAt:    s.startedAt.toISOString(),
      })),
      tenancyMisconfigured: tenancyMisconfigured.map(c => ({
        cameraId: c.id,
        cameraName: c.name,
        reason: !c.siteId
          ? 'no_site'
          : !c.clienteFinalId
            ? 'site_no_cliente_final'
            : !c.integradorId
              ? 'cliente_final_no_integrador'
              : 'unknown',
      })),
    })
  }),
)

// ─────────────────────────────────────────────────────────────────────────
// POST /recordings/storage/retry-now
// Dispara um ciclo de retry sob demanda. SUPER_ADMIN.
// ─────────────────────────────────────────────────────────────────────────

recordingsSegmentsRouter.post(
  '/storage/retry-now',
  asyncHandler(async (req: Request, res: Response) => {
    if (req.jwtPayload?.role !== 'SUPER_ADMIN') {
      throw new ValidationError('Apenas SUPER_ADMIN')
    }
    const { recordingUploadWorker } = await import('../services/recording-upload-worker.service')
    const r = await recordingUploadWorker.tickNow()
    res.json(r)
  }),
)

// ─────────────────────────────────────────────────────────────────────────
// GET /recordings/upload-logs?cameraId=...&limit=50
//
// Retorna eventos recentes de ingest (CameraLog source=RECORDER), em ordem
// reversa cronológica. Frontend usa pra feed em tempo real.
// ─────────────────────────────────────────────────────────────────────────

const LogsQuery = z.object({
  cameraId: z.string().min(1).max(64).optional(),
  limit:    z.coerce.number().int().min(1).max(500).default(50),
  level:    z.enum(['INFO', 'WARN', 'ERROR']).optional(),
})

recordingsSegmentsRouter.get(
  '/upload-logs',
  asyncHandler(async (req: Request, res: Response) => {
    const parse = LogsQuery.safeParse(req.query)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'query'}: ${first.message}`)
    }
    const q = parse.data

    const tenantWhere = cameraTenantWhere(req.jwtPayload)
    const where: Record<string, unknown> = {
      source: 'RECORDER',
      camera: tenantWhere,
      ...(q.cameraId ? { cameraId: q.cameraId } : {}),
      ...(q.level    ? { level: q.level } : {}),
    }

    if (q.cameraId) {
      await assertCameraBelongsToUser(q.cameraId, req.jwtPayload)
    }

    const logs = await prisma.cameraLog.findMany({
      where: where as any,
      orderBy: { recordedAt: 'desc' },
      take: q.limit,
      select: {
        id:           true,
        cameraId:     true,
        level:        true,
        message:      true,
        detailsJson:  true,
        correlationId: true,
        recordedAt:   true,
        camera:       { select: { name: true } },
      },
    })

    res.json({
      logs: logs.map(l => ({
        id:           l.id,
        cameraId:     l.cameraId,
        cameraName:   l.camera?.name ?? null,
        level:        l.level,
        message:      l.message,
        details:      l.detailsJson,
        segmentId:    l.correlationId,
        at:           l.recordedAt.toISOString(),
      })),
      total: logs.length,
    })
  }),
)
