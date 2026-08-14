/**
 * Guest Routes (Público) — Sprint F · Magic Link auditável.
 *
 * Endpoints acessados pelo CONVIDADO (sem login, sem JWT user). Auth via token
 * na URL (raw 32 bytes) + opcional PIN. Após autenticar, recebe JWT efêmero
 * (scope='guest', TTL 10min) que envia em todos requests subsequentes.
 *
 *   GET  /guest/:token/info               metadata (sem expor sensível)
 *   POST /guest/:token/access             { pin? } → { guestToken (JWT 10min) }
 *   GET  /guest/:token/stream/live        HLS/proxy ao vivo (auth: JWT)
 *   GET  /guest/:token/recording/timeline timeline restrito à janela
 *   GET  /guest/:token/recording/clip/:id download de clipe (se canDownload)
 *   POST /guest/:token/log                cliente reporta ações (heartbeat)
 *
 * Rate limit: POST /guest/:token/access tem 3 tentativas/min por token+IP.
 * Após 5 falhas em 10min, o link é auto-revogado.
 */
import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { guestLinkService, sha256 } from '../lib/guest-link.service'
import {
  requireGuestAuth, requireGuestCapability, signGuestJwt, GUEST_JWT_TTL_SEC,
} from '../middleware/guest-auth'
import { playbackService } from '../services/playback.service'
import { logger } from '../lib/logger'
import { notifyAdminOnGuestAccess } from './guest-links'

export const guestRouter = Router()

// Rate limit pra brute-force de PIN.
const accessLimiter = rateLimit({
  windowMs: 60_000,
  max:      3,
  keyGenerator: (req) => {
    const tok = req.params?.token ?? 'no-token'
    // Hash leve do token + IP — não vaza segredo no Redis nem no log
    return `guest-pin:${sha256(String(tok)).slice(0, 16)}:${req.ip}`
  },
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'PIN_RATE_LIMIT', message: 'Muitas tentativas de PIN. Aguarde 1 minuto.' },
})

// Tracking de falhas pra auto-revoke após 5 em 10min (in-memory, host-local).
// Pra escalar multi-instance, mover pra Redis (mas pra MVP single-host basta).
const failureTracker = new Map<string, { count: number; firstAt: number }>()
function trackFailure(tokenHash: string): { count: number } {
  const now = Date.now()
  const k = tokenHash.slice(0, 16)
  const cur = failureTracker.get(k)
  if (!cur || now - cur.firstAt > 10 * 60_000) {
    failureTracker.set(k, { count: 1, firstAt: now })
    return { count: 1 }
  }
  cur.count += 1
  return { count: cur.count }
}
function clearFailures(tokenHash: string): void {
  failureTracker.delete(tokenHash.slice(0, 16))
}
// =============================================================================
// GET /guest/:token/info
// =============================================================================
guestRouter.get('/:token/info',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const raw = String(req.params.token || '')
    if (raw.length < 16) throw new ValidationError('Token inválido')

    const hash = sha256(raw)
    const link = await prisma.guestAccessLink.findUnique({
      where: { tokenHash: hash },
      select: {
        id: true, guestName: true, purpose: true,
        cameraId: true, recordingClipId: true, siteId: true,
        recordingFrom: true, recordingTo: true,
        canViewLive: true, canViewRecording: true, canDownload: true,
        validFrom: true, validUntil: true,
        revokedAt: true, pinHash: true,
        clienteFinalId: true,
        createdBy:   { select: { name: true } },
        clienteFinal:{ select: { name: true, primaryColor: true, secondaryColor: true } },
      },
    })
    if (!link) throw new NotFoundError('Link')

    let scopeLabel = ''
    if (link.cameraId) {
      const cam = await prisma.camera.findUnique({
        where: { id: link.cameraId }, select: { name: true },
      })
      scopeLabel = cam?.name ? `Câmera: ${cam.name}` : 'Câmera'
    } else if (link.siteId) {
      const site = await prisma.site.findUnique({
        where: { id: link.siteId }, select: { name: true },
      })
      scopeLabel = site?.name ? `Site: ${site.name}` : 'Site'
    } else if (link.recordingClipId) {
      scopeLabel = 'Clipe de gravação'
    }

    // Audit: opened
    guestLinkService.logAccess(link.id, 'opened', {
      ip:        req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    })

    res.json({
      id:         link.id,
      guestName:  link.guestName,
      purpose:    link.purpose,
      scope: {
        kind:        link.cameraId ? 'camera' : link.siteId ? 'site' : 'clip',
        label:       scopeLabel,
        hasRecordingWindow: !!(link.recordingFrom && link.recordingTo),
        recordingFrom: link.recordingFrom?.toISOString() ?? null,
        recordingTo:   link.recordingTo?.toISOString() ?? null,
      },
      capabilities: {
        live:      link.canViewLive,
        recording: link.canViewRecording,
        download:  link.canDownload,
      },
      validFrom:  link.validFrom.toISOString(),
      validUntil: link.validUntil.toISOString(),
      requiresPin: !!link.pinHash,
      revoked:     !!link.revokedAt,
      expired:     link.validUntil.getTime() <= Date.now(),
      createdBy:   link.createdBy?.name ?? '—',
      tenant: {
        name:           link.clienteFinal?.name ?? '—',
        primaryColor:   link.clienteFinal?.primaryColor ?? null,
        secondaryColor: link.clienteFinal?.secondaryColor ?? null,
      },
    })
  }),
)

