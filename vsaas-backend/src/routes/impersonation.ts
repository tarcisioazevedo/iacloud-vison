/**
 * Impersonation — Lote 5
 *
 * Super Admin assume identidade de um User para debug/suporte.
 * Auditoria forte: toda ação executada fica registrada.
 *
 * Fluxo:
 *   1. POST /auth/impersonate  { targetUserId, reason }
 *      → cria ImpersonationSession + retorna token JWT de curta duração (1h)
 *      → JWT tem campo `impersonatedBy: superAdminId` no payload
 *
 *   2. Frontend detecta `impersonatedBy` → mostra banner "Você está como X"
 *
 *   3. POST /auth/impersonate/end  → encerra sessão (marca endedAt)
 *
 *   4. GET  /auth/impersonate/sessions (SUPER_ADMIN) → lista sessões ativas
 *
 * IMPORTANTE: apenas SUPER_ADMIN pode impersonar. ADMIN_GLOBAL não tem
 * esse poder por design (menor raio de impacto em comprometimento).
 */
import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'

export const impersonationRouter = Router()

// ── POST /auth/impersonate ────────────────────────────────────────────────────

const StartSchema = z.object({
  targetUserId: z.string().uuid(),
  reason:       z.string().min(10).max(500),
})

impersonationRouter.post(
  '/',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const parse = StartSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

    const { targetUserId, reason } = parse.data
    const superAdminId = req.jwtPayload!.sub

    // Impersonar a si mesmo é sem sentido
    if (targetUserId === superAdminId) {
      throw new ValidationError('Não é possível se impersonar')
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true, integradorId: true, clienteFinalId: true, active: true },
    })
    if (!target) throw new NotFoundError('Usuário alvo')
    if (!target.active) throw new ForbiddenError('Usuário inativo — não é possível impersonar')

    const secret = process.env.JWT_SECRET
    if (!secret) throw new Error('JWT_SECRET not configured')

    // JWT de curta duração com flag de impersonação
    const impersonateToken = jwt.sign(
      {
        sub:             target.id,
        role:            target.role,
        integradorId:    target.integradorId ?? undefined,
        clienteFinalId:  target.clienteFinalId ?? undefined,
        impersonatedBy:  superAdminId,  // flag que ativa banner no frontend
      },
      secret,
      { expiresIn: '1h' },
    )

    // Registra sessão — jwtJti é o sub do token (identificador único)
    const session = await prisma.impersonationSession.create({
      data: {
        superAdminId,
        targetUserId: target.id,
        reason,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
    })

    // Audit
    await prisma.auditLog.create({
      data: {
        superAdminId,
        action:       'IMPERSONATION_START',
        resource:     'User',
        resourceId:   target.id,
        metadataJson: { reason, sessionId: session.id, targetRole: target.role },
      },
    })

    logger.warn({
      superAdminId,
      targetUserId: target.id,
      targetRole:   target.role,
      sessionId:    session.id,
      reason,
    }, 'impersonation_started')

    res.json({
      token:   impersonateToken,
      session: { id: session.id, startedAt: session.startedAt },
      target:  { id: target.id, email: target.email, role: target.role },
    })
  }),
)

// ── POST /auth/impersonate/end ────────────────────────────────────────────────

impersonationRouter.post(
  '/end',
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = req.jwtPayload!

    // Funciona tanto para o super admin encerrar remotamente quanto para o
    // "impersonado" encerrar sua própria sessão (quando `impersonatedBy` presente).
    const isImpersonated = 'impersonatedBy' in payload
    const sessionId = req.body?.sessionId as string | undefined

    if (!isImpersonated && payload.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Apenas sessões de impersonação ou SUPER_ADMIN podem encerrar sessões')
    }

    let where: any = {}
    if (sessionId) {
      where = { id: sessionId }
    } else if (isImpersonated) {
      // Encerra a sessão ativa mais recente do sub
      where = { targetUserId: payload.sub, endedAt: null }
    } else {
      // SUPER_ADMIN encerrando por targetUserId
      if (!req.body?.targetUserId) throw new ValidationError('Informe sessionId ou targetUserId')
      where = { targetUserId: req.body.targetUserId, endedAt: null }
    }

    const session = await prisma.impersonationSession.findFirst({ where })
    if (!session) {
      return res.json({ ok: true, message: 'Sessão não encontrada ou já encerrada' })
    }

    await prisma.impersonationSession.update({
      where: { id: session.id },
      data:  { endedAt: new Date(), endedReason: 'manual' },
    })

    await prisma.auditLog.create({
      data: {
        superAdminId: isImpersonated ? (payload as any).impersonatedBy : payload.sub,
        action:       'IMPERSONATION_END',
        resource:     'User',
        resourceId:   session.targetUserId,
        metadataJson: { sessionId: session.id },
      },
    })

    logger.info({ sessionId: session.id }, 'impersonation_ended')
    res.json({ ok: true, sessionId: session.id })
  }),
)

// ── GET /auth/impersonate/sessions ────────────────────────────────────────────

impersonationRouter.get(
  '/sessions',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const active = req.query.active === 'true'
    const sessions = await prisma.impersonationSession.findMany({
      where: active ? { endedAt: null } : {},
      include: {
        target: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 100,
    })
    res.json({ sessions, total: sessions.length })
  }),
)
