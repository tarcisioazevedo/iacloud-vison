/**
 * Guest Links Routes (Admin) — Sprint F.
 *
 * Endpoints pra CLIENTE_ADMIN gerar e auditar links de acesso convidado.
 *
 *   POST   /guest-links               — cria
 *   GET    /guest-links               — lista (filtros: status, periodo, search)
 *   GET    /guest-links/:id           — detalhe + audit summary
 *   GET    /guest-links/:id/audit     — audit log paginado
 *   POST   /guest-links/:id/revoke    — revoga
 *   POST   /guest-links/bulk-revoke   — revoga vários
 *
 * Tenant scope: CLIENTE_ADMIN do clienteFinal pode criar/listar seus links.
 * SUPER_ADMIN/ADMIN_GLOBAL podem agir em qualquer cliente.
 * INTEGRADOR_ADMIN só com clienteFinalId explícito da sua árvore.
 *
 * Capability: publicRoute() — autorização é por ROLE (não tem capability
 * específica no marketplace). CLIENTE_ADMIN é check direto.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { guestLinkService, type GuestScope } from '../lib/guest-link.service'
import { logger } from '../lib/logger'
import { dispatchAlert } from '../lib/notification-dispatcher'

export const guestLinksRouter = Router()
guestLinksRouter.use(requireAuth)

// ───── Helpers ──────────────────────────────────────────────────────────────

const ADMIN_ROLES_GLOBAL = new Set(['SUPER_ADMIN', 'ADMIN_GLOBAL'])
const ADMIN_ROLES_CLIENT = new Set(['CLIENTE_ADMIN', 'SUPER_ADMIN', 'ADMIN_GLOBAL'])

/**
 * Resolve qual clienteFinalId pode ser operado pelo caller.
 * - CLIENTE_ADMIN: o seu próprio.
 * - SUPER_ADMIN/ADMIN_GLOBAL: o que vier do body/query.
 * - INTEGRADOR_ADMIN: validamos que pertence à sua árvore.
 *
 * Throw 403 se não pode operar nesse cliente.
 */
async function resolveClienteFinalId(req: Request, requestedId?: string | null): Promise<string> {
  const jwt = req.jwtPayload
  if (!jwt) throw new ForbiddenError()

  if (jwt.role === 'CLIENTE_ADMIN') {
    if (!jwt.clienteFinalId) throw new ForbiddenError('JWT sem cliente final')
    if (requestedId && requestedId !== jwt.clienteFinalId) {
      throw new ForbiddenError('Fora do seu cliente')
    }
    return jwt.clienteFinalId
  }

  if (ADMIN_ROLES_GLOBAL.has(jwt.role)) {
    if (!requestedId) throw new ValidationError('clienteFinalId obrigatório')
    return requestedId
  }

  if (jwt.role === 'INTEGRADOR_ADMIN') {
    if (!requestedId) throw new ValidationError('clienteFinalId obrigatório')
    const cf = await prisma.clienteFinal.findFirst({
      where: { id: requestedId, integradorId: jwt.integradorId ?? '__none__' },
      select: { id: true },
    })
    if (!cf) throw new ForbiddenError('ClienteFinal fora do seu integrador')
    return requestedId
  }

  throw new ForbiddenError('Role não pode gerenciar links convidado')
}