// =============================================================================
// POST /guest/:token/access
// =============================================================================
guestRouter.post('/:token/access',
  publicRoute(),
  accessLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const raw = String(req.params.token || '')
    if (raw.length < 16) throw new ValidationError('Token inválido')

    const body = z.object({ pin: z.string().min(4).max(8).optional() })
      .safeParse(req.body ?? {})
    const pin = body.success ? (body.data.pin ?? null) : null

    const hash = sha256(raw)
    const result = await guestLinkService.validateAccess(raw, { pin, ip: req.ip ?? null })

    if (!result.allowed) {
      const linkId = result.link?.id
      // Log denial
      if (linkId) {
        const actionMap: Record<string, string> = {
          'expired':      'denied_expired',
          'revoked':      'denied_revoked',
          'max_uses':     'denied_max_uses',
          'ip_blocked':   'denied_ip',
          'pin_required': 'denied_pin',
          'pin_wrong':    'pin_failed',
        }
        const action = actionMap[result.denyReason ?? ''] ?? 'denied'
        guestLinkService.logAccess(linkId, action, {
          ip:        req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
          metadata:  { reason: result.denyReason },
        })

        // Auto-revoga após 5 falhas de PIN em 10min
        if (result.denyReason === 'pin_wrong') {
          const t = trackFailure(hash)
          if (t.count >= 5) {
            await guestLinkService.revokeLink(linkId,
              'Auto-revogado: 5 PINs errados em 10 min (brute force suspeito)',
              null,
            )
            guestLinkService.logAccess(linkId, 'revoked', {
              ip:        req.ip ?? null,
              userAgent: req.get('user-agent') ?? null,
              metadata:  { auto: true, reason: 'brute_force_protection' },
            })
          }
        }
      }
      throw new ForbiddenError(denyReasonToMessage(result.denyReason))
    }

    const link = result.link!
    // Atomicamente incrementa usesCount
    const ok = await guestLinkService.consumeUse(link.id)
    if (!ok) {
      // Race: outro convidado consumiu o último uso entre validate e consume
      throw new ForbiddenError('Link esgotado ou expirou neste exato momento')
    }
    clearFailures(hash)

    guestLinkService.logAccess(link.id, 'pin_verified', {
      ip:        req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    })

    // Notificação ao admin (best-effort, async)
    notifyAdminOnGuestAccess(link.id, { ip: req.ip ?? null }).catch(() => { /* logged inside */ })

    const guestToken = signGuestJwt(link.id)
    res.json({
      guestToken,
      ttlSeconds: GUEST_JWT_TTL_SEC,
      link: {
        id:         link.id,
        guestName:  link.guestName,
        watermarkText: link.watermarkText ?? link.guestName,
        capabilities: {
          live:      link.canViewLive,
          recording: link.canViewRecording,
          download:  link.canDownload,
        },
        scope: {
          kind: link.cameraId ? 'camera' : link.siteId ? 'site' : 'clip',
          cameraId:        link.cameraId,
          siteId:          link.siteId,
          recordingClipId: link.recordingClipId,
          recordingFrom:   link.recordingFrom?.toISOString() ?? null,
          recordingTo:     link.recordingTo?.toISOString() ?? null,
        },
        validUntil: link.validUntil.toISOString(),
      },
    })
  }),
)

