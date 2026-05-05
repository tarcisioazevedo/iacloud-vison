/**
 * Audit Routes — Sprint Gap 6.
 *
 * Transparência LGPD: o integrador (e cliente final) precisa enxergar quando
 * a plataforma (SUPER_ADMIN) tomou ações sobre o seu tenant — alterou quotas,
 * desativou módulo, abriu ticket técnico, exportou dados, etc.
 *
 * Sem essa transparência o integrador não tem como saber o que a Anthropic
 * (ops da plataforma) fez no ambiente dele, o que viola o princípio de
 * accountability do art. 6º LGPD.
 *
 * Endpoints:
 *   GET /audit/platform-actions  → ações de SUPER_ADMIN sobre o próprio tenant.
 *                                  Visível para INTEGRADOR_ADMIN/CLIENTE_ADMIN/SUPER_ADMIN.
 *   GET /audit/timeline          → todas as ações no tenant (próprias + plataforma).
 *                                  Útil para correlação operacional.
 *
 * Filtros (query):
 *   - days   (1-90, default 30): janela de tempo.
 *   - action (string contains): filtra por código de ação.
 *   - limit  (1-500, default 100).
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { UnauthorizedError, ForbiddenError } from '../lib/errors'

export const auditRouter = Router()
auditRouter.use(requireAuth)

const QuerySchema = z.object({
  days:   z.coerce.number().int().min(1).max(90).default(30),
  action: z.string().max(80).optional(),
  limit:  z.coerce.number().int().min(1).max(500).default(100),
})

/**
 * Constrói filtro de tenant do AuditLog conforme JWT do consultante.
 * - SUPER_ADMIN          → sem filtro de tenant (vê todas).
 * - INTEGRADOR_*         → próprio integradorId OU clientes finais filhos.
 * - CLIENTE_*            → próprio clienteFinalId.
 *
 * Retorna a cláusula `OR` apropriada para o `where`.
 */
function tenantScopeFilter(jwt: any) {
  if (jwt.role === 'SUPER_ADMIN') return {}

  if (jwt.role?.startsWith('INTEGRADOR_')) {
    if (!jwt.integradorId) throw new UnauthorizedError('JWT sem integradorId')
    return {
      OR: [
        { integradorId: jwt.integradorId },
        // ações sobre clientes finais do próprio integrador
        { clienteFinal: { integradorId: jwt.integradorId } },
      ],
    }
  }

  if (jwt.role?.startsWith('CLIENTE_')) {
    if (!jwt.clienteFinalId) throw new UnauthorizedError('JWT sem clienteFinalId')
    return { clienteFinalId: jwt.clienteFinalId }
  }

  throw new ForbiddenError('Role sem permissão de auditoria')
}

// =============================================================================
// GET /audit/platform-actions  — ações de SUPER_ADMIN sobre o tenant
// =============================================================================
auditRouter.get('/platform-actions', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const q   = QuerySchema.parse(req.query)
  const since = new Date(Date.now() - q.days * 24 * 3600 * 1000)

  const tenantWhere = tenantScopeFilter(jwt)

  const where: any = {
    AND: [
      // Apenas ações executadas por SUPER_ADMIN (transparência da plataforma)
      { superAdminId: { not: null } },
      { createdAt: { gte: since } },
      tenantWhere,
      ...(q.action ? [{ action: { contains: q.action, mode: 'insensitive' } }] : []),
    ],
  }

  const logs = await prisma.auditLog.findMany({
    where,
    select: {
      id: true, action: true, resource: true, resourceId: true,
      result: true, ipAddress: true, createdAt: true, metadataJson: true,
      superAdmin:   { select: { id: true, name: true, email: true } },
      integrador:   { select: { id: true, name: true } },
      clienteFinal: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  })

  // Agregação por ação para a UI montar destaques.
  const counts = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.action] = (acc[l.action] ?? 0) + 1
    return acc
  }, {})

  res.json({
    logs,
    total: logs.length,
    window: { sinceIso: since.toISOString(), days: q.days },
    counts,
  })
}))