async function ensureCanAdminGuestLink(req: Request, link: { clienteFinalId: string }): Promise<void> {
  const jwt = req.jwtPayload
  if (!jwt) throw new ForbiddenError()
  if (ADMIN_ROLES_GLOBAL.has(jwt.role)) return
  if (jwt.role === 'CLIENTE_ADMIN' && jwt.clienteFinalId === link.clienteFinalId) return
  // INTEGRADOR_ADMIN: SEGURANÇA (auditoria 2026-06-24) — estes endpoints (GET
  // /:id, /:id/audit, POST /:id/revoke) buscam o link por findUnique(id) SEM
  // filtro de tenant. O comentário antigo ("o listing já scopeia") estava
  // ERRADO: não são listagem. Sem a checagem abaixo, qualquer INTEGRADOR_ADMIN
  // lia/revogava guest-links (acesso a vídeo) de OUTROS integradores via UUID.
  // Validamos que o clienteFinal do link pertence à árvore do integrador.
  if (jwt.role === 'INTEGRADOR_ADMIN') {
    if (!jwt.integradorId) throw new ForbiddenError()
    const cf = await prisma.clienteFinal.findFirst({
      where: { id: link.clienteFinalId, integradorId: jwt.integradorId },
      select: { id: true },
    })
    if (!cf) throw new ForbiddenError('Link não pertence ao seu integrador')
    return
  }
  throw new ForbiddenError()
}

// ───── Schemas ──────────────────────────────────────────────────────────────

const ScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('camera'), cameraId: z.string().uuid() }),
  z.object({ kind: z.literal('clip'),   recordingClipId: z.string().min(1) }),
  z.object({ kind: z.literal('site'),   siteId: z.string().uuid() }),
])

const CreateLinkSchema = z.object({
  clienteFinalId:   z.string().uuid().optional(),
  guestName:        z.string().min(1).max(200),
  guestEmail:       z.string().email().max(200).nullish(),
  guestPhone:       z.string().max(40).nullish(),
  purpose:          z.string().min(1).max(500),
  scope:            ScopeSchema,
  recordingFrom:    z.string().datetime().nullish(),
  recordingTo:      z.string().datetime().nullish(),
  canViewLive:      z.boolean().optional(),
  canViewRecording: z.boolean().optional(),
  canDownload:      z.boolean().optional(),
  /** Aceita preset 'PT1H','PT4H','PT24H','P7D' ou ISO datetime explícito. */
  validUntil:       z.string().min(3),
  maxUses:          z.number().int().min(1).max(100).optional(),
  pin:              z.union([z.literal('auto'), z.string().min(4).max(8)]).nullish(),
  allowedIpCidr:    z.string().max(45).nullish(),
  watermarkText:    z.string().max(200).nullish(),
  notifyOnAccess:   z.boolean().optional(),  // best-effort WhatsApp/email
})

const RevokeSchema = z.object({
  reason: z.string().max(500).optional(),
})

const BulkRevokeSchema = z.object({
  ids:    z.array(z.string().uuid()).min(1).max(200),
  reason: z.string().max(500).optional(),
})

function parseValidUntil(input: string): Date {
  // Presets curtos
  const presets: Record<string, number> = {
    'PT1H':  1 * 60 * 60 * 1000,
    'PT4H':  4 * 60 * 60 * 1000,
    'PT24H': 24 * 60 * 60 * 1000,
    'P7D':   7 * 24 * 60 * 60 * 1000,
  }
  if (presets[input]) return new Date(Date.now() + presets[input])
  // ISO datetime
  const d = new Date(input)
  if (isNaN(d.getTime())) throw new ValidationError('validUntil inválido (use ISO datetime ou preset PT1H/PT4H/PT24H/P7D)')
  if (d.getTime() <= Date.now()) throw new ValidationError('validUntil precisa estar no futuro')
  if (d.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) {
    throw new ValidationError('validUntil máximo: 90 dias')
  }
  return d
}