function denyReasonToMessage(reason: string | undefined): string {
  switch (reason) {
    case 'not_found':    return 'Link não encontrado'
    case 'expired':      return 'Link expirou'
    case 'revoked':      return 'Link foi revogado pelo administrador'
    case 'max_uses':     return 'Link já atingiu o número máximo de usos'
    case 'ip_blocked':   return 'Acesso não permitido a partir deste IP'
    case 'pin_required': return 'PIN obrigatório'
    case 'pin_wrong':    return 'PIN incorreto'
    default:             return 'Acesso negado'
  }
}

// =============================================================================
// GET /guest/:token/stream/live
// Proxy/redirect pro playback HLS da câmera autorizada — gera ticket do
// playback service (TTL 30min) e responde com URL + ticket. Frontend pluga no
// hls.js. Mantemos delegação ao playback existente (não duplicar lógica HLS).
// =============================================================================
guestRouter.get('/:token/stream/live',
  publicRoute(),
  requireGuestAuth,
  requireGuestCapability('live'),
  asyncHandler(async (req: Request, res: Response) => {
    const link = req.guestLink!
    if (!link.cameraId) throw new ForbiddenError('Link não tem câmera ao vivo')

    // Range live: últimos 60s até now (playback service inclui PENDING).
    const now = Date.now()
    const ticket = playbackService.issueTicket(link.cameraId, now - 60_000, now)

    guestLinkService.logAccess(link.id, 'viewed_live', {
      ip:        req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      metadata:  { cameraId: link.cameraId },
    })

    res.json({
      cameraId:    link.cameraId,
      manifestUrl: ticket.manifestUrl,
      ticket:      ticket.ticket,
    })
  }),
)

// =============================================================================
// GET /guest/:token/recording/timeline
// =============================================================================
guestRouter.get('/:token/recording/timeline',
  publicRoute(),
  requireGuestAuth,
  requireGuestCapability('recording'),
  asyncHandler(async (req: Request, res: Response) => {
    const link = req.guestLink!
    if (!link.cameraId) throw new ForbiddenError('Timeline só para escopo câmera')

    // Restringe ao window se setado
    const from = link.recordingFrom ?? new Date(Date.now() - 24 * 60 * 60 * 1000)
    const to   = link.recordingTo   ?? new Date()

    const segs = await prisma.recordingSegment.findMany({
      where: {
        cameraId:  link.cameraId,
        startedAt: { gte: from },
        endedAt:   { lte: to },
      },
      orderBy: { startedAt: 'asc' },
      select: { id: true, startedAt: true, endedAt: true, durationSec: true, hasMotion: true, hasEvent: true },
      take: 5000,
    })

    const ticket = playbackService.issueTicket(link.cameraId, from.getTime(), to.getTime())

    guestLinkService.logAccess(link.id, 'viewed_recording', {
      ip:        req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      metadata:  { cameraId: link.cameraId, fromIso: from.toISOString(), toIso: to.toISOString() },
    })

    res.json({
      cameraId:    link.cameraId,
      windowFrom:  from.toISOString(),
      windowTo:    to.toISOString(),
      segments:    segs,
      manifestUrl: ticket.manifestUrl,
      ticket:      ticket.ticket,
    })
  }),
)

