/**
 * Routes do pipeline de RTMP push (camera→cloud).
 *
 *   GET  /ingest-log                    — auditoria tenant-scoped (Sprint CF.3)
 *   GET  /ingest-log/stats              — KPI tenant-scoped
 *   GET  /admin/ingest-log/raw          — eventos órfãos cross-tenant
 *                                         (SUPER_ADMIN-only, detecta brute-force)
 *   GET  /cameras/:id/rtmp-ingest-key   — revela a key (com log)
 *   POST /cameras/:id/rtmp-ingest-key/regenerate — gera nova key
 *
 * Histórico:
 *   /admin/ingest-log foi originalmente SUPER_ADMIN-only por receio de
 *   misturar logs de tenants. Com Sprint CF.2 (Worker tenant router), o
 *   subdomínio acessado vira prova criptográfica de qual integrador é dono
 *   do request — basta filtrar IngestLog por camera.site.clienteFinal.
 *   integradorId. Mantemos o endpoint `/admin/ingest-log/raw` p/ SUPER_ADMIN
 *   ver eventos AUTH_FAIL/UNKNOWN_PATH (não associados a câmera, então sem
 *   tenant) — crítico pra detectar tentativas de força bruta.
 *
 * Por que `Reveal Key` é endpoint dedicado em vez de vir no GET normal:
 *   - GET /cameras/:id é cacheável e devolve dados em texto claro pro UI.
 *     Stream key é credencial — exibir só sob ação explícita do operador
 *     ("👁 mostrar"), com timestamp gravado em CameraLog pra auditoria.
 *   - Mesmo padrão do "Display password" do AWS console.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { generateRtmpStreamKey, buildRtmpPushUrl } from '../lib/rtmp-key'
import { requireCameraForUser, ingestLogTenantWhere } from '../lib/tenant-scope'
import { ingestService } from '../services/ingest.service'
import { cameraLogService } from '../services/camera-log.service'
import { logger } from '../lib/logger'

const INGEST_PUBLIC_HOST = process.env.RTMP_INGEST_PUBLIC_HOST ?? 'ingest.iacloud.com.br'
const INGEST_PUBLIC_PORT = Number(process.env.RTMP_INGEST_PUBLIC_PORT ?? 1935)

export const ingestRouter = Router()

// ─── GET /ingest-log ───────────────────────────────────────────────────────
//
// Lista eventos de auditoria do endpoint RTMP, FILTRADOS ao tenant do
// requester (Sprint CF.3). SUPER_ADMIN sem subdomínio enxerga tudo;
// SUPER_ADMIN navegando via `<slug>.iacloud.com.br` enxerga só do tenant
// daquele slug; INTEGRADOR_ADMIN/CLIENTE_OPERADOR enxergam só os deles.
//
// Eventos órfãos (sem `cameraId` resolvido — AUTH_FAIL, UNKNOWN_PATH) NÃO
// aparecem aqui pra non-SUPER_ADMIN: não temos como atribuí-los a um tenant.
// SUPER_ADMIN sem subdomínio vê esses junto; ou consulta `/admin/ingest-log/raw`.

const ListLogQuery = z.object({
  limit:   z.coerce.number().int().min(1).max(500).default(100),
  offset:  z.coerce.number().int().min(0).default(0),
  event:   z.enum(['PUBLISH_START', 'PUBLISH_END', 'AUTH_OK', 'AUTH_FAIL', 'UNKNOWN_PATH', 'ERROR']).optional(),
  /** Filtra por câmera (resolvida) — útil pra investigar 1 câmera específica. */
  cameraId: z.string().uuid().optional(),
  /** Filtra por origem (IP do cliente RTMP). */
  remoteAddr: z.string().max(64).optional(),
  /** ISO date — eventos a partir de quando. Default: 24h atrás. */
  since:    z.string().optional(),
})