// =============================================================================
// POST /guest-links
// =============================================================================
guestLinksRouter.post('/',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = req.jwtPayload!
    if (!ADMIN_ROLES_CLIENT.has(jwt.role) && jwt.role !== 'INTEGRADOR_ADMIN') {
      throw new ForbiddenError('Role não pode gerar link convidado')
    }

    const parse = CreateLinkSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const body = parse.data
    const clienteFinalId = await resolveClienteFinalId(req, body.clienteFinalId ?? null)

    // Valida que recurso (camera/clip/site) pertence ao tenant
    const scope = body.scope as GuestScope
    if (scope.kind === 'camera') {
      const cam = await prisma.camera.findFirst({
        where: { id: scope.cameraId, site: { clienteFinalId } },
        select: { id: true, name: true },
      })
      if (!cam) throw new NotFoundError('Câmera')
    } else if (scope.kind === 'site') {
      const site = await prisma.site.findFirst({
        where: { id: scope.siteId, clienteFinalId },
        select: { id: true },
      })
      if (!site) throw new NotFoundError('Site')
    } else if (scope.kind === 'clip') {
      // Aceita ID de Bookmark ou RecordingSegment do tenant
      const [bm, seg] = await Promise.all([
        prisma.bookmark.findFirst({
          where: { id: scope.recordingClipId, camera: { site: { clienteFinalId } } },
          select: { id: true },
        }),
        prisma.recordingSegment.findFirst({
          where: { id: scope.recordingClipId, camera: { site: { clienteFinalId } } },
          select: { id: true },
        }),
      ])
      if (!bm && !seg) throw new NotFoundError('Clipe')
    }

    const validUntil = parseValidUntil(body.validUntil)
    let recordingFrom = body.recordingFrom ? new Date(body.recordingFrom) : null
    let recordingTo   = body.recordingTo   ? new Date(body.recordingTo)   : null
    if (recordingFrom && recordingTo && recordingTo.getTime() <= recordingFrom.getTime()) {
      throw new ValidationError('recordingTo deve ser depois de recordingFrom')
    }

    const result = await guestLinkService.createLink({
      createdById:     jwt.sub,
      clienteFinalId,
      guestName:       body.guestName,
      guestEmail:      body.guestEmail ?? null,
      guestPhone:      body.guestPhone ?? null,
      purpose:         body.purpose,
      scope,
      recordingFrom,
      recordingTo,
      canViewLive:      body.canViewLive,
      canViewRecording: body.canViewRecording,
      canDownload:      body.canDownload,
      validUntil,
      maxUses:         body.maxUses,
      pin:             body.pin ?? null,
      allowedIpCidr:   body.allowedIpCidr ?? null,
      watermarkText:   body.watermarkText ?? null,
    })

    // Notificação best-effort ao admin do cliente (NÃO bloqueia)
    if (body.notifyOnAccess) {
      // Marca metadata no log de criação pra futuras notify_on_access
      guestLinkService.logAccess(result.id, 'created', {
        ip:        req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        metadata: {
          createdBy: jwt.sub,
          notifyOnAccess: true,
        },
      })
    } else {
      guestLinkService.logAccess(result.id, 'created', {
        ip:        req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        metadata:  { createdBy: jwt.sub },
      })
    }

    res.status(201).json({
      id:        result.id,
      url:       result.url,
      rawToken:  result.rawToken,    // mostra UMA vez
      pin:       result.pin ?? null, // só se PIN configurado
      validUntil: validUntil.toISOString(),
    })
  }),
)

