/**
 * BI Routes — Queries de Business Intelligence para o Dashboard.
 *
 * GET /bi/kpis            ← KPIs principais (fluxo, dwell, emoção)
 * GET /bi/flow/hourly     ← fluxo por hora (últimos N dias)
 * GET /bi/demographics    ← distribuição de idade, gênero, emoção
 * GET /bi/heatmap         ← grid de densidade por câmera/zona
 * GET /bi/ppe/compliance  ← compliance EPI por setor
 * GET /bi/occupancy       ← ocupação atual por zona
 * GET /bi/evidence        ← lista de evidências recentes (thumbs com signed URL)
 * GET /bi/counting        ← contagem de pessoas por janela de tempo
 */
import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { gcsService } from '../services/gcs.service'
import { r2Service } from '../services/r2.service'
import { prisma } from '../lib/prisma'
import { subDays, subHours, format } from 'date-fns'
import { requires, publicRoute } from '../middleware/require-capability'
import { CAPABILITIES } from '../lib/capabilities'
import {
  analyticsEventTenantWhereFromRequest,
  getStorageTenantContext,
  validateStorageAccess,
} from '../lib/tenant-scope'

export const biRouter = Router()
biRouter.use(requireAuth)

// ─── Helper: resolver cameraIds pelo contexto JWT ─────────────────────────

async function resolveScope(jwt: NonNullable<Request['jwtPayload']>) {
  const { clienteFinalId, integradorId } = jwt

  if (clienteFinalId) {
    const sites = await prisma.site.findMany({
      where: { clienteFinalId },
      select: { id: true },
    })
    const cameras = await prisma.camera.findMany({
      where: { siteId: { in: sites.map(s => s.id) }, active: true },
      select: { id: true },
    })
    return cameras.map(c => c.id)
  }

  if (integradorId) {
    const cameras = await prisma.camera.findMany({
      where: { site: { clienteFinal: { integradorId } }, active: true },
      select: { id: true },
    })
    return cameras.map(c => c.id)
  }

  // SuperAdmin — sem filtro
  return undefined
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseTzOffset(raw: unknown): number {
  if (typeof raw === 'string' && /^-?\d+$/.test(raw)) {
    const n = parseInt(raw, 10)
    if (n >= -840 && n <= 840) return n
  }
  return 0
}

/** Retorna o UTC timestamp que corresponde à meia-noite local do operador. */
function localDayStartUtc(tzOffsetMin: number): Date {
  const tzMs    = tzOffsetMin * 60_000
  const shifted = new Date(Date.now() + tzMs)         // "agora" no fuso local
  const dateStr = shifted.toISOString().slice(0, 10)  // "YYYY-MM-DD" local
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - tzMs)
}

// ─── GET /bi/kpis ─────────────────────────────────────────────────────────