ingestRouter.get(
  '/ingest-log',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const q = ListLogQuery.parse(req.query)
    const since = q.since ? new Date(q.since) : new Date(Date.now() - 24 * 60 * 60 * 1000)

    // Tenant scope: helper retorna {} pra SUPER_ADMIN sem subdomínio,
    // ou o filtro `camera: { site: { clienteFinal: { integradorId } } }`
    // nos demais casos. Se a query.cameraId não pertencer ao tenant, o
    // filtro composto simplesmente devolve 0 itens (não vaza existência).
    const tenantWhere = ingestLogTenantWhere(req)

    const where: Record<string, unknown> = {
      ...tenantWhere,
      ts: { gte: since },
    }
    if (q.event)      where.event = q.event
    if (q.cameraId)   where.cameraId = q.cameraId
    if (q.remoteAddr) where.remoteAddr = q.remoteAddr

    const [items, total] = await Promise.all([
      prisma.ingestLog.findMany({
        where,
        orderBy: { ts: 'desc' },
        take: q.limit,
        skip: q.offset,
        include: {
          camera: { select: { id: true, name: true, siteId: true } },
        },
      }),
      prisma.ingestLog.count({ where }),
    ])

    // BigInt não serializa em JSON nativo — converte explicitamente.
    const serialized = items.map(it => ({
      ...it,
      bytesIn: it.bytesIn != null ? it.bytesIn.toString() : null,
    }))

    res.json({
      items: serialized,
      total,
      limit: q.limit,
      offset: q.offset,
      sinceUtc: since.toISOString(),
    })
  }),
)

// ─── GET /ingest-log/stats ─────────────────────────────────────────────────
//
// KPI rápido pra dashboard, escopado ao tenant. Contagem por evento + top 5
// IPs com mais AUTH_FAIL nas últimas 24h.
//
// Observação importante sobre topFailers em escopo de tenant: AUTH_FAIL
// geralmente NÃO tem cameraId (a key falhou na resolução), então pra um
// tenant específico esses eventos somem. Devolvemos topFailers vazio nesse
// caso — o admin que precisa ver brute-force usa `/admin/ingest-log/raw`.

ingestRouter.get(
  '/ingest-log/stats',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const tenantWhere = ingestLogTenantWhere(req)
    const isGlobal = Object.keys(tenantWhere).length === 0  // SUPER_ADMIN sem subdomínio

    const grouped = await prisma.ingestLog.groupBy({
      by: ['event'],
      where: { ...tenantWhere, ts: { gte: since } },
      _count: { _all: true },
    })
    const stats: Record<string, number> = {
      PUBLISH_START: 0, PUBLISH_END: 0, AUTH_OK: 0,
      AUTH_FAIL: 0, UNKNOWN_PATH: 0, ERROR: 0,
    }
    for (const g of grouped) stats[g.event] = g._count._all

    // Top 5 IPs com mais AUTH_FAIL — só faz sentido cross-tenant
    // (AUTH_FAIL via de regra não tem cameraId resolvido).
    let topFailers: { remoteAddr: string; count: number }[] = []
    if (isGlobal) {
      const failersRaw = await prisma.$queryRaw<{ remoteAddr: string; n: bigint }[]>`
        SELECT "remoteAddr", COUNT(*)::bigint AS n
        FROM "IngestLog"
        WHERE event = 'AUTH_FAIL' AND ts >= ${since}
        GROUP BY "remoteAddr"
        ORDER BY n DESC
        LIMIT 5
      `
      topFailers = failersRaw.map(f => ({ remoteAddr: f.remoteAddr, count: Number(f.n) }))
    }

    res.json({ sinceUtc: since.toISOString(), stats, topFailers })
  }),
)

// ─── GET /admin/ingest-log/raw ─────────────────────────────────────────────
//
// SUPER_ADMIN-only. Lista eventos que NÃO têm cameraId resolvido — i.e.
// AUTH_FAIL, UNKNOWN_PATH e ERROR antes da resolução. Esses são inerentemente
// cross-tenant (não dá pra atribuir a um integrador específico) e são onde
// a gente vê tentativa de brute-force / scanning.
//
// Query support: same shape as /ingest-log mas sem o filtro de tenant.

const RawLogQuery = z.object({
  limit:      z.coerce.number().int().min(1).max(500).default(100),
  offset:     z.coerce.number().int().min(0).default(0),
  event:      z.enum(['AUTH_FAIL', 'UNKNOWN_PATH', 'ERROR']).optional(),
  remoteAddr: z.string().max(64).optional(),
  since:      z.string().optional(),
})

ingestRouter.get(
  '/admin/ingest-log/raw',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = RawLogQuery.parse(req.query)
    const since = q.since ? new Date(q.since) : new Date(Date.now() - 24 * 60 * 60 * 1000)

    // `cameraId: null` isola eventos órfãos (sem câmera resolvida).
    const where: Record<string, unknown> = {
      cameraId: null,
      ts: { gte: since },
    }
    if (q.event)      where.event = q.event
    else              where.event = { in: ['AUTH_FAIL', 'UNKNOWN_PATH', 'ERROR'] }
    if (q.remoteAddr) where.remoteAddr = q.remoteAddr

    const [items, total] = await Promise.all([
      prisma.ingestLog.findMany({
        where,
        orderBy: { ts: 'desc' },
        take: q.limit,
        skip: q.offset,
      }),
      prisma.ingestLog.count({ where }),
    ])

    const serialized = items.map(it => ({
      ...it,
      bytesIn: it.bytesIn != null ? it.bytesIn.toString() : null,
    }))

    res.json({
      items: serialized,
      total,
      limit: q.limit,
      offset: q.offset,
      sinceUtc: since.toISOString(),
    })
  }),
)

