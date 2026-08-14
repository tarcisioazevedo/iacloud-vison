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
import { publicRoute } from '../middleware/require-capability'
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
auditRouter.get('/platform-actions', publicRoute(), asyncHandler(async (req, res) => {
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
// GET /audit/camera/:id  — timeline focada de mudanças em UMA câmera
// Usado pela tab de auditoria no CameraDetailPage. Filtra por resource=Camera
// + resourceId=:id, com tenant-scope automático.
// =============================================================================
auditRouter.get('/camera/:id', publicRoute(), asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const q   = QuerySchema.parse(req.query)
  const since = new Date(Date.now() - q.days * 24 * 3600 * 1000)
  const tenantWhere = tenantScopeFilter(jwt)

  const logs = await prisma.auditLog.findMany({
    where: {
      AND: [
        { createdAt: { gte: since } },
        { resource:  'Camera' },
        { resourceId: req.params.id },
        tenantWhere,
        ...(q.action ? [{ action: { contains: q.action, mode: 'insensitive' as const } }] : []),
      ],
    },
    select: {
      id: true, action: true, resourceId: true, result: true,
      metadataJson: true, createdAt: true,
      superAdmin:   { select: { name: true, email: true } },
      integrador:   { select: { name: true } },
      clienteFinal: { select: { name: true } },
      user:         { select: { name: true, email: true, role: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  })

  res.json({ logs, total: logs.length, window: { days: q.days } })
}))

// =============================================================================
// GET /audit/timeline  — todas as ações no tenant (próprias + plataforma)
// =============================================================================
auditRouter.get('/timeline', publicRoute(), asyncHandler(async (req, res) => {
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

  // Onda 5 do log-audit (2026-05-06) — filtros hierárquicos.
  // Cada um valida RBAC: INTEGRADOR_* só pode passar IDs do próprio escopo;
  // CLIENTE_* só ao próprio. Validação acontece no handler depois de
  // resolver tenantWhere (ver helper assertOwnership).
  integradorId:   z.string().optional(),  // SUPER vê tudo; outras roles validam
  clienteFinalId: z.string().optional(),
  siteId:         z.string().optional(),
  cameraId:       z.string().optional(),
  edgeNodeId:     z.string().optional(),

  // Onda 6 do log-audit — filtros estruturados HTTP.
  method:    z.enum(['GET','POST','PUT','PATCH','DELETE']).optional(),
  actorRole: z.string().optional(),  // CSV: "INTEGRADOR_ADMIN,CLIENTE_OPERADOR"

  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
  sort:       z.enum(['desc','asc']).default('desc'),
})

// Map de category → resources cobertos no AuditLog (CRUD humano).
// Categorias com array vazio são exclusivas de outras fontes (vide lógica abaixo).
const CATEGORY_RESOURCES: Record<string, string[]> = {
  auth:          ['User','Session','ImpersonationSession'],
  users:         ['User'],
  tenancy:       ['Integrador','ClienteFinal','Site'],
  cameras:       ['Camera'],
  edge:          ['EdgeNode'],
  storage:       ['StorageBucket','Recording'],
  quota:         ['ApiQuota'],
  modules:       ['IntegradorModule','ClienteFinalModule'],
  approvals:     ['ApprovalRequest'],
  ingest:        [],  // exclusivo de IngestLog
  system:        [],  // exclusivo de SystemLog
  // Onda 2 do log-audit (2026-05-06):
  ai:            [],  // AnalyticsEvent + Face/Plate/Audio events
  notifications: [],  // NotificationLog (WhatsApp + email histórico)
  webhooks:      [],  // AsaasWebhookEvent
  usage:         [],  // ApiUsageLog (Vertex/Vision/GCS billing)
  // Onda 10 — LGPD Compliance Hub (2026-05-09).
  // LGPD não filtra por resource (várias entidades), filtra por ACTION
  // específica. Vide CATEGORY_ACTIONS abaixo.
  lgpd:          [],
}

// Mapeia category → lista de actions específicas (filtro por action IN).
// Usado quando a categoria não é definida por resource (LGPD/transparência).
const CATEGORY_ACTIONS: Record<string, string[]> = {
  lgpd: [
    'IMPERSONATION_START',
    'IMPERSONATION_END',
    'LGPD_DATA_EXPORTED',
    'LGPD_DATA_ERASED',
    'LGPD_ERASURE_EXECUTED',
    'LGPD_REQUEST_CREATED',
    'LGPD_REQUEST_CREATED_ACCESS',
    'LGPD_REQUEST_CREATED_PORTABILITY',
    'LGPD_REQUEST_CREATED_DELETION',
    'LGPD_REQUEST_CREATED_CORRECTION',
    'LGPD_REQUEST_CREATED_ANONYMIZATION',
    'LGPD_REQUEST_PROCESSED',
  ],
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

auditRouter.get('/explorer', publicRoute(), asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const q = ExplorerQuery.parse(req.query)
  const tenantWhere = tenantScopeFilter(jwt)

  // Tenant scope rigoroso para SUPER_ADMIN navegando cockpit de um integrador
  // específico. Para INTEGRADOR_*, o filtro JWT já restringe — se quem chama
  // tentar passar outro integradorId que não o seu, bloqueia.
  const scopedIntegradorId: string | undefined = q.integradorId
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
    const actions   = cats.flatMap(c => CATEGORY_ACTIONS[c]   ?? [])
    // Se a categoria define actions específicas (ex: lgpd), filtra por action.
    // Caso contrário, filtra por resource. Se ambos: OR (qualquer um casa).
    if (resources.length && actions.length) {
      conditions.push({ OR: [{ resource: { in: resources } }, { action: { in: actions } }] })
    } else if (actions.length) {
      conditions.push({ action: { in: actions } })
    } else if (resources.length) {
      conditions.push({ resource: { in: resources } })
    }
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

  // Onda 5 — filtros hierárquicos.
  // AuditLog: clienteFinalId direto; siteId/cameraId/edgeNodeId via resourceId
  // quando o resource bate (ações sobre Site/Camera/EdgeNode).
  if (q.clienteFinalId) conditions.push({ clienteFinalId: q.clienteFinalId })
  if (q.siteId)         conditions.push({ resource: 'Site',     resourceId: q.siteId })
  if (q.cameraId)       conditions.push({ resource: 'Camera',   resourceId: q.cameraId })
  if (q.edgeNodeId)     conditions.push({ resource: 'EdgeNode', resourceId: q.edgeNodeId })

  // Onda 6 — filtros HTTP.
  if (q.method) conditions.push({ method: q.method })
  if (q.actorRole) {
    const roles = q.actorRole.split(',').map(r => r.trim()).filter(Boolean)
    if (roles.length) conditions.push({ user: { role: { in: roles as any[] } } })
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
  // Onda 2 do log-audit (2026-05-06) — fontes novas
  const includeAi             = noFilter || requestedCats.includes('ai')
  const includeNotifications  = noFilter || requestedCats.includes('notifications')
  const includeWebhooks       = noFilter || requestedCats.includes('webhooks')
  const includeUsage          = noFilter || requestedCats.includes('usage')
  // Storage cobre tanto ações de admin (já em AuditLog 'storage') quanto acessos a R2/S3 (StorageAccessLog)
  const includeStorageAccess  = noFilter || requestedCats.includes('storage')

  // ── Onda 0 hotfix — resiliência multi-fonte ────────────────────────────────
  // Antes: Promise.all em série + uma fonte com erro de schema (ex: CameraLog,
  // EdgeConnectionLog) derrubava o endpoint inteiro com 500. Agora cada fonte
  // roda em try/catch, falha isolada vira aviso e é exposto em `sourceErrors`
  // no JSON pra UI poder mostrar "X fontes degradadas" sem esconder a verdade.
  const sourceErrors: Array<{ source: string; error: string }> = []
  async function safeSource<T>(source: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn() }
    catch (err: any) {
      const msg = err?.message ?? String(err)
      req.log?.warn?.({ source, err: msg }, 'audit_explorer_source_failed')
      sourceErrors.push({ source, error: msg.split('\n')[0].slice(0, 240) })
      return fallback
    }
  }

  const auditRes = await safeSource('audit', async () => {
    const [items, total] = await Promise.all([
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
    return { items, total }
  }, { items: [] as any[], total: 0 })
  const auditLogs = auditRes.items
  const auditTotal = auditRes.total

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

    // Tenant scope para EdgeConnectionLog — sem campo direto integradorId/clienteFinalId
    // no schema; atravessa edgeNode → site → clienteFinal → integrador via relação.
    // (Onda 0 hotfix — antes filtrava por campo inexistente e estourava 500.)
    if (scopedIntegradorId) {
      edgeWhere.edgeNode = { site: { clienteFinal: { integradorId: scopedIntegradorId } } }
    } else if (jwt.role?.startsWith('INTEGRADOR_')) {
      edgeWhere.edgeNode = { site: { clienteFinal: { integradorId: jwt.integradorId } } }
    } else if (jwt.role?.startsWith('CLIENTE_')) {
      edgeWhere.edgeNode = { site: { clienteFinalId: jwt.clienteFinalId } }
    }

    // Onda 5 — filtros hierárquicos no EdgeConnectionLog.
    // Aplicados como AND no relation edgeNode para NÃO sobrescrever o tenant
    // scope que já filtra edgeNode.site.clienteFinal.integradorId (segurança).
    if (q.edgeNodeId) edgeWhere.edgeNodeId = q.edgeNodeId
    const edgeNodeAndFilters: any[] = []
    if (q.siteId)         edgeNodeAndFilters.push({ siteId: q.siteId })
    if (q.clienteFinalId) edgeNodeAndFilters.push({ site: { clienteFinalId: q.clienteFinalId } })
    if (edgeNodeAndFilters.length) {
      edgeWhere.edgeNode = edgeWhere.edgeNode
        ? { AND: [edgeWhere.edgeNode, ...edgeNodeAndFilters] }
        : { AND: edgeNodeAndFilters }
    }

    if (q.action) {
      edgeWhere.eventType = { contains: q.action, mode: 'insensitive' }
    }
    if (q.result) {
      edgeWhere.status = q.result === 'ERROR' ? 'FAILED' : q.result === 'BLOCKED' ? 'PENDING' : 'SUCCESS'
    }

    const edgeRes = await safeSource('edge-connection', async () => {
      const [items, count] = await Promise.all([
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
      return { items, count }
    }, { items: [] as any[], count: 0 })
    edgeLogs = edgeRes.items
    edgeTotal = edgeRes.count
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

    // Onda 5 — filtros hierárquicos no SystemLog (campos diretos)
    // A3: override só p/ super/integrador (AND-safe). CLIENTE_* fica preso ao próprio.
    if (q.clienteFinalId && !jwt.role?.startsWith('CLIENTE_')) sysWhere.clienteFinalId = q.clienteFinalId
    if (q.edgeNodeId)     sysWhere.edgeNodeId = q.edgeNodeId
    if (q.actorId)        sysWhere.userId = q.actorId
    // Onda 6 — método HTTP
    if (q.method)         sysWhere.method = q.method

    const sysRes = await safeSource('system', async () => {
      const [items, count] = await Promise.all([
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
      // Lookup batch de nomes (UX premium) — dentro do safeSource pra falhar junto
      const intIds = Array.from(new Set(items.map(s => s.integradorId).filter(Boolean))) as string[]
      const cliIds = Array.from(new Set(items.map(s => s.clienteFinalId).filter(Boolean))) as string[]
      const [intsResolved, clisResolved] = await Promise.all([
        intIds.length ? prisma.integrador.findMany({ where: { id: { in: intIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
        cliIds.length ? prisma.clienteFinal.findMany({ where: { id: { in: cliIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      ])
      const intMap = new Map(intsResolved.map(i => [i.id, i.name]))
      const cliMap = new Map(clisResolved.map(c => [c.id, c.name]))
      const enriched = items.map(s => ({
        ...s,
        _integradorName:   s.integradorId ? intMap.get(s.integradorId) ?? null : null,
        _clienteFinalName: s.clienteFinalId ? cliMap.get(s.clienteFinalId) ?? null : null,
      }))
      return { items: enriched, count }
    }, { items: [] as any[], count: 0 })
    systemLogs = sysRes.items
    systemTotal = sysRes.count
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
    // Tenant scope para CameraLog — sem campo direto integradorId/clienteFinalId;
    // atravessa camera → site → clienteFinal → integrador via relação.
    // (Onda 0 hotfix — antes filtrava por campo inexistente e estourava 500.)
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
    // Onda 5 — filtros hierárquicos no CameraLog.
    // Aplicados como AND no relation camera para NÃO sobrescrever o tenant
    // scope que já filtra camera.site.clienteFinal.integradorId (segurança).
    if (q.cameraId) camWhere.cameraId = q.cameraId
    const cameraAndFilters: any[] = []
    if (q.siteId)         cameraAndFilters.push({ siteId: q.siteId })
    if (q.clienteFinalId) cameraAndFilters.push({ site: { clienteFinalId: q.clienteFinalId } })
    if (cameraAndFilters.length) {
      camWhere.camera = camWhere.camera
        ? { AND: [camWhere.camera, ...cameraAndFilters] }
        : { AND: cameraAndFilters }
    }

    const camRes = await safeSource('camera', async () => {
      const [items, count] = await Promise.all([
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
      return { items, count }
    }, { items: [] as any[], count: 0 })
    cameraLogs = camRes.items
    cameraTotal = camRes.count
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

    // Onda 5 — filtros hierárquicos no IngestLog.
    // AND-merge para preservar o tenant scope acima (não sobrescrever).
    if (q.cameraId) ingWhere.cameraId = q.cameraId
    const ingestCameraAndFilters: any[] = []
    if (q.siteId)         ingestCameraAndFilters.push({ siteId: q.siteId })
    if (q.clienteFinalId) ingestCameraAndFilters.push({ site: { clienteFinalId: q.clienteFinalId } })
    if (ingestCameraAndFilters.length) {
      ingWhere.camera = ingWhere.camera
        ? { AND: [ingWhere.camera, ...ingestCameraAndFilters] }
        : { AND: ingestCameraAndFilters }
    }

    const ingRes = await safeSource('ingest', async () => {
      const [items, count] = await Promise.all([
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
      return { items, count }
    }, { items: [] as any[], count: 0 })
    ingestLogs = ingRes.items
    ingestTotal = ingRes.count
  }

  // ════════════════════════════════════════════════════════════════════════
  // Onda 2 do log-audit — fontes adicionais
  // ════════════════════════════════════════════════════════════════════════

  // ── Fonte: AI events ──────────────────────────────────────────────────────
  // 4 modelos numa categoria: AnalyticsEvent (genérico), FaceRecognitionEvent,
  // LicensePlateEvent, AudioDetectionEvent. Tenant scope via Camera.
  let aiEvents: any[] = []
  let aiTotal = 0
  if (includeAi) {
    const aiBaseScope: any = {
      capturedAt: { gte: since, lte: until },
    }
    if (scopedIntegradorId) {
      aiBaseScope.camera = { site: { clienteFinal: { integradorId: scopedIntegradorId } } }
    } else if (jwt.role?.startsWith('INTEGRADOR_')) {
      aiBaseScope.camera = { site: { clienteFinal: { integradorId: jwt.integradorId } } }
    } else if (jwt.role?.startsWith('CLIENTE_')) {
      aiBaseScope.camera = { site: { clienteFinalId: jwt.clienteFinalId } }
    }
    if (q.resourceId) aiBaseScope.cameraId = q.resourceId

    // Onda 5 — filtros hierárquicos nas fontes IA.
    // AND-merge para preservar tenant scope.
    if (q.cameraId) aiBaseScope.cameraId = q.cameraId
    const aiCameraAndFilters: any[] = []
    if (q.siteId)         aiCameraAndFilters.push({ siteId: q.siteId })
    if (q.clienteFinalId) aiCameraAndFilters.push({ site: { clienteFinalId: q.clienteFinalId } })
    if (aiCameraAndFilters.length) {
      aiBaseScope.camera = aiBaseScope.camera
        ? { AND: [aiBaseScope.camera, ...aiCameraAndFilters] }
        : { AND: aiCameraAndFilters }
    }

    const camSelect = {
      camera: {
        select: {
          id: true, name: true,
          site: {
            select: {
              id: true, name: true,
              clienteFinal: { select: { id: true, name: true, integradorId: true } },
            },
          },
        },
      },
    }

    const aiRes = await safeSource('ai-event', async () => {
      const [analytics, faces, plates, audios, aCount, fCount, pCount, auCount] = await Promise.all([
        prisma.analyticsEvent.findMany({
          where: aiBaseScope,
          orderBy: { capturedAt: q.sort },
          take: q.limit,
          select: {
            id: true, eventType: true, severity: true, model: true, pipeline: true,
            cameraId: true, zoneId: true, capturedAt: true, processedAt: true,
            ...camSelect,
          },
        }),
        prisma.faceRecognitionEvent.findMany({
          where: aiBaseScope,
          orderBy: { capturedAt: q.sort },
          take: q.limit,
          select: {
            id: true, status: true, matchScore: true, capturedAt: true,
            cameraId: true, faceIdentityId: true, gender: true, ageRange: true,
            ...camSelect,
          },
        }),
        prisma.licensePlateEvent.findMany({
          where: aiBaseScope,
          orderBy: { capturedAt: q.sort },
          take: q.limit,
          select: {
            id: true, detectedPlate: true, ocrScore: true, capturedAt: true,
            cameraId: true, licensePlateId: true, vehicleType: true, direction: true,
            ...camSelect,
          },
        }),
        prisma.audioDetectionEvent.findMany({
          where: aiBaseScope,
          orderBy: { capturedAt: q.sort },
          take: q.limit,
          select: {
            id: true, label: true, score: true, volumeDb: true, capturedAt: true,
            cameraId: true, durationMs: true,
            ...camSelect,
          },
        }),
        prisma.analyticsEvent.count({ where: aiBaseScope }),
        prisma.faceRecognitionEvent.count({ where: aiBaseScope }),
        prisma.licensePlateEvent.count({ where: aiBaseScope }),
        prisma.audioDetectionEvent.count({ where: aiBaseScope }),
      ])
      const events = [
        ...analytics.map(a => ({ ...a, _kind: 'analytics' as const })),
        ...faces.map(f    => ({ ...f, _kind: 'face' as const })),
        ...plates.map(p   => ({ ...p, _kind: 'plate' as const })),
        ...audios.map(au  => ({ ...au, _kind: 'audio' as const })),
      ]
      return { events, count: aCount + fCount + pCount + auCount }
    }, { events: [] as any[], count: 0 })
    aiEvents = aiRes.events
    aiTotal = aiRes.count
  }

  // ── Fonte: NotificationLog ────────────────────────────────────────────────
  // Histórico de mensagens enviadas (WhatsApp via Evolution API).
  let notifLogs: any[] = []
  let notifTotal = 0
  if (includeNotifications) {
    const notifWhere: any = {
      sentAt: { gte: since, lte: until },
    }
    if (scopedIntegradorId) {
      notifWhere.clienteFinal = { integradorId: scopedIntegradorId }
    } else if (jwt.role?.startsWith('INTEGRADOR_')) {
      notifWhere.clienteFinal = { integradorId: jwt.integradorId }
    } else if (jwt.role?.startsWith('CLIENTE_')) {
      notifWhere.clienteFinalId = jwt.clienteFinalId
    }
    if (q.search) notifWhere.message = { contains: q.search, mode: 'insensitive' }
    // Onda 5 — filtros hierárquicos nas notificações (são por clienteFinal)
    // A3: override só p/ super/integrador (AND-safe). CLIENTE_* fica preso ao próprio.
    if (q.clienteFinalId && !jwt.role?.startsWith('CLIENTE_')) notifWhere.clienteFinalId = q.clienteFinalId

    const notifRes = await safeSource('notification', async () => {
      const [items, count] = await Promise.all([
        prisma.notificationLog.findMany({
          where: notifWhere,
          orderBy: { sentAt: q.sort },
          take: q.limit,
          select: {
            id: true, status: true, origin: true, toPhone: true, message: true,
            errorMessage: true, evolutionMsgId: true, instanceName: true,
            clienteFinalId: true, sentAt: true,
            clienteFinal: {
              select: {
                id: true, name: true, integradorId: true,
                integrador: { select: { id: true, name: true } },
              },
            },
          },
        }),
        prisma.notificationLog.count({ where: notifWhere }),
      ])
      return { items, count }
    }, { items: [] as any[], count: 0 })
    notifLogs = notifRes.items
    notifTotal = notifRes.count
  }

  // ── Fonte: AsaasWebhookEvent ──────────────────────────────────────────────
  // Webhooks de billing — só super-admin tem visão (eventos cross-tenant).
  let webhookLogs: any[] = []
  let webhookTotal = 0
  if (includeWebhooks && (jwt.role === 'SUPER_ADMIN' || jwt.role === 'ADMIN_GLOBAL')) {
    const webhookWhere: any = {
      receivedAt: { gte: since, lte: until },
    }
    if (q.search) webhookWhere.eventName = { contains: q.search, mode: 'insensitive' }

    const whRes = await safeSource('webhook', async () => {
      const [items, count] = await Promise.all([
        prisma.asaasWebhookEvent.findMany({
          where: webhookWhere,
          orderBy: { receivedAt: q.sort },
          take: q.limit,
          select: {
            id: true, eventId: true, eventName: true, status: true,
            errorMessage: true, receivedAt: true, processedAt: true,
          },
        }),
        prisma.asaasWebhookEvent.count({ where: webhookWhere }),
      ])
      return { items, count }
    }, { items: [] as any[], count: 0 })
    webhookLogs = whRes.items
    webhookTotal = whRes.count
  }

  // ── Fonte: ApiUsageLog ────────────────────────────────────────────────────
  // Custos Vision/Vertex/GCS — visível por tenant scope.
  let usageLogs: any[] = []
  let usageTotal = 0
  if (includeUsage) {
    // ApiUsageLog tem `recordedAt` (não createdAt)
    const usageWhere: any = {
      recordedAt: { gte: since, lte: until },
    }
    if (scopedIntegradorId) {
      usageWhere.integradorId = scopedIntegradorId
    } else if (jwt.role?.startsWith('INTEGRADOR_')) {
      usageWhere.integradorId = jwt.integradorId
    } else if (jwt.role?.startsWith('CLIENTE_')) {
      // ApiUsageLog não tem clienteFinalId direto — filtra via camera→site→clienteFinal
      usageWhere.camera = { site: { clienteFinalId: jwt.clienteFinalId } }
    }
    if (q.resourceId) usageWhere.cameraId = q.resourceId
    // Onda 5 — filtros hierárquicos no ApiUsageLog (AND-merge preserva tenant scope)
    if (q.cameraId)   usageWhere.cameraId = q.cameraId
    if (q.edgeNodeId) usageWhere.edgeNodeId = q.edgeNodeId
    const usageCameraAndFilters: any[] = []
    if (q.siteId)         usageCameraAndFilters.push({ siteId: q.siteId })
    if (q.clienteFinalId) usageCameraAndFilters.push({ site: { clienteFinalId: q.clienteFinalId } })
    if (usageCameraAndFilters.length) {
      usageWhere.camera = usageWhere.camera
        ? { AND: [usageWhere.camera, ...usageCameraAndFilters] }
        : { AND: usageCameraAndFilters }
    }

    const usageRes = await safeSource('api-usage', async () => {
      const [items, count] = await Promise.all([
        prisma.apiUsageLog.findMany({
          where: usageWhere,
          orderBy: { recordedAt: q.sort },
          take: q.limit,
          select: {
            id: true, integradorId: true, cameraId: true, edgeNodeId: true,
            visionApiCalls: true, vertexStreamMinutes: true, gcsObjectsStored: true,
            visionCostUsd: true, vertexCostUsd: true, gcsCostUsd: true,
            recordedAt: true,
          },
        }),
        prisma.apiUsageLog.count({ where: usageWhere }),
      ])
      return { items, count }
    }, { items: [] as any[], count: 0 })
    usageLogs = usageRes.items
    usageTotal = usageRes.count
  }

  // ── Fonte: StorageAccessLog ──────────────────────────────────────────────
  // Acessos a R2/S3 (download/upload/delete de gravações). Tenant scope nativo.
  let storageLogs: any[] = []
  let storageTotal = 0
  if (includeStorageAccess) {
    const stWhere: any = {
      createdAt: { gte: since, lte: until },
    }
    if (scopedIntegradorId) {
      stWhere.integradorId = scopedIntegradorId
    } else if (jwt.role?.startsWith('INTEGRADOR_')) {
      stWhere.integradorId = jwt.integradorId
    } else if (jwt.role?.startsWith('CLIENTE_')) {
      stWhere.clienteFinalId = jwt.clienteFinalId
    }
    if (q.actorId) stWhere.actorId = q.actorId
    if (q.actorEmail) stWhere.actorEmail = { contains: q.actorEmail, mode: 'insensitive' }
    // Onda 5 — filtros hierárquicos no StorageAccessLog (campos diretos)
    // A3: override só p/ super/integrador (AND-safe). CLIENTE_* fica preso ao próprio.
    if (q.clienteFinalId && !jwt.role?.startsWith('CLIENTE_')) stWhere.clienteFinalId = q.clienteFinalId
    if (q.cameraId)       stWhere.cameraId = q.cameraId

    const stRes = await safeSource('storage-access', async () => {
      const [items, count] = await Promise.all([
        prisma.storageAccessLog.findMany({
          where: stWhere,
          orderBy: { createdAt: q.sort },
          take: q.limit,
          select: {
            id: true, action: true, actorType: true, actorId: true, actorEmail: true,
            integradorId: true, clienteFinalId: true, cameraId: true,
            bucketName: true, objectKey: true, createdAt: true,
          },
        }),
        prisma.storageAccessLog.count({ where: stWhere }),
      ])
      return { items, count }
    }, { items: [] as any[], count: 0 })
    storageLogs = stRes.items
    storageTotal = stRes.count
  }

  let videoLogs: any[] = []
  let videoTotal = 0

  const logs = auditLogs
  const total = auditTotal + edgeTotal + systemTotal + cameraTotal + ingestTotal +
                aiTotal + notifTotal + webhookTotal + usageTotal + storageTotal + videoTotal


  // LGPD Masking Helper
  const isTechnicalView = jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'ADMIN_GLOBAL'
  const maskEmail = (email: string) => {
    if (!email) return email
    if (!isTechnicalView) return email
    const parts = email.split('@')
    if (parts.length !== 2) return email
    return `${parts[0].charAt(0)}***@${parts[1]}`
  }
  const maskIp = (ip: string | null) => {
    if (!ip) return ip
    if (!isTechnicalView) return ip
    return '[Restrito LGPD]'
  }

  // Enriquece com category + severity + actor consolidado
  const enrichedAudit = logs.map(l => {
    const actor = l.user
      ? { id: l.user.id, name: l.user.name, email: maskEmail(l.user.email), role: l.user.role, kind: 'user' as const }
      : l.superAdmin
        ? { id: l.superAdmin.id, name: l.superAdmin.name, email: maskEmail(l.superAdmin.email), role: 'SUPER_ADMIN', kind: 'superadmin' as const }
        : null
    return {
      id: l.id,
      source: 'audit' as const,
      timestamp: l.createdAt,
      action: l.action,
      resource: l.resource,
      resourceId: l.resourceId,
      result: l.result,
      ipAddress: maskIp(l.ipAddress),
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

  // ── Adapters Onda 2 do log-audit ────────────────────────────────────────

  // AI events (4 modelos numa fonte)
  const enrichedAi = aiEvents.map((e: any) => {
    const cf = e.camera?.site?.clienteFinal
    const tenant = cf
      ? { kind: 'clienteFinal' as const, id: cf.id, name: cf.name }
      : null
    let action: string
    let sev: 'info'|'warning'|'error'|'critical' = 'info'
    const resourceId: string | null = e.id
    const baseMeta: any = {
      cameraName: e.camera?.name,
      siteName:   e.camera?.site?.name,
    }
    if (e._kind === 'analytics') {
      action = e.eventType
      // AnalyticsEvent.severity é enum INFO|WARN|ERROR|CRITICAL
      sev = e.severity === 'CRITICAL' ? 'critical'
          : e.severity === 'ERROR'    ? 'error'
          : e.severity === 'WARN'     ? 'warning'
          : 'info'
      Object.assign(baseMeta, { model: e.model, pipeline: e.pipeline, zoneId: e.zoneId })
    } else if (e._kind === 'face') {
      action = `FACE_${e.status}`  // FACE_KNOWN | FACE_UNKNOWN | FACE_REVIEW
      sev = e.status === 'UNKNOWN' ? 'warning' : 'info'
      Object.assign(baseMeta, { faceIdentityId: e.faceIdentityId, matchScore: e.matchScore, gender: e.gender, ageRange: e.ageRange })
    } else if (e._kind === 'plate') {
      action = 'LICENSE_PLATE_DETECTED'
      sev = 'info'
      Object.assign(baseMeta, { detectedPlate: e.detectedPlate, ocrScore: e.ocrScore, vehicleType: e.vehicleType, direction: e.direction })
    } else {
      action = `AUDIO_${(e.label as string || 'UNKNOWN').toUpperCase()}`
      sev = 'warning'  // Audio detection sempre é warning (scream/glass/siren)
      Object.assign(baseMeta, { label: e.label, score: e.score, volumeDb: e.volumeDb, durationMs: e.durationMs })
    }
    return {
      id: e.id,
      source: 'ai-event' as const,
      timestamp: e.capturedAt,
      action,
      resource: 'Camera',
      resourceId: e.cameraId ?? resourceId,
      result: 'SUCCESS',
      ipAddress: null,
      userAgent: null,
      metadata: baseMeta,
      actor: null,  // box-side
      tenant,
      category: 'ai',
      severity: sev,
    }
  })

  // NotificationLog
  const enrichedNotif = notifLogs.map((n: any) => {
    const tenant = n.clienteFinal
      ? { kind: 'clienteFinal' as const, id: n.clienteFinal.id, name: n.clienteFinal.name }
      : null
    const sev: 'info'|'warning'|'error'|'critical' =
      n.status === 'failed' ? 'error' : 'info'
    return {
      id: n.id,
      source: 'notification' as const,
      timestamp: n.sentAt,
      action: `NOTIFICATION_${(n.status as string).toUpperCase()}`,
      resource: 'NotificationLog',
      resourceId: n.id,
      result: n.status === 'failed' ? 'ERROR' : 'SUCCESS',
      ipAddress: null,
      userAgent: null,
      metadata: {
        toPhone: n.toPhone,
        message: (n.message as string)?.slice(0, 200),
        origin: n.origin,
        instanceName: n.instanceName,
        evolutionMsgId: n.evolutionMsgId,
        errorMessage: n.errorMessage,
        clienteName: n.clienteFinal?.name,
        integradorName: n.clienteFinal?.integrador?.name,
      },
      actor: null,
      tenant,
      category: 'notifications',
      severity: sev,
    }
  })

  // AsaasWebhookEvent
  const enrichedWebhook = webhookLogs.map((w: any) => {
    const sev: 'info'|'warning'|'error'|'critical' =
      w.status === 'FAILED' ? 'error' :
      w.status === 'PENDING' ? 'warning' : 'info'
    return {
      id: w.id,
      source: 'webhook' as const,
      timestamp: w.receivedAt,
      action: w.eventName,
      resource: 'AsaasWebhookEvent',
      resourceId: w.eventId,
      result: w.status === 'FAILED' ? 'ERROR' : w.status === 'PROCESSED' ? 'SUCCESS' : 'BLOCKED',
      ipAddress: null,
      userAgent: null,
      metadata: {
        status: w.status,
        errorMessage: w.errorMessage,
        processedAt: w.processedAt,
      },
      actor: null,
      tenant: null,  // webhooks são platform-wide
      category: 'webhooks',
      severity: sev,
    }
  })

  // ApiUsageLog
  const enrichedUsage = usageLogs.map((u: any) => {
    return {
      id: u.id,
      source: 'api-usage' as const,
      timestamp: u.recordedAt,
      action: 'API_USAGE_RECORDED',
      resource: 'ApiQuota',
      resourceId: u.cameraId ?? u.edgeNodeId ?? u.integradorId,
      result: 'SUCCESS',
      ipAddress: null,
      userAgent: null,
      metadata: {
        visionApiCalls: u.visionApiCalls,
        vertexStreamMinutes: u.vertexStreamMinutes,
        gcsObjectsStored: u.gcsObjectsStored,
        visionCostUsd: u.visionCostUsd?.toString() ?? null,
        vertexCostUsd: u.vertexCostUsd?.toString() ?? null,
        gcsCostUsd: u.gcsCostUsd?.toString() ?? null,
        cameraId: u.cameraId, edgeNodeId: u.edgeNodeId,
      },
      actor: null,
      tenant: u.integradorId ? { kind: 'integrador' as const, id: u.integradorId, name: u.integradorId.slice(0, 8) } : null,
      category: 'usage',
      severity: 'info' as const,
    }
  })

  // StorageAccessLog
  const enrichedStorage = storageLogs.map((s: any) => {
    const tenant = s.integradorId
      ? { kind: 'integrador' as const, id: s.integradorId, name: s.integradorId.slice(0, 8) }
      : s.clienteFinalId
        ? { kind: 'clienteFinal' as const, id: s.clienteFinalId, name: s.clienteFinalId.slice(0, 8) }
        : null
    const sev: 'info'|'warning'|'error'|'critical' =
      String(s.action).includes('DELETE') || String(s.action).includes('PURGE') ? 'warning' : 'info'
    return {
      id: s.id,
      source: 'storage-access' as const,
      timestamp: s.createdAt,
      action: s.action,
      resource: 'StorageBucket',
      resourceId: s.bucketName ?? s.cameraId ?? null,
      result: 'SUCCESS',
      ipAddress: null,
      userAgent: null,
      metadata: {
        bucketName: s.bucketName,
        objectKey: s.objectKey,
        cameraId: s.cameraId,
      },
      actor: s.actorEmail
        ? { id: s.actorId, name: maskEmail(s.actorEmail), email: maskEmail(s.actorEmail), role: s.actorType, kind: 'user' as const }
        : null,
      tenant,
      category: 'storage',
      severity: sev,
    }
  })


  // Adapter VideoSessionLog -> shape comum
  const enrichedVideo = videoLogs.map((v: any) => {
    const tenant = v.integradorId
      ? { kind: 'integrador' as const, id: v.integradorId, name: v.integradorId.slice(0, 8) }
      : v.clienteFinalId
        ? { kind: 'clienteFinal' as const, id: v.clienteFinalId, name: v.clienteFinalId.slice(0, 8) }
        : null
    return {
      id: v.id,
      source: 'video-session' as const,
      timestamp: v.startedAt,
      action: v.streamType === 'PLAYBACK_HLS' ? 'PLAYBACK_REQUESTED' : 'LIVE_STREAM_OPENED',
      resource: 'Camera',
      resourceId: v.cameraId,
      result: 'SUCCESS',
      ipAddress: maskIp(v.ipAddress),
      userAgent: v.userAgent,
      metadata: {
        streamType: v.streamType,
        durationSec: v.durationSec,
        userId: v.userId,
        superAdminId: v.superAdminId,
      },
      actor: null, // Pode ser preenchido via userId se fizer o join
      tenant,
      category: 'video',
      severity: 'info' as const,
    }
  })

  const enriched = [
    ...enrichedAudit,
    ...enrichedEdge,
    ...enrichedSystem,
    ...enrichedCameraLog,
    ...enrichedIngest,
    // Onda 2 do log-audit (2026-05-06):
    ...enrichedAi,
    ...enrichedNotif,
    ...enrichedWebhook,
    ...enrichedUsage,
    ...enrichedStorage,
    ...enrichedVideo,
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

  // Onda 0 hotfix — expõe fontes degradadas pra UI mostrar warning sem esconder a verdade.
  // Echo o request-id (do pino-http) pra correlação rápida no suporte.
  const requestId = (req as any).id ?? req.headers['x-request-id'] ?? null
  if (sourceErrors.length) {
    req.log?.warn?.(
      { sourceErrors, requestId },
      'audit_explorer_partial_response_due_to_source_failures',
    )
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
    sourceErrors,            // [] quando tudo OK
    requestId,               // X-Request-Id eco pra correlação
  })
}))

// =============================================================================
// GET /audit/resource/:resource/:resourceId  — story view de uma entity
// Retorna timeline completa de ações sobre um recurso específico.
// =============================================================================
auditRouter.get('/resource/:resource/:resourceId', publicRoute(), asyncHandler(async (req, res) => {
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

// =============================================================================
// GET /audit/filter-options — popula dropdowns hierárquicos do /log-audit
//
// Onda 5 do log-audit (2026-05-06). Retorna listas escopadas por persona:
//   - SUPER_ADMIN/ADMIN_GLOBAL: todos integradores + todos clientes + todos
//                                sites + todas cameras + todos edges + todos users
//   - INTEGRADOR_*:             próprios clientes + próprios sites + próprias
//                                cameras + próprios edges + próprios users
//   - CLIENTE_*:                próprios sites + próprias cameras + próprios
//                                edges + próprios users
//
// Cache HTTP: 60s (frontend usa SWR refreshInterval 60_000).
// =============================================================================
auditRouter.get('/filter-options', publicRoute(), asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const role = jwt.role
  const isSuper = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'

  // Filtros base por persona — apenas o escopo permitido vem populado.
  const integScope:  string | undefined = isSuper
    ? undefined
    : jwt.integradorId ?? '__NONE__'
  const cliScope:    string | undefined = role?.startsWith('CLIENTE_')
    ? jwt.clienteFinalId ?? '__NONE__'
    : undefined

  const [integradores, clientesFinais, sites, cameras, edgeNodes, users] = await Promise.all([
    // Integradores: só super-admin lista
    isSuper
      ? prisma.integrador.findMany({
          select: { id: true, name: true, tradeName: true },
          orderBy: { name: 'asc' },
          take: 200,
        })
      : Promise.resolve([]),

    // Clientes finais: super vê todos, integrador vê próprios, cliente vê o seu
    cliScope
      ? prisma.clienteFinal.findMany({
          where: { id: cliScope },
          select: { id: true, name: true, tradeName: true, integradorId: true },
        })
      : prisma.clienteFinal.findMany({
          where: integScope ? { integradorId: integScope } : {},
          select: { id: true, name: true, tradeName: true, integradorId: true },
          orderBy: { name: 'asc' },
          take: 500,
        }),

    // Sites: filtra via clienteFinal → integrador
    prisma.site.findMany({
      where: cliScope
        ? { clienteFinalId: cliScope }
        : integScope
          ? { clienteFinal: { integradorId: integScope } }
          : {},
      select: { id: true, name: true, clienteFinalId: true, city: true, state: true },
      orderBy: { name: 'asc' },
      take: 1000,
    }),

    // Cameras: filtra via site → clienteFinal → integrador
    prisma.camera.findMany({
      where: cliScope
        ? { site: { clienteFinalId: cliScope } }
        : integScope
          ? { site: { clienteFinal: { integradorId: integScope } } }
          : {},
      select: { id: true, name: true, siteId: true, edgeNodeId: true },
      orderBy: { name: 'asc' },
      take: 2000,
    }),

    // EdgeNodes: filtra via site → clienteFinal → integrador
    prisma.edgeNode.findMany({
      where: cliScope
        ? { site: { clienteFinalId: cliScope } }
        : integScope
          ? { site: { clienteFinal: { integradorId: integScope } } }
          : {},
      select: { id: true, name: true, siteId: true, status: true, serialNumber: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),

    // Users: super vê todos, integrador vê próprios + dos clientes próprios,
    // cliente vê os do próprio clienteFinal
    cliScope
      ? prisma.user.findMany({
          where: { clienteFinalId: cliScope, active: true },
          select: { id: true, name: true, email: true, role: true, clienteFinalId: true, integradorId: true },
          orderBy: { name: 'asc' },
          take: 500,
        })
      : integScope
        ? prisma.user.findMany({
            where: {
              active: true,
              OR: [
                { integradorId: integScope },
                { clienteFinal: { integradorId: integScope } },
              ],
            },
            select: { id: true, name: true, email: true, role: true, clienteFinalId: true, integradorId: true },
            orderBy: { name: 'asc' },
            take: 1000,
          })
        : prisma.user.findMany({
            where: { active: true },
            select: { id: true, name: true, email: true, role: true, clienteFinalId: true, integradorId: true },
            orderBy: { name: 'asc' },
            take: 1000,
          }),
  ])

  res.set('Cache-Control', 'private, max-age=60')
  res.json({
    integradores,
    clientesFinais,
    sites,
    cameras,
    edgeNodes,
    users,
    scope: {
      role,
      integradorId:   jwt.integradorId ?? null,
      clienteFinalId: jwt.clienteFinalId ?? null,
      isSuper,
    },
  })
}))

// =============================================================================
// GET /audit/event-types — catálogo de tipos de evento por categoria
//
// Onda 8 do log-audit (2026-05-06). Lista distinct de eventTypes/actions para
// dropdowns estruturados (em vez de busca livre). Cache HTTP 5min.
//
// Tenant scope: respeita JWT — integrador vê só os tipos que ele realmente
// tem no histórico (próprio escopo). Cliente vê só os do próprio cliente.
// =============================================================================
auditRouter.get('/event-types', publicRoute(), asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const role = jwt.role
  const isSuper = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'

  // Janela de tempo para distinct (90d para capturar tipos sazonais)
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000)

  // Helper para tenant scope reutilizável (sem joins quando possível)
  const auditWhere = (() => {
    if (isSuper) return { createdAt: { gte: since } }
    if (role?.startsWith('INTEGRADOR_')) {
      return {
        createdAt: { gte: since },
        OR: [
          { integradorId: jwt.integradorId },
          { clienteFinal: { integradorId: jwt.integradorId } },
        ],
      }
    }
    if (role?.startsWith('CLIENTE_')) {
      return { createdAt: { gte: since }, clienteFinalId: jwt.clienteFinalId }
    }
    return { createdAt: { gte: since } }
  })()

  const edgeWhere = (() => {
    if (isSuper) return { createdAt: { gte: since } }
    if (role?.startsWith('INTEGRADOR_')) {
      return { createdAt: { gte: since }, edgeNode: { site: { clienteFinal: { integradorId: jwt.integradorId } } } }
    }
    if (role?.startsWith('CLIENTE_')) {
      return { createdAt: { gte: since }, edgeNode: { site: { clienteFinalId: jwt.clienteFinalId } } }
    }
    return { createdAt: { gte: since } }
  })()

  const aiWhere = (() => {
    if (isSuper) return { capturedAt: { gte: since } }
    if (role?.startsWith('INTEGRADOR_')) {
      return { capturedAt: { gte: since }, camera: { site: { clienteFinal: { integradorId: jwt.integradorId } } } }
    }
    if (role?.startsWith('CLIENTE_')) {
      return { capturedAt: { gte: since }, camera: { site: { clienteFinalId: jwt.clienteFinalId } } }
    }
    return { capturedAt: { gte: since } }
  })()

  const [auditActions, edgeEvents, aiTypes] = await Promise.all([
    // Distinct actions do AuditLog
    prisma.auditLog.findMany({
      where: auditWhere as any,
      select: { action: true },
      distinct: ['action'],
      take: 200,
    }),
    // Distinct eventTypes do EdgeConnectionLog
    prisma.edgeConnectionLog.findMany({
      where: edgeWhere as any,
      select: { eventType: true },
      distinct: ['eventType'],
      take: 100,
    }),
    // Distinct eventType do AnalyticsEvent
    prisma.analyticsEvent.findMany({
      where: aiWhere as any,
      select: { eventType: true },
      distinct: ['eventType'],
      take: 100,
    }),
  ])

  res.set('Cache-Control', 'private, max-age=300')  // 5min
  res.json({
    audit: auditActions.map(a => a.action).sort(),
    edge:  edgeEvents.map(e => e.eventType).sort(),
    ai:    aiTypes.map(a => a.eventType).sort(),
    // Categorias fixas conhecidas + counts (sparkline) podem ser adicionadas no frontend
  })
}))

// =============================================================================
// GET /audit/explorer/export.csv — Export CSV server-side com RBAC
//
// Onda 9 do log-audit (2026-05-06). Reusa /explorer mas devolve CSV streaming
// em vez de JSON. Cap rígido de 10.000 linhas / export para não saturar I/O.
// RBAC idêntico ao /explorer (server-side, não confia em filtros do client).
//
// Headers:
//   Content-Type: text/csv; charset=utf-8
//   Content-Disposition: attachment; filename="log-audit_<since>_<until>.csv"
// =============================================================================
auditRouter.get('/explorer/export.csv', publicRoute(), asyncHandler(async (req, res) => {
  // Reusa o mesmo schema mas com limit fixo
  const q = ExplorerQuery.parse({ ...req.query, limit: 10_000, page: 1 })
  const jwt = req.jwtPayload!

  // Faz a mesma chamada interna ao explorer mas retorna CSV.
  // Para evitar duplicação massiva, faz uma redireção lógica: chama o handler
  // do /explorer manualmente com `res` mockado.
  // Implementação simplificada: reusa as queries via AuditLog only para CSV
  // (CSV típico é admin → AuditLog). Outras fontes podem ser adicionadas
  // depois conforme demanda.

  const tenantWhere = tenantScopeFilter(jwt)
  const since = q.startDate ? new Date(q.startDate) : new Date(Date.now() - q.days * 24 * 3600 * 1000)
  const until = q.endDate ? new Date(q.endDate) : new Date()

  const scopedIntegradorId: string | undefined = q.integradorId
  if (scopedIntegradorId) {
    if (jwt.role !== 'SUPER_ADMIN' && jwt.integradorId !== scopedIntegradorId) {
      throw new ForbiddenError('integradorId fora do escopo')
    }
  }

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
  if (q.action) conditions.push({ action: { contains: q.action, mode: 'insensitive' } })
  if (q.resource) conditions.push({ resource: q.resource })
  if (q.resourceId) conditions.push({ resourceId: q.resourceId })
  if (q.ip) conditions.push({ ipAddress: q.ip })
  if (q.result) conditions.push({ result: q.result })
  if (q.method) conditions.push({ method: q.method })
  if (q.clienteFinalId) conditions.push({ clienteFinalId: q.clienteFinalId })

  const where = { AND: conditions }

  const filename = `log-audit_${since.toISOString().slice(0, 10)}_${until.toISOString().slice(0, 10)}.csv`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  // BOM para Excel reconhecer UTF-8
  res.write('﻿')
  // Header
  res.write('timestamp,action,resource,resourceId,result,method,path,statusCode,durationMs,actor,actorEmail,actorRole,tenant,ipAddress,userAgent\n')

  // Streaming em batches de 1000 para não carregar 10k em RAM
  const BATCH = 1000
  let offset = 0
  let total = 0
  for (;;) {
    const batch = await prisma.auditLog.findMany({
      where: where as any,
      orderBy: { createdAt: q.sort },
      skip: offset,
      take: BATCH,
      select: {
        action: true, resource: true, resourceId: true, result: true,
        method: true, path: true, statusCode: true, durationMs: true,
        ipAddress: true, userAgent: true, createdAt: true,
        superAdmin:   { select: { name: true, email: true } },
        integrador:   { select: { name: true } },
        clienteFinal: { select: { name: true } },
        user:         { select: { name: true, email: true, role: true } },
      },
    })
    if (batch.length === 0) break
    for (const l of batch) {
      const actorName  = l.user?.name ?? l.superAdmin?.name ?? ''
      const actorEmail = l.user?.email ?? l.superAdmin?.email ?? ''
      const actorRole  = l.user?.role ?? (l.superAdmin ? 'SUPER_ADMIN' : '')
      const tenant     = l.integrador?.name ?? l.clienteFinal?.name ?? ''
      const row = [
        l.createdAt.toISOString(),
        csvEscape(l.action),
        csvEscape(l.resource),
        csvEscape(l.resourceId ?? ''),
        l.result ?? '',
        l.method ?? '',
        csvEscape(l.path ?? ''),
        l.statusCode ?? '',
        l.durationMs ?? '',
        csvEscape(actorName),
        csvEscape(actorEmail),
        actorRole,
        csvEscape(tenant),
        l.ipAddress ?? '',
        csvEscape(l.userAgent ?? ''),
      ].join(',')
      res.write(row + '\n')
      total++
    }
    offset += BATCH
    if (total >= 10_000) break
  }
  res.end()
}))

/** Escapa um valor CSV: aspas duplas + duplica aspas internas. */
function csvEscape(v: string): string {
  if (v == null) return ''
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}