biRouter.get('/kpis',
  publicRoute(),  // KPIs próprios = dashboard básico, sem custo. Analytics avançado fica em rotas separadas.
  async (req: Request, res: Response) => {
  const cameraIds    = await resolveScope(req.jwtPayload!)
  const tzOffsetMin  = parseTzOffset(req.query.tzOffsetMin)
  const since        = localDayStartUtc(tzOffsetMin)

  const where = {
    capturedAt: { gte: since },
    ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
  }

  const [totalEvents, countingToday, avgDwell, topEmotion] = await Promise.all([
    // Total de eventos hoje
    prisma.analyticsEvent.count({ where }),

    // Contagem de pessoas hoje
    (prisma as any).peopleCountingFindRaw
      ? prisma.analyticsEvent.aggregate({
          where,
          _sum: { personCount: true },
        })
      : prisma.analyticsEvent.aggregate({
          where: { ...where, personCount: { not: null } },
          _sum: { personCount: true },
        }),

    // Dwell time médio
    prisma.analyticsEvent.aggregate({
      where: { ...where, dwellTimeSec: { not: null } },
      _avg: { dwellTimeSec: true },
    }),

    // Emoção dominante mais frequente
    prisma.analyticsEvent.groupBy({
      by: ['dominantEmotion'],
      where: { ...where, dominantEmotion: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 1,
    }),
  ])

  const tzMs        = tzOffsetMin * 60_000
  const todayLocal  = new Date(Date.now() + tzMs).toISOString().slice(0, 10)

  res.json({
    today: todayLocal,
    totalEvents,
    personCount:     countingToday._sum.personCount ?? 0,
    avgDwellSeconds: Math.round(avgDwell._avg.dwellTimeSec ?? 0),
    topEmotion:      topEmotion[0]?.dominantEmotion ?? 'neutral',
  })
})

// ─── GET /bi/flow/hourly ───────────────────────────────────────────────────

biRouter.get('/flow/hourly',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response) => {
  const cameraIds   = await resolveScope(req.jwtPayload!)
  const days        = Number(req.query.days ?? 7)
  const tzOffsetMin = parseTzOffset(req.query.tzOffsetMin)
  const tzMs        = tzOffsetMin * 60_000
  const since       = subDays(new Date(), days)

  const events = await prisma.analyticsEvent.findMany({
    where: {
      capturedAt: { gte: since },
      eventType:  { in: ['LINE_CROSS_IN', 'LINE_CROSS_OUT', 'PERSON_DETECTED'] },
      ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
    },
    select: { capturedAt: true, eventType: true },
    orderBy: { capturedAt: 'asc' },
  })

  // Agrupar por hora LOCAL do operador
  const buckets: Record<string, { in: number; out: number }> = {}
  for (const ev of events) {
    const localDate = new Date(ev.capturedAt.getTime() + tzMs)
    const key = format(localDate, "yyyy-MM-dd'T'HH:00")
    if (!buckets[key]) buckets[key] = { in: 0, out: 0 }
    if (ev.eventType.includes('IN') || ev.eventType === 'PERSON_DETECTED') buckets[key].in++
    else buckets[key].out++
  }

  res.json({
    granularity: 'hourly',
    data: Object.entries(buckets).map(([hour, v]) => ({ hour, ...v })),
  })
})

// ─── GET /bi/demographics ─────────────────────────────────────────────────

biRouter.get('/demographics',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response) => {
  const cameraIds = await resolveScope(req.jwtPayload!)
  const days      = Number(req.query.days ?? 30)
  const since     = subDays(new Date(), days)
  const where     = {
    capturedAt: { gte: since },
    ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
  }

  const [emotions, ageRanges] = await Promise.all([
    prisma.analyticsEvent.groupBy({
      by: ['dominantEmotion'],
      where: { ...where, dominantEmotion: { not: null } },
      _count: { id: true },
    }),
    prisma.analyticsEvent.groupBy({
      by: ['ageRange'],
      where: { ...where, ageRange: { not: null } },
      _count: { id: true },
    }),
  ])

  const total = emotions.reduce((s, e) => s + e._count.id, 0)

  res.json({
    emotions: emotions.map(e => ({
      emotion: e.dominantEmotion,
      count:   e._count.id,
      pct:     total ? Math.round((e._count.id / total) * 100) : 0,
    })),
    ageRanges: ageRanges.map(a => ({
      range: a.ageRange,
      count: a._count.id,
    })),
    periodDays: days,
  })
})

// ─── GET /bi/ppe/compliance ────────────────────────────────────────────────

biRouter.get('/ppe/compliance',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response) => {
  const cameraIds = await resolveScope(req.jwtPayload!)
  const since     = subDays(new Date(), 1) // últimas 24h

  const events = await prisma.analyticsEvent.groupBy({
    by: ['cameraId', 'ppeCompliant'],
    where: {
      capturedAt: { gte: since },
      model:      'PPE_DETECTION',
      ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
    },
    _count: { id: true },
  })

  const byCam: Record<string, { compliant: number; violation: number }> = {}
  for (const ev of events) {
    if (!ev.cameraId) continue
    if (!byCam[ev.cameraId]) byCam[ev.cameraId] = { compliant: 0, violation: 0 }
    if (ev.ppeCompliant) byCam[ev.cameraId].compliant += ev._count.id
    else                 byCam[ev.cameraId].violation += ev._count.id
  }

  const rows = Object.entries(byCam).map(([cameraId, v]) => {
    const total = v.compliant + v.violation
    return {
      cameraId,
      compliant:     v.compliant,
      violations:    v.violation,
      compliancePct: total ? Math.round((v.compliant / total) * 100) : 100,
    }
  })

  res.json({ data: rows, since: since.toISOString() })
})