// =============================================================================
// GET /guest/:token/recording/clip/:id
// =============================================================================
guestRouter.get('/:token/recording/clip/:id',
  publicRoute(),
  requireGuestAuth,
  requireGuestCapability('download'),
  asyncHandler(async (req: Request, res: Response) => {
    const link = req.guestLink!
    // O id pode ser de RecordingSegment OU Bookmark
    const targetId = req.params.id

    let cameraId: string | null = null
    let startedAt: Date | null = null
    let endedAt: Date | null = null

    const seg = await prisma.recordingSegment.findFirst({
      where: { id: targetId },
      select: { cameraId: true, startedAt: true, endedAt: true },
    })
    if (seg) {
      cameraId = seg.cameraId
      startedAt = seg.startedAt
      endedAt   = seg.endedAt
    } else {
      const bm = await prisma.bookmark.findUnique({
        where: { id: targetId },
        select: { cameraId: true, startAt: true, endAt: true },
      })
      if (!bm) throw new NotFoundError('Clipe')
      cameraId  = bm.cameraId
      startedAt = bm.startAt
      endedAt   = bm.endAt ?? new Date(bm.startAt.getTime() + 60_000)
    }

    // Bloqueia se não é a câmera/site do link
    if (link.cameraId && cameraId !== link.cameraId) {
      throw new ForbiddenError('Clipe fora do escopo do link')
    }
    if (link.siteId) {
      const cam = await prisma.camera.findFirst({
        where: { id: cameraId, site: { id: link.siteId } },
        select: { id: true },
      })
      if (!cam) throw new ForbiddenError('Clipe fora do site do link')
    }
    // Janela
    if (link.recordingFrom && startedAt && startedAt < link.recordingFrom) {
      throw new ForbiddenError('Clipe antes da janela permitida')
    }
    if (link.recordingTo && endedAt && endedAt > link.recordingTo) {
      throw new ForbiddenError('Clipe depois da janela permitida')
    }

    // Emite ticket do playback no range exato do clipe
    if (!cameraId || !startedAt || !endedAt) throw new NotFoundError('Clipe')
    const ticket = playbackService.issueTicket(cameraId, startedAt.getTime(), endedAt.getTime())

    guestLinkService.logAccess(link.id, 'downloaded', {
      ip:        req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      metadata:  { clipId: targetId, cameraId },
    })

    res.json({
      clipId:      targetId,
      cameraId,
      from:        startedAt.toISOString(),
      to:          endedAt.toISOString(),
      manifestUrl: ticket.manifestUrl,
      ticket:      ticket.ticket,
    })
  }),
)

// =============================================================================
// POST /guest/:token/log
// =============================================================================
guestRouter.post('/:token/log',
  publicRoute(),
  requireGuestAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const link = req.guestLink!
    const body = z.object({
      action:           z.enum(['heartbeat', 'session_end', 'viewed_live', 'viewed_recording', 'downloaded']),
      durationSeconds:  z.number().int().min(0).max(86400).optional(),
      metadata:         z.record(z.unknown()).optional(),
    }).safeParse(req.body ?? {})
    if (!body.success) {
      throw new ValidationError(body.error.errors[0]?.message ?? 'body inválido')
    }
    guestLinkService.logAccess(link.id, body.data.action, {
      ip:              req.ip ?? null,
      userAgent:       req.get('user-agent') ?? null,
      durationSeconds: body.data.durationSeconds ?? null,
      metadata:        body.data.metadata ?? null,
    })
    res.json({ ok: true })
  }),
)

// ───── Cron: cleanup expirados (chamado por app.ts no boot) ──────────────────
export function startGuestLinkCleanupCron(): void {
  const enabled = process.env.GUEST_LINK_CLEANUP_ENABLED !== 'false'
  if (!enabled) return
  // 1 vez por dia
  setInterval(() => {
    guestLinkService.cleanupExpired().catch(err => {
      logger.warn({ err }, 'guest_link_cleanup_failed')
    })
  }, 24 * 60 * 60 * 1000)
  logger.info('guest_link_cleanup_cron_started')
}