// =============================================================================
// GET /audit/timeline  — todas as ações no tenant (próprias + plataforma)
// =============================================================================
auditRouter.get('/timeline', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const q   = QuerySchema.parse(req.query)
  const since = new Date(Date.now() - q.days * 24 * 3600 * 1000)

  const tenantWhere = tenantScopeFilter(jwt)

  const where: any = {
    AND: [
      { createdAt: { gte: since } },
      tenantWhere,
      ...(q.action ? [{ action: { contains: q.action, mode: 'insensitive' } }] : []),
    ],
  }

  const logs = await prisma.auditLog.findMany({
    where,
    select: {
      id: true, action: true, resource: true, resourceId: true,
      result: true, ipAddress: true, createdAt: true,
      superAdmin:   { select: { id: true, name: true, email: true } },
      integrador:   { select: { id: true, name: true } },
      clienteFinal: { select: { id: true, name: true } },
      user:         { select: { id: true, name: true, email: true, role: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  })

  res.json({
    logs,
    total: logs.length,
    window: { sinceIso: since.toISOString(), days: q.days },
  })
}))

// =============================================================================
// GET /audit/explorer  — log explorer com filtros completos (Sprint Logs)
// Mental model:
//   - Categoria (auth, users, tenancy, cameras, edge, storage, quota, modules, approvals)
//   - Severidade (info, warning, error, critical) — derivada de action+result
//   - Filtros: período, categoria[], severidade[], ator, resource, resourceId, IP, busca
//   - Resposta: logs paginados + agregações (counts por categoria, top atores, sparkline 24h)
// =============================================================================
const ExplorerQuery = z.object({
  startDate:  z.string().datetime().optional(),
  endDate:    z.string().datetime().optional(),
  days:       z.coerce.number().int().min(1).max(365).default(7),
  categories: z.string().optional(),  // csv: "auth,users,edge"
  severities: z.string().optional(),  // csv: "warning,error,critical"
  actorId:    z.string().optional(),
  actorEmail: z.string().optional(),
  resource:   z.string().optional(),
  resourceId: z.string().optional(),
  action:     z.string().optional(),
  ip:         z.string().optional(),
  result:     z.enum(['SUCCESS','BLOCKED','ERROR']).optional(),
  search:     z.string().optional(),  // busca textual em action + metadata
  // Restringe à auditoria de um Integrador específico (usado pelo TenantCockpit
  // quando SUPER_ADMIN navega o cockpit de um integrador). Tenant scope ainda
  // se aplica — INTEGRADOR_* só pode passar o próprio id, senão bloqueia.
  integradorId: z.string().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
  sort:       z.enum(['desc','asc']).default('desc'),
})

// Map de category → resources cobertos no AuditLog (CRUD humano).
// Categorias `system`, `ingest` e `cameras` (subset) também consultam outras
// fontes — ver lógica abaixo (SystemLog, IngestLog, CameraLog).
const CATEGORY_RESOURCES: Record<string, string[]> = {
  auth:      ['User','Session','ImpersonationSession'],
  users:     ['User'],
  tenancy:   ['Integrador','ClienteFinal','Site'],
  cameras:   ['Camera'],
  edge:      ['EdgeNode'],
  storage:   ['StorageBucket','Recording'],
  quota:     ['ApiQuota'],
  modules:   ['IntegradorModule','ClienteFinalModule'],
  approvals: ['ApprovalRequest'],
  ingest:    [],  // exclusivo de IngestLog
  system:    [],  // exclusivo de SystemLog
}

/** Mapeia level CameraLogLevel/SystemLog → severity comum */
function levelToSeverity(level: string): 'info'|'warning'|'error'|'critical' {
  switch (level) {
    case 'FATAL':  return 'critical'
    case 'ERROR':  return 'error'
    case 'WARN':   return 'warning'
    case 'DEBUG':
    case 'INFO':
    default:       return 'info'
  }
}

/** Mapeia IngestEvent → severity */
function ingestEventToSeverity(event: string): 'info'|'warning'|'error'|'critical' {
  switch (event) {
    case 'AUTH_FAIL':
    case 'UNKNOWN_PATH':
      return 'warning'
    case 'ERROR':
      return 'error'
    default:
      return 'info'
  }
}

// Heurística de severidade derivada de action + result
function deriveSeverity(action: string, result: string | null): 'info'|'warning'|'error'|'critical' {
  const a = action.toUpperCase()
  if (result === 'ERROR' || a.includes('FAIL') || a.includes('ERROR')) return 'error'
  if (a.includes('IMPERSONATION') || a.includes('DELETE') || a.includes('SUSPEND') || a.includes('REVOK')) return 'critical'
  if (result === 'BLOCKED' || a.includes('BLOCKED') || a.includes('WARN') || a.includes('EXPIRED')) return 'warning'
  return 'info'
}

function deriveCategory(resource: string, action: string): string {
  const a = action.toUpperCase()
  if (a.startsWith('LOGIN') || a.startsWith('LOGOUT') || a.includes('PASSWORD') || a.includes('IMPERSON')) return 'auth'
  for (const [cat, resources] of Object.entries(CATEGORY_RESOURCES)) {
    if (resources.includes(resource)) return cat
  }
  return 'other'
}

auditRouter.get('/explorer', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const q = ExplorerQuery.parse(req.query)
  const tenantWhere = tenantScopeFilter(jwt)

  // Tenant scope rigoroso para SUPER_ADMIN navegando cockpit de um integrador
  // específico. Para INTEGRADOR_*, o filtro JWT já restringe — se quem chama
  // tentar passar outro integradorId que não o seu, bloqueia.
  let scopedIntegradorId: string | undefined = q.integradorId
  if (scopedIntegradorId) {
    if (jwt.role !== 'SUPER_ADMIN' && jwt.integradorId !== scopedIntegradorId) {
      throw new ForbiddenError('integradorId fora do escopo')
    }
  }

  const since = q.startDate ? new Date(q.startDate) : new Date(Date.now() - q.days * 24 * 3600 * 1000)
  const until = q.endDate ? new Date(q.endDate) : new Date()

  const conditions: any[] = [
    { createdAt: { gte: since, lte: until } },
    tenantWhere,
  ]
  if (scopedIntegradorId) {
    conditions.push({
      OR: [
        { integradorId: scopedIntegradorId },
        { clienteFinal: { integradorId: scopedIntegradorId } },
      ],
    })
  }

  // Filtros opcionais
  if (q.action) conditions.push({ action: { contains: q.action, mode: 'insensitive' } })
  if (q.resource) conditions.push({ resource: q.resource })
  if (q.resourceId) conditions.push({ resourceId: q.resourceId })
  if (q.ip) conditions.push({ ipAddress: q.ip })
  if (q.result) conditions.push({ result: q.result })
  if (q.actorId) {
    conditions.push({ OR: [{ userId: q.actorId }, { superAdminId: q.actorId }] })
  }
  if (q.actorEmail) {
    conditions.push({
      OR: [
        { user: { email: { contains: q.actorEmail, mode: 'insensitive' } } },
        { superAdmin: { email: { contains: q.actorEmail, mode: 'insensitive' } } },
      ],
    })
  }
  if (q.categories) {
    const cats = q.categories.split(',').map(c => c.trim()).filter(Boolean)
    const resources = cats.flatMap(c => CATEGORY_RESOURCES[c] ?? [])
    if (resources.length) conditions.push({ resource: { in: resources } })
  }
  if (q.search) {
    conditions.push({
      OR: [
        { action: { contains: q.search, mode: 'insensitive' } },
        { resource: { contains: q.search, mode: 'insensitive' } },
        // metadataJson não suporta contains direto no Prisma — usa text search
      ],
    })
  }

  const where: any = { AND: conditions }
  const skip = (q.page - 1) * q.limit

  // Filtro de categorias controla quais FONTES consultamos.
  // - AuditLog:           sempre (CRUD humano)
  // - EdgeConnectionLog:  quando 'edge' ou sem filtro
  // - SystemLog:          quando 'system' ou sem filtro
  // - CameraLog:          quando 'cameras' ou sem filtro
  // - IngestLog:          quando 'ingest' ou sem filtro
  const requestedCats = q.categories
    ? q.categories.split(',').map(c => c.trim()).filter(Boolean)
    : []
  const noFilter = requestedCats.length === 0
  const includeEdgeConnection = noFilter || requestedCats.includes('edge')
  const includeSystem         = noFilter || requestedCats.includes('system')
  const includeCameraLog      = noFilter || requestedCats.includes('cameras')
  const includeIngestLog      = noFilter || requestedCats.includes('ingest')

  const [auditLogs, auditTotal] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: q.sort },
      skip,
      take: q.limit,
      select: {
        id: true, action: true, resource: true, resourceId: true,
        result: true, ipAddress: true, userAgent: true,
        createdAt: true, metadataJson: true,
        superAdmin:   { select: { id: true, name: true, email: true } },
        integrador:   { select: { id: true, name: true } },
        clienteFinal: { select: { id: true, name: true } },
        user:         { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ])

  // ── Fonte adicional: EdgeConnectionLog ─────────────────────────────────────
  // Heartbeats / activate / tunnel / cameras-sync / command-ack / module-drift
  // não vivem em AuditLog. Mesclamos aqui quando categoria edge está pedida.
  let edgeLogs: any[] = []
  let edgeTotal = 0
  if (includeEdgeConnection) {
    const edgeWhere: any = {
      createdAt: { gte: since, lte: until },
    }
    if (q.resourceId) edgeWhere.edgeNodeId = q.resourceId
    if (q.ip) edgeWhere.ipAddress = q.ip

    // Tenant scope para EdgeConnectionLog (atravessa edgeNode → site → clienteFinal)
    if (scopedIntegradorId) {
      edgeWhere.edgeNode = { site: { clienteFinal: { integradorId: scopedIntegradorId } } }
    } else if (jwt.role?.startsWith('INTEGRADOR_')) {
      edgeWhere.edgeNode = { site: { clienteFinal: { integradorId: jwt.integradorId } } }
    } else if (jwt.role?.startsWith('CLIENTE_')) {
      edgeWhere.edgeNode = { site: { clienteFinalId: jwt.clienteFinalId } }
    }

    if (q.action) {
      edgeWhere.eventType = { contains: q.action, mode: 'insensitive' }
    }
    if (q.result) {
      edgeWhere.status = q.result === 'ERROR' ? 'FAILED' : q.result === 'BLOCKED' ? 'PENDING' : 'SUCCESS'
    }

    const [edges, edgesCount] = await Promise.all([
      prisma.edgeConnectionLog.findMany({
        where: edgeWhere,
        orderBy: { createdAt: q.sort },
        take: q.limit,
        select: {
          id: true, eventType: true, status: true, errorCode: true,
          errorMessage: true, ipAddress: true, userAgent: true,
          createdAt: true, payload: true,
          edgeNode: {
            select: {
              id: true, name: true,
              site: {
                select: {
                  id: true, name: true,
                  clienteFinal: {
                    select: {
                      id: true, name: true, integradorId: true,
                      integrador: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.edgeConnectionLog.count({ where: edgeWhere }),
    ])
    edgeLogs = edges
    edgeTotal = edgesCount
  }

  // ── Fonte adicional: SystemLog ─────────────────────────────────────────────
  // Logs de sistema (jobs, GCP, autenticação, batch da Box). Tem campos
  // de tenant nativos (integradorId, clienteFinalId, edgeNodeId, userId).
  let systemLogs: any[] = []
  let systemTotal = 0
  if (includeSystem) {
    const sysWhere: any = {
      recordedAt: { gte: since, lte: until },
    }
    // SystemLog não tem relação Prisma para integrador/clienteFinal (apenas IDs).
    // Filtro direto por colunas; nomes vêm em lookup batch após o fetch.
    if (scopedIntegradorId) {
      sysWhere.integradorId = scopedIntegradorId
    } else if (jwt.role?.startsWith('INTEGRADOR_')) {
      sysWhere.integradorId = jwt.integradorId
    } else if (jwt.role?.startsWith('CLIENTE_')) {
      sysWhere.clienteFinalId = jwt.clienteFinalId
    }
    if (q.search) {
      sysWhere.message = { contains: q.search, mode: 'insensitive' }
    }
    if (q.ip) sysWhere.ipAddress = q.ip

    const [sys, sysCount] = await Promise.all([
      prisma.systemLog.findMany({
        where: sysWhere,
        orderBy: { recordedAt: q.sort },
        take: q.limit,
        select: {
          id: true, level: true, source: true, message: true, detailsJson: true,
          integradorId: true, clienteFinalId: true, edgeNodeId: true, userId: true,
          correlationId: true, requestId: true, method: true, path: true,
          statusCode: true, durationMs: true, ipAddress: true, userAgent: true,
          errorCode: true, recordedAt: true,
        },
      }),
      prisma.systemLog.count({ where: sysWhere }),
    ])
    systemLogs = sys
    systemTotal = sysCount

    // Lookup batch de nomes (UX premium)
    const intIds = Array.from(new Set(sys.map(s => s.integradorId).filter(Boolean))) as string[]
    const cliIds = Array.from(new Set(sys.map(s => s.clienteFinalId).filter(Boolean))) as string[]
    const [intsResolved, clisResolved] = await Promise.all([
      intIds.length ? prisma.integrador.findMany({ where: { id: { in: intIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      cliIds.length ? prisma.clienteFinal.findMany({ where: { id: { in: cliIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ])
    const intMap = new Map(intsResolved.map(i => [i.id, i.name]))
    const cliMap = new Map(clisResolved.map(c => [c.id, c.name]))
    systemLogs = sys.map(s => ({
      ...s,
      _integradorName:   s.integradorId ? intMap.get(s.integradorId) ?? null : null,
      _clienteFinalName: s.clienteFinalId ? cliMap.get(s.clienteFinalId) ?? null : null,
    }))
  }

  // ── Fonte adicional: CameraLog ─────────────────────────────────────────────
  // Logs por câmera (FFMPEG, DETECTOR, MOTION, RECORDER, ONVIF, PTZ, AUDIO,
  // FACE, LPR, SEMANTIC, VERTEX, CLOUD_VISION). Tenant scope via Camera.
  let cameraLogs: any[] = []
  let cameraTotal = 0
  if (includeCameraLog) {
    const camWhere: any = {
      recordedAt: { gte: since, lte: until },
    }
    if (scopedIntegradorId) {
      camWhere.camera = { site: { clienteFinal: { integradorId: scopedIntegradorId } } }
    } else if (jwt.role?.startsWith('INTEGRADOR_')) {
      camWhere.camera = { site: { clienteFinal: { integradorId: jwt.integradorId } } }
    } else if (jwt.role?.startsWith('CLIENTE_')) {
      camWhere.camera = { site: { clienteFinalId: jwt.clienteFinalId } }
    }
    // resourceId pode ser cameraId
    if (q.resourceId) camWhere.cameraId = q.resourceId
    if (q.search) {
      camWhere.message = { contains: q.search, mode: 'insensitive' }
    }

    const [cams, camsCount] = await Promise.all([
      prisma.cameraLog.findMany({
        where: camWhere,
        orderBy: { recordedAt: q.sort },
        take: q.limit,
        select: {
          id: true, level: true, source: true, message: true, detailsJson: true,
          cameraId: true, correlationId: true, durationMs: true, errorCode: true,
          eventId: true, zoneId: true, recordedAt: true,
          camera: {
            select: {
              id: true, name: true,
              site: {
                select: {
                  id: true, name: true,
                  clienteFinal: {
                    select: { id: true, name: true, integradorId: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.cameraLog.count({ where: camWhere }),
    ])
    cameraLogs = cams
    cameraTotal = camsCount
  }

  // ── Fonte adicional: IngestLog ─────────────────────────────────────────────
  // RTMP push events (PUBLISH_START / AUTH_FAIL / UNKNOWN_PATH / ERROR).
  // Tenant scope via Camera (quando resolvida); UNKNOWN_PATH/AUTH_FAIL sem
  // câmera só visível para SUPER_ADMIN (cross-tenant por natureza).
  let ingestLogs: any[] = []
  let ingestTotal = 0
  if (includeIngestLog) {
    const ingWhere: any = {
      ts: { gte: since, lte: until },
    }
    if (scopedIntegradorId) {
      ingWhere.camera = { site: { clienteFinal: { integradorId: scopedIntegradorId } } }
    } else if (jwt.role?.startsWith('INTEGRADOR_')) {
      ingWhere.camera = { site: { clienteFinal: { integradorId: jwt.integradorId } } }
    } else if (jwt.role?.startsWith('CLIENTE_')) {
      ingWhere.camera = { site: { clienteFinalId: jwt.clienteFinalId } }
    }
    // SUPER_ADMIN também vê eventos sem câmera resolvida (UNKNOWN_PATH/AUTH_FAIL);
    // outras roles automaticamente não veem (camera=null não bate o filtro `camera = {...}`)
    if (q.ip) ingWhere.remoteAddr = q.ip

    const [ing, ingCount] = await Promise.all([
      prisma.ingestLog.findMany({
        where: ingWhere,
        orderBy: { ts: q.sort },
        take: q.limit,
        select: {
          id: true, ts: true, event: true, streamPath: true, remoteAddr: true,
          cameraId: true, bytesIn: true, detailsJson: true,
          camera: {
            select: {
              id: true, name: true,
              site: {
                select: {
                  id: true, name: true,
                  clienteFinal: {
                    select: { id: true, name: true, integradorId: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.ingestLog.count({ where: ingWhere }),
    ])
    ingestLogs = ing
    ingestTotal = ingCount
  }

  const logs = auditLogs
  const total = auditTotal + edgeTotal + systemTotal + cameraTotal + ingestTotal

  // Enriquece com category + severity + actor consolidado
  const enrichedAudit = logs.map(l => {
    const actor = l.user
      ? { id: l.user.id, name: l.user.name, email: l.user.email, role: l.user.role, kind: 'user' as const }
      : l.superAdmin
        ? { id: l.superAdmin.id, name: l.superAdmin.name, email: l.superAdmin.email, role: 'SUPER_ADMIN', kind: 'superadmin' as const }
        : null
    return {
      id: l.id,
      source: 'audit' as const,
      timestamp: l.createdAt,
      action: l.action,
      resource: l.resource,
      resourceId: l.resourceId,
      result: l.result,
      ipAddress: l.ipAddress,
      userAgent: l.userAgent,
      metadata: l.metadataJson,
      actor,
      tenant: l.integrador
        ? { kind: 'integrador', id: l.integrador.id, name: l.integrador.name }
        : l.clienteFinal
          ? { kind: 'clienteFinal', id: l.clienteFinal.id, name: l.clienteFinal.name }
          : null,
      category: deriveCategory(l.resource, l.action),
      severity: deriveSeverity(l.action, l.result),
    }
  })

  // Adapta EdgeConnectionLog para o shape comum
  const enrichedEdge = edgeLogs.map((e: any) => {
    const tenant = e.edgeNode?.site?.clienteFinal
      ? { kind: 'clienteFinal' as const, id: e.edgeNode.site.clienteFinal.id, name: e.edgeNode.site.clienteFinal.name }
      : null
    // Severidade: FAILED → error, PENDING → warning, SUCCESS → info.
    // MODULE_DRIFT com FAILED → critical (Box rodando módulo não autorizado).
    const sev: 'info'|'warning'|'error'|'critical' =
      e.eventType === 'MODULE_DRIFT' && e.status === 'FAILED' ? 'critical' :
      e.status === 'FAILED' ? 'error' :
      e.status === 'PENDING' ? 'warning' : 'info'
    return {
      id: e.id,
      source: 'edge-connection' as const,
      timestamp: e.createdAt,
      action: e.eventType,
      resource: 'EdgeNode',
      resourceId: e.edgeNode?.id ?? null,
      result: e.status === 'SUCCESS' ? 'SUCCESS' : e.status === 'FAILED' ? 'ERROR' : 'BLOCKED',
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
      metadata: {
        ...(e.payload as any ?? {}),
        errorCode: e.errorCode,
        errorMessage: e.errorMessage,
        edgeNodeName: e.edgeNode?.name,
        siteName: e.edgeNode?.site?.name,
      },
      actor: null,  // box-side, não tem actor humano
      tenant,
      category: 'edge',
      severity: sev,
    }
  })

  // ── Adapter SystemLog → shape comum ────────────────────────────────────────
  const enrichedSystem = systemLogs.map((s: any) => {
    const tenant = s.integradorId
      ? { kind: 'integrador' as const, id: s.integradorId, name: s._integradorName ?? s.integradorId.slice(0, 8) }
      : s.clienteFinalId
        ? { kind: 'clienteFinal' as const, id: s.clienteFinalId, name: s._clienteFinalName ?? s.clienteFinalId.slice(0, 8) }
        : null
    return {
      id: s.id,
      source: 'system' as const,
      timestamp: s.recordedAt,
      action: `${s.source}.${s.level}`,
      resource: 'System',
      resourceId: s.correlationId ?? null,
      result: s.level === 'ERROR' || s.level === 'FATAL' ? 'ERROR' : 'SUCCESS',
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      metadata: {
        message: s.message,
        details: s.detailsJson,
        method: s.method, path: s.path, statusCode: s.statusCode,
        durationMs: s.durationMs, requestId: s.requestId, errorCode: s.errorCode,
      },
      actor: null,
      tenant,
      category: 'system',
      severity: levelToSeverity(s.level),
    }
  })

  // ── Adapter CameraLog → shape comum ────────────────────────────────────────
  const enrichedCameraLog = cameraLogs.map((c: any) => {
    const cf = c.camera?.site?.clienteFinal
    const tenant = cf
      ? { kind: 'clienteFinal' as const, id: cf.id, name: cf.name }
      : null
    return {
      id: c.id,
      source: 'camera' as const,
      timestamp: c.recordedAt,
      action: `${c.source}.${c.level}`,
      resource: 'Camera',
      resourceId: c.cameraId,
      result: c.level === 'ERROR' || c.level === 'FATAL' ? 'ERROR' : 'SUCCESS',
      ipAddress: null,
      userAgent: null,
      metadata: {
        message: c.message,
        details: c.detailsJson,
        cameraName: c.camera?.name,
        siteName: c.camera?.site?.name,
        durationMs: c.durationMs, errorCode: c.errorCode,
        eventId: c.eventId, zoneId: c.zoneId,
        correlationId: c.correlationId,
      },
      actor: null,
      tenant,
      category: 'cameras',
      severity: levelToSeverity(c.level),
    }
  })

  // ── Adapter IngestLog → shape comum ────────────────────────────────────────
  const enrichedIngest = ingestLogs.map((i: any) => {
    const cf = i.camera?.site?.clienteFinal
    const tenant = cf
      ? { kind: 'clienteFinal' as const, id: cf.id, name: cf.name }
      : null
    const evtSev = ingestEventToSeverity(i.event)
    return {
      id: i.id,
      source: 'ingest' as const,
      timestamp: i.ts,
      action: i.event,
      resource: 'IngestLog',
      resourceId: i.cameraId ?? null,
      result: i.event === 'ERROR' || i.event === 'AUTH_FAIL' || i.event === 'UNKNOWN_PATH' ? 'BLOCKED' : 'SUCCESS',
      ipAddress: i.remoteAddr,
      userAgent: null,
      metadata: {
        streamPath: i.streamPath,
        bytesIn: i.bytesIn != null ? Number(i.bytesIn) : null,
        details: i.detailsJson,
        cameraName: i.camera?.name,
        siteName: i.camera?.site?.name,
      },
      actor: null,
      tenant,
      category: 'ingest',
      severity: evtSev,
    }
  })

  const enriched = [
    ...enrichedAudit,
    ...enrichedEdge,
    ...enrichedSystem,
    ...enrichedCameraLog,
    ...enrichedIngest,
  ]
    .sort((a, b) => q.sort === 'desc'
      ? new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      : new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(0, q.limit)  // respeita o limite após union

  // Filtro por severidade (pós-processamento porque é derivada)
  const sevFiltered = q.severities
    ? enriched.filter(e => q.severities!.split(',').includes(e.severity))
    : enriched

  // Agregações
  const countsByCategory: Record<string, number> = {}
  const countsBySeverity: Record<string, number> = { info: 0, warning: 0, error: 0, critical: 0 }
  const actorMap: Record<string, { name: string; email: string; count: number }> = {}
  for (const l of sevFiltered) {
    countsByCategory[l.category] = (countsByCategory[l.category] ?? 0) + 1
    countsBySeverity[l.severity] = (countsBySeverity[l.severity] ?? 0) + 1
    if (l.actor) {
      const key = l.actor.email
      if (!actorMap[key]) actorMap[key] = { name: l.actor.name ?? key, email: key, count: 0 }
      actorMap[key].count++
    }
  }
  const topActors = Object.values(actorMap).sort((a, b) => b.count - a.count).slice(0, 5)

  // Sparkline: agrupa por hora nas últimas 24h
  const sparkSince = new Date(Math.max(since.getTime(), Date.now() - 24 * 3600 * 1000))
  const sparkBucket: number[] = new Array(24).fill(0)
  for (const l of sevFiltered) {
    const t = new Date(l.timestamp).getTime()
    if (t < sparkSince.getTime()) continue
    const hour = Math.floor((Date.now() - t) / 3600 / 1000)
    if (hour >= 0 && hour < 24) sparkBucket[23 - hour]++
  }

  res.json({
    logs: sevFiltered,
    total,
    page: q.page,
    pages: Math.ceil(total / q.limit),
    limit: q.limit,
    window: { sinceIso: since.toISOString(), untilIso: until.toISOString() },
    aggregations: {
      countsByCategory,
      countsBySeverity,
      topActors,
      sparkline24h: sparkBucket,
    },
  })
}))

// =============================================================================
// GET /audit/resource/:resource/:resourceId  — story view de uma entity
// Retorna timeline completa de ações sobre um recurso específico.
// =============================================================================
auditRouter.get('/resource/:resource/:resourceId', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const tenantWhere = tenantScopeFilter(jwt)
  const { resource, resourceId } = req.params

  const logs = await prisma.auditLog.findMany({
    where: {
      AND: [
        { resource: String(resource) },
        { resourceId: String(resourceId) },
        tenantWhere,
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, action: true, resource: true, resourceId: true,
      result: true, ipAddress: true, createdAt: true, metadataJson: true,
      superAdmin: { select: { id: true, name: true, email: true } },
      user:       { select: { id: true, name: true, email: true, role: true } },
    },
  })

  res.json({
    resource: { type: resource, id: resourceId },
    total: logs.length,
    logs: logs.map(l => ({
      ...l,
      severity: deriveSeverity(l.action, l.result),
      category: deriveCategory(l.resource, l.action),
    })),
  })
}))