// ─── GET /bi/occupancy ────────────────────────────────────────────────────

biRouter.get('/occupancy',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response) => {
  const cameraIds = await resolveScope(req.jwtPayload!)
  const since     = subHours(new Date(), 1)

  const events = await prisma.analyticsEvent.findMany({
    where: {
      capturedAt: { gte: since },
      occupancyCount: { not: null },
      ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
    },
    select: { cameraId: true, zoneId: true, occupancyCount: true, capturedAt: true },
    orderBy: { capturedAt: 'desc' },
    distinct: ['cameraId', 'zoneId'],
  })

  res.json({ data: events, asOf: new Date().toISOString() })
})

// ─── GET /bi/evidence ─────────────────────────────────────────────────────
// Lista evidências recentes com URLs assinadas, respeitando isolamento multi-tenant.

biRouter.get('/evidence',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 50)
  const tenantWhere = await analyticsEventTenantWhereFromRequest(req)
  const storageCtx = getStorageTenantContext(req.jwtPayload)

  const events = await prisma.analyticsEvent.findMany({
    where: {
      evidenceGcsKey: { not: null },
      evidenceExpiry: { gt: new Date() },
      ...tenantWhere,
    },
    select: {
      id: true, cameraId: true, edgeNodeId: true, eventType: true,
      capturedAt: true, evidenceGcsBucket: true,
      evidenceGcsKey: true, evidenceExpiry: true,
      dominantEmotion: true, ppeCompliant: true,
    },
    orderBy: { capturedAt: 'desc' },
    take: limit,
  })

  // Gerar signed URLs com validação de acesso
  const results = await Promise.all(
    events.map(async ev => {
      let thumbnailUrl: string | null = null

      if (ev.evidenceGcsBucket && ev.evidenceGcsKey) {
        // Validar acesso ao storage antes de gerar URL
        const access = validateStorageAccess(ev.evidenceGcsBucket, ev.evidenceGcsKey, storageCtx)
        if (access.allowed) {
          // Determina se é R2 ou GCS pelo formato do bucket
          if (ev.evidenceGcsBucket.startsWith('icv-')) {
            // R2 multi-tenant
            thumbnailUrl = await r2Service.getPresignedUrl(ev.evidenceGcsBucket, ev.evidenceGcsKey, 3600)
          } else {
            // GCS legado
            thumbnailUrl = await gcsService.getSignedUrl(ev.evidenceGcsKey, 3600_000)
          }
        }
      }

      return { ...ev, thumbnailUrl }
    }),
  )

  res.json({ data: results, total: results.length })
})

// ─── GET /bi/counting ─────────────────────────────────────────────────────

biRouter.get('/counting',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response) => {
  const cameraIds = await resolveScope(req.jwtPayload!)
  const { cameraId, granularity = '1hour', days = '7' } = req.query

  const since = subDays(new Date(), Number(days))

  const rows = await prisma.peopleCounting.findMany({
    where: {
      windowStart:  { gte: since },
      granularity:  granularity as string,
      ...(cameraId  ? { cameraId: cameraId as string } : {}),
      ...(cameraIds && !cameraId ? { cameraId: { in: cameraIds } } : {}),
    },
    orderBy: { windowStart: 'asc' },
    take: 500,
  })

  res.json({ data: rows, granularity, periodDays: Number(days) })
})