// =============================================================================
// GET /guest-links
// =============================================================================
guestLinksRouter.get('/',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = req.jwtPayload!

    let where: Record<string, unknown> = {}
    if (jwt.role === 'CLIENTE_ADMIN') {
      if (!jwt.clienteFinalId) throw new ForbiddenError()
      where = { clienteFinalId: jwt.clienteFinalId }
    } else if (ADMIN_ROLES_GLOBAL.has(jwt.role)) {
      const qpId = typeof req.query.clienteFinalId === 'string' ? req.query.clienteFinalId : null
      if (qpId) where = { clienteFinalId: qpId }
    } else if (jwt.role === 'INTEGRADOR_ADMIN') {
      if (!jwt.integradorId) throw new ForbiddenError()
      where = { clienteFinal: { integradorId: jwt.integradorId } }
    } else {
      throw new ForbiddenError('Role não pode listar links convidado')
    }

    const status = typeof req.query.status === 'string' ? req.query.status : null
    const now = new Date()
    if (status === 'active') {
      where = { ...where, revokedAt: null, validUntil: { gt: now } }
    } else if (status === 'expired') {
      where = { ...where, revokedAt: null, validUntil: { lte: now } }
    } else if (status === 'revoked') {
      where = { ...where, revokedAt: { not: null } }
    } else if (status === 'used') {
      // "Usado" = pelo menos um acesso bem-sucedido (usesCount >= 1)
      where = { ...where, usesCount: { gt: 0 } }
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : null
    if (search && search.length >= 2) {
      where = {
        ...where,
        OR: [
          { guestName:  { contains: search, mode: 'insensitive' } },
          { guestEmail: { contains: search, mode: 'insensitive' } },
          { purpose:    { contains: search, mode: 'insensitive' } },
        ],
      }
    }

    const periodDays = typeof req.query.periodDays === 'string' ? parseInt(req.query.periodDays, 10) : null
    if (periodDays && periodDays > 0 && periodDays <= 365) {
      const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)
      where = { ...where, createdAt: { gte: since } }
    }

    const links = await prisma.guestAccessLink.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(typeof req.query.limit === 'string' ? req.query.limit : '100', 10) || 100, 500),
      select: {
        id: true, guestName: true, guestEmail: true, guestPhone: true, purpose: true,
        cameraId: true, recordingClipId: true, recordingFrom: true, recordingTo: true,
        siteId: true, canViewLive: true, canViewRecording: true, canDownload: true,
        validFrom: true, validUntil: true, maxUses: true, usesCount: true,
        allowedIpCidr: true, watermarkText: true,
        revokedAt: true, revokedReason: true, revokedById: true,
        createdById: true, clienteFinalId: true, createdAt: true,
        // Computed-ish: tem PIN?
        pinHash: true,
      },
    })

    res.json({
      total: links.length,
      links: links.map(l => ({
        ...l,
        hasPin: !!l.pinHash,
        pinHash: undefined,
        status: computeStatus(l),
      })),
    })
  }),
)

function computeStatus(l: { revokedAt: Date | null; validUntil: Date; usesCount: number; maxUses: number }): string {
  if (l.revokedAt) return 'revoked'
  if (l.validUntil.getTime() <= Date.now()) return 'expired'
  if (l.usesCount >= l.maxUses) return 'used_up'
  if (l.usesCount > 0) return 'used'
  return 'active'
}

// =============================================================================
// GET /guest-links/:id
// =============================================================================
guestLinksRouter.get('/:id',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const link = await prisma.guestAccessLink.findUnique({ where: { id: req.params.id } })
    if (!link) throw new NotFoundError('Link convidado')
    await ensureCanAdminGuestLink(req, link)

    const [lastAccesses, totalLogs] = await Promise.all([
      prisma.guestAccessLog.findMany({
        where: { linkId: link.id },
        orderBy: { ts: 'desc' },
        take: 10,
      }),
      prisma.guestAccessLog.count({ where: { linkId: link.id } }),
    ])

    res.json({
      ...link,
      hasPin:        !!link.pinHash,
      pinHash:       undefined,
      tokenHash:     undefined,
      status:        computeStatus(link),
      lastAccesses,
      totalLogs,
    })
  }),
)

// =============================================================================
// GET /guest-links/:id/audit
// =============================================================================
guestLinksRouter.get('/:id/audit',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const link = await prisma.guestAccessLink.findUnique({
      where: { id: req.params.id },
      select: { id: true, clienteFinalId: true },
    })
    if (!link) throw new NotFoundError('Link convidado')
    await ensureCanAdminGuestLink(req, link)

    const limit  = Math.min(parseInt(typeof req.query.limit === 'string' ? req.query.limit : '100', 10) || 100, 500)
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
    const logs   = await guestLinkService.auditLink(link.id, { limit, cursor })

    res.json({
      logs,
      nextCursor: logs.length === limit ? logs[logs.length - 1].id : null,
    })
  }),
)