// ─── GET /cameras/:id/rtmp-ingest-key ──────────────────────────────────────
//
// Revela a stream key em plain text. Restrito ao escopo de tenant da câmera
// (requireCameraForUser) e logado em CameraLog ("operador X revelou a key
// às 14:32"). UI usa toggle 👁 mostrar/ocultar — operador deveria copiar
// e fechar a tela rápido.

ingestRouter.get(
  '/cameras/:id/rtmp-ingest-key',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
      select: { id: true, ingestMode: true, rtmpIngestKeyEnc: true },
    })
    if (!cam.rtmpIngestKeyEnc) {
      // Sem key → o frontend deve oferecer "Gerar key".
      res.json({ key: null, url: null })
      return
    }
    const key = decryptSecret(cam.rtmpIngestKeyEnc)
    if (!key) throw new Error('falha ao decifrar stream key')

    // Auditoria — quem revelou e quando. Útil em investigação se key vazar.
    await cameraLogService.logCamera({
      cameraId: cam.id, level: 'WARN', source: 'SYSTEM',
      message: 'RTMP ingest key revelada via UI',
      details: { userId: req.jwtPayload?.sub, role: req.jwtPayload?.role },
    }).catch(() => { /* log best-effort */ })

    res.json({
      key,
      url: buildRtmpPushUrl(INGEST_PUBLIC_HOST, INGEST_PUBLIC_PORT, key),
      host: INGEST_PUBLIC_HOST,
      port: INGEST_PUBLIC_PORT,
    })
  }),
)

// ─── POST /cameras/:id/rtmp-ingest-key/regenerate ──────────────────────────
//
// Gera nova key (rotação). Câmera para de funcionar até o operador atualizar
// a config dela com a URL nova. Útil quando suspeita de vazamento.
// Audit log mantém a key antiga via mask em CameraLog detailsJson.

ingestRouter.post(
  '/cameras/:id/rtmp-ingest-key/regenerate',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
      select: { id: true, rtmpIngestKeyEnc: true },
    })

    const oldKey = cam.rtmpIngestKeyEnc ? decryptSecret(cam.rtmpIngestKeyEnc) : null
    const newKey = generateRtmpStreamKey()

    await prisma.camera.update({
      where: { id: cam.id },
      data: { rtmpIngestKeyEnc: encryptSecret(newKey) },
    })

    // Limpa cache do ingest service pra próxima tentativa de PUSH usar a nova key.
    if (oldKey) ingestService.invalidateKeyCache(oldKey)
    ingestService.invalidateKeyCache(newKey)

    await cameraLogService.logCamera({
      cameraId: cam.id, level: 'WARN', source: 'SYSTEM',
      message: 'RTMP ingest key rotacionada',
      details: { userId: req.jwtPayload?.sub, oldKeyMasked: oldKey ? `${oldKey.slice(0,7)}…${oldKey.slice(-4)}` : null },
    }).catch(() => {})

    logger.info({ cameraId: cam.id, userId: req.jwtPayload?.sub }, 'rtmp_key_regenerated')

    res.json({
      key: newKey,
      url: buildRtmpPushUrl(INGEST_PUBLIC_HOST, INGEST_PUBLIC_PORT, newKey),
      host: INGEST_PUBLIC_HOST,
      port: INGEST_PUBLIC_PORT,
    })
  }),
)

// ─── (público) GET /config/ingest ──────────────────────────────────────────
//
// Frontend usa pra mostrar a URL completa no card "Modo de ingestão" sem
// hard-coding o host. Não-autenticado, mas só devolve dados não-sensíveis
// (host+port). Stream key continua escondida atrás do `requireAuth`.

ingestRouter.get('/config/ingest', (_req, res) => {
  res.json({
    rtmpHost: INGEST_PUBLIC_HOST,
    rtmpPort: INGEST_PUBLIC_PORT,
    rtmpUrlBase: `rtmp://${INGEST_PUBLIC_HOST}${INGEST_PUBLIC_PORT === 1935 ? '' : ':' + INGEST_PUBLIC_PORT}/live`,
  })
})