// ═══════════════════════════════════════════════════════════════════════════
// IA ANALYTICS DASHBOARD — /bi/ia/*
// Dashboard dedicado de performance das IAs (Sprint 1.1 — supera Monuv que
// tem esta tela "em construção" em /reports/detail/3).
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /bi/ia/kpis?days=7 ────────────────────────────────────────────────
// Cards topo: total detecções, por tipo, câmeras ativas com IA, variação pp.

biRouter.get('/ia/kpis',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response, next) => {
  try {
    const cameraIds = await resolveScope(req.jwtPayload!)
    const days      = Math.max(1, Math.min(Number(req.query.days ?? 7), 90))
    const now       = new Date()
    const since     = subDays(now, days)
    const prevSince = subDays(since, days)  // período anterior para comparação

    const baseWhere  = cameraIds ? { cameraId: { in: cameraIds } } : {}
    const curWhere   = { capturedAt: { gte: since },                        ...baseWhere }
    const prevWhere  = { capturedAt: { gte: prevSince, lt: since },         ...baseWhere }
    const whereLast24 = { capturedAt: { gte: subHours(now, 24) },           ...baseWhere }

    const [total, last24, prevTotal, withEvidence, activeCamsRaw, bySeverity] = await Promise.all([
      prisma.analyticsEvent.count({ where: curWhere }),
      prisma.analyticsEvent.count({ where: whereLast24 }),
      prisma.analyticsEvent.count({ where: prevWhere }),
      prisma.analyticsEvent.count({ where: { ...curWhere, evidenceGcsKey: { not: null } } }),
      prisma.analyticsEvent.findMany({
        where: curWhere,
        select: { cameraId: true },
        distinct: ['cameraId'],
      }),
      prisma.analyticsEvent.groupBy({
        by: ['severity'],
        where: curWhere,
        _count: { id: true },
      }),
    ])

    const activeCameras = activeCamsRaw.length
    const delta = prevTotal === 0 ? null : Math.round(((total - prevTotal) / prevTotal) * 100)

    const sevMap: Record<string, number> = { INFO: 0, WARNING: 0, CRITICAL: 0 }
    for (const row of bySeverity) sevMap[row.severity] = row._count.id

    res.json({
      periodDays: days,
      total,
      last24h: last24,
      prevPeriodTotal: prevTotal,
      deltaPct: delta,
      activeCameras,
      withEvidencePct: total ? Math.round((withEvidence / total) * 100) : 0,
      bySeverity: sevMap,
    })
  } catch (err) { next(err) }
})

// ─── GET /bi/ia/breakdown?days=7 ──────────────────────────────────────────
// Distribuição por modelo de IA (donut).