// =============================================================================
// POST /guest-links/:id/revoke
// =============================================================================
guestLinksRouter.post('/:id/revoke',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const link = await prisma.guestAccessLink.findUnique({
      where: { id: req.params.id },
      select: { id: true, clienteFinalId: true, revokedAt: true },
    })
    if (!link) throw new NotFoundError('Link convidado')
    await ensureCanAdminGuestLink(req, link)

    if (link.revokedAt) {
      res.json({ ok: true, alreadyRevoked: true })
      return
    }
    const parse = RevokeSchema.safeParse(req.body ?? {})
    const reason = parse.success ? (parse.data.reason ?? null) : null

    await guestLinkService.revokeLink(link.id, reason, req.jwtPayload!.sub)
    guestLinkService.logAccess(link.id, 'revoked', {
      ip:        req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      metadata:  { reason, byUser: req.jwtPayload!.sub },
    })

    res.json({ ok: true })
  }),
)

// =============================================================================
// POST /guest-links/bulk-revoke
// =============================================================================
guestLinksRouter.post('/bulk-revoke',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const parse = BulkRevokeSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const jwt = req.jwtPayload!

    // Filtra só links que o caller pode tocar
    const where: Record<string, unknown> = { id: { in: parse.data.ids } }
    if (jwt.role === 'CLIENTE_ADMIN') {
      if (!jwt.clienteFinalId) throw new ForbiddenError()
      where.clienteFinalId = jwt.clienteFinalId
    } else if (jwt.role === 'INTEGRADOR_ADMIN') {
      if (!jwt.integradorId) throw new ForbiddenError()
      where.clienteFinal = { integradorId: jwt.integradorId }
    } else if (!ADMIN_ROLES_GLOBAL.has(jwt.role)) {
      throw new ForbiddenError()
    }

    const targets = await prisma.guestAccessLink.findMany({
      where: { ...where, revokedAt: null } as never,
      select: { id: true },
    })

    await prisma.$transaction(targets.map(t =>
      prisma.guestAccessLink.update({
        where: { id: t.id },
        data:  {
          revokedAt: new Date(),
          revokedReason: parse.data.reason ?? null,
          revokedById: jwt.sub,
        },
      }),
    ))

    for (const t of targets) {
      guestLinkService.logAccess(t.id, 'revoked', {
        ip:        req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        metadata:  { reason: parse.data.reason ?? null, bulk: true },
      })
    }

    res.json({ ok: true, revoked: targets.length })
  }),
)

// ───── Util pro endpoint público: notificar admin quando convidado acessa ───
/**
 * Disparado pelo route público `/guest/:token/access` quando o convidado
 * autentica com sucesso. Best-effort: WhatsApp ao notificationChannel
 * configurado do clienteFinal, fallback log warn.
 */
export async function notifyAdminOnGuestAccess(linkId: string, opts: { ip?: string | null }): Promise<void> {
  try {
    const link = await prisma.guestAccessLink.findUnique({
      where: { id: linkId },
      select: {
        clienteFinalId: true, guestName: true, purpose: true,
        clienteFinal: { select: { integradorId: true } },
      } as never,
    }) as { clienteFinalId: string; guestName: string; purpose: string; clienteFinal: { integradorId: string } } | null
    if (!link) return

    await dispatchAlert({
      integradorId:   link.clienteFinal.integradorId,
      clienteFinalId: link.clienteFinalId,
      title:    `Convidado acessou link: ${link.guestName}`,
      body:     `Motivo: ${link.purpose} · IP ${opts.ip ?? 'desconhecido'}`,
      severity: 'INFO',
      dedupKey: `guest-access:${linkId}`,
      dedupScope: 'guest',
    })
  } catch (err) {
    logger.warn({ err, linkId }, 'guest_notify_admin_failed')
  }
}