biRouter.get('/ia/breakdown',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response, next) => {
  try {
    const cameraIds = await resolveScope(req.jwtPayload!)
    const days      = Math.max(1, Math.min(Number(req.query.days ?? 7), 90))
    const since     = subDays(new Date(), days)

    const where = {
      capturedAt: { gte: since },
      ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
    }

    const [byModel, byEventType] = await Promise.all([
      prisma.analyticsEvent.groupBy({
        by: ['model'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.analyticsEvent.groupBy({
        by: ['eventType'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ])

    const total = byModel.reduce((s, r) => s + r._count.id, 0)

    res.json({
      periodDays: days,
      total,
      byModel: byModel.map(r => ({
        model: r.model,
        count: r._count.id,
        pct:   total ? Math.round((r._count.id / total) * 1000) / 10 : 0,
      })),
      byEventType: byEventType.map(r => ({
        eventType: r.eventType,
        count:     r._count.id,
      })),
    })
  } catch (err) { next(err) }
})

// ─── GET /bi/ia/heatmap?days=14 ────────────────────────────────────────────
// Heatmap hora × dia-da-semana (7×24 matrix).

biRouter.get('/ia/heatmap',
  requires(CAPABILITIES.AI_HEATMAP_GENERATE),
  async (req: Request, res: Response, next) => {
  try {
    const cameraIds   = await resolveScope(req.jwtPayload!)
    const days        = Math.max(1, Math.min(Number(req.query.days ?? 14), 90))
    const tzOffsetMin = parseTzOffset(req.query.tzOffsetMin)
    const tzMs        = tzOffsetMin * 60_000
    const since       = subDays(new Date(), days)

    const events = await prisma.analyticsEvent.findMany({
      where: {
        capturedAt: { gte: since },
        ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
      },
      select: { capturedAt: true },
    })

    // Matriz 7 (dom-sáb) × 24 (h) — usando hora LOCAL do operador
    const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const ev of events) {
      const d    = new Date(ev.capturedAt.getTime() + tzMs)
      const dow  = d.getUTCDay()    // 0=dom (shifted date, use UTC methods)
      const hour = d.getUTCHours()
      matrix[dow][hour]++
    }

    // Maximum para normalização de cores no front
    let max = 0
    for (const row of matrix) for (const v of row) if (v > max) max = v

    res.json({ periodDays: days, matrix, max, total: events.length })
  } catch (err) { next(err) }
})

// ─── GET /bi/ia/top-cameras?days=7&limit=10 ───────────────────────────────
// Top N câmeras com mais detecções (identifica as mais "ruidosas" ou críticas).

biRouter.get('/ia/top-cameras',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response, next) => {
  try {
    const cameraIds = await resolveScope(req.jwtPayload!)
    const days      = Math.max(1, Math.min(Number(req.query.days ?? 7), 90))
    const limit     = Math.max(1, Math.min(Number(req.query.limit ?? 10), 50))
    const since     = subDays(new Date(), days)

    const where = {
      capturedAt: { gte: since },
      ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
    }

    const grouped = await prisma.analyticsEvent.groupBy({
      by: ['cameraId'],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    })

    // Enriquecer com nome + site da câmera
    const ids = grouped.map(g => g.cameraId).filter((id): id is string => id !== null)
    const cams = await prisma.camera.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, name: true,
        site: { select: { id: true, name: true, clienteFinal: { select: { name: true } } } },
      },
    })
    const camMap = new Map(cams.map(c => [c.id, c]))

    const rows = grouped.map(g => {
      const cam = g.cameraId ? camMap.get(g.cameraId) : undefined
      return {
        cameraId:    g.cameraId,
        cameraName:  cam?.name ?? '(desconhecida)',
        siteName:    cam?.site?.name ?? null,
        clientName:  cam?.site?.clienteFinal?.name ?? null,
        events:      g._count.id,
      }
    })

    res.json({ periodDays: days, data: rows })
  } catch (err) { next(err) }
})

// ─── GET /bi/ia/timeline?days=30&granularity=day ──────────────────────────
// Série temporal (line chart) — evolução de detecções e severidade no tempo.

biRouter.get('/ia/timeline',
  requires(CAPABILITIES.ANALYTICS_BASIC),
  async (req: Request, res: Response, next) => {
  try {
    const cameraIds   = await resolveScope(req.jwtPayload!)
    const days        = Math.max(1, Math.min(Number(req.query.days ?? 30), 180))
    const granularity = (req.query.granularity as string) ?? 'day'  // 'day' | 'hour'
    const since       = subDays(new Date(), days)

    const events = await prisma.analyticsEvent.findMany({
      where: {
        capturedAt: { gte: since },
        ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
      },
      select: { capturedAt: true, severity: true },
    })

    const buckets: Record<string, { total: number; warning: number; critical: number }> = {}
    const fmt = granularity === 'hour' ? "yyyy-MM-dd'T'HH:00" : 'yyyy-MM-dd'
    for (const ev of events) {
      const key = format(ev.capturedAt, fmt)
      if (!buckets[key]) buckets[key] = { total: 0, warning: 0, critical: 0 }
      buckets[key].total++
      if (ev.severity === 'WARNING')  buckets[key].warning++
      if (ev.severity === 'CRITICAL') buckets[key].critical++
    }

    const data = Object.entries(buckets)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([bucket, v]) => ({ bucket, ...v }))

    res.json({ periodDays: days, granularity, data })
  } catch (err) { next(err) }
})
